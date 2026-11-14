-- 야나완 성공 선물 소급(7/1 이후 기록으로 이미 단계를 넘긴 회원) — supabase/migrations/20261114200000_yanawan_gift_auto.sql 적용 뒤, 운영자가 직접.
--   migrations 폴더 밖에 둔 이유: db push 가 저절로 돌려 선물이 나가지 않게.
--   이 파일은 세 덩어리다. ①·② 는 읽기만(쓰기 0) · ③ 이 실제 지급이다. ③ 만 따로 돌려도 되고 두 번 돌려도 한 번만 준다(원장 멱등).
--   🔴 ③ 은 구독권 코드(60일 기한이 오늘부터 시작)와 함께 읽기 자리 +1 을 실제로 만든다. 메일은 보내지 않는다.
--   되돌리기(③ 직후, 아직 아무도 코드를 쓰지 않았을 때):
--     delete from public.class_subscription_gift_codes c using private.yanawan_gifts g
--      where g.pass_code = c.code and c.redeemed_by is null;
--     delete from public.class_redemptions r using private.yanawan_gifts g where g.voucher_code = r.code and r.redeemed_by is null;
--     delete from private.together_seat_bonus where basis = 'yanawan_auto';
--     delete from private.yanawan_gifts;

-- ── ① 미리 보기(마이그레이션 전에도 돌아간다 — 운영 함수만 쓴다, 쓰기 0) ──
--   2026-11-14 운영 실측: 올인원 7명 자리 +1 · 구독권 8장(2장×3 + 1장×2) · 소장 회원 1명 수강권 3장 · 소장 0 1명 선물 없음.
with
days as (
  select distinct u.auth_uid, c.user_id, c.season_id, c.checked_in_at as d
    from public.check_ins c join public.users u on u.id = c.user_id
   where u.auth_uid is not null and c.is_yanawan and c.checked_in_at >= date '2026-07-01'
     and c.checked_in_at between (c.created_at at time zone 'Asia/Seoul')::date - 1
                             and (c.created_at at time zone 'Asia/Seoul')::date + 1),
