// 구독 기간권(한 번 결제) + 구독 안내 메일 시험 — 실제 Postgres(PGlite) 위에 구독 초안 전부 + 기간권·메일 초안을 올리고,
//   가짜 토스(일반 결제 승인)·가짜 Resend 로 서버 모듈을 끝까지 돌린다.
//   PGLITE_ENTRY=<…/@electric-sql/pglite/dist/index.js> node class-subscription-onetime-test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { classSubscription, chargeDueSubscriptions } from './src/class-subscription.mjs';
import { subscriptionQuote } from './src/class-subscription-pricing.mjs';
import entry, { classMidSubscriptionWebhook } from './src/class-subscription-entry.mjs';
import { processSubscriptionEmails, queueSubscriptionReminders, renderSubscriptionEmail, SUBSCRIPTION_MAIL_COPY } from './src/class-subscription-email.mjs';

const ENTRY = process.env.PGLITE_ENTRY || process.env.PGLITE_MODULE;
if (!ENTRY) { console.log('class-subscription-onetime-test: PGLITE_ENTRY 가 없어 건너뜀'); process.exit(0); }
const { PGlite } = await import(pathToFileURL(ENTRY).href);
const db = new PGlite();
const U = '00000000-0000-4000-8000-0000000000a1'; // 키다리 1권 소장 → 자동 결제 구독자(기간권 막힘 대조군)
const V = '00000000-0000-4000-8000-0000000000b2'; // 소장 없음 → 기간권 월 개인 → 이어 사기
const W = '00000000-0000-4000-8000-0000000000c3'; // 선물 구독자
const P = '00000000-0000-4000-8000-0000000000d4'; // 포인트 5,000P → 기간권 월 개인 + 포인트 → 전액 환불
const T = '00000000-0000-4000-8000-0000000000f6'; // 무료로 먼저 써 본 회원 + 포인트 → 기간권 연간 개인(+3달)
const T2 = '00000000-0000-4000-8000-0000000000a7'; // 무료로 먼저 써 본 회원 → 기간권 연간 함께 읽기(+6달)
const PM = '00000000-0000-4000-8000-0000000000e5';
const TM = '00000000-0000-4000-8000-0000000000e6'; // T 의 회원 행
const B = '00000000-0000-4000-8000-0000000000b9'; // 키다리·앤 소장(=이론도 셈) → 기간권 연간 함께 읽기 할인

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
const mig = async (name, times = 2) => { const sql = await readFile(new URL(`./supabase/migrations/${name}.sql`, import.meta.url), 'utf8'); for (let i = 0; i < times; i++) await db.exec(sql); };
await mig('20261113090000_class_subscription_points');
await mig('20261113100000_class_subscription_launch_upgrade');
await db.exec(`create table public.lecture_progress(email text, book_code text, ep smallint, first_seen_at timestamptz default now(), last_seen_at timestamptz default now())`);
await mig('20261113110000_class_subscription_theory_refund');
await db.exec(`create function public.is_ls_admin() returns boolean language sql stable as $$ select false $$;`);
await mig('20261113130000_class_subscription_gift');
// 이번 초안 둘 — 두 번 돌려도 된다(이미 고친 함수는 건너뛴다)
await mig('20261114100000_class_subscription_onetime');
await mig('20261114110000_class_subscription_email');
await db.exec(`
  insert into public.class_trial_signups(user_id, kind) values ('${T}', 'all'), ('${T2}', 'all');
  insert into public.users values ('${TM}', '${T}');
  insert into public.point_transactions(user_id, amount, reason, ref_id) values ('${TM}', 3000, 'adjust', 'seedT');
  insert into auth.users(id, email) values ('${B}', 'b@example.test');
  insert into public.class_verifications values ('b@example.test', 'kidari'), ('b@example.test', 'anne');
`);

