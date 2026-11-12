-- 챌린지 도전 결제: 포인트를 먼저 쓰고 남은 금액만 카드로(운영자 2026-11-12). 🔴 아직 적용하지 않는다(운영자 승인 뒤).
--   서버(literstella-api challenge-card-checkout.mjs)만 부른다 — service_role 전용.
--   잡기(reserve) = 카드 승인 직전에 포인트를 차감. 같은 주문은 한 번만. 놓기(release) = 카드가 거절됐을 때만 그 줄을 지운다.
--   식별자는 포인트 전액 결제와 같은 enroll_pay:<시즌>:<일수>[:<시작일>] — 배지·새 도전 판정(private.yanawan_challenge_days)이 그대로 읽는다.

create or replace function public.challenge_card_points_reserve(
  p_user_id uuid, p_season text, p_points integer, p_ref text, p_order_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_memo text := 'card+points:' || coalesce(p_order_id, ''); v_existing text; v_balance integer;
begin
  if p_points is null or p_points < 10 or p_points > 880 or p_points % 10 <> 0
     or coalesce(p_order_id, '') = '' or p_ref !~ ('^enroll_pay:' || p_season || ':(30|66|100)(:[0-9]{4}-[0-9]{2}-[0-9]{2})?$')
     or not exists (select 1 from public.seasons s where s.id = p_season) then
    return jsonb_build_object('ok', false, 'error', 'bad_points');
  end if;
  perform 1 from public.users u where u.id = p_user_id for update;   -- 같은 회원의 동시 차감을 줄 세운다
  if not found then return jsonb_build_object('ok', false, 'error', 'member_not_linked'); end if;
  select t.memo into v_existing from public.point_transactions t
   where t.user_id = p_user_id and t.reason = 'spend_extension' and t.ref_id = p_ref;
  if found then
    if v_existing = v_memo then return jsonb_build_object('ok', true, 'held', true, 'again', true); end if;
    return jsonb_build_object('ok', false, 'error', 'already_paid_points');   -- 같은 도전을 이미 포인트로 결제했다
  end if;
  select coalesce(sum(t.amount), 0)::integer into v_balance from public.point_transactions t where t.user_id = p_user_id;
  if v_balance < p_points then return jsonb_build_object('ok', false, 'error', 'points_short', 'balance', v_balance); end if;
  insert into public.point_transactions (user_id, season_id, amount, reason, ref_id, memo)
  values (p_user_id, p_season, -p_points, 'spend_extension', p_ref, v_memo);
  return jsonb_build_object('ok', true, 'held', true, 'balance', v_balance - p_points);
end $$;

create or replace function public.challenge_card_points_release(p_user_id uuid, p_ref text, p_order_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  -- 결제가 끝난 주문의 포인트는 돌려놓지 않는다.
  if exists (select 1 from public.payments p where p.id = p_order_id and p.status = 'DONE') then
    return jsonb_build_object('ok', false, 'error', 'order_paid');
  end if;
  delete from public.point_transactions t
   where t.user_id = p_user_id and t.reason = 'spend_extension' and t.ref_id = p_ref and t.memo = 'card+points:' || p_order_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'released', v_n);
end $$;

revoke all on function public.challenge_card_points_reserve(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.challenge_card_points_release(uuid, text, text) from public, anon, authenticated;
grant execute on function public.challenge_card_points_reserve(uuid, text, integer, text, text) to service_role;
grant execute on function public.challenge_card_points_release(uuid, text, text) to service_role;

-- 되돌리기: drop function public.challenge_card_points_reserve(uuid, text, integer, text, text), public.challenge_card_points_release(uuid, text, text);
