-- 야나완 성공 선물 자동 지급(2026-11-14 운영자 확정 규칙 · 정본 docs/handoffs/subscription-rollout-20261113/YANAWAN-GIFT-RULES-20261114.md).
--   20261113130000_class_subscription_gift.sql 뒤에. 적용 = 운영자. 소급은 별도 파일 ops/20261114220000_yanawan_gift_backfill.sql
--   (migrations 폴더 밖에 둔다 — db push 가 저절로 돌리지 않게). 운영 되돌림 시험 = ops/yanawan-gift-rollback-test.sql.
--
--   만드는 것
--     ① private.yanawan_gifts — 선물 원장(회원·종류·순번 하나에 한 줄 = 멱등). 자리 +1 · 구독권 · 평생 소장 수강권.
--     ② private.yanawan_gift_progress(uid) — 7/1 이후 누적 일수 · 한 도전 안의 30/66/100일 도달일(읽기만).
--     ③ private.yanawan_gift_plan(uid) — 지금 받을 선물 계획(읽기만 — 소급 미리 보기도 이것을 쓴다).
--     ④ private.yanawan_gift_sync(uid) — 계획대로 원장을 채우고 실제 선물을 만든다(두 번 돌려도 한 번).
--     ⑤ private.class_subscription_gift_issue_core — 구독권 발급 본체(운영자 발급 함수도 이것을 부른다 — 규칙 한 곳).
--     ⑥ public.my_yanawan_gifts() · public.my_yanawan_voucher_pick(uuid,text) — 회원 본인 것만.
--     ⑦ 트리거 — 야나완 인증이 들어오면 동기화(실패해도 인증 저장은 막지 않는다) · 인증 저장 시각 위조 막기 ·
--        수강권 코드를 준 사람 본인이 등록하는 것 막기.
--     ⑧ together_overview 연결 항목에 partnerAvatar(private.together_view 한 곳 치환).
--
--   판정 원칙
--     · enrollments.start_date 는 회원이 고칠 수 있어 판정에 안 쓴다(기존 원칙 — private.yanawan_challenge_days 와 같은 결제 기록 기준).
--     · 한 도전 = 시즌 첫 도전(첫 새 도전 결제일 전) / 새 도전 결제일(enroll_pay:<시즌>:<일수>:<날짜>)부터 다음 새 도전 결제일 전.
--       새 도전의 시작 인정 규칙은 yanawan_challenge_days 그대로(결제 시각 KST ±1일 · 그 전 인증 있음).
--     · 인증 하루 = 7/1 이후 · 정직한 인증만(인증 날짜가 서버가 적은 저장 시각 KST ±1일 안 — 11-14 실측 947건 전부 해당).
--       클라이언트가 checked_in_at 을 과거로 넣어 한 번에 100일을 만드는 길을 막는다. 저장 시각은 ⑦ 트리거가 now() 로 고정한다.
--     · 재도전으로 덮인 지난 도전의 성공은 세그먼트 계산이 이미 잡지만, 보강으로 이 마이그레이션 전(11-15 00:00 KST 전)에
--       서버가 검증해 지급한 성공 배지 기록(point_transactions badge '<시즌>:streak_N')도 도달 근거로 쓴다.
--       그 뒤의 배지 기록은 근거로 쓰지 않는다(배지 함수는 정직성 필터가 없다).
--     · 등급(tier)은 동기화하는 그 순간의 소장으로 본다: 클래식 7종 = 올인원 · 8종 중 1개 이상 = 소장 회원 · 그 밖 = 선물 없음.
--       선물 없음 회원은 원장에 아무것도 남기지 않는다 → 나중에 소장하면 그때 동기화로 열린다(소급 원칙과 같다).
--
--   되돌리기(선물 원장이 비었을 때 — 아니면 먼저 만든 구독권·수강권 코드를 어떻게 할지 운영자 결정):
--     drop trigger if exists check_ins_yanawan_gift_sync on public.check_ins;
--     drop trigger if exists check_ins_force_created_at on public.check_ins;
--     drop trigger if exists class_redemptions_yanawan_self on public.class_redemptions;
--     drop function public.my_yanawan_gifts(), public.my_yanawan_voucher_pick(uuid,text),
--       private.yanawan_gift_sync(uuid), private.yanawan_gift_plan(uuid), private.yanawan_gift_progress(uuid),
--       private.yanawan_voucher_json(uuid), private.yanawan_gift_on_checkin(), private.check_ins_force_created_at(),
--       private.yanawan_voucher_self_guard(), private.yanawan_gift_since(), private.yanawan_badge_trust_until();
--     delete from private.together_seat_bonus where basis = 'yanawan_auto';
--     drop table private.yanawan_gifts;
--     운영자 발급 함수: 20261113130000 의 ④ 를 다시 돌리고 drop function private.class_subscription_gift_issue_core(text,integer,text,text,text);
--     together_view: 'partnerAvatar' 줄을 빼는 반대 치환 후 drop function private.together_avatar(uuid);
--     together_seat_bonus 의 basis CHECK 를 ('challenge30','challenge','admin') 로 되돌린다.