// ── 서버가 쓰는 DB 통로(PostgREST 흉내 — rpc · select · PATCH) ──
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v)
  : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'` : `'${String(v).replace(/'/g, "''")}'`);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const sbCalls = [];
const sbFetch = async (_env, path, init = {}) => {
  sbCalls.push(path);
  if (path.startsWith('rpc/')) {
    const args = init.body ? JSON.parse(init.body) : {};
    const list = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
    const r = await db.query(`select public.${path.slice(4)}(${list}) as v`);
    return json(r.rows[0].v);
  }
  const [table, qs] = path.split('?');
  const p = new URLSearchParams(qs);
  const where = [...p.entries()].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => `${k}::text = ${lit(v.slice(3))}`).join(' and ');
  if (init.method === 'PATCH') {
    const set = Object.entries(JSON.parse(init.body)).map(([k, v]) => `${k} = ${lit(v)}`).join(', ');
    const r = await db.query(`update public.${table} set ${set} where ${where || 'false'} returning *`);
    return json(r.rows);
  }
  const r = await db.query(`select ${p.get('select') || '*'} from public.${table} where ${where || 'true'} limit ${Number(p.get('limit')) || 50}`);
  return json(r.rows);
};

// ── 가짜 토스(일반 결제 + 빌링) · 가짜 Resend · 진입 모듈용 DB(https://db.test/rest/v1/) ──
const toss = { payments: new Map(), confirms: 0, billing: 0, decline: false, unclear: false, auth: [] };
const mails = [];
let resendMode = 200;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const body = init.body ? JSON.parse(init.body) : {};
  if (u.startsWith('https://db.test/rest/v1/')) return sbFetch(null, u.slice('https://db.test/rest/v1/'.length), init);
  if (u === 'https://api.resend.com/emails') {
    if (resendMode !== 200) return json({}, resendMode);
    mails.push({ key: init.headers['Idempotency-Key'], body });
    return json({ id: `re_${mails.length}` });
  }
  if (u.endsWith('/billing/authorizations/issue')) return json({ billingKey: `bk_${body.customerKey}` });
  if (u.includes('/billing/')) {
    toss.billing++;
    const pay = { paymentKey: `bpk_${toss.billing}`, orderId: body.orderId, totalAmount: body.amount, balanceAmount: body.amount, currency: 'KRW', status: 'DONE' };
    toss.payments.set(pay.paymentKey, pay);
    return json(pay);
  }
  if (u.endsWith('/payments/confirm')) {
    toss.auth.push(init.headers.Authorization);
    if (toss.decline) return json({ code: 'REJECT_CARD_COMPANY' }, 400);
    if (toss.unclear) return json({ code: 'PROVIDER_ERROR' }, 500);
    const pay = toss.payments.get(body.paymentKey);
    if (!pay || pay.orderId !== body.orderId || pay.totalAmount !== body.amount) return json({ code: 'NOT_FOUND_PAYMENT' }, 404);
    if (pay.status === 'DONE') return json({ code: 'ALREADY_PROCESSED_PAYMENT' }, 400);
    toss.confirms++; pay.status = 'DONE';
    return json(pay);
  }
  const m = u.match(/\/payments\/([^/]+)$/);
  if (m && toss.payments.has(decodeURIComponent(m[1]))) return json(toss.payments.get(decodeURIComponent(m[1])));
  return json({}, 404);
};
// 회원이 토스 결제창에서 결제를 마침(승인 전 상태) — 결제 키를 돌려준다
let widget = 0;
const payInWidget = (orderId, amount) => {
  const key = `tpk_${++widget}`;
  toss.payments.set(key, { paymentKey: key, orderId, totalAmount: amount, balanceAmount: amount, currency: 'KRW', status: 'IN_PROGRESS' });
  return key;
};

const TERMS = { CLASS_SUBSCRIPTION_TERMS_URL: 'https://class-new.literstella.co.kr/subscribe#terms', CLASS_SUBSCRIPTION_TERMS_VERSION: 'sub-2026-12' };
// 기간권만 연다(자동 결제 스위치는 꺼짐 — 심사 전 판매 모양)
const ENV = { ...TERMS, CLASS_SUBSCRIPTION_ONETIME_ENABLED: 'true', TOSS_CLASS_SECRET_KEY: 'csk',
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'srv', ALLOWED_ORIGINS: 'https://class-new.literstella.co.kr' };
const AUTO = { ...ENV, CLASS_SUBSCRIPTION_ENABLED: 'true', TOSS_BILLING_SECRET_KEY: 'bsk', TOSS_BILLING_CLIENT_KEY: 'bck' };
const MAIL = { ...ENV, CLASS_SUBSCRIPTION_MAIL_ENABLED: 'true', RESEND_API_KEY: 're_test', RESEND_FROM: '리터스텔라 <noreply@literstella.co.kr>',
  CLASS_SUBSCRIPTION_PAGE_URL: 'https://class-new.literstella.co.kr/subscribe' };
const api = async (uid, action, body, env = ENV) => {
  const deps = { requireUser: async () => ({ id: uid, emailConfirmed: true }), sbFetch, json };
  const r = await classSubscription(new Request(`https://x/api/class-subscription/${action}`, { method: 'POST', body: JSON.stringify(body || {}) }), env, {}, action, deps);
  return { status: r.status, body: await r.json() };
};
const access = async (uid, email, book) => {
  await db.exec(`set test.uid = '${uid}'; set test.email = '${email}'; set role authenticated;`);
  try { return (await db.query(`select public.check_my_class_access(${lit(book)}) as ok`)).rows[0].ok; }
  finally { await db.exec('reset role;'); }
};
const one = async (sql) => (await db.query(sql)).rows[0];
const sub = (uid) => one(`select * from public.class_subscriptions where user_id = '${uid}' order by created_at desc limit 1`);
const pts = async (member) => (await one(`select coalesce(sum(amount),0)::int as v from public.point_transactions where user_id = '${member}'`)).v;
const outbox = async (where = 'true') => (await db.query(`select * from public.class_subscription_email_outbox where ${where} order by created_at`)).rows;
const ms = (x) => new Date(x).getTime();
const DAY = 86400e3;
// 견적 → 주문 → 결제창 → 승인
const buy = async (uid, plan, cycle, { usePoints, env = ENV } = {}) => {
  const q = await api(uid, 'quote', { plan, cycle }, env);
  const p = await api(uid, 'once-prepare', { plan, cycle, expectedAmount: q.body.amount, acceptedTermsVersion: 'sub-2026-12', usePoints }, env);
  if (p.status !== 200) return { q: q.body, p };
  const paymentKey = payInWidget(p.body.orderId, p.body.cardAmount);
  const c = await api(uid, 'once-confirm', { orderId: p.body.orderId, paymentKey, amount: p.body.cardAmount }, env);
  return { q: q.body, p, c, paymentKey };
};

let n = 0;
const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

await check('스위치가 꺼져 있으면 닫혀 있다: once-prepare/once-confirm 503 onetime_closed · 견적·상태는 onetimeOpen:false · DB 를 안 건드린다', async () => {
  const off = { ...ENV, CLASS_SUBSCRIPTION_ONETIME_ENABLED: 'false' };
  const before = sbCalls.length;
  for (const a of ['once-prepare', 'once-confirm']) {
    const r = await api(V, a, { plan: 'solo', cycle: 'month' }, off);
    assert.deepEqual([r.status, r.body.error], [503, 'onetime_closed']);
  }
  assert.equal(sbCalls.length, before, '닫혀 있으면 DB 호출 0');
  assert.equal((await api(V, 'once-prepare', {}, { ...ENV, TOSS_CLASS_SECRET_KEY: '' })).body.error, 'onetime_closed', '클래스 상점 키가 없으면 닫힘');
  assert.equal((await api(V, 'once-prepare', {}, { ...ENV, CLASS_SUBSCRIPTION_TERMS_URL: '' })).body.error, 'onetime_closed', '약관 변수가 없으면 닫힘');
  assert.equal((await api(V, 'quote', { plan: 'solo', cycle: 'month' }, off)).body.onetimeOpen, false);
  const s = await api(V, 'status', {}, ENV);
  assert.equal(s.body.onetimeOpen, true); assert.equal(s.body.checkoutEnabled, false, '자동 결제는 그대로 꺼져 있다');
  assert.equal(s.body.pointsAllowed, true);
});

let tBuy;
await check('연간 개인(무료로 써 본 회원) + 포인트 1,000P: 금액 99,000 · 카드 89,000 · 런칭 선물 +3달 · 강의 열림 · 클래스 상점 키로 승인', async () => {
  tBuy = await buy(T, 'solo', 'year', { usePoints: 1000 });
  assert.equal(tBuy.p.status, 200, JSON.stringify(tBuy.p.body));
  assert.equal(tBuy.q.amount, 99000); assert.equal(tBuy.q.pointsAllowed, true);
  const p = tBuy.p.body;
  assert.deepEqual([p.amount, p.cardAmount, p.usePoints, p.bonusMonths, p.billingMode, p.renewal], [99000, 89000, 1000, 3, 'once', false]);
  assert.equal(p.clientKey, 'live_gck_vZnjEJeQVxJnOWvQa2jZ8PmOoBN0'); assert.match(p.orderName, /개인 연간 구독\(1회 결제\)/);
  assert.equal(tBuy.c.status, 200, JSON.stringify(tBuy.c.body)); assert.equal(tBuy.c.body.status, 'paid');
  assert.equal(toss.confirms, 1); assert.equal(toss.auth.at(-1), `Basic ${btoa('csk:')}`); assert.equal(toss.billing, 0);
  const s = await sub(T);
  assert.deepEqual([s.status, s.source, s.billing_mode, s.billing_key, s.next_charge_at], ['active', 'paid', 'once', null, null]);
  assert.ok(s.cancel_requested_at, '기간이 끝나면 정리되도록 해지 예약이 걸려 있다');
  const months = (ms(s.current_period_end) - ms(s.current_period_start)) / DAY;
  assert.ok(months > 450 && months < 460, `1년 + 3달 (${months}일)`);
  assert.equal(await pts(TM), 2000, '포인트 1,000P 차감');
  for (const b of ['anne', 'theory', 'oz', 'littleprince']) assert.equal(await access(T, 't@example.test', b), true, b);
  assert.equal((await gateBooks('t@example.test')).length, 10);
});

await check('같은 승인을 다시 보내도 같은 답 — 토스 승인·기간·포인트가 한 번만', async () => {
  const before = await sub(T);
  const again = await api(T, 'once-confirm', { orderId: tBuy.p.body.orderId, paymentKey: tBuy.paymentKey, amount: 89000 });
  assert.equal(again.status, 200); assert.equal(again.body.status, 'paid');
  assert.equal(toss.confirms, 1);
  assert.equal(ms((await sub(T)).current_period_end), ms(before.current_period_end));
  assert.equal(await pts(TM), 2000);
  const other = await api(T, 'once-confirm', { orderId: tBuy.p.body.orderId, paymentKey: 'tpk_other', amount: 89000 });
  assert.equal(other.body.error, 'payment_mismatch', '다른 결제 키로는 못 묶는다');
});

await check('금액이 다르면 거절: 주문 만들 때(서버 견적과 다름) · 승인 때(주문 금액과 다름) — 토스 승인 0', async () => {
  const p = await api(T2, 'once-prepare', { plan: 'together', cycle: 'year', expectedAmount: 1000, acceptedTermsVersion: 'sub-2026-12' });
  assert.deepEqual([p.status, p.body.error, p.body.amount], [409, 'amount_mismatch', 149000]);
  const terms = await api(T2, 'once-prepare', { plan: 'together', cycle: 'year', expectedAmount: 149000, acceptedTermsVersion: 'old' });
  assert.equal(terms.body.error, 'terms_changed');
  const ok = await api(T2, 'once-prepare', { plan: 'together', cycle: 'year', expectedAmount: 149000, acceptedTermsVersion: 'sub-2026-12' });
  assert.equal(ok.status, 200); assert.equal(ok.body.bonusMonths, 6, '연간 함께 읽기 런칭 선물 6달(자동 결제와 같은 규칙)');
  const key = payInWidget(ok.body.orderId, 149000);
  const bad = await api(T2, 'once-confirm', { orderId: ok.body.orderId, paymentKey: key, amount: 100 });
  assert.deepEqual([bad.status, bad.body.error], [409, 'amount_mismatch']);
  const confirms = toss.confirms;
  const good = await api(T2, 'once-confirm', { orderId: ok.body.orderId, paymentKey: key, amount: 149000 });
  assert.equal(good.body.status, 'paid'); assert.equal(toss.confirms, confirms + 1);
  assert.equal((await sub(T2)).plan, 'together');
});

await check('소장 할인(연간 함께 읽기, 키다리·앤 = 이론까지 3권) — 견적과 같은 금액으로 결제', async () => {
  const q = subscriptionQuote({ plan: 'together', cycle: 'year', ownedCount: 2, ownedTheory: true });
  const r = await buy(B, 'together', 'year');
  assert.equal(r.q.ownedTheory, true); assert.equal(r.q.ownedCount, 3); assert.equal(r.q.amount, q.amount); assert.ok(q.amount < 149000);
  assert.equal(r.c.body.status, 'paid');
  const pay = await one(`select * from public.class_subscription_payments where user_id = '${B}'`);
  assert.equal(pay.amount, q.amount); assert.equal(pay.kind, 'first'); assert.equal(pay.bonus_months, 0, '무료로 안 써 본 회원은 더 드리는 달 없음');
  assert.equal((await sub(B)).owned_count, 3);
});

let vFirst;
await check('월 개인: 9,900원 · 월 책 8권(오즈·어린 왕자 닫힘) · 요약에 billingMode·renewableFrom(끝 − 14일)', async () => {
  vFirst = await buy(V, 'solo', 'month');
  assert.equal(vFirst.c.body.status, 'paid'); assert.equal(vFirst.p.body.cardAmount, 9900);
  assert.equal(await access(V, 'v@example.test', 'anne'), true);
  assert.equal(await access(V, 'v@example.test', 'oz'), false);
  const s = (await api(V, 'status')).body.subscription;
  assert.equal(s.billingMode, 'once'); assert.equal(s.source, 'paid');
  assert.equal(ms(s.renewableFrom), ms(s.periodEnd) - 14 * DAY);
});

const quote = async (uid) => (await one(`select public.class_subscription_refund_quote('${uid}') as v`)).v;
const shiftUser = async (uid, interval) => db.exec(`
  update public.class_subscription_payments set period_start = period_start - interval '${interval}', period_end = period_end - interval '${interval}',
    paid_at = paid_at - interval '${interval}' where user_id = '${uid}';
  update public.class_subscriptions set current_period_start = current_period_start - interval '${interval}',
    current_period_end = current_period_end - interval '${interval}' where user_id = '${uid}'`);
const unshiftUser = (uid, interval) => shiftUser(uid, `-${interval}`);

await check('환불 견적(첫 결제·연간): 7일 안 = 전액 + 포인트 전부 · 7일 뒤 = 결제액 − 지난 개월 수 × 월 요금(한 달 미만은 한 달) · 포인트 같은 비율', async () => {
  const q1 = await quote(T);
  assert.equal(q1.ok, true, JSON.stringify(q1));
  assert.deepEqual([q1.kind, q1.mode, q1.rule, q1.paidCard, q1.refundCard, q1.pointsUsed, q1.pointsReturn, q1.withinDays7, q1.endsSubscription, q1.cycle, q1.billingMode],
    ['first', 'full', 'within_7_days_full', 89000, 89000, 1000, 1000, true, true, 'year', 'once']);
  await shiftUser(T, '40 days');
  const q2 = await quote(T);
  assert.deepEqual([q2.mode, q2.rule, q2.monthsUsed, q2.monthlyPrice, q2.refundCard, q2.pointsReturn, q2.withinDays7, q2.endsSubscription],
    ['prorated', 'annual_minus_used_months', 2, 9900, 89000 - 2 * 9900, Math.floor(1000 * (89000 - 19800) / 89000), false, true]);
  await shiftUser(T, '400 days');   // 산 12달이 다 지나고 런칭 선물 달에 들어섬 = 12달까지만 센다(선물 달은 공제하지 않는다)
  const q3 = await quote(T);
  assert.equal(q3.monthsUsed, 12); assert.equal(q3.refundCard, 0); assert.equal(q3.mode, 'none'); assert.equal(q3.endsSubscription, false);
  await unshiftUser(T, '440 days');
});

await check('이어 사기: 너무 이르면 too_early · 요금제 바꾸기 plan_fixed', async () => {
  const early = await api(V, 'once-prepare', { plan: 'solo', cycle: 'month', expectedAmount: 9900, acceptedTermsVersion: 'sub-2026-12' });
  assert.deepEqual([early.status, early.body.error], [409, 'too_early']); assert.ok(early.body.renewableFrom);
  await db.exec(`update public.class_subscriptions set current_period_end = now() + interval '10 days' where user_id = '${V}';
    update public.class_subscription_payments set period_end = now() + interval '10 days' where user_id = '${V}' and status = 'paid'`);
  const plan = await api(V, 'once-prepare', { plan: 'together', cycle: 'month', expectedAmount: 14900, acceptedTermsVersion: 'sub-2026-12' });
  assert.deepEqual([plan.body.error, plan.body.plan], ['plan_fixed', 'solo']);
  await db.exec(`insert into public.users values ('00000000-0000-4000-8000-0000000000e7', '${V}');
    insert into public.point_transactions(user_id, amount, reason, ref_id) values ('00000000-0000-4000-8000-0000000000e7', 1000, 'adjust', 'seedV')`);
  assert.equal((await api(V, 'quote', { plan: 'solo', cycle: 'year' })).body.pointsAllowed, true, '기간권은 이어 사기에도 포인트(운영자 2026-11-14)');
  assert.equal((await api(V, 'status')).body.subscription.pointsAllowed, undefined);
  assert.equal((await one(`select public.class_subscription_summary('${V}') as v`)).v.pointsAllowed, true);
});

await check('환불 견적(월): 7일 뒤에는 환불 없음(기간 끝까지 이용) · 7일 안은 전액', async () => {
  assert.equal((await quote(V)).mode, 'full');
  await shiftUser(V, '8 days');
  const q = await quote(V);
  assert.deepEqual([q.mode, q.rule, q.refundCard, q.pointsReturn, q.endsSubscription, q.cycle], ['none', 'monthly_no_refund_after_7_days', 0, 0, false, 'month']);
  await unshiftUser(V, '8 days');
});

await check('월 기간권 → 월↔연간 전환은 이어 사기로: upgrade 는 once_use_renewal(청구 0)', async () => {
  const r = await api(V, 'upgrade', { acceptedTermsVersion: 'sub-2026-12', expectedAmount: 1 }, AUTO);
  assert.deepEqual([r.status, r.body.error], [409, 'once_use_renewal']); assert.ok(r.body.renewableFrom);
  assert.equal((await api(V, 'upgrade-quote', {}, AUTO)).body.error, 'once_use_renewal');
  assert.equal(toss.billing, 0);
});

let vRenew;
await check('끝나기 10일 전 연간으로 이어 사기: 지금 기간 끝에 이어 붙는다 · 남은 월 기간엔 8권 그대로 · 이어진 기간이 시작되면 10권', async () => {
  const before = await sub(V);
  vRenew = await buy(V, 'solo', 'year', { usePoints: 100 });
  assert.equal(vRenew.p.status, 200, JSON.stringify(vRenew.p.body));
  assert.equal(vRenew.p.body.renewal, true); assert.equal(vRenew.p.body.bonusMonths, 0);
  assert.equal(ms(vRenew.p.body.periodStart), ms(before.current_period_end));
  assert.equal(vRenew.c.body.status, 'paid');
  const s = await sub(V);
  assert.equal(s.id, before.id, '같은 구독 행');
  assert.equal(ms(s.current_period_end), ms(before.current_period_end) + 365 * DAY);
  assert.equal(s.cycle, 'year'); assert.equal(s.billing_mode, 'once');
  assert.equal((await gateBooks('v@example.test')).length, 8, '남은 월 기간은 월 책');
  assert.equal(await access(V, 'v@example.test', 'oz'), false);
  const rp = await one(`select * from public.class_subscription_payments where id = '${vRenew.p.body.orderId}'`);
  assert.equal(rp.kind, 'renewal'); assert.equal(rp.points_used, 100); assert.equal(rp.amount, 99000 - 1000);
  assert.equal(await pts('00000000-0000-4000-8000-0000000000e7'), 900, '이어 사기에도 포인트를 쓴다');
  // 시간이 흘러 이어 산 기간이 시작됨(모든 시각을 11일 앞으로)
  await db.exec(`update public.class_subscription_payments set period_start = period_start - interval '11 days', period_end = period_end - interval '11 days' where user_id = '${V}';
    update public.class_subscriptions set current_period_start = current_period_start - interval '11 days', current_period_end = current_period_end - interval '11 days' where user_id = '${V}'`);
  assert.equal((await gateBooks('v@example.test')).length, 10, '연간 책');
  assert.equal(await access(V, 'v@example.test', 'oz'), true);
  await db.exec(`update public.class_subscription_payments set period_start = period_start + interval '11 days', period_end = period_end + interval '11 days' where user_id = '${V}';
    update public.class_subscriptions set current_period_start = current_period_start + interval '11 days', current_period_end = current_period_end + interval '11 days' where user_id = '${V}'`);
});

await check('아직 시작 안 한 이어 산 기간을 전액 환불: 구독은 살아 있고 앞 기간 끝으로 되돌아간다(주기도 월로)', async () => {
  const q = await quote(V);
  assert.deepEqual([q.kind, q.orderId, q.futurePeriod, q.mode, q.refundCard, q.pointsReturn, q.endsSubscription, q.monthsUsed],
    ['renewal', vRenew.p.body.orderId, true, 'full', 98000, 100, false, 0], '가장 최근 결제(아직 시작 안 한 기간)를 견적한다');
  const pay = toss.payments.get(vRenew.paymentKey);
  pay.status = 'CANCELED'; pay.balanceAmount = 0;
  const w = await api(V, 'webhook', { data: { paymentKey: vRenew.paymentKey, orderId: vRenew.p.body.orderId } });
  assert.equal(w.status, 200, JSON.stringify(w.body)); assert.equal(w.body.status, 'canceled');
  const s = await sub(V);
  assert.equal(s.status, 'active'); assert.equal(s.cycle, 'month');
  assert.equal(ms(s.current_period_end), ms(vRenew.p.body.periodStart));
  assert.equal(await access(V, 'v@example.test', 'anne'), true);
  assert.equal(await pts('00000000-0000-4000-8000-0000000000e7'), 1000, '환불한 이어 사기의 포인트는 돌아온다');
  const again = await api(V, 'webhook', { data: { paymentKey: vRenew.paymentKey, orderId: vRenew.p.body.orderId } });
  assert.equal(again.status, 200); assert.equal((await sub(V)).status, 'active', '웹훅을 다시 받아도 그대로');
});

await check('끝난 뒤 다시 사면 지금부터 · 그 전에 기간이 끝나면 class_subscription_expire 가 정리(자동 결제 꺼져 있어도 크론이 부른다)', async () => {
  await db.exec(`update public.class_subscriptions set current_period_end = now() - interval '1 hour' where user_id = '${V}'`);
  const out = await chargeDueSubscriptions(ENV, { sbFetch });
  assert.equal(out.expired, 1); assert.equal(out.due, 0);
  assert.equal((await sub(V)).status, 'canceled');
  assert.equal(await access(V, 'v@example.test', 'anne'), false);
  const r = await buy(V, 'solo', 'month');
  assert.equal(r.c.body.status, 'paid'); assert.equal(r.p.body.renewal, false);
  assert.ok(Math.abs(ms(r.p.body.periodStart) - Date.now()) < 60e3, '지금부터');
  assert.equal((await db.query(`select count(*)::int as c from public.class_subscriptions where user_id = '${V}'`)).rows[0].c, 2, '끝난 행은 남고 새 행');
  // 끝난 상태(크론 전)에 이어 사도 지금부터
  await db.exec(`update public.class_subscriptions set current_period_end = now() - interval '1 hour' where user_id = '${V}' and status = 'active'`);
  const r2 = await buy(V, 'solo', 'month');
  assert.equal(r2.p.body.renewal, true); assert.ok(Math.abs(ms(r2.p.body.periodStart) - Date.now()) < 60e3);
  assert.equal(r2.c.body.status, 'paid'); assert.equal((await sub(V)).status, 'active');
});

await check('이어 사기 결제가 거절돼도 지금 기간권은 그대로(연체·재시도로 바뀌지 않는다) · 포인트는 돌아온다', async () => {
  const before = await sub(V);
  await db.exec(`update public.class_subscriptions set current_period_end = now() + interval '5 days' where id = '${before.id}'`);
  const p = await api(V, 'once-prepare', { plan: 'solo', cycle: 'month', expectedAmount: 9900, acceptedTermsVersion: 'sub-2026-12', usePoints: 50 });
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.renewal, true);
  const key = payInWidget(p.body.orderId, p.body.cardAmount);
  toss.decline = true;
  const r = await api(V, 'once-confirm', { orderId: p.body.orderId, paymentKey: key, amount: p.body.cardAmount });
  toss.decline = false;
  assert.deepEqual([r.status, r.body.error], [402, 'card_declined']);
  const s = await sub(V);
  assert.deepEqual([s.status, s.retry_count, s.next_charge_at], ['active', 0, null]);
  assert.equal(await pts('00000000-0000-4000-8000-0000000000e7'), 1000);
  await db.exec(`update public.class_subscriptions set current_period_end = '${new Date(before.current_period_end).toISOString()}' where id = '${before.id}'`);
});

