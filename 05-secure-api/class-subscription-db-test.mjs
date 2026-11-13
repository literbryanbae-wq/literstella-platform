// 구독 가상 회원 시험 — 실제 Postgres(PGlite) 위에 DB 초안을 올리고, 가짜 토스로 서버 모듈을 끝까지 돌린다.
//   PGLITE_ENTRY=<…/@electric-sql/pglite/dist/index.js> node class-subscription-db-test.mjs
//   흐름: 견적 → 카드 등록·첫 결제 → 강의 열림 → 자동 갱신 → 결제 실패 4번 → 해지 → 기간 끝 → 올인원 전환 견적
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { classSubscription, chargeDueSubscriptions } from './src/class-subscription.mjs';

if (!process.env.PGLITE_ENTRY) { console.log('class-subscription-db-test: PGLITE_ENTRY 가 없어 건너뜀'); process.exit(0); }
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_ENTRY).href);
const db = new PGlite();
const U = '00000000-0000-4000-8000-0000000000a1'; // 키다리 1권 소장 → 연간 개인
const V = '00000000-0000-4000-8000-0000000000b2'; // 소장 없음 → 월 함께 읽기
const W = '00000000-0000-4000-8000-0000000000c3'; // 구독 안 함(대조군)
const P = '00000000-0000-4000-8000-0000000000d4'; // 포인트 5,000P 보유 → 함께 읽기 연간을 포인트 + 카드로
const T = '00000000-0000-4000-8000-0000000000f6'; // 무료로 먼저 써 본 회원 → 월 개인(+1달) → 연간 전환
const T2 = '00000000-0000-4000-8000-0000000000a7'; // 무료로 먼저 써 본 회원 → 연간 함께 읽기(+6달)
const PM = '00000000-0000-4000-8000-0000000000e5'; // P 의 회원 행(public.users.id — 포인트 원장은 이 id 를 쓴다)

// ── 운영 DB 에 이미 있는 것들의 최소 모형(함수 본문은 2026-11-12 운영 정의를 그대로 옮김) ──
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema private;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', nullif(current_setting('test.email', true), '')) $$;
  create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz default now());
  create table public.class_verifications(email text, book_code text);
  create table public.class_redemptions(redeemed_by text, book_code text);
  create table public.class_access_passes(email text, status text, starts_at timestamptz, expires_at timestamptz, book_codes text[]);
  create table public.class_trial_signups(user_id uuid, kind text, canceled_at timestamptz, ends_at timestamptz);
  create function private.class_trial_books(p_kind text) returns text[] language sql immutable as $$ select array['kidari']::text[] $$;
  create function private.class_trial_open_books(p_uid uuid) returns text[] language sql stable as $$
    select coalesce((select private.class_trial_books(t.kind) from public.class_trial_signups t
      where t.user_id = p_uid and t.canceled_at is null and (t.ends_at is null or t.ends_at > now())), array[]::text[]) $$;
  create function private.class_owned_originals(p_email text) returns integer language sql stable as $$
    select count(distinct b)::int from (
      select cv.book_code as b from public.class_verifications cv where lower(cv.email) = lower(p_email)
      union select cr.book_code from public.class_redemptions cr where lower(cr.redeemed_by) = lower(p_email)) x
    where b in ('kidari','anne','littlewomen1','littlewomen2','pride','sherlock','gatsby') $$;
  create function public.check_my_class_access(book_code text) returns boolean language sql stable security definer as $$
  select
    exists (select 1 from public.class_verifications cv where cv.book_code = $1 and lower(cv.email) = lower(auth.jwt() ->> 'email'))
    or exists (select 1 from public.class_redemptions cr where cr.book_code = $1 and lower(cr.redeemed_by) = lower(auth.jwt() ->> 'email'))
    or ($1 = any(private.class_trial_open_books(auth.uid())));
  $$;
  create table public.stella_upgrade_requests(user_id uuid, status text);
  create table public.class_checkout_orders(id text primary key, user_id uuid, status text, product_code text);
  create function public.class_checkout_quote(p_user_id uuid) returns jsonb language plpgsql stable security definer as $fn$
declare
  v_email text;
  v_all text[] := array['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock','theory'];
  v_owned text[];
  v_missing text[];
  v_blocked boolean;
  v_paid int;
  v_theory boolean := false;
  v_n int;
begin
  select lower(email) into v_email from auth.users where id=p_user_id and email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('ok',false,'error','login_required'); end if;
  select coalesce(array_agg(c order by n),array[]::text[]) into v_owned
    from unnest(v_all) with ordinality t(c,n)
    where exists(select 1 from public.class_verifications v where lower(v.email)=v_email and v.book_code=c)
       or exists(select 1 from public.class_redemptions r where lower(r.redeemed_by)=v_email and r.book_code=c);
  select count(*) into v_paid from unnest(v_owned) b where b<>'theory';
  if v_paid>=2 and not ('theory'=any(v_owned)) then
    v_theory := true;
    select coalesce(array_agg(c order by n),array[]::text[]) into v_owned
      from unnest(v_all) with ordinality t(c,n) where c=any(v_owned) or c='theory';
  end if;
  select coalesce(array_agg(c order by n),array[]::text[]) into v_missing
    from unnest(v_all) with ordinality t(c,n) where not(c=any(v_owned));
  select exists(select 1 from public.stella_upgrade_requests where user_id=p_user_id
    and status in ('pending','coupon_issued','completed')) into v_blocked;
  v_n := cardinality(v_owned);
  return jsonb_build_object('ok',true,'userId',p_user_id,'email',v_email,
    'baseAmount',398000,'ownedBooks',v_owned,'missingBooks',v_missing,
    'ownedCount',v_n,'creditAmount',least(v_n*50000,398000),
    'amount',greatest(398000-v_n*50000,0),'complete',v_n=8,
    'eligible',v_n between 0 and 7 and not v_blocked,
    'newBuyer',v_n=0,'theoryIncluded',v_theory,
    'existingRequest',v_blocked);
