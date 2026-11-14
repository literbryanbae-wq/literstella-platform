// 야나완 성공 선물 자동 지급 — 실제 Postgres(PGlite) 위에 운영 정의 모형 + 마이그레이션 두 개를 올려 돌린다.
//   PGLITE_ENTRY=<…/@electric-sql/pglite/dist/index.js> node yanawan-gift-db-test.mjs
//   모형 함수 본문은 2026-11-14 운영 정의(pg_get_functiondef)에서 옮겼다 — 운영 스키마 전체는 아니다(못 하는 것은 ops/yanawan-gift-rollback-test.sql).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.env.PGLITE_ENTRY) { console.log('yanawan-gift-db-test: PGLITE_ENTRY 가 없어 건너뜀'); process.exit(0); }
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_ENTRY).href);
const db = new PGlite();
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const v = async (sql, params) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];

// 회원(인증 uid) · 회원 행(public.users.id)
const A = '00000000-0000-4000-8000-00000000000a', AU = '10000000-0000-4000-8000-00000000000a'; // 올인원 · 한 도전 100일
const B = '00000000-0000-4000-8000-00000000000b', BU = '10000000-0000-4000-8000-00000000000b'; // 2권 소장 · 한 도전 66일 → 100일
const C = '00000000-0000-4000-8000-00000000000c', CU = '10000000-0000-4000-8000-00000000000c'; // 소장 없음 · 100일
const D = '00000000-0000-4000-8000-00000000000d', DU = '10000000-0000-4000-8000-00000000000d'; // 올인원 · 40+40+20 = 누적 100(66 없음)
const E = '00000000-0000-4000-8000-00000000000e', EU = '10000000-0000-4000-8000-00000000000e'; // 1권 소장 · 25×4 = 누적 100(30 없음)
const F = '00000000-0000-4000-8000-00000000000f', FU = '10000000-0000-4000-8000-00000000000f'; // 올인원 · 50+30 = 80(66 누적 불인정)
const G = '00000000-0000-4000-8000-000000000010', GU = '10000000-0000-4000-8000-000000000010'; // 올인원 · 66일 · 올해 구독권 이미 2장
const H = '00000000-0000-4000-8000-000000000011', HU = '10000000-0000-4000-8000-000000000011'; // 수강권 받는 분
const K = '00000000-0000-4000-8000-000000000012', KU = '10000000-0000-4000-8000-000000000012'; // 거짓 날짜(과거 날짜로 몰아 넣기)
const L = '00000000-0000-4000-8000-000000000013', LU = '10000000-0000-4000-8000-000000000013'; // 올인원 · 인증 트리거로 30일째
const em = (x) => `m${x.slice(-2)}@t.test`;
const CLASSIC = ['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock'];

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema private;
  grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', nullif(current_setting('test.email', true), '')) $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
  grant execute on all functions in schema auth to anon, authenticated;
  create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz default now());
  create function public.is_ls_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), '') = '1' $$;

  create table public.users(id uuid primary key, auth_uid uuid, email text, nickname text, avatar_url text, created_at timestamptz default now());
  create table public.seasons(id text primary key, starts_at date, ends_at date, is_active boolean);
  insert into public.seasons values ('yanawan-2606','2026-06-01','2026-06-30',false), ('yanawan-2607','2026-07-01','2026-12-31',true);
  create table public.check_ins(id uuid primary key default gen_random_uuid(), user_id uuid, season_id text, is_yanawan boolean default false,
    checked_in_at date default ((now() at time zone 'Asia/Seoul')::date), created_at timestamptz default now());
  grant select, insert on public.check_ins to authenticated;
  create table public.enrollments(id uuid primary key default gen_random_uuid(), user_id uuid, season_id text, is_yanawan boolean default true,
    goal_days int, status text default 'active', start_date date, created_at timestamptz default now());
  create table public.point_transactions(id uuid primary key default gen_random_uuid(), user_id uuid, season_id text, amount int, reason text, ref_id text, created_at timestamptz default now());
  create table public.payments(status text, source text, raw jsonb, created_at timestamptz default now());
  create table public.class_verifications(email text, book_code text);
  create table public.class_redemptions(code text primary key, book_code text, redeemed_by text, redeemed_at timestamptz, created_at timestamptz default now());
  grant select, update on public.class_redemptions to service_role;

  create function private.yanawan_restart_refs(p_user_id uuid) returns table(ref_id text, created_at timestamptz) language sql stable set search_path = '' as $$
    select p.ref_id, p.created_at from public.point_transactions p
     where p.user_id = p_user_id and p.reason = 'spend_extension' and p.ref_id like 'enroll_pay:%'
    union all
    select (pm.raw ->> 'ref'), pm.created_at from public.payments pm
     where pm.status = 'DONE' and pm.source like 'toss:challenge-%' and (pm.raw ->> 'memberId') = p_user_id::text and (pm.raw ->> 'ref') like 'enroll_pay:%' $$;

  create function private.together_email(p_uid uuid) returns text language sql stable security definer set search_path = '' as $$
    select lower(btrim(u.email)) from auth.users u where u.id = p_uid $$;
  create function private.together_owned_books(p_email text) returns text[] language sql stable security definer set search_path = '' as $$
    select coalesce(array_agg(distinct b order by b), '{}'::text[]) from (
      select cv.book_code b from public.class_verifications cv where lower(cv.email) = lower(p_email)
      union select cr.book_code from public.class_redemptions cr where lower(cr.redeemed_by) = lower(p_email)) x $$;
  create function private.together_classic_count(p_email text) returns integer language sql stable security definer set search_path = '' as $$
    select count(*)::int from unnest(private.together_owned_books(p_email)) b
     where b = any (array['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock']) $$;
  create function private.together_k8() returns text[] language sql immutable set search_path = '' as $$
    select array['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock','theory']::text[] $$;
  create table private.together_seat_bonus(sponsor_uid uuid primary key references auth.users(id) on delete cascade, basis text,
    granted_at timestamptz default now(), granted_by text, note text, level smallint default 30,
    constraint together_seat_bonus_basis_check check (basis = any (array['challenge30','challenge','admin'])),
    constraint together_seat_bonus_level_check check (level = any (array[30,66,100])));
  create function private.together_success_level(p_uid uuid) returns smallint language sql stable security definer set search_path = '' as $$
    select b.level from private.together_seat_bonus b where b.sponsor_uid = p_uid $$;
  create function private.together_seat_bonus_on(p_uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
    select p_uid is not null and private.together_classic_count(private.together_email(p_uid)) >= 7
       and coalesce(private.together_success_level(p_uid), 0) >= 30 $$;
  create function private.together_nickname(p_uid uuid) returns text language sql stable security definer set search_path = '' as $$
    select coalesce((select nullif(btrim(pu.nickname), '') from public.users pu
      where pu.auth_uid = p_uid and lower(btrim(pu.email)) = private.together_email(p_uid) order by pu.created_at limit 1), '회원') $$;
  -- together_view 모형: 운영 정의의 그 줄(앵커)을 글자 그대로 담는다
  create function private.together_view(p_conn uuid, p_uid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $f$
  declare v_partner uuid := p_conn; c record;
  begin
    select 'active'::text as status into c;
    return jsonb_build_object(
      'connectionId', p_conn,
      'partnerNickname', case when v_partner is null or c.status = 'ended' then null else private.together_nickname(v_partner) end,
      'role', 'sponsor');
  end $f$;

  -- 구독권(20261113130000 의 ②·코드 생성기 그대로 — 구독 표 FK 는 뺐다)
  create table public.class_subscription_gift_codes (code text primary key check (code ~ '^[A-HJKMNP-Z2-9]{12}$'),
    kind text not null check (kind in ('yanawan66','yanawan100','operator')), issued_to text, note text, issued_by text,
    issued_at timestamptz not null default now(), expires_at timestamptz, redeemed_by uuid, redeemed_at timestamptz, subscription_id uuid);
  create function private.class_subscription_gift_code() returns text language plpgsql volatile set search_path = '' as $$
  declare a constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea := uuid_send(gen_random_uuid()); i int; o text := '';
  begin foreach i in array array[0,1,2,3,4,5,7,9,10,11,12,13] loop o := o || substr(a, 1 + (get_byte(b, i) % 31), 1); end loop; return o; end $$;

  -- 무료 체험(운영 정의 그대로)
  create table public.class_trial_signups(user_id uuid primary key, email text, kind text, owned_originals smallint default 0,
    consent_version text, created_at timestamptz default now(), ends_at timestamptz, canceled_at timestamptz, cancel_reason text);
  create function private.class_trial_deadline() returns timestamptz language sql immutable set search_path = '' as $$ select timestamptz 'infinity' $$;
  create function private.class_owned_originals(p_email text) returns integer language sql stable set search_path = '' as $$
    select count(distinct b)::int from (select cv.book_code as b from public.class_verifications cv where lower(cv.email) = lower(p_email)
      union select cr.book_code from public.class_redemptions cr where lower(cr.redeemed_by) = lower(p_email)) x
     where b in ('kidari','anne','littlewomen1','littlewomen2','pride','sherlock','gatsby') $$;
  create function private.class_trial_only_books(p_uid uuid, p_email text) returns text[] language sql stable as $$ select array['kidari']::text[] $$;
`);
// 운영 정의 원문(CRLF 포함 — 치환 스크립트가 CRLF 를 다루는지까지 본다)
await db.exec([
  "create function public.class_trial_start(p_consent_version text) returns jsonb language plpgsql security definer set search_path to '' as $function$\r\n",
  "declare\r\n  v_uid uuid := auth.uid();\r\n  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));\r\n  v_row public.class_trial_signups;\r\n  v_owned int;\r\n  v_kind text;\r\nbegin\r\n",
  "  if v_uid is null then raise exception using errcode = '28000', message = 'login_required'; end if;\r\n",
  "  if v_email = '' then return jsonb_build_object('ok', false, 'error', 'email_required'); end if;\r\n",
  "  select * into v_row from public.class_trial_signups where user_id = v_uid;\r\n  if found then\r\n",
  "    return jsonb_build_object('ok', true, 'already', true, 'kind', v_row.kind,\r\n      'books', to_jsonb(private.class_trial_only_books(v_uid, v_email)),\r\n",
  "      'active', v_row.canceled_at is null and (v_row.ends_at is null or v_row.ends_at > now()));\r\n  end if;\r\n",
  "  if now() >= private.class_trial_deadline() then return jsonb_build_object('ok', false, 'error', 'closed'); end if;\r\n",
  "  if length(btrim(coalesce(p_consent_version, ''))) not between 1 and 60 then\r\n    return jsonb_build_object('ok', false, 'error', 'consent_required');\r\n  end if;\r\n",
  "  v_owned := private.class_owned_originals(v_email);\r\n  v_kind := case when v_owned >= 4 then 'owner_gift' else 'full' end;\r\n",
  "  insert into public.class_trial_signups (user_id, email, kind, owned_originals, consent_version)\r\n",
  "  values (v_uid, v_email, v_kind, v_owned, btrim(p_consent_version))\r\n  on conflict (user_id) do nothing;\r\n",
  "  return jsonb_build_object('ok', true, 'already', false, 'kind', v_kind, 'ownedOriginals', v_owned,\r\n",
  "    'books', to_jsonb(private.class_trial_only_books(v_uid, v_email)), 'active', true);\r\nend $function$;\n",
  "create function public.my_class_trial() returns jsonb language plpgsql stable security definer set search_path to '' as $function$\r\n",
  "declare\r\n  v_uid uuid := auth.uid();\r\n  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));\r\n  v_row public.class_trial_signups;\r\n  v_owned int;\r\n",
  "  v_open boolean := now() < private.class_trial_deadline();\r\nbegin\r\n  if v_uid is null then\r\n",
  "    return jsonb_build_object('ok', true, 'open', v_open, 'deadline', '2026-11-30', 'signedUp', false);\r\n  end if;\r\n",
  "  select * into v_row from public.class_trial_signups where user_id = v_uid;\r\n  if found then\r\n",
  "    return jsonb_build_object('ok', true, 'open', v_open, 'deadline', '2026-11-30', 'signedUp', true,\r\n",
  "      'kind', v_row.kind, 'books', to_jsonb(private.class_trial_only_books(v_uid, v_email)),\r\n",
  "      'active', v_row.canceled_at is null and (v_row.ends_at is null or v_row.ends_at > now()),\r\n      'endsAt', v_row.ends_at);\r\n  end if;\r\n",
  "  v_owned := case when v_email = '' then 0 else private.class_owned_originals(v_email) end;\r\n",
  "  return jsonb_build_object('ok', true, 'open', v_open, 'deadline', '2026-11-30', 'signedUp', false,\r\n",
  "    'kindIfStart', case when v_owned >= 4 then 'owner_gift' else 'full' end, 'ownedOriginals', v_owned);\r\nend $function$;\n",
].join(''));

// ── 데이터 ──
for (const [uid, pu] of [[A,AU],[B,BU],[C,CU],[D,DU],[E,EU],[F,FU],[G,GU],[H,HU],[K,KU],[L,LU]]) {
  await db.query('insert into auth.users(id,email) values ($1,$2)', [uid, em(uid)]);
  await db.query("insert into public.users(id,auth_uid,email,nickname,avatar_url) values ($1,$2,$3,$4,$5)",
    [pu, uid, em(uid), 'nick' + uid.slice(-2), uid === H ? 'data:image/jpeg;base64,AAAA' : null]);
}
const own = async (uid, books) => { for (const b of books) await db.query('insert into public.class_verifications values ($1,$2)', [em(uid), b]); };
for (const u of [A, D, F, G, L]) await own(u, [...CLASSIC, 'theory']);
await own(B, ['gatsby', 'sherlock', 'theory']);
await own(E, ['anne']);
// 정직한 인증 n일: 시작일부터 하루씩, 저장 시각 = 그날 정오 KST
const days = async (pu, start, count, season = 'yanawan-2607') => {
  await db.query(`insert into public.check_ins(user_id, season_id, is_yanawan, checked_in_at, created_at)
    select $1, $2, true, d::date, (d::date + time '12:00') at time zone 'Asia/Seoul'
      from generate_series($3::date, $3::date + ($4::int - 1), interval '1 day') d`, [pu, season, start, count]);
};
const restart = async (pu, goal, date) => db.query(`insert into public.point_transactions(user_id, season_id, amount, reason, ref_id, created_at)
  values ($1, 'yanawan-2607', -300, 'spend_extension', $2, ($3::date + time '12:00') at time zone 'Asia/Seoul')`, [pu, `enroll_pay:yanawan-2607:${goal}:${date}`, date]);

await days(AU, '2026-07-01', 100);
await days(BU, '2026-07-01', 66);
await days(CU, '2026-07-01', 100);
await days(DU, '2026-07-01', 40); await restart(DU, 66, '2026-08-20'); await days(DU, '2026-08-20', 40); await restart(DU, 66, '2026-10-01'); await days(DU, '2026-10-01', 20);
await days(EU, '2026-07-01', 25); for (const [i, s] of ['2026-08-01','2026-09-01','2026-10-01'].entries()) { await restart(EU, 30, s); await days(EU, s, 25); }
await days(FU, '2026-07-01', 50); await restart(FU, 66, '2026-09-01'); await days(FU, '2026-09-01', 30);
await days(GU, '2026-07-01', 66);
await days(LU, '2026-07-01', 29);
// 시즌 2606(7/1 전) 인증은 세지 않는다
await days(AU, '2026-06-01', 10, 'yanawan-2606');
// 거짓: 과거 날짜 100일을 오늘 한꺼번에 넣은 행(서버 저장 시각 = 오늘)
await db.query(`insert into public.check_ins(user_id, season_id, is_yanawan, checked_in_at, created_at)
  select $1, 'yanawan-2607', true, d::date, now() from generate_series('2026-07-01'::date, '2026-10-08'::date, interval '1 day') d`, [KU]);
// G: 올해 운영자 구독권 2장이 이미 G 앞으로 나갔다
await db.exec(`insert into public.class_subscription_gift_codes(code, kind, issued_to) values ('AAAABBBBCCCC','yanawan66','${em(G)}'), ('AAAABBBBCCCD','yanawan100','${em(G)}')`);
// 무료 체험 행: 이용 중 · 이미 끝 시각 있음 · 취소
await db.exec(`insert into public.class_trial_signups(user_id, email, kind, consent_version) values ('${A}', '${em(A)}', 'full', 'v1');
  insert into public.class_trial_signups(user_id, email, kind, consent_version, ends_at) values ('${B}', '${em(B)}', 'full', 'v1', '2026-11-18 00:00+09');
  insert into public.class_trial_signups(user_id, email, kind, consent_version, canceled_at) values ('${C}', '${em(C)}', 'full', 'v1', now());`);

// ── 마이그레이션 적용 ──
// YG_MIG = 고의 파손 시험용으로 다른 파일을 넣을 때만
const MIG = await readFile(process.env.YG_MIG || new URL('./supabase/migrations/20261114200000_yanawan_gift_auto.sql', import.meta.url), 'utf8');
await db.exec(MIG);
await db.exec(MIG);   // 다시 돌려도 터지지 않는다(재실행 안전 · together_view 치환 건너뜀)
ok(true, 'migration applies twice');
const TRIAL = await readFile(new URL('./supabase/migrations/20261114210000_class_trial_close_1120.sql', import.meta.url), 'utf8');
await db.exec(TRIAL); await db.exec(TRIAL);
ok(true, 'trial migration applies twice');

const as = async (uid, sql, params) => {
  await db.exec(`set test.uid = '${uid ?? ''}'; set test.email = '${uid ? em(uid) : ''}'; set test.role = '${uid ? 'authenticated' : 'anon'}'; set role ${uid ? 'authenticated' : 'anon'};`);
  try { return Object.values((await db.query(sql, params)).rows[0] ?? {})[0]; }
  finally { await db.exec(`reset role; set test.uid = ''; set test.email = ''; set test.role = '';`); }
};
const sync = (uid) => v('select private.yanawan_gift_sync($1)', [uid]);
const gifts = async (uid) => (await db.query('select kind, level, seq, reached_by, pass_code, hold_reason, tier from private.yanawan_gifts where auth_uid=$1 order by kind, seq', [uid])).rows;

// ── 계획(쓰기 0) ──
const pA = await v('select private.yanawan_gift_plan($1)', [A]);
eq([pA.tier, pA.cumulative, pA.seat, pA.passes, pA.vouchers], ['allinone', 100, true, 2, 0], 'A plan');
eq(pA.reached['100'].by, 'challenge', 'A 100 by challenge');
eq(await v('select count(*)::int from private.yanawan_gifts'), 0, 'plan writes nothing');
const pD = await v('select private.yanawan_gift_plan($1)', [D]);
eq([pD.reached['30']?.by, pD.reached['66'], pD.reached['100']?.by, pD.passes], ['challenge', null, 'cumulative', 1], 'D: 30 yes, 66 no, 100 cumulative → pass 1');
const pE = await v('select private.yanawan_gift_plan($1)', [E]);
eq([pE.tier, pE.reached['30'], pE.reached['100']?.by, pE.vouchers], ['owner', null, 'cumulative', 3], 'E: cumulative 100 → 3 vouchers, 30 not reached');
const pF = await v('select private.yanawan_gift_plan($1)', [F]);
eq([pF.cumulative, pF.reached['30']?.at != null, pF.reached['66'], pF.reached['100'], pF.passes], [80, true, null, null, 0], 'F: 50+30 = 66 not by cumulative');
const pK = await v('select private.yanawan_gift_plan($1)', [K]);
eq([pK.cumulative, pK.reached['30'], pK.reached['100']], [0, null, null], 'K: back-dated rows not counted');
const pC = await v('select private.yanawan_gift_plan($1)', [C]);
eq([pC.tier, pC.seat, pC.passes, pC.vouchers], ['none', false, 0, 0], 'C: none');

// ── 동기화 ──
const rA = await sync(A);
eq(rA.created, 3, 'A: seat + 2 pass rows');
const gA = await gifts(A);
eq(gA.map(g => g.kind + g.level), ['seat30', 'subscription_pass66', 'subscription_pass100'], 'A gift rows');
ok(gA.filter(g => g.pass_code).length === 2, 'A two codes issued');
eq(await v("select basis || '/' || level from private.together_seat_bonus where sponsor_uid=$1", [A]), 'yanawan_auto/100', 'A auto seat bonus level 100');
eq(await v('select private.together_seat_bonus_on($1)', [A]), true, 'A seat bonus on');
eq(await v("select count(*)::int from public.class_subscription_gift_codes where issued_to=$1 and issued_by='yanawan_auto' and expires_at > now() + interval '59 days'", [em(A)]), 2, 'A codes 60d, issued_to self');
const rA2 = await sync(A);
eq(rA2.created, 0, 'A idempotent');
eq(await v('select count(*)::int from public.class_subscription_gift_codes where issued_to=$1', [em(A)]), 2, 'A still 2 codes');

await sync(B);
eq((await gifts(B)).map(g => g.kind + g.level + ':' + g.seq), ['course_voucher30:1', 'course_voucher66:2'], 'B 66 → 2 vouchers');
await days(BU, '2026-09-05', 34);   // 같은 도전 이어서 100일
await sync(B);
eq((await gifts(B)).map(g => g.level), [30, 66, 100], 'B 100 → 3rd voucher');
eq(await v('select count(*)::int from private.together_seat_bonus where sponsor_uid=$1', [B]), 0, 'owner gets no seat bonus');
await sync(B);
eq(await v("select count(*)::int from private.yanawan_gifts where auth_uid=$1", [B]), 3, 'B idempotent at 3');

eq((await sync(C)).created, 0, 'C none'); eq(await v('select count(*)::int from private.yanawan_gifts where auth_uid=$1', [C]), 0, 'C no rows');
await sync(D);
eq((await gifts(D)).map(g => g.kind + g.level + (g.reached_by ? ':' + g.reached_by : '')), ['seat30:challenge', 'subscription_pass100:cumulative'], 'D seat + 100 pass only');
await sync(E);
eq((await gifts(E)).map(g => g.level + ':' + g.seq), ['100:1', '100:2', '100:3'], 'E 3 vouchers at level 100');
await sync(F);
eq((await gifts(F)).map(g => g.kind), ['seat'], 'F seat only');
await sync(G);
const gG = await gifts(G);
eq([gG.find(g => g.kind === 'subscription_pass')?.pass_code, gG.find(g => g.kind === 'subscription_pass')?.hold_reason], [null, 'year_limit'], 'G: year cap → held, no code');
eq(await v('select count(*)::int from public.class_subscription_gift_codes where issued_to=$1', [em(G)]), 2, 'G no third code');
await sync(K); eq(await v('select count(*)::int from private.yanawan_gifts where auth_uid=$1', [K]), 0, 'K forged: nothing');

// 운영자가 자리를 이미 표시했으면 그대로 · 운영자가 끄면 다시 켜지 않는다
await db.exec(`update private.together_seat_bonus set basis='challenge', level=66 where sponsor_uid='${F}'`);
await sync(F);
eq(await v("select basis || '/' || level from private.together_seat_bonus where sponsor_uid=$1", [F]), 'challenge/66', 'admin row untouched');
await db.exec(`delete from private.together_seat_bonus where sponsor_uid='${F}'`);
await sync(F);
eq(await v('select count(*)::int from private.together_seat_bonus where sponsor_uid=$1', [F]), 0, 'operator-off not re-enabled');

// ── 인증 트리거: 회원이 30일째 인증을 넣는 순간 열린다 · 저장 시각 위조는 서버 시각으로 ──
await db.exec(`set test.uid = '${L}'; set test.role = 'authenticated'; set role authenticated;`);
await db.query(`insert into public.check_ins(user_id, season_id, is_yanawan, checked_in_at, created_at) values ($1, 'yanawan-2607', true, '2026-07-30', '2026-07-30 12:00+09')`, [LU]);
await db.exec(`reset role; set test.uid = ''; set test.role = '';`);
eq(await v("select (created_at > now() - interval '1 minute') from public.check_ins where user_id=$1 and checked_in_at='2026-07-30'", [LU]), true, 'created_at forced to now for authenticated');
eq(await v('select count(*)::int from private.yanawan_gifts where auth_uid=$1', [L]), 0, 'L back-dated 30th day (forced now) not honest → no gift');
await db.query("delete from public.check_ins where user_id=$1 and checked_in_at='2026-07-30'", [LU]);
// 정직한 30일째(오늘 날짜로 오늘 저장) — 29일(어제까지로 옮김) + 오늘 = 30, 같은 도전
await db.query(`update public.check_ins set checked_in_at = checked_in_at + ((now() at time zone 'Asia/Seoul')::date - date '2026-07-30'),
  created_at = created_at + ((now() at time zone 'Asia/Seoul')::date - date '2026-07-30') * interval '1 day' where user_id=$1`, [LU]);
eq(await v('select count(*)::int from private.yanawan_gifts where auth_uid=$1', [L]), 0, 'L 29 days → nothing yet');
await db.exec(`set test.uid = '${L}'; set test.role = 'authenticated'; set role authenticated;`);
await db.query(`insert into public.check_ins(user_id, season_id, is_yanawan) values ($1, 'yanawan-2607', true)`, [LU]);
await db.exec(`reset role; set test.uid = ''; set test.role = '';`);
eq((await gifts(L)).map(g => g.kind), ['seat'], 'insert trigger synced at day 30');
// 동기화가 터져도 인증은 저장된다
const PLAN_DEF = await v("select pg_get_functiondef('private.yanawan_gift_plan(uuid)'::regprocedure)");
await db.exec(`create or replace function private.yanawan_gift_plan(p_auth_uid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin raise exception 'boom'; end $$;`);
eq(await sync(L).then(() => 'no error', e => e.message.includes('boom') ? 'boom' : e.message), 'boom', 'sync really throws while broken');
await db.exec(`set test.uid = '${L}'; set test.role = 'authenticated'; set role authenticated;`);
await db.query(`insert into public.check_ins(user_id, season_id, is_yanawan, checked_in_at) values ($1, 'yanawan-2607', true, (now() at time zone 'Asia/Seoul')::date + 1)`, [LU]);
await db.exec(`reset role; set test.uid = ''; set test.role = '';`);
eq(await v("select count(*)::int from public.check_ins where user_id=$1 and checked_in_at=(now() at time zone 'Asia/Seoul')::date + 1", [LU]), 1, 'check-in saved even when sync throws');
await db.exec(PLAN_DEF);
eq((await sync(L)).ok, true, 'plan restored');

// ── 회원 조회 ──
eq(await as(null, 'select public.my_yanawan_gifts()').catch(e => e.message.includes('permission') ? 'denied' : e.message), 'denied', 'anon cannot execute my_yanawan_gifts');
eq(await v("select has_function_privilege('anon', 'public.my_yanawan_gifts()', 'execute')"), false, 'anon no execute');
eq(await v("select has_function_privilege('authenticated', 'private.yanawan_gift_sync(uuid)', 'execute')"), false, 'sync not callable by members');
const mA = await as(A, 'select public.my_yanawan_gifts()');
eq([mA.ok, mA.since, mA.owner.allInOne, mA.owner.ownedCount, mA.days.cumulative, mA.steps.length, mA.seatBonus, mA.passes.length], [true, '2026-07-01', true, 8, 100, 3, true, 2], 'A view');
eq(mA.steps.map(s => [s.level, s.reached, s.gift.type, s.gift.count]), [[30, true, 'seat', 1], [66, true, 'subscription_pass', 1], [100, true, 'subscription_pass', 1]], 'A steps');
eq(Object.keys(mA.passes[0]).sort(), ['code', 'expiresAt', 'issuedAt', 'kind', 'redeemedAt'], 'pass keys (no recipient)');
ok(!JSON.stringify(mA).includes('@'), 'no email in my_yanawan_gifts');
const mC = await as(C, 'select public.my_yanawan_gifts()');
eq(mC.steps.map(s => s.gift.type), ['none', 'none', 'none'], 'C gift none');
const mG = await as(G, 'select public.my_yanawan_gifts()');
eq([mG.passes.length, mG.passesHeld], [0, 1], 'G held pass shown as count');
const mE = await as(E, 'select public.my_yanawan_gifts()');
eq([mE.steps[0].reached, mE.steps[2].gift.count, mE.vouchers.map(x => x.status)], [false, 3, ['unused', 'unused', 'unused']], 'E view');
// 지금 도전 표시
await db.query("insert into public.enrollments(user_id, season_id, goal_days, start_date) values ($1,'yanawan-2607',100,'2026-07-01')", [AU]);
const mA2 = await as(A, 'select public.my_yanawan_gifts()');
eq([mA2.days.current.goal, mA2.days.current.start, mA2.days.current.count, mA2.days.current.state], [100, '2026-07-01', 100, 'success'], 'A current');
await db.query("insert into public.enrollments(user_id, season_id, goal_days, start_date) values ($1,'yanawan-2607',30,'2099-01-01')", [CU]);
eq((await as(C, 'select public.my_yanawan_gifts()')).days.current.state, 'upcoming', 'C upcoming');
eq((await as(K, 'select public.my_yanawan_gifts()')).days.current.state, 'none', 'K none (no enrollment)');

// ── 수강권 고르기 · 등록 ──
const bv = (await as(B, 'select public.my_yanawan_gifts()')).vouchers;
eq(bv.length, 3, 'B 3 vouchers');
eq((await as(B, 'select public.my_yanawan_voucher_pick($1, $2)', [bv[0].id, 'kidari'])).error, 'not_owned', 'not owned book rejected');
eq((await as(B, 'select public.my_yanawan_voucher_pick($1, $2)', [bv[0].id, 'coaching'])).error, 'not_owned', 'non-course rejected');
eq((await as(A, 'select public.my_yanawan_voucher_pick($1, $2)', [bv[0].id, 'gatsby'])).error, 'not_found', 'other member voucher not_found');
eq((await as(null, 'select public.my_yanawan_voucher_pick($1, $2)', [bv[0].id, 'gatsby']).catch(() => 'denied')), 'denied', 'anon cannot pick');
const pick = await as(B, 'select public.my_yanawan_voucher_pick($1, $2)', [bv[0].id, 'Gatsby']);
ok(pick.ok && /^GATSBY-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(pick.voucher.code) && pick.voucher.status === 'issued', 'pick creates code');
eq(await v('select book_code from public.class_redemptions where code=$1 and redeemed_by is null', [pick.voucher.code]), 'gatsby', 'class_redemptions row');
eq((await as(B, 'select public.my_yanawan_voucher_pick($1, $2)', [bv[0].id, 'sherlock'])).error, 'already_picked', 'already picked');
// 준 사람 본인 등록 금지(class-gate /redeem 의 PATCH 와 같은 조건부 갱신)
await db.exec('set role service_role');
const selfErr = await db.query(`update public.class_redemptions set redeemed_by = $1, redeemed_at = now() where code = $2 and redeemed_by is null`, [em(B), pick.voucher.code]).then(() => 'ok', e => e.message);
ok(String(selfErr).includes('yanawan_voucher_self'), 'self redeem blocked');
const other = await db.query(`update public.class_redemptions set redeemed_by = $1, redeemed_at = now() where code = $2 and redeemed_by is null returning code`, [em(H), pick.voucher.code]);
await db.exec('reset role');
eq(other.rows.length, 1, 'other member redeems');
eq(await v("select 'gatsby' = any(private.together_owned_books($1))", [em(H)]), true, 'recipient now owns gatsby permanently');
eq((await as(B, 'select public.my_yanawan_gifts()')).vouchers[0].status, 'redeemed', 'voucher redeemed');
ok(!JSON.stringify(await as(B, 'select public.my_yanawan_gifts()')).includes(em(H)), 'recipient email not shown');
// 일반 인증 코드(수강권 아님)는 영향 없음
await db.exec(`insert into public.class_redemptions(code, book_code) values ('KIDARI-AAAA-BBBB','kidari')`);
await db.query(`update public.class_redemptions set redeemed_by=$1 where code='KIDARI-AAAA-BBBB'`, [em(B)]);
eq(await v("select redeemed_by from public.class_redemptions where code='KIDARI-AAAA-BBBB'"), em(B), 'plain code unaffected');

// ── 운영자 발급(본체로 옮긴 뒤에도 같은 규칙) ──
await db.exec(`set test.uid = '${A}'; set test.email = 'op@t.test'; set test.admin = '1';`);
const adm = await v(`select public.admin_class_subscription_gift_issue('yanawan66', 1, $1, 'x')`, [em(A)]);
eq(adm.error, 'year_limit', 'admin issue still year-capped (A already has 2)');
const adm2 = await v(`select public.admin_class_subscription_gift_issue('operator', 2, null, null)`);
eq([adm2.ok, adm2.codes.length], [true, 2], 'admin operator issue');
eq(await v("select count(*)::int from public.class_subscription_gift_codes where kind='operator' and issued_by='op@t.test'"), 2, 'issued_by = admin email');
await db.exec(`set test.admin = ''; set test.uid = ''; set test.email = '';`);

// ── 함께 읽기 상대 사진 ──
const tv = await v('select private.together_view($1, $2)', [H, A]);
eq([tv.partnerNickname, tv.partnerAvatar], ['nick11', 'data:image/jpeg;base64,AAAA'], 'partnerAvatar added');
eq((await v('select private.together_view($1, $2)', [A, A])).partnerAvatar, null, 'no avatar → null');
await db.query("update public.users set avatar_url='javascript:alert(1)' where id=$1", [HU]);
eq((await v('select private.together_view($1, $2)', [H, A])).partnerAvatar, null, 'non-image url → null');
eq(await v("select (length(pg_get_functiondef('private.together_view(uuid,uuid)'::regprocedure)) - length(replace(pg_get_functiondef('private.together_view(uuid,uuid)'::regprocedure), 'partnerAvatar', ''))) / 13"), 1, 'patched exactly once');

// ── 무료 체험 마감 ──
eq(await v("select private.class_trial_deadline() = timestamptz '2026-11-21 00:00+09'"), true, 'deadline 11-21 00:00 KST');
eq(await v("select ends_at = timestamptz '2026-11-21 00:00+09' from public.class_trial_signups where user_id=$1", [A]), true, 'active row ends 11-21');
eq(await v("select ends_at = timestamptz '2026-11-18 00:00+09' from public.class_trial_signups where user_id=$1", [B]), true, 'existing ends_at kept');
eq(await v("select ends_at is null from public.class_trial_signups where user_id=$1", [C]), true, 'canceled row untouched');
const mt = await as(A, 'select public.my_class_trial()');
eq([mt.deadline, mt.open, mt.active], ['2026-11-20', true, true], 'my_class_trial before deadline');
const st = await as(D, "select public.class_trial_start('v1')");
eq(st.ok, true, 'new signup before deadline');
eq(await v("select ends_at = timestamptz '2026-11-21 00:00+09' from public.class_trial_signups where user_id=$1", [D]), true, 'new signup gets ends_at');
eq((await as(null, 'select public.my_class_trial()')).deadline, '2026-11-20', 'anon deadline text');

console.log(`yanawan-gift-db-test: ${n} checks passed`);