await check('자동 결제·선물 구독이 살아 있으면 already_subscribed · 자동 결제 길은 그대로 동작', async () => {
  const q = await api(U, 'quote', { plan: 'solo', cycle: 'year' }, AUTO);
  const p = await api(U, 'prepare', { plan: 'solo', cycle: 'year', expectedAmount: q.body.amount, acceptedTermsVersion: 'sub-2026-12' }, AUTO);
  const c = await api(U, 'confirm', { orderId: p.body.orderId, authKey: 'auth' }, AUTO);
  assert.equal(c.body.status, 'paid'); assert.equal(toss.billing, 1);
  const s = await sub(U);
  assert.deepEqual([s.billing_mode, s.cancel_requested_at], ['auto', null]); assert.ok(s.next_charge_at);
  const blocked = await api(U, 'once-prepare', { plan: 'solo', cycle: 'year', expectedAmount: q.body.amount, acceptedTermsVersion: 'sub-2026-12' });
  assert.deepEqual([blocked.status, blocked.body.error], [409, 'already_subscribed']);
  await db.exec(`insert into public.class_subscriptions (user_id, plan, cycle, status, source, customer_key, amount, list_amount, current_period_start, current_period_end, cancel_requested_at, terms_version, terms_url)
    values ('${W}', 'solo', 'year', 'active', 'gift', 'cusgift', 99000, 99000, now(), now() + interval '5 days', now(), 'v', 'u')`);
  const g = await api(W, 'once-prepare', { plan: 'solo', cycle: 'month', expectedAmount: 9900, acceptedTermsVersion: 'sub-2026-12' });
  assert.deepEqual([g.status, g.body.error], [409, 'already_subscribed']);
});

