-- 챌린지 카드 결제의 '새 도전' 기록도 배지 재지급 판정에 넣는다(운영자 2026-11-09 '챌린지 도전할 때 실제 결제').
--   판정 함수 private.yanawan_challenge_days 는 같은 시즌 새 도전을 포인트 거래 꼬리(point_transactions
--   reason='spend_extension', ref_id='enroll_pay:<시즌>:<일수>:<시작일>')로만 알아봤다. 카드 결제는 포인트 거래가
--   없으므로(point_transactions 는 amount <> 0 이라 0P 기록도 못 남긴다) 결제 서버가 payments.raw.ref 에 같은 꼬리를
--   남기고, 이 함수가 둘 다 읽는다. 결제 완료(status='DONE')된 챌린지 주문만 센다.
--   ⚠️ 적용 전 원래 본문 md5 = bf4351dcc6e3245d93f1d390499289ea (아니면 멈춘다 — 그새 누가 바꿨다는 뜻).
--   ⚠️ 카드 결제 행이 없으면 결과가 이전과 같다(적용 전후 지문 대조로 확인).

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'private.yanawan_challenge_days(uuid,text,text)'::regprocedure)
     not in ('bf4351dcc6e3245d93f1d390499289ea') then
    raise exception 'yanawan_challenge_days 본문이 예상과 다릅니다 — 적용을 멈춥니다';
  end if;
end $$;

-- 새 도전 꼬리 모음 — 포인트 결제 + 카드 결제(같은 모양 ref_id · 결제 시각)
create or replace function private.yanawan_restart_refs(p_user_id uuid)
returns table(ref_id text, created_at timestamptz)
language sql
stable
set search_path to ''
as $function$
  select p.ref_id, p.created_at
    from public.point_transactions p
   where p.user_id = p_user_id and p.reason = 'spend_extension' and p.ref_id like 'enroll_pay:%'
  union all
  select (pm.raw ->> 'ref'), pm.created_at
    from public.payments pm
   where pm.status = 'DONE' and pm.source like 'toss:challenge-%'
     and (pm.raw ->> 'memberId') = p_user_id::text
     and (pm.raw ->> 'ref') like 'enroll_pay:%'
$function$;

revoke all on function private.yanawan_restart_refs(uuid) from public, anon, authenticated;

create or replace function private.yanawan_challenge_days(p_user_id uuid, p_season text, p_start text)
 returns integer
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  v_d date;
  v_first date;
  v_next date;
  v_count integer;
begin
  -- 새 도전 꼬리 = 포인트 결제(point_transactions) + 카드 결제(payments.raw.ref) — private.yanawan_restart_refs (2026-11-09)
  if coalesce(p_start, '') = '' then
    select pg_catalog.min(pg_catalog.to_date(pg_catalog.split_part(r.ref_id, ':', 4), 'YYYY-MM-DD')) into v_first
      from private.yanawan_restart_refs(p_user_id) r
     where r.ref_id ~ ('^enroll_pay:' || p_season || ':(30|66|100):[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    select pg_catalog.count(distinct c.checked_in_at)::integer into v_count
      from public.check_ins c
     where c.user_id = p_user_id and c.season_id = p_season and c.is_yanawan = true
       and (v_first is null or c.checked_in_at < v_first);
    return v_count;
  end if;
  begin
    v_d := pg_catalog.to_date(p_start, 'YYYY-MM-DD');
  exception when others then
    raise exception using errcode = '22023', message = '새 도전 날짜가 올바르지 않습니다.';
  end;
  if pg_catalog.to_char(v_d, 'YYYY-MM-DD') <> p_start
     or not exists (
       select 1 from private.yanawan_restart_refs(p_user_id) r
        where r.ref_id ~ ('^enroll_pay:' || p_season || ':(30|66|100):' || p_start || '$')
          and v_d between ((r.created_at at time zone 'Asia/Seoul')::date - 1)
                      and ((r.created_at at time zone 'Asia/Seoul')::date + 1)
     )
     or not exists (
       select 1 from public.check_ins c
        where c.user_id = p_user_id and c.season_id = p_season
          and c.is_yanawan = true and c.checked_in_at < v_d
     ) then
    raise exception using errcode = '22023', message = '새 도전 정보를 확인할 수 없습니다.';
  end if;
  select pg_catalog.min(x.d) into v_next
    from (
      select pg_catalog.to_date(pg_catalog.split_part(r.ref_id, ':', 4), 'YYYY-MM-DD') as d
        from private.yanawan_restart_refs(p_user_id) r
       where r.ref_id ~ ('^enroll_pay:' || p_season || ':(30|66|100):[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    ) x
   where x.d > v_d;
  select pg_catalog.count(distinct c.checked_in_at)::integer into v_count
    from public.check_ins c
   where c.user_id = p_user_id and c.season_id = p_season and c.is_yanawan = true
     and c.checked_in_at >= v_d
     and (v_next is null or c.checked_in_at < v_next);
  return v_count;
end
$function$;