-- ── ① 기준값 ──
create or replace function private.yanawan_gift_since() returns date
language sql immutable set search_path = '' as $$ select date '2026-07-01' $$;
create or replace function private.yanawan_badge_trust_until() returns timestamptz
language sql immutable set search_path = '' as $$ select timestamptz '2026-11-15 00:00:00+09' $$;

-- ── ② 선물 원장 ──
create table if not exists private.yanawan_gifts (
  id           uuid primary key default gen_random_uuid(),
  auth_uid     uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('seat','subscription_pass','course_voucher')),
  level        smallint not null check (level in (30, 66, 100)),
  seq          smallint not null check (seq between 1 and 3),   -- 자리 1 · 구독권 66=1 100=2 · 수강권 1~3(합계 순번)
  tier         text not null check (tier in ('allinone','owner')),
  reached_at   date,
  reached_by   text check (reached_by in ('challenge','cumulative')),
  pass_code    text unique,          -- 구독권: public.class_subscription_gift_codes.code
  hold_reason  text,                 -- 구독권을 아직 못 만든 이유(예: year_limit) — 다음 동기화에서 다시 시도
  book_code    text,                 -- 수강권: 고른 강의
  voucher_code text unique,          -- 수강권: public.class_redemptions.code
  picked_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (auth_uid, kind, seq)
);
alter table private.yanawan_gifts enable row level security;
revoke all on private.yanawan_gifts from public, anon, authenticated;

-- 함께 읽기 자리 +1 을 자동으로 표시할 때의 출처
alter table private.together_seat_bonus drop constraint if exists together_seat_bonus_basis_check;
alter table private.together_seat_bonus add constraint together_seat_bonus_basis_check
  check (basis = any (array['challenge30'::text, 'challenge'::text, 'admin'::text, 'yanawan_auto'::text]));