await check('결제 거절: 포인트를 돌려놓고 card_declined(402) · 구독은 연체로 바뀌지 않는다 · 애매하면 202 그대로', async () => {
  const q = await api(P, 'quote', { plan: 'solo', cycle: 'month' });
  const p = await api(P, 'once-prepare', { plan: 'solo', cycle: 'month', expectedAmount: 9900, acceptedTermsVersion: 'sub-2026-12', usePoints: 297 });
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(q.body.pointsMax, 297);
  const key = payInWidget(p.body.orderId, p.body.cardAmount);
  toss.unclear = true;
  const pend = await api(P, 'once-confirm', { orderId: p.body.orderId, paymentKey: key, amount: p.body.cardAmount });
  assert.deepEqual([pend.status, pend.body.error], [202, 'payment_pending']);
  assert.equal(await pts(PM), 5000 - 297, '애매하면 포인트를 잡은 채 기다린다');
  toss.unclear = false; toss.decline = true;
  const dec = await api(P, 'once-confirm', { orderId: p.body.orderId, paymentKey: key, amount: p.body.cardAmount });
  assert.deepEqual([dec.status, dec.body.error], [402, 'card_declined']);
  toss.decline = false;
  assert.equal(await pts(PM), 5000, '포인트 원래대로');
  const s = await sub(P);
  assert.equal(s.status, 'pending'); assert.equal(s.retry_count, 0);
});

