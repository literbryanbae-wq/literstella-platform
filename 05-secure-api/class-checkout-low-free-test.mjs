// 올인원 전환가가 구독료 차감으로 낮아질 때(0원 포함) — 20261113120000_class_checkout_low_and_free.sql 시험.
//   PGLITE_MODULE=<…/@electric-sql/pglite/dist/index.js> node class-checkout-low-free-test.mjs
//   운영 DB 에 이미 있는 것을 순서대로 올린 뒤, class_checkout_quote·class_checkout_prepare 는 **2026-11-13 운영 정의 그대로**로 바꾼다
//   (저장소의 옛 파일 본문은 운영에서 치환 패치돼 다르다 — 구독료 차감·소장 0권 허용·이론 자동 포함).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { classMemberCheckout } from './src/class-member-checkout.mjs';
import { renderCheckoutEmail, freePaymentRecord } from './src/class-checkout-email.mjs';
import { conversionQuote } from './src/class-subscription-pricing.mjs';

const ENTRY = process.env.PGLITE_MODULE || process.env.PGLITE_ENTRY;
if (!ENTRY) { console.log('class-checkout-low-free-test: PGLITE_MODULE 가 없어 건너뜀'); process.exit(0); }
const { PGlite } = await import(pathToFileURL(ENTRY).href);
const db = new PGlite();
let checks = 0; let seq = 0;
const check = (v, m) => { assert.ok(v, m); checks++; };
const rpc = async (name, args = []) => (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) v`, args)).rows[0].v;
const mig = async (name) => db.exec(await readFile(new URL(`./supabase/migrations/${name}.sql`, import.meta.url), 'utf8'));

await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
create function auth.uid() returns uuid language sql as $$select null::uuid$$;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table users(id uuid primary key default gen_random_uuid(),auth_uid uuid,email text);
create table point_transactions(user_id uuid,season_id text,amount int,reason text,ref_id text,memo text,unique(user_id,reason,ref_id));
create table class_enrollments(email text,book_code text,source text);
create table class_access_passes(email text);
create table class_verifications(email text,book_code text,verified_at timestamptz default clock_timestamp(),enrollment_email text,primary key(email,book_code));
create table class_redemptions(book_code text,redeemed_by text);create table stella_upgrade_requests(user_id uuid,status text);
create function public.growth_panel_request(p_action text,p_campaign_id text,p_auth_uid uuid,p_auth_email text,p_payload jsonb default '{}') returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;
grant usage on schema public,auth to service_role;grant select on class_redemptions,stella_upgrade_requests,class_enrollments,class_access_passes,users to service_role;
grant select,insert,update,delete on class_verifications,point_transactions to service_role;
-- 구독 표(전환 차감·다음 결제 중단 트리거가 읽는 칸만)
create table public.class_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid,status text,cancel_requested_at timestamptz,next_charge_at timestamptz,updated_at timestamptz);
create table public.class_subscription_payments(id text primary key,user_id uuid,amount int,canceled_amount int not null default 0,paid_at timestamptz);`);
for (const f of ['20261012100801_class_member_checkout', '20261012155826_class_checkout_email_outbox', '20261012170322_class_course_checkout', '20261013131413_class_first_course_promotion']) await mig(f);

