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
  insert into auth.users(id, email) values ('${U}', 'u@example.test'), ('${V}', 'v@example.test'), ('${W}', 'w@example.test');
  insert into public.class_verifications values ('u@example.test', 'kidari');
`);
await db.exec(await readFile(new URL('./supabase/migrations/20261112100000_class_subscription_billing.sql', import.meta.url), 'utf8'));
const CONV = await readFile(new URL('./supabase/migrations/20261112110000_class_subscription_conversion.sql', import.meta.url), 'utf8');
await db.exec(CONV); await db.exec(CONV);
// 한 번 더 돌려도 된다(이미 들어간 한 줄은 건너뛴다)
await db.exec(await readFile(new URL('./supabase/migrations/20261112100000_class_subscription_billing.sql', import.meta.url), 'utf8'));

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
const toss = { payments: new Map(), charges: 0, decline: false };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const body = init.body ? JSON.parse(init.body) : {};
  if (u.endsWith('/billing/authorizations/issue')) return json({ billingKey: `bk_${body.customerKey}` });
  if (u.includes('/billing/')) {
    if (toss.decline) return json({ code: 'REJECT_CARD_COMPANY' }, 400);
    const prev = [...toss.payments.values()].find((x) => x.orderId === body.orderId);
    if (prev) return json({ code: 'ALREADY_PROCESSED_PAYMENT', paymentKey: prev.paymentKey }, 400);
    toss.charges++;
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
await check('연간 개인 가입: 1권 소장 할인 86,600원 · 한 번만 청구 · 강의가 열린다', async () => {
  first = await join(U, 'solo', 'year');
  assert.equal(first.q.amount, 86600);
  assert.equal(first.c.status, 200); assert.equal(first.c.body.status, 'paid');
  assert.equal(toss.charges, 1);
  const s = await sub(U);
  assert.equal(s.status, 'active'); assert.equal(s.billing_key, `bk_${s.customer_key}`);
  for (const b of ['anne', 'theory', 'oz', 'littleprince']) assert.equal(await access(U, 'u@example.test', b), true, b);
  assert.equal(await access(W, 'w@example.test', 'anne'), false, '구독 안 한 회원은 그대로 닫혀 있다');
});

await check('같은 주문을 다시 확정해도 두 번 청구하지 않는다 · 구독 중에는 또 가입할 수 없다', async () => {
  const again = await api(U, 'confirm', { orderId: first.p.orderId, authKey: 'auth' });
  assert.equal(again.body.status, 'paid'); assert.equal(toss.charges, 1);
  const p = await api(U, 'prepare', { plan: 'solo', cycle: 'year', expectedAmount: 86600, acceptedTermsVersion: 'sub-2026-12' });
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

await check('전환 견적: 1권 소장 348,000원에서 지금까지 낸 구독료(86,600원 × 2)를 뺀다', async () => {
  const r = await api(U, 'status');
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (today <= '2026-12-31') {
    assert.equal(r.body.conversion.basePrice, 348000);
    assert.equal(r.body.conversion.credit, 173200);
    assert.equal(r.body.conversion.amount, 174800);
  } else assert.equal(r.body.conversion, null, '기한이 지나면 차감 안내가 없다');
});

await check('올인원 주문서 금액(DB)도 같은 만큼 빠진다 · 소장 결제가 끝나면 구독의 다음 결제가 멈춘다', async () => {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const q = (await db.query(`select public.class_checkout_quote('${U}') as v`)).rows[0].v;
  assert.equal(q.amount, today <= '2026-12-31' ? 174800 : 348000);
  assert.equal(q.subscriptionCredit, today <= '2026-12-31' ? 173200 : 0);
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
  assert.equal(toss.charges, 2);
});

await check('월 함께 읽기 가입 → 해지: 다음 결제만 멈추고 낸 기간 끝까지 열려 있다 → 기간이 끝나면 닫힌다', async () => {
  const j = await join(V, 'together', 'month');
  assert.equal(j.q.amount, 14900); assert.equal(j.c.body.status, 'paid');
  assert.equal(await access(V, 'v@example.test', 'pride'), true);
  assert.equal(await access(V, 'v@example.test', 'oz'), false, '월 구독에는 오즈·어린 왕자가 없다');
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

console.log(`class-subscription-db-test: ${n} checks passed (토스 청구 ${toss.charges}회)`);