let pBuy;
await check('포인트 + 카드로 다시 결제 → 전액 환불(클래스 상점 웹훅 sub… 주문): 구독 끝 · 강의 닫힘 · 포인트 반환', async () => {
  pBuy = await buy(P, 'solo', 'month', { usePoints: 297 });
  assert.equal(pBuy.c.body.status, 'paid'); assert.equal(await pts(PM), 5000 - 297);
  assert.equal(await access(P, 'p@example.test', 'anne'), true);
  // 클래스 상점 웹훅 주소로 들어온다(진입 모듈) — cls 주문은 라이브로 넘기고(null) sub 주문만 받는다
  assert.equal(await classMidSubscriptionWebhook(new Request('https://api.test/api/class-checkout/webhook', { method: 'POST', body: JSON.stringify({ data: { orderId: 'cls' + 'a'.repeat(32), paymentKey: 'x' } }) }), ENV), null);
  assert.equal(await classMidSubscriptionWebhook(new Request('https://api.test/api/class-checkout/webhook', { method: 'POST', body: 'not json' }), ENV), null);
  const pay = toss.payments.get(pBuy.paymentKey); pay.status = 'CANCELED'; pay.balanceAmount = 0;
  const waits = [];
  const res = await entry.fetch(new Request('https://api.test/api/class-checkout/webhook', { method: 'POST',
    body: JSON.stringify({ eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: pBuy.p.body.orderId, paymentKey: pBuy.paymentKey } }) }), ENV, { waitUntil: (x) => waits.push(x) });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body)); assert.equal(body.status, 'canceled');
  await Promise.all(waits);
  const s = await sub(P);
  assert.equal(s.status, 'canceled');
  assert.equal(await access(P, 'p@example.test', 'anne'), false);
  assert.equal(await pts(PM), 5000, '포인트 전부 반환');
});

