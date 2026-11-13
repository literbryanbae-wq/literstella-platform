-- 구독 할인에 핵심 이론 + 월 → 연간 전환 결제의 환불 규칙(운영자 2026-11-13 승인). 20261113100000 뒤에.
--   A. 구독 할인에 핵심 이론을 소장으로 센다 — 올인원 결제(class_checkout_quote)와 같은 규칙:
--      오리지널 2권 이상 소장했거나 theory 를 실제로 소장(class_verifications/class_redemptions)했으면 이론 1권을 더 센다.
--      summary 가 ownedTheory(boolean)를 더 준다. 금액 계산은 서버(class-subscription-pricing.mjs) — 분모 9 그대로,
--      올인원 권유 문턱(4권)은 오리지널 권수만 본다.
--   B. 월 → 연간 전환 결제(kind='upgrade')의 환불(운영자가 토스 상점관리자에서 취소 → 웹훅 → settle):
--      ① 전환 후 7일 안 + 오즈·어린 왕자 유료 강의(6강~)를 안 들음 → 전액 취소(CANCELED) · 포인트 전부 반환 ·
--         월 구독으로 되돌리고 원래 남아 있던 기간을 되살린다(남은 날짜 차감분 credit 은 여기서만 기간으로 돌아온다).
--      ② 그 밖(7일 안이어도 유료 강의를 들었거나 7일이 지남) → 카드 결제액 − 연간 금액 ÷ 365 × 이용 일수(100원 아래 버림, 0 밑 없음)
--         만큼 부분 취소(PARTIAL_CANCELED) · 포인트는 같은 비율로 반환 · 구독 종료.
--      ③ 런칭 선물로 더 받은 달은 계산에 넣지 않는다(전환 주문은 bonus_months 0 이라 해당 없음).
--      ④ credit 은 현금 환불 대상이 아니다.
--      settle 은 upgrade 결제가 끝날 때 바꾸기 직전 구독 값을 upgrade_to.prev 에 남겨 ①에서 되돌린다.
--      포인트 비율 반환은 차감 줄을 '남겨야 할 값'으로 고쳐 쓴다 — 🔴 양수 줄을 새로 넣지 않는다(랭킹이 양수 줄을 시즌 점수로 센다).
--      환불액 계산(운영자용 견적) = class_subscription_refund_quote(user) — 계산만, 쓰기 없음.
--   되돌리기(전환 주문 환불 0건일 때만): summary·settle 을 20261113090000·20261113100000 본문으로 다시 적용 ·
--     drop function public.class_subscription_points_refund(text), public.class_subscription_refund_quote(uuid), private.class_owns_theory(text).

-- ── A. 핵심 이론을 소장으로 세는가(올인원 결제와 같은 규칙) ──
create or replace function private.class_owns_theory(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.class_owned_originals(p_email), 0) >= 2
    or exists (select 1 from public.class_verifications cv where lower(cv.email) = lower(p_email) and cv.book_code = 'theory')
    or exists (select 1 from public.class_redemptions cr where lower(cr.redeemed_by) = lower(p_email) and cr.book_code = 'theory')
$$;
revoke all on function private.class_owns_theory(text) from public, anon, authenticated;

-- 서버가 읽는 요약 — 20261113090000 과 같고 ownedTheory 를 더한다.
create or replace function public.class_subscription_summary(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'subscription', (select jsonb_build_object('id', s.id, 'plan', s.plan, 'cycle', s.cycle, 'status', s.status, 'amount', s.amount,
        'periodEnd', s.current_period_end, 'nextChargeAt', s.next_charge_at, 'cancelRequested', s.cancel_requested_at is not null)
      from public.class_subscriptions s where s.user_id = p_user_id order by (s.status in ('active','past_due')) desc, s.created_at desc limit 1),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('orderId', p.id, 'amount', p.amount, 'paidAt', p.paid_at,
        'canceledAmount', p.canceled_amount, 'kind', p.kind, 'pointsUsed', p.points_used) order by p.paid_at)
      from public.class_subscription_payments p where p.user_id = p_user_id and p.paid_at is not null), '[]'::jsonb),
    'ownedOriginals', (select private.class_owned_originals(u.email) from auth.users u where u.id = p_user_id),
    'ownedTheory', coalesce((select private.class_owns_theory(u.email) from auth.users u where u.id = p_user_id), false),
    'pointsBalance', coalesce((select sum(t.amount)::integer from public.point_transactions t
        where t.user_id = private.class_subscription_member(p_user_id)), 0))