// ── 2026-11-13 운영 정의(pg_get_functiondef) 그대로 ──
await db.exec(`CREATE OR REPLACE FUNCTION public.class_checkout_quote(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_email text;
  v_all text[] := array['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock','theory'];
  v_owned text[];
  v_missing text[];
  v_blocked boolean;
  v_paid int;
  v_theory boolean := false;
  v_n int;
  v_sub int := 0;
begin
  select lower(email) into v_email from auth.users where id=p_user_id and email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('ok',false,'error','login_required'); end if;
  select coalesce(array_agg(c order by n),array[]::text[]) into v_owned
    from unnest(v_all) with ordinality t(c,n)
    where exists(select 1 from public.class_verifications v where lower(v.email)=v_email and v.book_code=c)
       or exists(select 1 from public.class_redemptions r where lower(r.redeemed_by)=v_email and r.book_code=c);
  -- 강독 2개 이상 소장 = 핵심 이론 무료 수강 → 소장으로 센다(전환 차감·누락 목록 모두)
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
  -- 구독으로 낸 금액만큼 차감(12월 31일 KST 까지 낸 것 · 그날까지만)
  if (now() at time zone 'Asia/Seoul')::date <= date '2026-12-31' then
    select coalesce(sum(greatest(sp.amount - sp.canceled_amount, 0)), 0)::int into v_sub
      from public.class_subscription_payments sp
     where sp.user_id = p_user_id and sp.paid_at is not null and (sp.paid_at at time zone 'Asia/Seoul')::date <= date '2026-12-31';
    v_sub := least(v_sub, greatest(398000-v_n*50000,0));
  end if;
  return jsonb_build_object('ok',true,'userId',p_user_id,'email',v_email,
    'baseAmount',398000,'ownedBooks',v_owned,'missingBooks',v_missing,
    'ownedCount',v_n,'creditAmount',least(v_n*50000,398000),
    'amount',greatest(398000-v_n*50000,0)-v_sub,'subscriptionCredit',v_sub,'complete',v_n=8,
    'eligible',v_n between 0 and 7 and not v_blocked,
    'newBuyer',v_n=0,'theoryIncluded',v_theory,
    'existingRequest',v_blocked);
end $function$;
CREATE OR REPLACE FUNCTION public.class_checkout_prepare(p_user_id uuid, p_expected_amount integer, p_terms_version text, p_terms_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare q jsonb; o public.class_checkout_orders; v_owned text[]; v_missing text[];
begin
  if coalesce(p_terms_version,'')='' or coalesce(p_terms_url,'')='' then
    return jsonb_build_object('ok',false,'error','terms_changed'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stella-upgrade:'||p_user_id::text,0));
  q := public.class_checkout_quote(p_user_id);
  if not coalesce((q->>'ok')::boolean,false) then return q; end if;
  if not (q->>'eligible')::boolean then return jsonb_build_object('ok',false,'error',
    case when (q->>'complete')::boolean then 'already_owned' when (q->>'existingRequest')::boolean then 'existing_request' else 'member_required' end); end if;
  if p_expected_amount is distinct from (q->>'amount')::integer then
    return jsonb_build_object('ok',false,'error','quote_changed'); end if;
  select coalesce(array_agg(value),array[]::text[]) into v_owned from jsonb_array_elements_text(q->'ownedBooks');
  select coalesce(array_agg(value),array[]::text[]) into v_missing from jsonb_array_elements_text(q->'missingBooks');
  update public.class_checkout_orders set status='expired',updated_at=now()
    where user_id=p_user_id and status='ready' and (product_code<>'class-stella-member-upgrade' or expires_at<=now() or owned_books<>v_owned or email<>q->>'email'
      or terms_version<>p_terms_version or terms_url<>p_terms_url or amount<>(q->>'amount')::integer);
  select * into o from public.class_checkout_orders where user_id=p_user_id
    and status in ('ready','confirming','partial_refund_review') for update;
  if found and o.status<>'ready' then return jsonb_build_object('ok',false,'error','payment_pending'); end if;
  if o.id is null then
    insert into public.class_checkout_orders(id,user_id,email,amount,owned_books,missing_books,terms_version,terms_url)
      values('cls'||replace(gen_random_uuid()::text,'-',''),p_user_id,q->>'email',(q->>'amount')::integer,v_owned,v_missing,p_terms_version,p_terms_url)
      returning * into o;
  end if;
  return jsonb_build_object('ok',true,'orderId',o.id,'amount',o.amount,'email',o.email,
    'orderName',case when cardinality(o.owned_books)=0 then '리터스텔라 올인원 8개 평생소장' else '리터스텔라 올인원 8개 평생소장 · 회원 전환' end,
    'customerKey',o.user_id,
    'expiresAt',o.expires_at,'ownedBooks',o.owned_books,'missingBooks',o.missing_books);
end $function$;`);
// 다음 결제 중단 트리거(운영과 같은 파일 — quote 는 이미 subscriptionCredit 이 있어 치환을 건너뛴다)
await mig('20261112110000_class_subscription_conversion');