await check('기간권 연간 7일 뒤 일부 환불(제6조): 견적대로 부분 취소 → 구독 종료 · 환불 줄 한 줄', async () => {
  await shiftUser(T2, '40 days');
  const q = await quote(T2);
  assert.deepEqual([q.mode, q.monthsUsed, q.monthlyPrice, q.refundCard, q.endsSubscription], ['prorated', 2, 14900, 149000 - 2 * 14900, true]);
  const payRow = await one(`select * from public.class_subscription_payments where user_id = '${T2}' and status = 'paid'`);
  const pay = toss.payments.get(payRow.payment_key);
  pay.status = 'PARTIAL_CANCELED'; pay.balanceAmount = 149000 - q.refundCard;
  const w = await api(T2, 'webhook', { data: { paymentKey: payRow.payment_key, orderId: payRow.id } });
  assert.equal(w.status, 200, JSON.stringify(w.body)); assert.equal(w.body.status, 'partial_canceled');
  assert.equal((await sub(T2)).status, 'canceled', '기간권 일부 환불 = 구독 끝');
  assert.equal((await one(`select canceled_amount from public.class_subscription_payments where id = '${payRow.id}'`)).canceled_amount, q.refundCard);
  await api(T2, 'webhook', { data: { paymentKey: payRow.payment_key, orderId: payRow.id } });
  assert.equal((await outbox(`kind = 'refund' and payment_id = '${payRow.id}'`)).length, 1, '웹훅을 다시 받아도 환불 메일 줄은 하나');
  await unshiftUser(T2, '40 days');
});

await check('올인원 전환 차감: 기간권으로 낸 카드 금액을 그대로 센다(12월 31일까지)', async () => {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const q = (await one(`select public.class_checkout_quote('${T}') as v`)).v;
  assert.equal(q.subscriptionCredit, today <= '2026-12-31' ? 89000 : 0);
  assert.equal(q.amount, today <= '2026-12-31' ? 398000 - 89000 : 398000);
  const st = await api(T, 'status');
  if (today <= '2026-12-31') assert.equal(st.body.conversion.credit, 89000);
});