$$;

-- ── B. 결제 결과 반영 — 20261113100000 과 같고, 전환(upgrade) 결제의 되돌림·종료를 더한다 ──
create or replace function public.class_subscription_settle(
  p_order_id text, p_payment_key text, p_amount integer, p_status text, p_canceled_amount integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pay public.class_subscription_payments; v_sub public.class_subscriptions; v_prev jsonb; v_prev_end timestamptz;
  v_current boolean;
begin
  select * into v_pay from public.class_subscription_payments where id = p_order_id for update;
  if not found or v_pay.amount <> p_amount then return jsonb_build_object('ok', false, 'error', 'payment_mismatch'); end if;
  if v_pay.payment_key is not null and v_pay.payment_key <> p_payment_key then return jsonb_build_object('ok', false, 'error', 'payment_mismatch'); end if;
  select * into v_sub from public.class_subscriptions where id = v_pay.subscription_id for update;
  if p_status = 'DONE' then
    if v_pay.status <> 'paid' then
      update public.class_subscription_payments set status = 'paid', payment_key = p_payment_key, paid_at = now(), updated_at = now() where id = p_order_id;
      if v_pay.kind = 'upgrade' then
        -- 바꾸기 직전 월 구독 값을 남긴다(전액 환불 때 그대로 되돌린다)
        update public.class_subscription_payments set upgrade_to = coalesce(upgrade_to, '{}'::jsonb) || jsonb_build_object('prev', jsonb_build_object(
            'plan', v_sub.plan, 'amount', v_sub.amount, 'listAmount', v_sub.list_amount, 'ownedCount', v_sub.owned_count,
            'termsVersion', v_sub.terms_version, 'termsUrl', v_sub.terms_url,
            'periodStart', v_sub.current_period_start, 'periodEnd', v_sub.current_period_end,
            'cancelRequested', v_sub.cancel_requested_at is not null)), updated_at = now()
         where id = p_order_id;
        -- 월 → 연간: 요금제·금액·기간을 바꾸고 해지 예약을 푼다. 기다리던 월 갱신 주문은 닫는다.
        update public.class_subscriptions set status = 'active', retry_count = 0, cycle = 'year',
          plan = v_pay.upgrade_to ->> 'plan', amount = (v_pay.upgrade_to ->> 'amount')::integer,
          list_amount = (v_pay.upgrade_to ->> 'listAmount')::integer, owned_count = (v_pay.upgrade_to ->> 'ownedCount')::integer,
          terms_version = v_pay.upgrade_to ->> 'termsVersion', terms_url = v_pay.upgrade_to ->> 'termsUrl',
          current_period_start = v_pay.period_start, current_period_end = v_pay.period_end,
          next_charge_at = v_pay.period_end, cancel_requested_at = null, updated_at = now()
         where id = v_sub.id;
        update public.class_subscription_payments set status = 'canceled', updated_at = now()
         where subscription_id = v_sub.id and kind = 'renewal' and status = 'ready';
      else
        update public.class_subscriptions set status = 'active', retry_count = 0,
          current_period_start = v_pay.period_start, current_period_end = v_pay.period_end,
          next_charge_at = case when cancel_requested_at is null then v_pay.period_end else null end, updated_at = now()
         where id = v_sub.id and (current_period_end is null or current_period_end < v_pay.period_end);
      end if;
    end if;
    return jsonb_build_object('ok', true, 'status', 'paid', 'orderId', p_order_id, 'periodEnd', v_pay.period_end);
  elsif p_status in ('CANCELED','PARTIAL_CANCELED') then
    update public.class_subscription_payments set status = case when p_status = 'CANCELED' then 'canceled' else status end,
      payment_key = p_payment_key, canceled_amount = greatest(canceled_amount, coalesce(p_canceled_amount, 0)), updated_at = now() where id = p_order_id;
    -- 이 결제가 지금 기간의 결제인가(살아 있는 구독일 때만 — 이미 끝난 구독은 다시 살리지 않는다)
    v_current := v_sub.current_period_start = v_pay.period_start;
    if v_pay.kind = 'upgrade' then
      v_prev := v_pay.upgrade_to -> 'prev';
      if p_status = 'CANCELED' and v_pay.status <> 'canceled' and v_current and v_sub.status in ('active','past_due') then
        if v_prev is not null and v_prev ->> 'periodEnd' is not null then
          -- ① 전액 환불 = 월 구독으로 되돌리고 원래 남아 있던 기간을 되살린다
          v_prev_end := (v_prev ->> 'periodEnd')::timestamptz;
          update public.class_subscriptions set cycle = 'month',
            plan = v_prev ->> 'plan', amount = (v_prev ->> 'amount')::integer, list_amount = (v_prev ->> 'listAmount')::integer,
            owned_count = (v_prev ->> 'ownedCount')::integer, terms_version = v_prev ->> 'termsVersion', terms_url = v_prev ->> 'termsUrl',
            current_period_start = (v_prev ->> 'periodStart')::timestamptz, current_period_end = v_prev_end, retry_count = 0,
            status = case when v_prev_end > now() then 'active' else 'canceled' end,
            ended_at = case when v_prev_end > now() then null else now() end,
            next_charge_at = case when v_prev_end > now() and not coalesce((v_prev ->> 'cancelRequested')::boolean, false) then v_prev_end else null end,
            cancel_requested_at = case when v_prev_end > now() and coalesce((v_prev ->> 'cancelRequested')::boolean, false) then now() else null end,
            updated_at = now()
           where id = v_sub.id;
        else
          -- 되돌릴 정보가 없는 옛 결제 = 예전처럼 이용 종료
          update public.class_subscriptions set status = 'canceled', ended_at = now(), next_charge_at = null,
            current_period_end = least(current_period_end, now()), updated_at = now() where id = v_sub.id;
        end if;
      elsif p_status = 'PARTIAL_CANCELED' and v_current and v_sub.status in ('active','past_due') then
        -- ② 이용 일수만큼 빼고 환불 = 구독 종료
        update public.class_subscriptions set status = 'canceled', ended_at = now(), next_charge_at = null,
          current_period_end = least(current_period_end, now()), updated_at = now() where id = v_sub.id;
      end if;
    elsif p_status = 'CANCELED' and v_current then
      -- 첫·갱신 결제: 지금 기간의 결제가 전액 취소됨 = 이용 종료(부분 취소는 기록만 — 예전 그대로)
      update public.class_subscriptions set status = 'canceled', ended_at = now(), next_charge_at = null,
        current_period_end = least(current_period_end, now()), updated_at = now() where id = v_sub.id;
    end if;
    return jsonb_build_object('ok', true, 'status', case when p_status = 'CANCELED' then 'canceled' else 'partial_canceled' end,
      'kind', v_pay.kind, 'orderId', p_order_id);
  end if;
  return jsonb_build_object('ok', false, 'error', 'payment_pending');
end $$;

-- ── B. 포인트 비율 반환 — 차감 줄을 '남겨야 할 값'으로 고쳐 쓴다(양수 줄은 넣지 않는다) ──
--   남는 포인트 = 쓴 포인트 − floor(쓴 포인트 × 누적 취소액 ÷ 카드 금액). 전액 취소면 0 → 줄을 지운다(원장 제약 amount <> 0).
--   누적 취소액으로 매번 다시 계산하므로 여러 번 불려도 같은 결과.
create or replace function public.class_subscription_points_refund(p_order_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pay public.class_subscription_payments; v_member uuid; v_canceled integer; v_kept integer; v_ref text := 'sub_pay:' || coalesce(p_order_id, '');
begin
  select * into v_pay from public.class_subscription_payments where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if v_pay.points_used = 0 then return jsonb_build_object('ok', true, 'pointsUsed', 0, 'pointsKept', 0, 'pointsReturned', 0); end if;
  if v_pay.status not in ('paid','canceled') then return jsonb_build_object('ok', false, 'error', 'order_not_paid'); end if;
  v_canceled := case when v_pay.status = 'canceled' then v_pay.amount else least(greatest(v_pay.canceled_amount, 0), v_pay.amount) end;
  v_kept := v_pay.points_used - floor(v_pay.points_used::numeric * v_canceled / v_pay.amount)::integer;
  v_member := private.class_subscription_member(v_pay.user_id);
  if v_member is null then return jsonb_build_object('ok', false, 'error', 'member_not_found'); end if;
  perform 1 from public.users u where u.id = v_member for update;   -- 같은 회원의 포인트 변경을 줄 세운다
  if v_kept <= 0 then
    delete from public.point_transactions t where t.user_id = v_member and t.reason = 'subscription' and t.ref_id = v_ref;
  else
    update public.point_transactions t set amount = -v_kept where t.user_id = v_member and t.reason = 'subscription' and t.ref_id = v_ref;
  end if;
  return jsonb_build_object('ok', true, 'pointsUsed', v_pay.points_used, 'pointsKept', greatest(v_kept, 0),
    'pointsReturned', v_pay.points_used - greatest(v_kept, 0));
end $$;

-- ── B. 환불 견적(운영자용, 계산만) ──
--   지금 기간의 결제가 전환(upgrade) 결제일 때만. 1~5강은 무료 구간이라 유료 제공 개시가 아니다(ep > 5).
create or replace function public.class_subscription_refund_quote(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_sub public.class_subscriptions; v_pay public.class_subscription_payments; v_email text; v_annual integer; v_days integer;
  v_within boolean; v_heard boolean; v_mode text; v_refund integer; v_points integer; v_prev jsonb; v_ends boolean; v_since timestamptz;
begin
  select * into v_sub from public.class_subscriptions where user_id = p_user_id and status in ('active','past_due')
   order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_subscription'); end if;
  select * into v_pay from public.class_subscription_payments
   where subscription_id = v_sub.id and status = 'paid' and period_start = v_sub.current_period_start
   order by paid_at desc nulls last limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_payment'); end if;
  if v_pay.kind <> 'upgrade' then return jsonb_build_object('ok', false, 'error', 'not_upgrade'); end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  v_since := coalesce(v_pay.paid_at, v_pay.period_start);
  v_annual := (v_pay.upgrade_to ->> 'amount')::integer;
  v_days := greatest(1, ceil(extract(epoch from (now() - v_pay.period_start)) / 86400)::integer);
  v_within := now() < v_since + interval '7 days';
  v_heard := exists (select 1 from public.lecture_progress lp
    where lower(lp.email) = v_email and lp.book_code in ('oz','littleprince') and lp.ep > 5 and lp.last_seen_at >= v_since);
  v_prev := v_pay.upgrade_to -> 'prev';
  if v_within and not v_heard then
    v_mode := 'full'; v_refund := v_pay.amount; v_points := v_pay.points_used;
    v_ends := v_prev is null or v_prev ->> 'periodEnd' is null or (v_prev ->> 'periodEnd')::timestamptz <= now();
  else
    v_mode := 'prorated';
    v_refund := greatest(0, (floor((v_pay.amount - v_annual / 365.0 * v_days) / 100) * 100)::integer);
    v_points := case when v_pay.amount > 0 then floor(v_pay.points_used::numeric * v_refund / v_pay.amount)::integer else 0 end;
    v_ends := true;
  end if;
  return jsonb_build_object('ok', true, 'orderId', v_pay.id, 'kind', 'upgrade', 'paidCard', v_pay.amount, 'pointsUsed', v_pay.points_used,
    'annualAmount', v_annual, 'daysUsed', v_days, 'withinDays7', v_within, 'heardPaidLecture', v_heard, 'mode', v_mode,
    'refundCard', v_refund, 'pointsReturn', v_points, 'endsSubscription', v_ends);
end $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.class_subscription_summary(uuid)',
    'public.class_subscription_settle(text,text,integer,text,integer)',
    'public.class_subscription_points_refund(text)',
    'public.class_subscription_refund_quote(uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;