-- ── ③ 도달 판정(읽기만) ──
create or replace function private.yanawan_gift_progress(p_auth_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
with
days as (
  select distinct c.user_id, c.season_id, c.checked_in_at as d
    from public.check_ins c join public.users u on u.id = c.user_id
   where u.auth_uid = p_auth_uid and c.is_yanawan and c.checked_in_at >= private.yanawan_gift_since()
     and c.checked_in_at between (c.created_at at time zone 'Asia/Seoul')::date - 1
                             and (c.created_at at time zone 'Asia/Seoul')::date + 1),
us as (select distinct user_id, season_id from days),
refs as (
  select us.user_id, us.season_id,
         pg_catalog.to_date(pg_catalog.split_part(r.ref_id, ':', 4), 'YYYY-MM-DD') as rd,
         (r.created_at at time zone 'Asia/Seoul')::date as ck
    from us, lateral private.yanawan_restart_refs(us.user_id) r
   where r.ref_id ~ '^enroll_pay:[^:]+:(30|66|100):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and pg_catalog.split_part(r.ref_id, ':', 2) = us.season_id),
starts as (
  select us.user_id, us.season_id, null::date as s from us
  union
  select f.user_id, f.season_id, f.rd from refs f
   where f.rd between f.ck - 1 and f.ck + 1
     and exists (select 1 from public.check_ins c where c.user_id = f.user_id and c.season_id = f.season_id
                   and c.is_yanawan and c.checked_in_at < f.rd)),
segs as (
  select st.user_id, st.season_id, st.s,
         (select min(f.rd) from refs f where f.user_id = st.user_id and f.season_id = st.season_id
            and (st.s is null or f.rd > st.s)) as e
    from starts st),
ranked as (
  select d.d, pg_catalog.row_number() over (partition by g.user_id, g.season_id, g.s order by d.d) as rn
    from segs g join days d on d.user_id = g.user_id and d.season_id = g.season_id
   where (g.s is null or d.d >= g.s) and (g.e is null or d.d < g.e)),
chal as (select rn::int as lv, min(d) as at from ranked where rn in (30, 66, 100) group by 1),
badge as (
  select (pg_catalog.regexp_match(p.ref_id, ':streak_(30|66|100)'))[1]::int as lv,
         min((p.created_at at time zone 'Asia/Seoul')::date) as at
    from public.point_transactions p join public.users u on u.id = p.user_id
   where u.auth_uid = p_auth_uid and p.reason = 'badge'
     and p.ref_id ~ '^[^:]+:streak_(30|66|100)(:[0-9]{4}-[0-9]{2}-[0-9]{2})?$'
     and p.created_at >= (private.yanawan_gift_since()::timestamp at time zone 'Asia/Seoul')
     and p.created_at < private.yanawan_badge_trust_until()
   group by 1),
lv as (select x.lv, min(x.at) as at from (select * from chal union all select * from badge) x group by 1),
alld as (select distinct d from days),
cum as (select count(*)::int as n, (select a.d from alld a order by a.d offset 99 limit 1) as at100 from alld)
select pg_catalog.jsonb_build_object(
  'cumulative', (select n from cum),
  'challenge', pg_catalog.jsonb_build_object(
     '30', (select at from lv where lv = 30), '66', (select at from lv where lv = 66), '100', (select at from lv where lv = 100)),
  'cumulative100', (select at100 from cum))
$$;
revoke all on function private.yanawan_gift_progress(uuid) from public, anon, authenticated;

-- ── ④ 선물 계획(읽기만) ──
--   steps: 30·66 = 한 도전만 · 100 = 한 도전 또는 누적 100일(먼저 온 날 · 같은 날이면 도전).
--   올인원: 30 = 자리 +1 · 66 = 구독권 1 · 100 = 구독권 1.
--   소장 회원: 수강권 합계 30=1 · 66=2 · 100=3(누적 100일도 100일 단계 — 운영자 미확인 가정, 정본 1절 마지막 줄).
create or replace function private.yanawan_gift_plan(p_auth_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text := private.together_email(p_auth_uid);
  v_cls int := 0; v_k8 int := 0; v_tier text; p jsonb;
  c30 date; c66 date; c100 date; cu100 date; r100 date; b100 text;
begin
  if v_email is not null and v_email <> '' then
    v_cls := private.together_classic_count(v_email);
    select count(*)::int into v_k8 from unnest(private.together_owned_books(v_email)) b where b = any (private.together_k8());
  end if;
  v_tier := case when v_cls >= 7 then 'allinone' when v_k8 >= 1 then 'owner' else 'none' end;
  p := private.yanawan_gift_progress(p_auth_uid);
  c30 := (p -> 'challenge' ->> '30')::date;
  c66 := (p -> 'challenge' ->> '66')::date;
  c100 := (p -> 'challenge' ->> '100')::date;
  cu100 := (p ->> 'cumulative100')::date;
  r100 := least(c100, cu100);
  b100 := case when c100 is not null and (cu100 is null or c100 <= cu100) then 'challenge'
               when cu100 is not null then 'cumulative' end;
  return pg_catalog.jsonb_build_object(
    'tier', v_tier, 'ownedCount', v_k8, 'allInOne', v_cls >= 7,
    'cumulative', coalesce((p ->> 'cumulative')::int, 0),
    'reached', pg_catalog.jsonb_build_object(
      '30', case when c30 is null then null else pg_catalog.jsonb_build_object('at', c30, 'by', 'challenge') end,
      '66', case when c66 is null then null else pg_catalog.jsonb_build_object('at', c66, 'by', 'challenge') end,
      '100', case when r100 is null then null else pg_catalog.jsonb_build_object('at', r100, 'by', b100) end),
    'seat', v_tier = 'allinone' and c30 is not null,
    'passes', case when v_tier <> 'allinone' then 0 else (c66 is not null)::int + (r100 is not null)::int end,
    'vouchers', case when v_tier <> 'owner' then 0
                     when r100 is not null then 3 when c66 is not null then 2 when c30 is not null then 1 else 0 end);
end $$;
revoke all on function private.yanawan_gift_plan(uuid) from public, anon, authenticated;

-- ── ⑤ 구독권 발급 본체 — 운영자 발급 함수의 규칙 그대로(60일 기한 · 야나완 종류는 받는 회원 이메일 필수 · 한 해 2장) ──
create or replace function private.class_subscription_gift_issue_core(p_kind text, p_count integer, p_issued_to text, p_note text, p_by text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_codes text[] := array[]::text[]; v_code text; v_try int; v_to text; v_year_count int := 0;
  v_expires timestamptz := now() + interval '60 days';
begin
  if p_kind is null or p_kind not in ('yanawan66','yanawan100','operator') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if p_count is null or p_count < 1 or p_count > 20 then return jsonb_build_object('ok', false, 'error', 'bad_count'); end if;
  v_to := nullif(lower(btrim(coalesce(p_issued_to, ''))), '');
  if p_kind in ('yanawan66','yanawan100') then
    if v_to is null then return jsonb_build_object('ok', false, 'error', 'issued_to_required'); end if;
    if length(v_to) > 200 or v_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      return jsonb_build_object('ok', false, 'error', 'bad_issued_to'); end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('class-subscription-gift-issue:' || v_to, 0));
    select count(*)::int into v_year_count from public.class_subscription_gift_codes c
     where c.issued_to = v_to and c.kind in ('yanawan66','yanawan100')
       and date_part('year', c.issued_at at time zone 'Asia/Seoul') = date_part('year', now() at time zone 'Asia/Seoul');
    if v_year_count + p_count > 2 then
      return jsonb_build_object('ok', false, 'error', 'year_limit', 'issuedThisYear', v_year_count, 'remaining', greatest(2 - v_year_count, 0));
    end if;
  else
    v_to := left(v_to, 200);
  end if;
  for n in 1..p_count loop
    v_try := 0;
    loop
      v_try := v_try + 1;
      v_code := private.class_subscription_gift_code();
      insert into public.class_subscription_gift_codes (code, kind, issued_to, note, issued_by, expires_at)
      values (v_code, p_kind, v_to, nullif(left(btrim(coalesce(p_note, '')), 500), ''), p_by, v_expires)
      on conflict (code) do nothing;
      exit when found;
      if v_try >= 5 then raise exception 'gift_code_collision'; end if;
    end loop;
    v_codes := v_codes || v_code;
  end loop;
  return jsonb_build_object('ok', true, 'kind', p_kind, 'count', p_count, 'codes', to_jsonb(v_codes), 'expiresAt', v_expires);
end $$;
revoke all on function private.class_subscription_gift_issue_core(text,integer,text,text,text) from public, anon, authenticated;

-- 운영자 발급 = 로그인·운영자 확인 + 본체(응답 모양은 예전과 같다)
create or replace function public.admin_class_subscription_gift_issue(p_kind text, p_count integer, p_issued_to text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'login_required'; end if;
  if not public.is_ls_admin() then raise exception using errcode = '42501', message = 'admin_only'; end if;
  return private.class_subscription_gift_issue_core(p_kind, p_count, p_issued_to, p_note, lower(auth.jwt() ->> 'email'));
end $$;
revoke all on function public.admin_class_subscription_gift_issue(text,integer,text,text) from public, anon;
grant execute on function public.admin_class_subscription_gift_issue(text,integer,text,text) to authenticated, service_role;

-- ── ⑥ 동기화(멱등) ──
create or replace function private.yanawan_gift_sync(p_auth_uid uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text; pl jsonb; v_tier text; v_target int; v_have int; v_lv int; v_at date; v_by text;
  v_max int; v_new int := 0; g record; v_res jsonb; lv int;
begin
  if p_auth_uid is null then return jsonb_build_object('ok', false, 'error', 'no_user'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('yanawan-gift:' || p_auth_uid::text, 0));
  v_email := private.together_email(p_auth_uid);
  if v_email is null or v_email = '' then return jsonb_build_object('ok', false, 'error', 'no_account'); end if;
  pl := private.yanawan_gift_plan(p_auth_uid);
  v_tier := pl ->> 'tier';
  v_max := case when pl -> 'reached' -> '100' <> 'null'::jsonb then 100
                when pl -> 'reached' -> '66' <> 'null'::jsonb then 66
                when pl -> 'reached' -> '30' <> 'null'::jsonb then 30 end;

  if v_tier = 'allinone' then
    if (pl ->> 'seat')::boolean then
      insert into private.yanawan_gifts (auth_uid, kind, level, seq, tier, reached_at, reached_by)
      values (p_auth_uid, 'seat', 30, 1, 'allinone', (pl -> 'reached' -> '30' ->> 'at')::date, 'challenge')
      on conflict (auth_uid, kind, seq) do nothing;
      if found then
        v_new := v_new + 1;
        -- 운영자가 이미 표시한 행은 건드리지 않는다(그쪽이 우선). 운영자가 나중에 끄면 다시 켜지 않는다(원장이 이미 있다).
        insert into private.together_seat_bonus (sponsor_uid, basis, level, granted_by, note)
        values (p_auth_uid, 'yanawan_auto', v_max::smallint, 'yanawan_auto', '야나완 30일 성공 — 자동')
        on conflict (sponsor_uid) do nothing;
      end if;
    end if;
    if v_max is not null then
      update private.together_seat_bonus set level = v_max::smallint
       where sponsor_uid = p_auth_uid and basis = 'yanawan_auto' and level < v_max;
    end if;
    foreach lv in array array[66, 100] loop
      if pl -> 'reached' -> lv::text <> 'null'::jsonb then
        insert into private.yanawan_gifts (auth_uid, kind, level, seq, tier, reached_at, reached_by)
        values (p_auth_uid, 'subscription_pass', lv, case lv when 66 then 1 else 2 end, 'allinone',
                (pl -> 'reached' -> lv::text ->> 'at')::date, pl -> 'reached' -> lv::text ->> 'by')
        on conflict (auth_uid, kind, seq) do nothing;
        if found then v_new := v_new + 1; end if;
      end if;
    end loop;
  elsif v_tier = 'owner' then
    v_target := (pl ->> 'vouchers')::int;
    select count(*)::int into v_have from private.yanawan_gifts where auth_uid = p_auth_uid and kind = 'course_voucher';
    while v_have < v_target loop
      v_lv := case when v_have + 1 <= 1 and pl -> 'reached' -> '30' <> 'null'::jsonb then 30
                   when v_have + 1 <= 2 and pl -> 'reached' -> '66' <> 'null'::jsonb then 66
                   else 100 end;
      v_at := (pl -> 'reached' -> v_lv::text ->> 'at')::date;
      v_by := pl -> 'reached' -> v_lv::text ->> 'by';
      insert into private.yanawan_gifts (auth_uid, kind, level, seq, tier, reached_at, reached_by)
      values (p_auth_uid, 'course_voucher', v_lv, v_have + 1, 'owner', v_at, v_by)
      on conflict (auth_uid, kind, seq) do nothing;
      if found then v_new := v_new + 1; end if;
      v_have := v_have + 1;
    end loop;
  end if;

  -- 아직 코드가 없는 구독권을 만든다(한 해 2장 상한에 걸리면 이유를 남기고 다음 동기화에서 다시)
  for g in select * from private.yanawan_gifts
            where auth_uid = p_auth_uid and kind = 'subscription_pass' and pass_code is null order by seq loop
    v_res := private.class_subscription_gift_issue_core(case g.level when 66 then 'yanawan66' else 'yanawan100' end, 1,
               v_email, '야나완 ' || g.level || '일 성공 — 자동', 'yanawan_auto');
    if coalesce((v_res ->> 'ok')::boolean, false) then
      update private.yanawan_gifts set pass_code = v_res -> 'codes' ->> 0, hold_reason = null where id = g.id;
    else
      update private.yanawan_gifts set hold_reason = left(coalesce(v_res ->> 'error', 'unknown'), 60) where id = g.id;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'tier', v_tier, 'created', v_new);
end $$;
revoke all on function private.yanawan_gift_sync(uuid) from public, anon, authenticated;

-- ── ⑦ 트리거 ──
-- 인증이 들어오면 동기화 — 어떤 오류도 인증 저장을 막지 않는다(경고만 남긴다).
create or replace function private.yanawan_gift_on_checkin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  begin
    select u.auth_uid into v_uid from public.users u where u.id = new.user_id;
    if v_uid is not null then perform private.yanawan_gift_sync(v_uid); end if;
  exception when others then
    raise warning 'yanawan_gift_sync failed for check_in %: % %', new.id, sqlstate, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.yanawan_gift_on_checkin() from public, anon, authenticated;
drop trigger if exists check_ins_yanawan_gift_sync on public.check_ins;
create trigger check_ins_yanawan_gift_sync after insert on public.check_ins
  for each row when (new.is_yanawan) execute function private.yanawan_gift_on_checkin();

-- 회원이 넣는 인증의 저장 시각은 서버 시각으로 — 정직한 인증 판정(인증 날짜 = 저장 시각 ±1일)이 그 값을 믿는다.
--   앱은 created_at 을 보내지 않는다(기본값) → 화면 동작 변화 0. service_role(이관·운영 작업)은 그대로.
create or replace function private.check_ins_force_created_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then new.created_at := now(); end if;
  return new;
end $$;
revoke all on function private.check_ins_force_created_at() from public, anon, authenticated;
drop trigger if exists check_ins_force_created_at on public.check_ins;
create trigger check_ins_force_created_at before insert on public.check_ins
  for each row execute function private.check_ins_force_created_at();

-- 수강권 코드는 준 사람 본인 계정에 등록할 수 없다(class-gate /redeem 은 손대지 않는다 — PATCH 가 0행이 되어 '이미 사용됐거나 없는 코드' 로 떨어진다).
create or replace function private.yanawan_voucher_self_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_giver uuid;
begin
  if new.redeemed_by is not null and old.redeemed_by is null then
    select v.auth_uid into v_giver from private.yanawan_gifts v where v.voucher_code = new.code and v.kind = 'course_voucher';
    if v_giver is not null and lower(btrim(new.redeemed_by)) = private.together_email(v_giver) then
      raise exception using errcode = '42501', message = 'yanawan_voucher_self';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.yanawan_voucher_self_guard() from public, anon, authenticated;
drop trigger if exists class_redemptions_yanawan_self on public.class_redemptions;
create trigger class_redemptions_yanawan_self before update of redeemed_by on public.class_redemptions
  for each row execute function private.yanawan_voucher_self_guard();

-- ── ⑧ 회원 조회 ──
create or replace function private.yanawan_voucher_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', v.id, 'level', v.level,
    'status', case when v.voucher_code is null then 'unused' when r.redeemed_by is null then 'issued' else 'redeemed' end,
    'bookCode', v.book_code, 'code', v.voucher_code, 'issuedAt', v.picked_at, 'redeemedAt', r.redeemed_at)
  from private.yanawan_gifts v left join public.class_redemptions r on r.code = v.voucher_code
  where v.id = p_id and v.kind = 'course_voucher'
$$;
revoke all on function private.yanawan_voucher_json(uuid) from public, anon, authenticated;

create or replace function public.my_yanawan_gifts() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_email text; pl jsonb; v_tier text;
  e record; v_goal int; v_start date; v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_rest int; v_window int; v_deadline date; v_count int := 0; v_closed int; v_closed_ok int; v_state text := 'none';
  v_steps jsonb := '[]'::jsonb; lv int; v_type text; v_cnt int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'login_required'); end if;
  v_email := private.together_email(v_uid);
  begin
    perform private.yanawan_gift_sync(v_uid);
  exception when others then
    raise warning 'my_yanawan_gifts sync failed: % %', sqlstate, sqlerrm;
  end;
  pl := private.yanawan_gift_plan(v_uid);
  v_tier := pl ->> 'tier';

  -- 지금 도전(표시용 — 앱 stats.js challengeStatus 와 같은 규칙. 선물 판정에는 쓰지 않는다)
  select en.goal_days, en.start_date, en.season_id, en.user_id into e
    from public.enrollments en join public.users u on u.id = en.user_id
    join public.seasons s on s.id = en.season_id
   where u.auth_uid = v_uid and en.is_yanawan and en.status <> 'dropped' and s.is_active
   order by en.created_at desc limit 1;
  if found then
    v_goal := case when e.goal_days in (30, 66, 100) then e.goal_days end;
    select coalesce(e.start_date, min(c.checked_in_at)) into v_start
      from public.check_ins c where c.user_id = e.user_id and c.season_id = e.season_id and c.is_yanawan;
    if v_start is not null and v_goal is not null then
      v_rest := greatest(0, least(case v_goal when 30 then 3 when 66 then 6 else 10 end,
                                  (make_date(extract(year from v_start)::int, 12, 31) - v_start + 1) - v_goal));
      v_window := v_goal + v_rest;
      v_deadline := least(v_start + (v_goal + case v_goal when 30 then 3 when 66 then 6 else 10 end) - 1,
                          make_date(extract(year from v_start)::int, 12, 31));
      if v_start > v_today then v_state := 'upcoming';
      else
        select count(distinct c.checked_in_at)::int, count(distinct c.checked_in_at) filter (where c.checked_in_at < v_today)::int
          into v_count, v_closed_ok
          from public.check_ins c
         where c.user_id = e.user_id and c.season_id = e.season_id and c.is_yanawan
           and c.checked_in_at >= v_start and c.checked_in_at <= least(v_deadline, v_today);
        v_closed := least(greatest(0, v_today - v_start), v_window);
        v_state := case when v_count >= v_goal then 'success'
                        when v_today > v_deadline then 'failed'
                        when v_closed - v_closed_ok > v_rest then 'failed'
                        else 'active' end;
      end if;
    end if;
  end if;

  foreach lv in array array[30, 66, 100] loop
    if pl -> 'reached' -> lv::text <> 'null'::jsonb then
      select case max(g.kind) when 'seat' then 'seat' when 'subscription_pass' then 'subscription_pass'
                  when 'course_voucher' then 'course_voucher' else 'none' end, count(*)::int
        into v_type, v_cnt
        from private.yanawan_gifts g where g.auth_uid = v_uid and g.level = lv;
      if v_cnt = 0 then v_type := 'none'; end if;
    else
      v_type := case v_tier when 'allinone' then case lv when 30 then 'seat' else 'subscription_pass' end
                            when 'owner' then 'course_voucher' else 'none' end;
      v_cnt := case when v_type = 'none' then 0 else 1 end;
    end if;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'level', lv,
      'reached', pl -> 'reached' -> lv::text <> 'null'::jsonb,
      'reachedAt', pl -> 'reached' -> lv::text -> 'at',
      'by', pl -> 'reached' -> lv::text -> 'by',
      'gift', jsonb_build_object('type', v_type, 'count', v_cnt)));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'since', to_char(private.yanawan_gift_since(), 'YYYY-MM-DD'),
    'owner', jsonb_build_object('allInOne', coalesce((pl ->> 'allInOne')::boolean, false), 'ownedCount', coalesce((pl ->> 'ownedCount')::int, 0)),
    'days', jsonb_build_object('cumulative', coalesce((pl ->> 'cumulative')::int, 0),
      'current', jsonb_build_object('goal', v_goal, 'start', to_char(v_start, 'YYYY-MM-DD'), 'count', coalesce(v_count, 0), 'state', v_state)),
    'steps', v_steps,
    'seatBonus', private.together_seat_bonus_on(v_uid),
    'passes', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'kind', c.kind, 'issuedAt', c.issued_at,
                 'expiresAt', c.expires_at, 'redeemedAt', c.redeemed_at) order by g.seq)
               from private.yanawan_gifts g join public.class_subscription_gift_codes c on c.code = g.pass_code
              where g.auth_uid = v_uid and g.kind = 'subscription_pass'), '[]'::jsonb),
    'passesHeld', (select count(*)::int from private.yanawan_gifts g
                    where g.auth_uid = v_uid and g.kind = 'subscription_pass' and g.pass_code is null),
    'vouchers', coalesce((select jsonb_agg(private.yanawan_voucher_json(g.id) order by g.seq)
               from private.yanawan_gifts g where g.auth_uid = v_uid and g.kind = 'course_voucher'), '[]'::jsonb));