us as (select distinct auth_uid, user_id, season_id from days),
refs as (
  select us.auth_uid, us.user_id, us.season_id,
         pg_catalog.to_date(pg_catalog.split_part(r.ref_id, ':', 4), 'YYYY-MM-DD') as rd,
         (r.created_at at time zone 'Asia/Seoul')::date as ck
    from us, lateral private.yanawan_restart_refs(us.user_id) r
   where r.ref_id ~ '^enroll_pay:[^:]+:(30|66|100):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and pg_catalog.split_part(r.ref_id, ':', 2) = us.season_id),
starts as (
  select us.auth_uid, us.user_id, us.season_id, null::date as s from us
  union
  select f.auth_uid, f.user_id, f.season_id, f.rd from refs f
   where f.rd between f.ck - 1 and f.ck + 1
     and exists (select 1 from public.check_ins c where c.user_id = f.user_id and c.season_id = f.season_id
                   and c.is_yanawan and c.checked_in_at < f.rd)),
segs as (
  select st.*, (select min(f.rd) from refs f where f.user_id = st.user_id and f.season_id = st.season_id
                  and (st.s is null or f.rd > st.s)) as e
    from starts st),
ranked as (
  select g.auth_uid, d.d, pg_catalog.row_number() over (partition by g.auth_uid, g.user_id, g.season_id, g.s order by d.d) as rn
    from segs g join days d on d.user_id = g.user_id and d.season_id = g.season_id
   where (g.s is null or d.d >= g.s) and (g.e is null or d.d < g.e)),
chal as (select auth_uid, rn as lv, min(d) as at from ranked where rn in (30, 66, 100) group by 1, 2),
badge as (
  select u.auth_uid, (pg_catalog.regexp_match(p.ref_id, ':streak_(30|66|100)'))[1]::int as lv,
         min((p.created_at at time zone 'Asia/Seoul')::date) as at
    from public.point_transactions p join public.users u on u.id = p.user_id
   where u.auth_uid is not null and p.reason = 'badge'
     and p.ref_id ~ '^[^:]+:streak_(30|66|100)(:[0-9]{4}-[0-9]{2}-[0-9]{2})?$'
     and p.created_at >= timestamptz '2026-07-01 00:00+09' and p.created_at < timestamptz '2026-11-15 00:00+09'
   group by 1, 2),
cum as (
  select auth_uid, count(distinct d) as n,
         (select x.d from (select distinct d2.d from days d2 where d2.auth_uid = dd.auth_uid order by 1 offset 99 limit 1) x) as at100
    from days dd group by auth_uid),
lv as (
  select m.auth_uid,
    min(case when lv = 30 then at end) as c30, min(case when lv = 66 then at end) as c66, min(case when lv = 100 then at end) as c100
  from (select * from chal union all select * from badge) m group by 1),
who as (
  select c.auth_uid, c.n as cumulative, private.together_email(c.auth_uid) as em, l.c30, l.c66, l.c100, c.at100
    from cum c left join lv l on l.auth_uid = c.auth_uid),
plan as (
  select w.*, private.together_classic_count(w.em) as classic,
         (select count(*) from unnest(private.together_owned_books(w.em)) b where b = any (private.together_k8()))::int as k8,
         least(w.c100, w.at100) as r100
    from who w)
select (select pu.nickname from public.users pu where pu.auth_uid = p.auth_uid order by pu.created_at limit 1) as nickname,
       p.cumulative, p.classic, p.k8,
       p.c30 as reached30, p.c66 as reached66, p.r100 as reached100,
       case when p.c100 is not null and p.c100 <= coalesce(p.at100, p.c100) then 'challenge' when p.r100 is not null then 'cumulative' end as by100,
       case when p.classic >= 7 then 'allinone' when p.k8 >= 1 then 'owner' else 'none' end as tier,
       case when p.classic >= 7 and p.c30 is not null then 1 else 0 end as seat,
       case when p.classic >= 7 then (p.c66 is not null)::int + (p.r100 is not null)::int else 0 end as passes,
       case when p.classic < 7 and p.k8 >= 1 then
         case when p.r100 is not null then 3 when p.c66 is not null then 2 when p.c30 is not null then 1 else 0 end else 0 end as vouchers
  from plan p
 where p.c30 is not null or p.c66 is not null or p.r100 is not null
 order by tier, cumulative desc;

-- ── ② 미리 보기(마이그레이션 뒤 — 실제 지급이 쓰는 private.yanawan_gift_plan 그대로, 쓰기 0). ① 과 같은 표가 나와야 한다. ──
select (select pu.nickname from public.users pu where pu.auth_uid = x.auth_uid order by pu.created_at limit 1) as nickname,
       x.p ->> 'tier' as tier, (x.p ->> 'cumulative')::int as cumulative,
       x.p -> 'reached' -> '30' ->> 'at' as reached30, x.p -> 'reached' -> '66' ->> 'at' as reached66,
       x.p -> 'reached' -> '100' ->> 'at' as reached100, x.p -> 'reached' -> '100' ->> 'by' as by100,
       (x.p ->> 'seat')::boolean as seat, (x.p ->> 'passes')::int as passes, (x.p ->> 'vouchers')::int as vouchers
  from (select a.auth_uid, private.yanawan_gift_plan(a.auth_uid) as p
          from (select distinct u.auth_uid from public.check_ins c join public.users u on u.id = c.user_id
                 where u.auth_uid is not null and c.is_yanawan and c.checked_in_at >= date '2026-07-01') a) x
 where x.p -> 'reached' -> '30' <> 'null'::jsonb or x.p -> 'reached' -> '66' <> 'null'::jsonb or x.p -> 'reached' -> '100' <> 'null'::jsonb
 order by tier, cumulative desc;

-- ── ③ 실제 지급(소급) — 7/1 이후 야나완 인증이 있는 로그인 계정 전원에게 동기화를 한 번 ──
select a.auth_uid is not null as has_uid, private.yanawan_gift_sync(a.auth_uid) as result
  from (select distinct u.auth_uid from public.check_ins c join public.users u on u.id = c.user_id
         where u.auth_uid is not null and c.is_yanawan and c.checked_in_at >= date '2026-07-01') a;

-- 결과 세기(읽기만) — 기대: seat 7 · subscription_pass 8(hold_reason 0) · course_voucher 3 · together_seat_bonus(yanawan_auto) 7
select kind, count(*) as rows, count(pass_code) as with_code, count(*) filter (where hold_reason is not null) as held
  from private.yanawan_gifts group by kind order by kind;
select count(*) as auto_seat_bonus from private.together_seat_bonus where basis = 'yanawan_auto';