end $fn$;
  insert into auth.users(id, email) values ('${U}', 'u@example.test'), ('${V}', 'v@example.test'), ('${W}', 'w@example.test'), ('${P}', 'p@example.test'), ('${T}', 't@example.test'), ('${T2}', 't2@example.test');
  -- 포인트 원장(운영 제약 그대로: 사유 목록에 구독이 없고 한 줄 한도 3,000P — 포인트 초안이 넓힌다)
  create table public.users(id uuid primary key, auth_uid uuid);
  create table public.point_transactions(id bigserial primary key, user_id uuid not null references public.users(id), season_id text,
    amount integer not null, reason text not null, ref_id text, memo text, created_at timestamptz not null default now(),
    unique (user_id, reason, ref_id),
    constraint point_tx_amount_range check (amount >= -3000 and amount <= 3000 and amount <> 0),
    constraint point_tx_reason_whitelist check (reason = any (array['checkin','adjust','spend_extension','signup'])));
  insert into public.users values ('${PM}', '${P}');
  insert into public.point_transactions(user_id, amount, reason, ref_id) values ('${PM}', 3000, 'adjust', 'seed1'), ('${PM}', 2000, 'adjust', 'seed2');
  insert into public.class_verifications values ('u@example.test', 'kidari');
`);
await db.exec(await readFile(new URL('./supabase/migrations/20261112100000_class_subscription_billing.sql', import.meta.url), 'utf8'));
const CONV = await readFile(new URL('./supabase/migrations/20261112110000_class_subscription_conversion.sql', import.meta.url), 'utf8');
await db.exec(CONV); await db.exec(CONV);
await db.exec(await readFile(new URL('./supabase/migrations/20261112120000_class_subscription_gate.sql', import.meta.url), 'utf8'));
const gateBooks = async (email) => (await db.query(`select public.class_subscription_books_by_email('${email}') as v`)).rows[0].v;
// 한 번 더 돌려도 된다(이미 들어간 한 줄은 건너뛴다)
await db.exec(await readFile(new URL('./supabase/migrations/20261112100000_class_subscription_billing.sql', import.meta.url), 'utf8'));
// 포인트 초안은 맨 뒤에(예전 8칸짜리 가입 함수를 지우고 9칸짜리로 바꾼다) · 두 번 돌려도 된다
const POINTS = await readFile(new URL('./supabase/migrations/20261113090000_class_subscription_points.sql', import.meta.url), 'utf8');
await db.exec(POINTS); await db.exec(POINTS);
// 런칭 선물(더 드리는 달) + 월 → 연간 전환 — 맨 뒤에 · 두 번 돌려도 된다
const LAUNCH = await readFile(new URL('./supabase/migrations/20261113100000_class_subscription_launch_upgrade.sql', import.meta.url), 'utf8');
await db.exec(LAUNCH); await db.exec(LAUNCH);
// 핵심 이론 할인 + 전환 결제 환불 규칙(2026-11-13) — 맨 뒤에 · 두 번 돌려도 된다
//   lecture_progress 는 운영에 이미 있다(마이그레이션이 만들지 않는다) — 시험에서만 최소 칸으로 만든다.
await db.exec(`create table public.lecture_progress(email text, book_code text, ep smallint, first_seen_at timestamptz default now(), last_seen_at timestamptz default now())`);
const REFUND = await readFile(new URL('./supabase/migrations/20261113110000_class_subscription_theory_refund.sql', import.meta.url), 'utf8');
await db.exec(REFUND); await db.exec(REFUND);
await db.exec(`insert into public.class_trial_signups(user_id, kind) values ('${T}', 'all'), ('${T2}', 'all')`);

// ── 서버가 쓰는 DB 통로(PostgREST 흉내) ──
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const sbFetch = async (_env, path, init = {}) => {
  if (path.startsWith('rpc/')) {
    const args = init.body ? JSON.parse(init.body) : {};
    const list = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
    const r = await db.query(`select public.${path.slice(4)}(${list}) as v`);
    return json(r.rows[0].v);
  }
  const [table, qs] = path.split('?');
  const p = new URLSearchParams(qs);
  const where = [...p.entries()].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => `${k}::text = ${lit(v.slice(3))}`).join(' and ');
  const r = await db.query(`select ${p.get('select') || '*'} from public.${table} where ${where || 'true'} limit ${Number(p.get('limit')) || 50}`);
  return json(r.rows);
};

// ── 가짜 토스 ──
const toss = { payments: new Map(), charges: 0, decline: false, unclear: false, lastAmount: null };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const body = init.body ? JSON.parse(init.body) : {};
  if (u.endsWith('/billing/authorizations/issue')) return json({ billingKey: `bk_${body.customerKey}` });
  if (u.includes('/billing/')) {
    if (toss.decline) return json({ code: 'REJECT_CARD_COMPANY' }, 400);
    if (toss.unclear) return json({ code: 'PROVIDER_ERROR' }, 500);
    const prev = [...toss.payments.values()].find((x) => x.orderId === body.orderId);
    if (prev) return json({ code: 'ALREADY_PROCESSED_PAYMENT', paymentKey: prev.paymentKey }, 400);
    toss.charges++; toss.lastAmount = body.amount;
    const pay = { paymentKey: `pk_${toss.charges}`, orderId: body.orderId, totalAmount: body.amount, balanceAmount: body.amount, currency: 'KRW', status: 'DONE' };
    toss.payments.set(pay.paymentKey, pay);
    return json(pay);
  }
  const m = u.match(/\/payments\/([^/]+)$/);
  if (m && toss.payments.has(decodeURIComponent(m[1]))) return json(toss.payments.get(decodeURIComponent(m[1])));
  return json({}, 404);
};

const ENV = { CLASS_SUBSCRIPTION_ENABLED: 'true', TOSS_BILLING_SECRET_KEY: 'sk', TOSS_BILLING_CLIENT_KEY: 'ck',
  CLASS_SUBSCRIPTION_TERMS_URL: 'https://class-new.literstella.co.kr/subscribe#terms', CLASS_SUBSCRIPTION_TERMS_VERSION: 'sub-2026-12' };
const api = async (uid, action, body) => {
  const deps = { requireUser: async () => ({ id: uid, emailConfirmed: true }), sbFetch, json };
  const r = await classSubscription(new Request(`https://x/api/class-subscription/${action}`, { method: 'POST', body: JSON.stringify(body || {}) }), ENV, {}, action, deps);
  return { status: r.status, body: await r.json() };
};
const access = async (uid, email, book) => {
  await db.exec(`set test.uid = '${uid}'; set test.email = '${email}'; set role authenticated;`);
  try { return (await db.query(`select public.check_my_class_access(${lit(book)}) as ok`)).rows[0].ok; }
  finally { await db.exec('reset role;'); }
};
const sub = async (uid) => (await db.query(`select * from public.class_subscriptions where user_id = '${uid}' order by created_at desc limit 1`)).rows[0];
const join = async (uid, plan, cycle) => {
  const q = await api(uid, 'quote', { plan, cycle });
  const p = await api(uid, 'prepare', { plan, cycle, expectedAmount: q.body.amount, acceptedTermsVersion: 'sub-2026-12' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const c = await api(uid, 'confirm', { orderId: p.body.orderId, authKey: 'auth' });
  return { q: q.body, p: p.body, c };
};

let n = 0;
const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

await check('구독 전: 소장한 책만 열려 있다', async () => {
  assert.equal(await access(U, 'u@example.test', 'kidari'), true);
  assert.equal(await access(U, 'u@example.test', 'anne'), false);
});

let first;
await check('연간 개인 가입: 1권 소장 할인 88,000원 · 한 번만 청구 · 강의가 열린다', async () => {
  first = await join(U, 'solo', 'year');
  assert.equal(first.q.amount, 88000);
  assert.equal(first.c.status, 200); assert.equal(first.c.body.status, 'paid');
  assert.equal(toss.charges, 1);
  const s = await sub(U);
  assert.equal(s.status, 'active'); assert.equal(s.billing_key, `bk_${s.customer_key}`);
  for (const b of ['anne', 'theory', 'oz', 'littleprince']) assert.equal(await access(U, 'u@example.test', b), true, b);
  assert.equal(await access(W, 'w@example.test', 'anne'), false, '구독 안 한 회원은 그대로 닫혀 있다');
  assert.equal((await gateBooks('U@example.test')).length, 10, '강의 서버용 목록: 연간 10권(이메일 대소문자 무관)');
  assert.equal((await gateBooks('w@example.test')).length, 0);
});

await check('같은 주문을 다시 확정해도 두 번 청구하지 않는다 · 구독 중에는 또 가입할 수 없다', async () => {
  const again = await api(U, 'confirm', { orderId: first.p.orderId, authKey: 'auth' });
  assert.equal(again.body.status, 'paid'); assert.equal(toss.charges, 1);
  const p = await api(U, 'prepare', { plan: 'solo', cycle: 'year', expectedAmount: 88000, acceptedTermsVersion: 'sub-2026-12' });
  assert.equal(p.body.error, 'already_subscribed');
});

await check('회원 화면용 조회에는 빌링키·결제 키가 없다 · 비로그인·다른 역할은 서버 함수를 못 부른다', async () => {
  await db.exec(`set test.uid = '${U}'; set role authenticated;`);
  const mine = (await db.query('select public.my_class_subscription() as v')).rows[0].v;
  assert.equal(mine.subscription.status, 'active');
  assert.ok(!JSON.stringify(mine).includes('bk_') && !JSON.stringify(mine).includes('pk_'));
  await assert.rejects(db.query(`select public.class_subscription_due(5)`), /permission denied/);
  await assert.rejects(db.query(`select * from public.class_subscriptions`), /permission denied/);
  await db.exec('reset role; set role anon;');
  await assert.rejects(db.query('select public.my_class_subscription()'), /permission denied/);
  await db.exec('reset role;');
});

await check('자동 갱신: 기간이 끝나면 한 번 청구하고 1년 늘린다 · 크론이 겹쳐 돌아도 한 번', async () => {
  const before = await sub(U);
  await db.exec(`update public.class_subscriptions set next_charge_at = now() - interval '1 minute' where user_id = '${U}'`);
  const out = await chargeDueSubscriptions(ENV, { sbFetch });
  assert.deepEqual({ due: out.due, paid: out.paid, failed: out.failed }, { due: 1, paid: 1, failed: 0 });
  assert.equal((await chargeDueSubscriptions(ENV, { sbFetch })).due, 0);
  const after = await sub(U);
  assert.equal(toss.charges, 2);
  assert.equal(new Date(after.current_period_end).getTime() - new Date(before.current_period_end).getTime() > 360 * 86400e3, true);
  assert.equal(new Date(after.next_charge_at).getTime(), new Date(after.current_period_end).getTime());
});

await check('전환 견적: 1권 소장 348,000원에서 지금까지 낸 구독료(88,000원 × 2)를 뺀다', async () => {
  const r = await api(U, 'status');
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (today <= '2026-12-31') {
    assert.equal(r.body.conversion.basePrice, 348000);
    assert.equal(r.body.conversion.credit, 176000);
    assert.equal(r.body.conversion.amount, 172000);
  } else assert.equal(r.body.conversion, null, '기한이 지나면 차감 안내가 없다');
});

await check('올인원 주문서 금액(DB)도 같은 만큼 빠진다 · 소장 결제가 끝나면 구독의 다음 결제가 멈춘다', async () => {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const q = (await db.query(`select public.class_checkout_quote('${U}') as v`)).rows[0].v;
  assert.equal(q.amount, today <= '2026-12-31' ? 172000 : 348000);
  assert.equal(q.subscriptionCredit, today <= '2026-12-31' ? 176000 : 0);
  assert.equal((await db.query(`select public.class_checkout_quote('${W}') as v`)).rows[0].v.amount, 398000, '구독 안 한 회원은 그대로');
  await db.exec(`begin; insert into public.class_checkout_orders values ('clsx', '${U}', 'confirming', 'class-stella-member-upgrade');
    update public.class_checkout_orders set status = 'paid' where id = 'clsx';`);
  const s = await sub(U);
  assert.ok(s.cancel_requested_at && s.next_charge_at === null && s.status === 'active');
  await db.exec('rollback;'); // 뒤 시험(결제 실패)이 살아 있는 구독을 쓴다
});

await check('결제 실패: 하루 뒤 다시 · 4번 실패하면 끝나고 강의가 닫힌다', async () => {
  toss.decline = true;
  for (let i = 1; i <= 4; i++) {
    await db.exec(`update public.class_subscriptions set next_charge_at = now() - interval '1 minute' where user_id = '${U}' and status in ('active','past_due')`);
    const out = await chargeDueSubscriptions(ENV, { sbFetch });
    assert.equal(out.failed, 1, `실패 ${i}`);
    const s = await sub(U);
    assert.equal(s.status, i < 4 ? 'past_due' : 'expired');
    if (i < 4) assert.equal(await access(U, 'u@example.test', 'anne'), true, '낸 기간 안에는 그대로 열려 있다');
  }
  toss.decline = false;
  assert.equal(await access(U, 'u@example.test', 'anne'), false);
  assert.equal(await access(U, 'u@example.test', 'kidari'), true, '소장한 책은 그대로');
  assert.equal((await gateBooks('u@example.test')).length, 0, '끝난 구독은 강의 서버에도 빈 목록');
  assert.equal(toss.charges, 2);
});

await check('월 함께 읽기 가입 → 해지: 다음 결제만 멈추고 낸 기간 끝까지 열려 있다 → 기간이 끝나면 닫힌다', async () => {
  const j = await join(V, 'together', 'month');
  assert.equal(j.q.amount, 14900); assert.equal(j.c.body.status, 'paid');
  assert.equal(await access(V, 'v@example.test', 'pride'), true);
  assert.equal(await access(V, 'v@example.test', 'oz'), false, '월 구독에는 오즈·어린 왕자가 없다');
  assert.equal((await gateBooks('v@example.test')).length, 8, '강의 서버용 목록: 월 8권');
  const c = await api(V, 'cancel');
  assert.equal(c.body.ok, true);
  await db.exec(`update public.class_subscriptions set next_charge_at = now() - interval '1 minute' where user_id = '${V}'`); // 누가 되살려도
  const charges = toss.charges;
  assert.equal((await chargeDueSubscriptions(ENV, { sbFetch })).due, 0, '해지한 구독은 청구 대상이 아니다');
  assert.equal(toss.charges, charges);
  assert.equal(await access(V, 'v@example.test', 'pride'), true);
  await db.exec(`update public.class_subscriptions set current_period_end = now() - interval '1 minute' where user_id = '${V}'`);
  assert.equal(await access(V, 'v@example.test', 'pride'), false, '정리 크론이 돌기 전이라도 기간이 끝나면 닫힌다');
  await chargeDueSubscriptions(ENV, { sbFetch });
  assert.equal((await sub(V)).status, 'canceled');
  assert.equal(await access(V, 'v@example.test', 'pride'), false);
});

await check('끝난 뒤에는 다시 가입할 수 있다', async () => {
  const j = await join(V, 'solo', 'year');
  assert.equal(j.q.amount, 99000); assert.equal(j.c.body.status, 'paid');
  assert.equal(await access(V, 'v@example.test', 'oz'), true);
});

await check('전액 취소(환불) 웹훅: 토스에 다시 물어 반영하고 강의를 닫는다', async () => {
  const s = await sub(V);
  const pay = (await db.query(`select id, payment_key from public.class_subscription_payments where subscription_id = '${s.id}' and status = 'paid'`)).rows[0];
  const t = toss.payments.get(pay.payment_key); t.status = 'CANCELED'; t.balanceAmount = 0;
  const deps = { requireUser: async () => null, sbFetch, json };
  const r = await classSubscription(new Request('https://x/api/class-subscription/webhook', { method: 'POST', body: JSON.stringify({ data: { paymentKey: pay.payment_key, orderId: pay.id } }) }), ENV, {}, 'webhook', deps);
  assert.equal(r.status, 200);
  assert.equal((await sub(V)).status, 'canceled');
  assert.equal(await access(V, 'v@example.test', 'oz'), false);
});

// ── 구독료의 30%까지 포인트(1P = 10원) — 첫 결제에만 ──
const balance = async () => (await db.query(`select coalesce(sum(amount),0)::int as b from public.point_transactions where user_id = '${PM}'`)).rows[0].b;
const terms = { acceptedTermsVersion: 'sub-2026-12' };

await check('견적: 쓸 수 있는 포인트 = 구독료의 30%와 가진 포인트 중 작은 쪽', async () => {
  const solo = (await api(P, 'quote', { plan: 'solo', cycle: 'year' })).body;
  assert.equal(solo.pointsBalance, 5000); assert.equal(solo.pointsMax, 2970);
  const tog = (await api(P, 'quote', { plan: 'together', cycle: 'year' })).body;
  assert.equal(tog.pointsMax, 4470);
  assert.equal((await api(W, 'quote', { plan: 'solo', cycle: 'year' })).body.pointsMax, 0, '포인트가 없는 회원은 0');
});

await check('주문: 한도를 넘거나 모자라면 주문을 만들지 않는다', async () => {
  assert.equal((await api(P, 'prepare', { plan: 'solo', cycle: 'year', expectedAmount: 99000, usePoints: 2971, ...terms })).body.error, 'bad_points');
  assert.equal((await api(P, 'prepare', { plan: 'solo', cycle: 'year', expectedAmount: 99000, usePoints: -10, ...terms })).body.error, 'bad_points');
  assert.equal((await api(P, 'prepare', { plan: 'solo', cycle: 'year', expectedAmount: 99000, usePoints: 1.5, ...terms })).body.error, 'bad_points');
  assert.equal((await api(W, 'prepare', { plan: 'solo', cycle: 'year', expectedAmount: 99000, usePoints: 10, ...terms })).body.error, 'points_short');
  assert.equal((await db.query(`select count(*)::int as c from public.class_subscriptions where user_id in ('${P}','${W}')`)).rows[0].c, 0);
});

await check('주문 뒤에 포인트를 다른 데 써서 모자라면 카드를 청구하지 않는다(돈이 나가지 않는다)', async () => {
  const p = await api(P, 'prepare', { plan: 'together', cycle: 'year', expectedAmount: 149000, usePoints: 4470, ...terms });
  await db.exec(`insert into public.point_transactions(user_id, amount, reason, ref_id) values ('${PM}', -3000, 'adjust', 'drain')`);
  const before = toss.charges;
  const c = await api(P, 'confirm', { orderId: p.body.orderId, authKey: 'auth' });
  assert.equal(c.status, 409); assert.equal(c.body.error, 'points_short');
  assert.equal(toss.charges, before); assert.equal(await balance(), 2000);
  await db.exec(`delete from public.point_transactions where ref_id = 'drain'`);
});

let pOrder;
await check('카드가 거절되면 포인트를 돌려놓는다(카드 금액 = 149,000 − 4,470P × 10)', async () => {
  const p = await api(P, 'prepare', { plan: 'together', cycle: 'year', expectedAmount: 149000, usePoints: 4470, ...terms });
  assert.equal(p.body.cardAmount, 104300); assert.equal(p.body.usePoints, 4470);
  assert.equal(await balance(), 5000, '주문만 만들고는 차감하지 않는다');
  toss.decline = true;
  const c = await api(P, 'confirm', { orderId: p.body.orderId, authKey: 'auth' });
  toss.decline = false;
  assert.equal(c.status, 402); assert.equal(await balance(), 5000);
  assert.equal((await sub(P)).status, 'pending');
});

await check('결과가 애매하면 포인트를 잡은 채 기다린다 · 그동안 새 주문을 만들지 않는다 · 다시 물으면 한 번만 결제', async () => {
  const p = await api(P, 'prepare', { plan: 'together', cycle: 'year', expectedAmount: 149000, usePoints: 4470, ...terms });
  pOrder = p.body.orderId;
  const before = toss.charges;
  toss.unclear = true;
  const c = await api(P, 'confirm', { orderId: pOrder, authKey: 'auth' });
  toss.unclear = false;
  assert.equal(c.status, 202); assert.equal(await balance(), 530, '잡은 채');
  assert.equal((await api(P, 'prepare', { plan: 'solo', cycle: 'month', expectedAmount: 9900, ...terms })).body.error, 'payment_pending');
  const again = await api(P, 'confirm', { orderId: pOrder, authKey: 'auth' });
  assert.equal(again.body.status, 'paid'); assert.equal(toss.charges, before + 1); assert.equal(toss.lastAmount, 104300);
  assert.equal(await balance(), 530, '두 번 차감하지 않는다');
  await api(P, 'confirm', { orderId: pOrder, authKey: 'auth' });
  assert.equal(await balance(), 530); assert.equal(toss.charges, before + 1);
});

await check('원장 한 줄: −4,470P · 사유 subscription · 주문 번호로 묶인다 · 구독 금액(다음 결제)은 149,000원 그대로', async () => {
  const row = (await db.query(`select amount, reason, ref_id from public.point_transactions where user_id = '${PM}' and reason = 'subscription'`)).rows;
  assert.deepEqual(row, [{ amount: -4470, reason: 'subscription', ref_id: `sub_pay:${pOrder}` }]);
  const s = await sub(P);
  assert.equal(s.status, 'active'); assert.equal(s.amount, 149000);
  assert.equal(await access(P, 'p@example.test', 'anne'), true);
});

await check('전환 차감은 카드로 낸 금액만 센다(포인트 몫 제외)', async () => {
  const st = (await api(P, 'status')).body;
  assert.equal(st.conversion.paidTotal, 104300); assert.equal(st.conversion.amount, 398000 - 104300);
});

await check('자동 갱신에는 포인트를 쓰지 않는다 — 149,000원 전액 카드', async () => {
  await db.exec(`update public.class_subscriptions set current_period_end = now() - interval '1 minute', next_charge_at = now() - interval '1 minute' where user_id = '${P}'`);
  const out = await chargeDueSubscriptions(ENV, { sbFetch });
  assert.equal(out.paid, 1); assert.equal(toss.lastAmount, 149000); assert.equal(await balance(), 530);
});

await check('회원은 포인트 함수를 직접 못 부른다 · 결제된 주문의 포인트는 돌려놓지 않는다', async () => {
  await db.exec('set role authenticated;');
  await assert.rejects(db.query(`select public.class_subscription_points_reserve('${pOrder}')`), /permission denied/);
  await assert.rejects(db.query(`select public.class_subscription_points_release('${pOrder}')`), /permission denied/);
  await db.exec('reset role;');
  assert.equal((await db.query(`select public.class_subscription_points_release('${pOrder}') as v`)).rows[0].v.error, 'order_paid');
  assert.equal(await balance(), 530);
});

await check('첫 결제가 전액 취소(환불)되면 쓴 포인트를 돌려준다', async () => {
  const pay = (await db.query(`select payment_key from public.class_subscription_payments where id = '${pOrder}'`)).rows[0];
  const t = toss.payments.get(pay.payment_key); t.status = 'CANCELED'; t.balanceAmount = 0;
  const deps = { requireUser: async () => null, sbFetch, json };
  const r = await classSubscription(new Request('https://x/api/class-subscription/webhook', { method: 'POST', body: JSON.stringify({ data: { paymentKey: pay.payment_key, orderId: pOrder } }) }), ENV, {}, 'webhook', deps);
  assert.equal(r.status, 200); assert.equal(await balance(), 5000);
});

// ── 런칭 선물: 무료로 먼저 써 본 분의 첫 결제에 달을 더 ──
const launchOpen = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) <= '2026-12-31';
const monthsBetween = (a, b) => { const x = new Date(a), y = new Date(b); return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth()); };
const lastPay = async (uid) => (await db.query(`select * from public.class_subscription_payments where user_id = '${uid}' order by created_at desc, period_end desc limit 1`)).rows[0];