end $$;
revoke all on function public.my_yanawan_gifts() from public, anon;
grant execute on function public.my_yanawan_gifts() to authenticated;

-- 수강권 한 장에 내가 소장한 강의를 정해 등록 코드를 만든다(받는 분은 기존 인증 코드 등록 화면에 코드를 넣는다 → class_redemptions = 평생 소장).
create or replace function public.my_yanawan_voucher_pick(p_voucher_id uuid, p_book_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_email text; v_book text := lower(btrim(coalesce(p_book_code, '')));
  g private.yanawan_gifts; v_code text; v_s text; v_try int := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'login_required'); end if;
  v_email := private.together_email(v_uid);
  select * into g from private.yanawan_gifts where id = p_voucher_id and auth_uid = v_uid and kind = 'course_voucher' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if g.voucher_code is not null then
    return jsonb_build_object('ok', false, 'error', 'already_picked', 'voucher', private.yanawan_voucher_json(g.id));
  end if;
  if not (v_book = any (private.together_k8())) or not (v_book = any (private.together_owned_books(v_email))) then
    return jsonb_build_object('ok', false, 'error', 'not_owned');
  end if;
  loop
    v_try := v_try + 1;
    v_s := private.class_subscription_gift_code();
    v_code := upper(left(v_book, 8)) || '-' || substr(v_s, 1, 4) || '-' || substr(v_s, 5, 4);
    insert into public.class_redemptions (code, book_code) values (v_code, v_book) on conflict (code) do nothing;
    exit when found;
    if v_try >= 5 then raise exception 'voucher_code_collision'; end if;
  end loop;
  update private.yanawan_gifts set book_code = v_book, voucher_code = v_code, picked_at = now() where id = g.id;
  return jsonb_build_object('ok', true, 'voucher', private.yanawan_voucher_json(g.id));