const TERMS = ['course-terms-2026-10-01', 'https://challenge.literstella.co.kr/course-terms#article-5'];
const SIX = ['kidari', 'anne', 'littlewomen1', 'littlewomen2', 'pride', 'gatsby'];
async function member(books, subPaid = 0) {
  const id = `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`; const email = `low${seq}@example.test`;
  await db.query('insert into auth.users values($1,$2,now())', [id, email]);
  for (const b of books) await db.query('insert into class_verifications(email,book_code) values($1,$2)', [email, b]);
  if (subPaid) await db.query(`insert into public.class_subscription_payments values($1,$2,$3,0,now())`, ['sub' + seq, id, subPaid]);
  return { id, email, emailConfirmed: true };
}
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const creditOpen = today <= '2026-12-31';
const prepare = (u, amount) => rpc('class_checkout_prepare', [u.id, amount, ...TERMS]);
const free = (u) => rpc('class_checkout_grant_free', [u.id, ...TERMS]);

try {
  // ── 대조군: 고치기 전 — 38,100원 주문은 제약 위반으로 죽는다(지금 운영 그대로) ──
  const before = await member(SIX, 9900);
  if (creditOpen) {
    check((await rpc('class_checkout_quote', [before.id])).amount === 38100, '6권+이론 = 48,000 − 9,900');
    await assert.rejects(prepare(before, 38100), /class_checkout_orders_amount_check/); checks++;
  }
  const zeroBefore = await member([]);
  await assert.rejects(prepare(zeroBefore, 398000), /class_checkout_orders_amount_check/, '소장 0권 398,000 도 지금 운영에선 죽는다'); checks++;

  await mig('20261113120000_class_checkout_low_and_free');
  await mig('20261113120000_class_checkout_low_and_free'); // 두 번 돌려도 된다(이미 들어간 치환은 건너뜀)
  check((await db.query(`select count(*)::int n from pg_proc where proname='class_checkout_prepare' and prosrc like '%use_free%'`)).rows[0].n === 1);

  // ── (i) 48,000 아래 금액도 주문이 만들어지고 결제·지급까지 간다 ──
  const low = await member(SIX, 9900);
  const lowAmount = creditOpen ? 38100 : 48000;
  const o = await prepare(low, lowAmount);
  check(o.ok && o.amount === lowAmount, JSON.stringify(o));
  check((await rpc('class_checkout_claim', [low.id, o.orderId, 'key-low', lowAmount])).ok);
  check((await rpc('class_checkout_settle', [o.orderId, 'key-low', lowAmount, 'DONE'])).granted);
  check((await db.query(`select 1 from class_verifications where email=$1 and book_code='sherlock'`, [low.email])).rows.length === 1);
  // 소장 0권(newBuyer) 398,000 도 이제 만들어진다(운영자 2026-11-13: 올인원 결제는 원래 되는 것)
  const nb = await prepare(await member([]), 398000);
  check(nb.ok && nb.amount === 398000 && nb.orderName === '리터스텔라 올인원 8개 평생소장', JSON.stringify(nb));
  // 단품 강좌 하한은 그대로
  await assert.rejects(db.query(`insert into class_checkout_orders(id,user_id,email,product_code,amount,owned_books,missing_books,terms_version,terms_url)
    values('clsbadcourse',$1,'x@example.test','class-kidari-lifetime',100,'{}','{kidari}','v','u')`, [low.id]), /amount_check/); checks++;

  // ── (ii) 0원: prepare 는 use_free · free 는 한 번만 지급 · 구독 다음 결제가 멈춘다 · 메일 큐 2통 ──
  if (creditOpen) {
    const z = await member(SIX, 99000);
    await db.query(`insert into public.class_subscriptions(user_id,status,next_charge_at) values($1,'active',now()+interval '20 days')`, [z.id]);
    const q = await rpc('class_checkout_quote', [z.id]);
    check(q.amount === 0 && q.subscriptionCredit === 48000 && q.eligible, JSON.stringify(q));
    const p = await prepare(z, 0);
    check(p.ok === false && p.error === 'use_free', JSON.stringify(p));
    check((await db.query(`select count(*)::int n from class_checkout_orders where user_id=$1`, [z.id])).rows[0].n === 0, 'prepare 가 0원 주문을 만들지 않는다');
    // 결제창만 열고 닫은 옛 주문(ready)이 있으면 닫힌다
    await db.query(`insert into class_checkout_orders(id,user_id,email,amount,owned_books,missing_books,terms_version,terms_url)
      values('clsoldready',$1,$2,48000,'{}','{}','v','u')`, [z.id, z.email]);
    const g = await free(z);
    check(g.ok && g.status === 'paid' && g.free && g.granted && g.missingBooks.join() === 'sherlock' && g.grantedBooks.join() === 'sherlock', JSON.stringify(g));
    check((await db.query(`select status from class_checkout_orders where id='clsoldready'`)).rows[0].status === 'expired');
    const row = (await db.query(`select * from class_checkout_orders where id=$1`, [g.orderId])).rows[0];
    check(row.status === 'paid' && row.amount === 0 && row.payment_key === null && row.product_code === 'class-stella-member-upgrade');
    check((await db.query(`select count(*)::int n from class_checkout_grants where order_id=$1`, [g.orderId])).rows[0].n === 1);
    check((await db.query(`select count(*)::int n from class_checkout_email_outbox where order_id=$1`, [g.orderId])).rows[0].n === 2, '결제 메일 큐(회원·운영자)');
    const s = (await db.query(`select * from public.class_subscriptions where user_id=$1`, [z.id])).rows[0];
    check(s.cancel_requested_at && s.next_charge_at === null && s.status === 'active', '구독 다음 결제 중단(낸 기간은 그대로)');
    const again = await free(z);
    check(again.ok && again.again && again.orderId === g.orderId, JSON.stringify(again));
    check((await db.query(`select count(*)::int n from class_checkout_orders where user_id=$1 and status='paid'`, [z.id])).rows[0].n === 1, '두 번 불러도 한 번만 지급');
    check((await db.query(`select count(*)::int n from class_checkout_grants g join class_checkout_orders o on o.id=g.order_id where o.user_id=$1`, [z.id])).rows[0].n === 1);
    // 결제 메일: 0원 주문은 토스를 묻지 않고 주문 행으로 기록을 만든다
    const pay = freePaymentRecord(row);
    check(pay.paymentKey === row.payment_key && pay.totalAmount === row.amount && pay.status === 'DONE');
    const mailEnv = { RESEND_FROM: 'LiterStella <mail@example.test>', ADMIN_EMAIL: 'admin@example.test' };
    const mail = renderCheckoutEmail({ ...row, updated_at: new Date(row.updated_at).toISOString() }, pay, 'member', mailEnv);
    check(mail.subject.includes('수강권이 열렸어요') && mail.html.includes('결제 없음(0원)') && mail.html.includes('구독료 차감') &&
      mail.html.includes('48,000원') && mail.html.includes('기존 소장 할인') && mail.html.includes('350,000원') && !mail.html.includes('398,000원'), mail.text);
    check(!mail.html.includes('카카오 채널로 문의해 주세요') && mail.html.includes('영수증은 발행되지 않아요'));
    // 결제가 있는 38,100원 주문 메일도 할인을 둘로 나눠 적는다(예전: '기존 소장 할인 359,900원')
    const lowRow = (await db.query(`select * from class_checkout_orders where id=$1`, [o.orderId])).rows[0];
    const lowMail = renderCheckoutEmail(lowRow, { approvedAt: '2026-11-13T10:00:00+09:00', method: '카드' }, 'member', mailEnv);
    check(lowMail.html.includes('350,000원') && lowMail.html.includes('9,900원') && !lowMail.html.includes('359,900원'), lowMail.text);
  }

  // ── (ii-b) 구독료 차감 뒤 1~999원 자투리 = 회사 부담 0원(운영자 2026-11-13) · conversionQuote 도 같은 답 ──
  check((await db.query(`select count(*)::int n from pg_proc where proname='class_checkout_quote' and prosrc like '%roundedDown%'`)).rows[0].n === 1, 'quote 패치 1번만');
  // 구독 차감이 있는 회원만 — 조건이 정의에 남아 있는지(소장 할인만으로는 1~999 가 나올 수 없어 동작으로는 못 잰다)
  check((await db.query(`select prosrc from pg_proc where proname='class_checkout_quote'`)).rows[0].prosrc.includes('if v_sub > 0 and greatest(398000-v_n*50000,0)-v_sub between 1 and 999 then'), '구독 차감 0 회원 제외 조건');
  if (creditOpen) {
    // 6권 + 이론 = 48,000 · 낸 구독료 47,500 → 500원 남음 → 0원
    const r5 = await member(SIX, 47500);
    const q5 = await rpc('class_checkout_quote', [r5.id]);
    check(q5.amount === 0 && q5.roundedDown === 500 && q5.subscriptionCredit === 48000 && q5.eligible, JSON.stringify(q5));
    const cq5 = conversionQuote({ ownedCount: q5.ownedCount, payments: [{ amount: 47500, paidAt: new Date().toISOString(), canceledAmount: 0 }] });
    check(cq5.amount === 0 && cq5.roundedDown === 500 && cq5.credit === 48000, JSON.stringify(cq5));
    check((await prepare(r5, 0)).error === 'use_free');
    const g5 = await free(r5);
    check(g5.ok && g5.free && g5.granted && g5.roundedDown === 500 && g5.subscriptionCredit === 48000 && g5.grantedBooks.join() === 'sherlock', JSON.stringify(g5));
    const row5 = (await db.query(`select * from class_checkout_orders where id=$1`, [g5.orderId])).rows[0];
    check(row5.amount === 0 && row5.status === 'paid' && row5.payment_key === null);
    const mail5 = renderCheckoutEmail({ ...row5, updated_at: new Date(row5.updated_at).toISOString() }, freePaymentRecord(row5), 'member',
      { RESEND_FROM: 'LiterStella <mail@example.test>', ADMIN_EMAIL: 'admin@example.test' });
    check(mail5.text.includes('구독료 차감: 48,000원') && mail5.text.includes('기존 소장 할인: 350,000원') && !mail5.text.includes('47,500원'), mail5.text);
    // 999원 남음 → 0원 · 1,000원 남음 → 그대로 1,000원
    const r9 = await member(SIX, 47001);
    const q9 = await rpc('class_checkout_quote', [r9.id]);
    check(q9.amount === 0 && q9.roundedDown === 999 && q9.subscriptionCredit === 48000, JSON.stringify(q9));
    const r10 = await member(SIX, 47000);
    const q10 = await rpc('class_checkout_quote', [r10.id]);
    check(q10.amount === 1000 && q10.roundedDown === 0 && q10.subscriptionCredit === 47000, JSON.stringify(q10));
    const cq10 = conversionQuote({ ownedCount: q10.ownedCount, payments: [{ amount: 47000, paidAt: new Date().toISOString(), canceledAmount: 0 }] });
    check(cq10.amount === 1000 && cq10.roundedDown === 0 && cq10.credit === 47000, JSON.stringify(cq10));
    check((await free(r10)).error === 'not_free');
    const p10 = await prepare(r10, 1000);
    check(p10.ok && p10.amount === 1000, JSON.stringify(p10));
  }
  // 구독 차감 0 인 회원은 영향 없다
  const r0 = await member(['kidari']);
  const q0 = await rpc('class_checkout_quote', [r0.id]);
  check(q0.amount === 348000 && q0.roundedDown === 0 && q0.subscriptionCredit === 0, JSON.stringify(q0));
  const cq0 = conversionQuote({ ownedCount: 1, payments: [] });
  check(cq0.amount === 348000 && cq0.roundedDown === 0 && cq0.credit === 0, JSON.stringify(cq0));

  // ── (iii) 0원이 아니면 free 를 거절한다 · 다 가진 회원도 ──
  const paid = await member(['kidari']);
  const nf = await free(paid);
  check(nf.ok === false && nf.error === 'not_free' && nf.amount === 348000, JSON.stringify(nf));
  check((await db.query(`select count(*)::int n from class_checkout_orders where user_id=$1`, [paid.id])).rows[0].n === 0);
  const all = await member(['kidari', 'anne', 'littlewomen1', 'littlewomen2', 'pride', 'gatsby', 'sherlock']);
  check((await free(all)).error === 'already_owned');
  check((await rpc('class_checkout_grant_free', [paid.id, '', ''])).error === 'terms_changed');

  // ── (iv) 회원 역할로 직접 부를 수 없다 ──
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(db.query(`select public.class_checkout_grant_free('${paid.id}','v','u')`), /permission denied/); checks++; }
    finally { await db.exec('reset role'); }
  }

  // ── 서버 모듈(가짜 PostgREST 로 실제 SQL) ──
  if (creditOpen) {
    let auth = await member(SIX, 99000);
    const env = { CLASS_MEMBER_CHECKOUT_ENABLED: 'true', TOSS_CLASS_SECRET_KEY: 'test', TOSS_CLASS_CLIENT_KEY: 'ck',
      CLASS_MEMBER_CHECKOUT_TERMS_VERSION: TERMS[0], CLASS_MEMBER_CHECKOUT_TERMS_URL: TERMS[1] };
    const deps = {
      requireUser: async () => auth,
      json: (body, status, headers) => new Response(JSON.stringify(body), { status, headers }),
      sbFetch: async (_env, path, init) => {
        if (path.startsWith('rpc/class_checkout_')) {
          const name = path.split('rpc/')[1]; const args = JSON.parse(init.body);
          const keys = Object.keys(args);
          return Response.json((await db.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) v`, keys.map((k) => args[k]))).rows[0].v);
        }
        return Response.json([]);
      },
    };
    const call = async (action, body = {}, config = env, productCode) => {
      const res = await classMemberCheckout(new Request('https://x/api/class-checkout/' + action, { method: 'POST', body: JSON.stringify(body) }), config, {}, action,
        productCode ? { ...deps, productCode } : deps);
      return { status: res.status, body: await res.json() };
    };
    const qq = await call('quote');
    check(qq.body.free === true && qq.body.amount === 0, JSON.stringify(qq.body));
    const pp = await call('prepare', { expectedAmount: 0, acceptedTermsVersion: TERMS[0] });
    check(pp.status === 409 && pp.body.error === 'use_free', JSON.stringify(pp));
    check((await call('free', { acceptedTermsVersion: 'old' })).body.error === 'terms_changed');
    check((await call('free', { acceptedTermsVersion: TERMS[0] }, { ...env, CLASS_MEMBER_CHECKOUT_ENABLED: 'false' })).status === 503);
    check((await call('free', { acceptedTermsVersion: TERMS[0] }, env, 'class-kidari-lifetime')).status === 404, '단품 주문서에는 0원 길이 없다');
    const ff = await call('free', { acceptedTermsVersion: TERMS[0] }, { ...env, TOSS_CLASS_SECRET_KEY: '' });
    check(ff.status === 200 && ff.body.granted && ff.body.free, JSON.stringify(ff));
    check((await call('quote')).body.free === false, '받은 뒤에는 다 가졌다(complete)');
    auth = await member(['kidari']);
    const nq = await call('quote');
    check(nq.body.free === false && nq.body.amount === 348000);
    const nfr = await call('free', { acceptedTermsVersion: TERMS[0] });
    check(nfr.status === 409 && nfr.body.error === 'not_free');
    auth = null; check((await call('free', {})).status === 401);
  }
} finally { await db.close(); }
console.log(`class-checkout-low-free-test: ${checks} checks passed${creditOpen ? '' : ' (구독료 차감 기한이 지나 0원 경로는 건너뜀)'}`);