await check('더 드리는 달: 써 본 회원의 첫 결제 — 월 개인 +1달 · 연간 함께 +6달 · 금액은 그대로', async () => {
  const q = (await api(T, 'quote', { plan: 'solo', cycle: 'month' })).body;
  assert.equal(q.bonusMonths, launchOpen ? 1 : 0); assert.equal(q.amount, 9900);
  const j = await join(T, 'solo', 'month');
  assert.equal(j.c.body.status, 'paid'); assert.equal(toss.lastAmount, 9900);
  const s1 = await sub(T);
  assert.equal(monthsBetween(s1.current_period_start, s1.current_period_end), launchOpen ? 2 : 1);
  assert.equal((await lastPay(T)).bonus_months, launchOpen ? 1 : 0);
  const j2 = await join(T2, 'together', 'year');
  assert.equal(j2.q.bonusMonths, launchOpen ? 6 : 0); assert.equal(toss.lastAmount, 149000);
  const s2 = await sub(T2);
  assert.equal(monthsBetween(s2.current_period_start, s2.current_period_end), launchOpen ? 18 : 12);
});

await check('더 드리는 달은 한 번만 · 써 보지 않은 회원에게는 없다', async () => {
  assert.equal((await api(T, 'quote', { plan: 'solo', cycle: 'year' })).body.bonusMonths, 0, '이미 결제한 적이 있다');
  assert.equal((await api(W, 'quote', { plan: 'together', cycle: 'year' })).body.bonusMonths, 0, '무료로 써 본 적이 없다');
  assert.equal((await db.query(`select private.class_subscription_bonus_months('${W}', 'together', 'year') as m`)).rows[0].m, 0);
});