await check('끝나기 전 안내 대상: 기간권·선물만 · 7일 안 · 같은 기간은 한 번(mark_reminded) · 이어 사면 다시 대상', async () => {
  await db.exec(`update public.class_subscriptions set current_period_end = now() + interval '3 days' where user_id = '${T}'`);
  const list = (await one(`select public.class_subscription_expiring(7) as v`)).v;
  const ids = list.map((x) => x.userId).sort();
  assert.ok(ids.includes(T) && ids.includes(W), JSON.stringify(list));
  assert.ok(!ids.includes(U), '자동 결제는 대상 아님');
  assert.ok(!ids.includes(V), '아직 한 달 남은 기간권은 대상 아님');
  const t = list.find((x) => x.userId === T);
  assert.equal(t.email, 't@example.test'); assert.equal(t.billingMode, 'once');
  assert.equal((await one(`select public.class_subscription_mark_reminded('${t.subscriptionId}', '${new Date(0).toISOString()}') as v`)).v.ok, false, '다른 기간 끝이면 표시 안 함');
  assert.equal((await one(`select public.class_subscription_mark_reminded('${t.subscriptionId}') as v`)).v.ok, true);
  assert.ok(!(await one(`select public.class_subscription_expiring(7) as v`)).v.some((x) => x.userId === T), '한 번 표시하면 다시 안 나온다');
  await db.exec(`update public.class_subscriptions set current_period_end = now() + interval '4 days' where user_id = '${T}'`);
  assert.ok((await one(`select public.class_subscription_expiring(7) as v`)).v.some((x) => x.userId === T), '기간이 바뀌면 다시 대상');
  await db.exec(`update public.class_subscriptions set reminded_period_end = null where user_id = '${T}'`);
});