end $$;
revoke all on function public.my_yanawan_voucher_pick(uuid, text) from public, anon;
grant execute on function public.my_yanawan_voucher_pick(uuid, text) to authenticated;

-- ── ⑨ 함께 읽기 연결 항목의 상대 사진 ──
--   닉네임과 같은 짝 규칙(auth_uid + 같은 이메일). 사진이 아닌 값·너무 큰 값은 null(화면은 닉네임 첫 글자).
create or replace function private.together_avatar(p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
select (select case when pu.avatar_url ~ '^(https://|data:image/(jpeg|png|webp|gif);base64,)' and length(pu.avatar_url) <= 20000
                    then pu.avatar_url end
          from public.users pu
         where pu.auth_uid = p_uid and lower(btrim(pu.email)) = private.together_email(p_uid)
           and coalesce(btrim(pu.avatar_url), '') <> ''
         order by pu.created_at limit 1)
$$;
revoke all on function private.together_avatar(uuid) from public, anon, authenticated;

do $patch$
declare v_def text; n int;
  a1 text := '''partnerNickname'', case when v_partner is null or c.status = ''ended'' then null else private.together_nickname(v_partner) end,';
begin
  select pg_get_functiondef('private.together_view(uuid,uuid)'::regprocedure) into v_def;
  if position('''partnerAvatar''' in v_def) > 0 then return; end if;
  v_def := replace(v_def, E'\r\n', E'\n');
  n := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'together_view anchor matched % times', n; end if;
  execute replace(v_def, a1, a1 || E'\n    ''partnerAvatar'', case when v_partner is null or c.status = ''ended'' then null else private.together_avatar(v_partner) end,');
end $patch$;