// ── 월 → 연간 전환: 이번 달 남은 날짜만큼 뺀다 ──
await check('전환 견적: 연간 99,000원에서 남은 날짜 값어치를 뺀다(100원 아래 버림) · 월 구독이 아니면 견적이 없다', async () => {
  // 기간의 정확히 절반이 지난 것으로 만든다 → 9,900원의 절반 4,950 → 4,900원
  await db.exec(`update public.class_subscription_payments set period_start = now() - interval '10 days', period_end = now() + interval '10 days' where user_id = '${T}' and status = 'paid';
                 update public.class_subscriptions set current_period_start = (select period_start from public.class_subscription_payments where user_id = '${T}' and status = 'paid'),
                   current_period_end = (select period_end from public.class_subscription_payments where user_id = '${T}' and status = 'paid') where user_id = '${T}'`);
  const q = (await api(T, 'upgrade-quote', {})).body;
  assert.equal(q.ok, true); assert.equal(q.amount, 99000); assert.equal(q.credit, 4900); assert.equal(q.payAmount, 94100); assert.equal(q.daysLeft, 10);
  const no = await api(T2, 'upgrade-quote', {});
  assert.equal(no.status, 409); assert.equal(no.body.error, 'no_monthly_subscription');
  assert.equal((await api(W, 'upgrade-quote', { plan: 'solo' })).body.error, 'no_monthly_subscription');
});