await check('권한: 새 함수 전부 service_role 만(회원·비로그인은 permission denied)', async () => {
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role};`);
    try {
      for (const sql of [`select public.class_subscription_once_begin('${V}','solo','month',9900,9900,0,'v','u',0)`,
        `select public.class_subscription_once_claim('${V}','sub00','k',1)`, 'select public.class_subscription_expiring(7)',
        `select public.class_subscription_mark_reminded('${V}')`, 'select public.class_subscription_email_claim()',
        'select public.class_subscription_email_queue_reminders(7)', `select public.class_subscription_summary('${V}')`,
        `select public.class_subscription_fail('x','y')`]) {
        await assert.rejects(db.query(sql), /permission denied/, `${role}: ${sql}`);
      }
    } finally { await db.exec('reset role;'); }
  }
});

// ── 구독 안내 메일 ──
await check('메일 줄: 결제마다 한 줄(같은 승인을 다시 보내도 한 줄) · 전액 환불 = 환불 한 줄 + 안 나간 결제 메일은 닫힘 · 결제 전에 닫힌 주문은 메일 없음', async () => {
  const paidRows = await outbox(`kind = 'paid'`);
  const paidPayments = (await db.query(`select id from public.class_subscription_payments where paid_at is not null`)).rows.map((r) => r.id).sort();
  assert.deepEqual(paidRows.map((r) => r.payment_id).sort(), paidPayments);
  assert.equal(new Set(paidRows.map((r) => r.dedup_key)).size, paidRows.length);
  const refunds = await outbox(`kind = 'refund'`);
  assert.equal(refunds.length, 3, '기간권 전액 환불 2건(V 이어 산 기간 · P) + 연간 일부 환불 1건(T2)');
  assert.equal(refunds.find((r) => r.payment_id === pBuy.p.body.orderId).refund_amount, pBuy.p.body.cardAmount);
  assert.equal((await outbox(`kind = 'paid' and payment_id = '${pBuy.p.body.orderId}'`))[0].status, 'canceled');
  assert.equal((await outbox(`status = 'accepted'`)).length, 0);
  const declinedOrder = (await one(`select id from public.class_subscription_payments where user_id = '${P}' and status = 'failed'`)).id;
  assert.equal((await outbox(`payment_id = '${declinedOrder}'`)).length, 0);
});

await check('스위치가 꺼져 있으면 아무것도 안 보낸다(DB 도 안 건드린다) · 안내 줄도 안 쌓는다', async () => {
  const before = sbCalls.length;
  assert.equal(await processSubscriptionEmails(ENV, { sbFetch }), 0);
  assert.equal(await queueSubscriptionReminders(ENV, { sbFetch }), 0);
  assert.equal(await processSubscriptionEmails({ ...MAIL, CLASS_SUBSCRIPTION_PAGE_URL: 'https://evil.test/x' }, { sbFetch }), 0, '페이지 주소가 회사 도메인이 아니면 닫힘');
  const off = { ...MAIL, CLASS_SUBSCRIPTION_MAIL_ENABLED: 'false' };
  assert.equal(await processSubscriptionEmails(off, { sbFetch }), 0, '키·발신자·주소가 다 있어도 스위치가 꺼져 있으면 0');
  assert.equal(await queueSubscriptionReminders(off, { sbFetch }), 0);
  assert.equal(sbCalls.length, before); assert.equal(mails.length, 0);
});

await check('결제 완료 메일: 한 번만 보낸다(같은 Idempotency-Key) · 기간권 안내 문구 · 금액·기간·포인트·더 드린 달', async () => {
  const sent = await processSubscriptionEmails(MAIL, { sbFetch, paymentId: tBuy.p.body.orderId });
  assert.equal(sent, 1); assert.equal(mails.length, 1);
  const m = mails[0];
  const row = (await outbox(`payment_id = '${tBuy.p.body.orderId}' and kind = 'paid'`))[0];
  assert.equal(row.status, 'accepted'); assert.equal(m.key, `class-subscription/${row.id}`);
  assert.deepEqual(m.body.to, ['t@example.test']); assert.equal(m.body.subject, SUBSCRIPTION_MAIL_COPY.paid.subject);
  for (const s of ['개인 연간 구독', '89,000원', '1,000P', '3달', SUBSCRIPTION_MAIL_COPY.paid.once, tBuy.p.body.orderId, 'https://class-new.literstella.co.kr/room', 'pf.kakao.com', 'logo-literstella-en.png']) {
    assert.ok(m.body.html.includes(s), s); }
  assert.ok(m.body.text.includes(SUBSCRIPTION_MAIL_COPY.paid.once));
  assert.equal(await processSubscriptionEmails(MAIL, { sbFetch, paymentId: tBuy.p.body.orderId }), 0, '다시 불러도 안 보낸다');
  assert.equal(mails.length, 1);
});

await check('보내기 실패(429) = 다시 · 재시도는 같은 봉투·같은 키 · 나머지 결제 메일 전부 보냄', async () => {
  resendMode = 429;
  await processSubscriptionEmails(MAIL, { sbFetch, limit: 1 });
  const retry = (await outbox(`status = 'pending' and attempts = 1`))[0];
  assert.ok(retry && retry.envelope, '봉투를 저장해 둔다');
  resendMode = 200;
  await db.exec(`update public.class_subscription_email_outbox set next_attempt_at = now() where status = 'pending'`);
  await processSubscriptionEmails(MAIL, { sbFetch, limit: 50 });
  const r = mails.find((x) => x.key === `class-subscription/${retry.id}`);
  assert.deepEqual(r.body, retry.envelope);
  const auto = mails.find((x) => x.body.to[0] === 'u@example.test');
  assert.ok(auto.body.html.includes('자동 결제돼요'), '자동 결제 회원에게는 다음 결제일 안내');
  assert.ok(!auto.body.html.includes(SUBSCRIPTION_MAIL_COPY.paid.once));
  assert.equal(new Set(mails.map((x) => x.key)).size, mails.length, '같은 줄을 두 번 보내지 않았다');
});

await check('환불 메일: 환불 금액 · 돌려드린 포인트 · 구독이 끝났다는 안내 / 이어 산 기간 환불은 그대로 이용 안내', async () => {
  const m = mails.find((x) => x.body.subject === SUBSCRIPTION_MAIL_COPY.refund.subject && x.body.to[0] === 'p@example.test');
  assert.ok(m, '환불 메일이 나갔다');
  for (const s of ['9,900원'.replace('9,900', (pBuy.p.body.cardAmount).toLocaleString('ko-KR')), '297P', SUBSCRIPTION_MAIL_COPY.refund.ended]) assert.ok(m.body.html.includes(s), s);
  const v = mails.find((x) => x.body.subject === SUBSCRIPTION_MAIL_COPY.refund.subject && x.body.to[0] === 'v@example.test');
  assert.ok(v.body.html.includes('그대로 이용할 수 있어요') || v.body.html.includes(SUBSCRIPTION_MAIL_COPY.refund.ended));
});

await check('끝나기 전 안내 메일: 7일 안 기간권·선물에 한 통씩 · 다시 돌려도 안 쌓인다 · 다시 구독하기 링크 = 구독 페이지 주소', async () => {
  const before = mails.length;
  const queued = await queueSubscriptionReminders(MAIL, { sbFetch });
  assert.equal(queued, 2, 'T(기간권) · W(선물)');
  const tSub = await sub(T);
  assert.equal(ms(tSub.reminded_period_end), ms(tSub.current_period_end), '보냈다고 표시(class_subscription_mark_reminded)');
  assert.equal(await queueSubscriptionReminders(MAIL, { sbFetch }), 0, '같은 기간은 다시 안 쌓인다');
  await processSubscriptionEmails(MAIL, { sbFetch, limit: 20 });
  const sent = mails.slice(before);
  assert.equal(sent.length, 2);
  const t = sent.find((x) => x.body.to[0] === 't@example.test'); const w = sent.find((x) => x.body.to[0] === 'w@example.test');
  assert.ok(t.body.html.includes('https://class-new.literstella.co.kr/subscribe')); assert.ok(t.body.html.includes(SUBSCRIPTION_MAIL_COPY.reminder.onceHow));
  assert.ok(w.body.html.includes(SUBSCRIPTION_MAIL_COPY.reminder.giftHow));
  assert.match(t.body.subject, /구독이 \d{4}년 \d+월 \d+일에 끝나요/);
  assert.equal(await queueSubscriptionReminders(MAIL, { sbFetch }), 0);
  await processSubscriptionEmails(MAIL, { sbFetch });
  assert.equal(mails.length, before + 2, '같은 기간 안내는 한 번');
});

await check('뜻이 없어진 안내는 안 보낸다(이어 샀다) · 스위치가 꺼진 동안 쌓여 3일 지난 줄은 보내지 않고 닫는다', async () => {
  const subT = await sub(T);
  await db.exec(`insert into public.class_subscription_email_outbox (kind, dedup_key, user_id, subscription_id, period_end)
      values ('reminder', 'reminder:test-old-period', '${T}', '${subT.id}', now() + interval '1 day');
    insert into public.class_subscription_email_outbox (kind, dedup_key, user_id, subscription_id, payment_id, created_at)
      values ('paid', 'paid:test-stale', '${T}', '${subT.id}', '${tBuy.p.body.orderId}', now() - interval '4 days')`);
  const before = mails.length;
  await processSubscriptionEmails(MAIL, { sbFetch, limit: 10 });
  assert.equal(mails.length, before);
  assert.equal((await outbox(`dedup_key = 'reminder:test-old-period'`))[0].status, 'skipped');
  assert.equal((await outbox(`dedup_key = 'paid:test-stale'`))[0].status, 'skipped');
});

await check('봉투 만들기: 페이지 주소·발신자가 틀리면 보내지 않는다(던진다) · 글자는 이스케이프', async () => {
  const f = { kind: 'reminder', email: 'x@example.test', plan: 'solo', cycle: 'month', source: 'paid', billingMode: 'once', periodEnd: new Date().toISOString() };
  assert.throws(() => renderSubscriptionEmail(f, { ...MAIL, CLASS_SUBSCRIPTION_PAGE_URL: 'http://class-new.literstella.co.kr/s' }), /mail_configuration/);
  assert.throws(() => renderSubscriptionEmail(f, { ...MAIL, RESEND_FROM: 'a\nb' }), /mail_configuration/);
  assert.throws(() => renderSubscriptionEmail({ ...f, email: 'bad' }, MAIL), /mail_configuration/);
  const e = renderSubscriptionEmail({ ...f, kind: 'paid', paymentKind: 'first', periodStart: f.periodEnd, amount: 9900, pointsUsed: 0, bonusMonths: 0, orderId: '<b>' }, MAIL);
  assert.ok(e.html.includes('&lt;b&gt;') && !e.html.includes('<b>'));
});

console.log(`class-subscription-onetime-test: ${n} checks passed (토스 승인 ${toss.confirms}회 · 빌링 ${toss.billing}회 · 메일 ${mails.length}통)`);