await check('전환: 금액이 다르면 청구하지 않는다 · 카드가 거절되면 월 구독은 그대로', async () => {
  const charges = toss.charges;
  const bad = await api(T, 'upgrade', { expectedAmount: 99000, ...terms });
  assert.equal(bad.status, 409); assert.equal(bad.body.error, 'amount_mismatch'); assert.equal(bad.body.amount, 94100);
  toss.decline = true;
  const d = await api(T, 'upgrade', { expectedAmount: 94100, ...terms });
  toss.decline = false;
  assert.equal(d.status, 402); assert.equal(toss.charges, charges);
  const s = await sub(T);
  assert.equal(s.cycle, 'month'); assert.equal(s.status, 'active'); assert.equal(s.retry_count, 0, '전환 거절은 연체가 아니다');
});

await check('전환 결제: 등록된 카드로 94,100원 한 번 · 구독이 연간으로 · 그날부터 1년 · 오즈가 열린다', async () => {
  const charges = toss.charges;
  assert.equal(await access(T, 't@example.test', 'oz'), false, '월 구독에는 오즈가 없다');
  const r = await api(T, 'upgrade', { expectedAmount: 94100, ...terms });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'paid'); assert.equal(r.body.credit, 4900);
  assert.equal(toss.charges, charges + 1); assert.equal(toss.lastAmount, 94100);
  const s = await sub(T);
  assert.equal(s.cycle, 'year'); assert.equal(s.plan, 'solo'); assert.equal(s.amount, 99000, '다음 갱신은 연간 금액 그대로');
  assert.equal(monthsBetween(s.current_period_start, s.current_period_end), 12);
  assert.equal(new Date(s.next_charge_at).getTime(), new Date(s.current_period_end).getTime());
  assert.equal(await access(T, 't@example.test', 'oz'), true);
  const again = await api(T, 'upgrade', { expectedAmount: 94100, ...terms });
  assert.equal(again.status, 409, '이미 연간이면 또 전환할 수 없다'); assert.equal(toss.charges, charges + 1);
});

await check('회원은 전환·선물 함수를 직접 못 부른다', async () => {
  await db.exec(`set test.uid = '${T}'; set role authenticated;`);
  try {
    await assert.rejects(db.query(`select public.class_subscription_upgrade_begin('${T}', 'solo', 99000, 99000, 0, 'v', 'u', 0)`));
    await assert.rejects(db.query(`select public.class_subscription_bonus('${T}', 'solo', 'year')`));
  } finally { await db.exec('reset role;'); }
});

// ── 2026-11-13 A: 구독 할인에 핵심 이론을 소장으로 센다(올인원 결제와 같은 규칙) ──
const O2 = '00000000-0000-4000-8000-0000000000b8'; // 오리지널 2권(키다리·앤) → 이론 자동 포함 → 3/9
const OT = '00000000-0000-4000-8000-0000000000b9'; // 이론만 실제로 소장 → 1/9
await db.exec(`insert into auth.users(id, email) values ('${O2}', 'o2@example.test'), ('${OT}', 'ot@example.test');
  insert into public.class_verifications values ('O2@example.test', 'kidari'), ('o2@example.test', 'anne');
  insert into public.class_redemptions values ('ot@example.test', 'theory');`);

await check('이론 포함: 오리지널 2권 소장 회원의 연간 개인 견적 66,000원(할인에 센 권수 3) · 월은 정가', async () => {
  const sm = (await db.query(`select public.class_subscription_summary('${O2}') as v`)).rows[0].v;
  assert.equal(sm.ownedOriginals, 2); assert.equal(sm.ownedTheory, true);
  const q = (await api(O2, 'quote', { plan: 'solo', cycle: 'year' })).body;
  assert.equal(q.amount, 66000); assert.equal(q.ownedCount, 3); assert.equal(q.ownedOriginals, 2); assert.equal(q.ownedTheory, true);
  assert.equal((await api(O2, 'quote', { plan: 'solo', cycle: 'month' })).body.amount, 9900);
  assert.equal((await api(O2, 'quote', { plan: 'together', cycle: 'year' })).body.amount, 132400);
});

await check('이론 포함: 이론만 실제로 소장 = 88,000원 · 오리지널 1권(U)은 이론 없이 그대로 · 구독 안 한 회원(W)은 이론 없음', async () => {
  assert.equal((await db.query(`select public.class_subscription_summary('${OT}') as v`)).rows[0].v.ownedTheory, true);
  assert.equal((await api(OT, 'quote', { plan: 'solo', cycle: 'year' })).body.amount, 88000);
  assert.equal((await db.query(`select public.class_subscription_summary('${U}') as v`)).rows[0].v.ownedTheory, false);
  assert.equal((await db.query(`select public.class_subscription_summary('${W}') as v`)).rows[0].v.ownedTheory, false);
});

// ── 2026-11-13 B: 월 → 연간 전환 결제의 환불 ──
const R1 = '00000000-0000-4000-8000-0000000000c1'; const RM1 = '00000000-0000-4000-8000-0000000000c2'; // 전액 환불 → 월로 되돌림
const R2 = '00000000-0000-4000-8000-0000000000c4'; const RM2 = '00000000-0000-4000-8000-0000000000c5'; // 부분 환불 → 구독 종료
await db.exec(`insert into auth.users(id, email) values ('${R1}', 'r1@example.test'), ('${R2}', 'r2@example.test');
  insert into public.users values ('${RM1}', '${R1}'), ('${RM2}', '${R2}');
  insert into public.point_transactions(user_id, amount, reason, ref_id) values
    ('${RM1}', 3000, 'adjust', 'r1a'), ('${RM1}', 2000, 'adjust', 'r1b'), ('${RM2}', 3000, 'adjust', 'r2a'), ('${RM2}', 2000, 'adjust', 'r2b');`);
const bal = async (m) => (await db.query(`select coalesce(sum(amount),0)::int as b from public.point_transactions where user_id = '${m}'`)).rows[0].b;
const halfMonth = async (uid) => db.exec(`update public.class_subscription_payments set period_start = now() - interval '10 days', period_end = now() + interval '10 days' where user_id = '${uid}' and status = 'paid';
  update public.class_subscriptions set current_period_start = (select period_start from public.class_subscription_payments where user_id = '${uid}' and status = 'paid'),
    current_period_end = (select period_end from public.class_subscription_payments where user_id = '${uid}' and status = 'paid') where user_id = '${uid}'`);
const upgradePay = async (uid) => (await db.query(`select * from public.class_subscription_payments where user_id = '${uid}' and kind = 'upgrade' and status in ('paid','canceled') order by created_at desc limit 1`)).rows[0];
const hook = async (orderId, paymentKey) => {
  const deps = { requireUser: async () => null, sbFetch, json };
  const r = await classSubscription(new Request('https://x/api/class-subscription/webhook', { method: 'POST', body: JSON.stringify({ data: { paymentKey, orderId } }) }), ENV, {}, 'webhook', deps);
  return { status: r.status, body: await r.json() };
};
const refundQuote = async (uid) => (await db.query(`select public.class_subscription_refund_quote('${uid}') as v`)).rows[0].v;

let r1Before;
await check('전환 결제(포인트 1,000P + 카드 84,100원): 바꾸기 직전 월 구독 값을 prev 로 남긴다', async () => {
  const j = await join(R1, 'solo', 'month');
  assert.equal(j.c.body.status, 'paid');
  await halfMonth(R1);
  r1Before = await sub(R1);
  const r = await api(R1, 'upgrade', { expectedAmount: 94100, usePoints: 1000, ...terms });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(toss.lastAmount, 84100);
  assert.equal(await bal(RM1), 4000);
  const p = await upgradePay(R1);
  const prev = p.upgrade_to.prev;
  assert.equal(prev.plan, 'solo'); assert.equal(prev.amount, 9900); assert.equal(prev.cancelRequested, false);
  assert.equal(new Date(prev.periodEnd).getTime(), new Date(r1Before.current_period_end).getTime());
  assert.equal(new Date(prev.periodStart).getTime(), new Date(r1Before.current_period_start).getTime());
});

await check('환불 견적: 7일 안·유료 강의 안 들음 = 전액(full) · 무료 구간(1~5강)·전환 전 청취는 세지 않는다 · 6강~ 들으면 비율(prorated)', async () => {
  let q = await refundQuote(R1);
  assert.deepEqual({ mode: q.mode, within: q.withinDays7, heard: q.heardPaidLecture, card: q.refundCard, pts: q.pointsReturn, ends: q.endsSubscription, paid: q.paidCard, annual: q.annualAmount },
    { mode: 'full', within: true, heard: false, card: 84100, pts: 1000, ends: false, paid: 84100, annual: 99000 });
  await db.exec(`insert into public.lecture_progress(email, book_code, ep) values ('R1@example.test', 'oz', 3), ('r1@example.test', 'kidari', 9);
    insert into public.lecture_progress(email, book_code, ep, last_seen_at) values ('r1@example.test', 'littleprince', 8, now() - interval '30 days')`);
  assert.equal((await refundQuote(R1)).mode, 'full', '무료 구간·다른 책·전환 전 청취');
  await db.exec(`insert into public.lecture_progress(email, book_code, ep) values ('R1@example.test', 'littleprince', 6)`);
  q = await refundQuote(R1);
  assert.equal(q.heardPaidLecture, true); assert.equal(q.mode, 'prorated'); assert.equal(q.endsSubscription, true);
  // 이용 1일: 84,100 − 99,000/365 × 1 = 83,828.8 → 83,800
  assert.equal(q.daysUsed, 1); assert.equal(q.refundCard, 83800); assert.equal(q.pointsReturn, Math.floor(1000 * 83800 / 84100));
  await db.exec(`delete from public.lecture_progress where lower(email) = 'r1@example.test'`);
  assert.equal((await refundQuote(T2)).error, 'not_upgrade', '지금 기간 결제가 첫 결제면 견적 없음');
  assert.equal((await refundQuote(W)).error, 'no_subscription');
});

await check('전환 결제 전액 취소: 월 구독·원래 기간으로 되돌리고 포인트 전부 반환 · 웹훅을 두 번 받아도 같은 결과', async () => {
  const p = await upgradePay(R1);
  const t = toss.payments.get(p.payment_key); t.status = 'CANCELED'; t.balanceAmount = 0;
  for (let i = 0; i < 2; i++) {
    const r = await hook(p.id, p.payment_key);
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'canceled');
    const s = await sub(R1);
    assert.equal(s.cycle, 'month'); assert.equal(s.plan, 'solo'); assert.equal(s.amount, 9900); assert.equal(s.status, 'active');
    assert.equal(new Date(s.current_period_start).getTime(), new Date(r1Before.current_period_start).getTime());
    assert.equal(new Date(s.current_period_end).getTime(), new Date(r1Before.current_period_end).getTime());
    assert.equal(new Date(s.next_charge_at).getTime(), new Date(r1Before.current_period_end).getTime());
    assert.equal(s.cancel_requested_at, null); assert.equal(s.ended_at, null);
    assert.equal(await bal(RM1), 5000, `포인트 전부 반환(${i + 1}번째)`);
    assert.equal((await upgradePay(R1)).status, 'canceled');
  }
  assert.equal(await access(R1, 'r1@example.test', 'anne'), true, '월 구독 책은 남은 기간 동안 열려 있다');
  assert.equal(await access(R1, 'r1@example.test', 'oz'), false, '연간 책(오즈)은 닫힌다');
  assert.equal((await api(R1, 'upgrade-quote', {})).body.ok, true, '다시 전환할 수 있다');
});

let r2Pay;
await check('전환 결제 부분 취소(7일 지남 · 이용 10일): 견적대로 환불 · 구독 종료 · 포인트는 같은 비율로 반환', async () => {
  await join(R2, 'solo', 'month');
  await halfMonth(R2);
  const r = await api(R2, 'upgrade', { expectedAmount: 94100, usePoints: 2000, ...terms });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(toss.lastAmount, 74100);
  assert.equal(await bal(RM2), 3000);
  r2Pay = await upgradePay(R2);
  await db.exec(`update public.class_subscription_payments set period_start = now() - interval '10 days' + interval '1 hour', paid_at = now() - interval '10 days' + interval '1 hour' where id = '${r2Pay.id}';
    update public.class_subscriptions set current_period_start = now() - interval '10 days' + interval '1 hour' where user_id = '${R2}'`);
  const q = await refundQuote(R2);
  // 74,100 − 99,000/365 × 10 = 71,387.7 → 71,300 · 포인트 floor(2,000 × 71,300 / 74,100) = 1,924
  assert.deepEqual({ mode: q.mode, within: q.withinDays7, days: q.daysUsed, card: q.refundCard, pts: q.pointsReturn, ends: q.endsSubscription },
    { mode: 'prorated', within: false, days: 10, card: 71300, pts: 1924, ends: true });
  const t = toss.payments.get(r2Pay.payment_key); t.status = 'PARTIAL_CANCELED'; t.balanceAmount = 74100 - q.refundCard;
  for (let i = 0; i < 2; i++) {
    const h = await hook(r2Pay.id, r2Pay.payment_key);
    assert.equal(h.status, 200, JSON.stringify(h.body)); assert.equal(h.body.status, 'partial_canceled'); assert.equal(h.body.kind, 'upgrade');
    const s = await sub(R2);
    assert.equal(s.status, 'canceled'); assert.ok(s.ended_at); assert.equal(s.next_charge_at, null);
    assert.ok(new Date(s.current_period_end).getTime() <= Date.now() + 1000);
    assert.equal(await bal(RM2), 5000 - 76, `남는 포인트 2,000 − 1,924 = 76P(${i + 1}번째)`);
    const rows = (await db.query(`select amount from public.point_transactions where user_id = '${RM2}' and reason = 'subscription'`)).rows;
    assert.deepEqual(rows, [{ amount: -76 }], '양수 줄을 넣지 않고 차감 줄을 고쳐 쓴다');
    const p = (await db.query(`select status, canceled_amount from public.class_subscription_payments where id = '${r2Pay.id}'`)).rows[0];
    assert.deepEqual(p, { status: 'paid', canceled_amount: 71300 });
  }
  assert.equal(await access(R2, 'r2@example.test', 'oz'), false); assert.equal(await access(R2, 'r2@example.test', 'anne'), false);
  assert.equal((await db.query(`select count(*)::int as c from public.point_transactions where amount > 0 and reason = 'subscription'`)).rows[0].c, 0);
});

await check('부분 취소 뒤 나머지까지 전액 취소돼도 끝난 구독을 되살리지 않는다 · 남은 포인트도 돌아온다', async () => {
  const t = toss.payments.get(r2Pay.payment_key); t.status = 'CANCELED'; t.balanceAmount = 0;
  const h = await hook(r2Pay.id, r2Pay.payment_key);
  assert.equal(h.status, 200); assert.equal(h.body.status, 'canceled');
  const s = await sub(R2);
  assert.equal(s.status, 'canceled'); assert.equal(s.cycle, 'year');
  assert.equal(await bal(RM2), 5000);
});

await check('회원 역할은 환불 함수를 직접 못 부른다', async () => {
  await db.exec(`set test.uid = '${R1}'; set role authenticated;`);
  try {
    await assert.rejects(db.query(`select public.class_subscription_points_refund('${r2Pay.id}')`), /permission denied/);
    await assert.rejects(db.query(`select public.class_subscription_refund_quote('${R1}')`), /permission denied/);
  } finally { await db.exec('reset role; set role anon;'); }
  try {
    await assert.rejects(db.query(`select public.class_subscription_refund_quote('${R1}')`), /permission denied/);
  } finally { await db.exec('reset role;'); }
});

console.log(`class-subscription-db-test: ${n} checks passed (토스 청구 ${toss.charges}회)`);
