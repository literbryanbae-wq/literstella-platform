-- 구독 런칭 선물(더 드리는 달) + 월 → 연간 전환 차감(운영자 2026-11-13 "다 넣어").
--   🔴 아직 적용하지 않는다 — 20261113090000(포인트) 뒤에, 구독 결제를 여는 날 같이.
--   ① 더 드리는 달: 무료로 먼저 써 본 회원(class_trial_signups 에 줄이 있다)의 '첫 구독 결제'에 달을 얹는다.
--      월 개인 1 · 월 함께 2 · 연간 개인 3 · 연간 함께 6. 2026-12-31(KST)까지. 금액은 그대로, 첫 기간만 길어진다.
--   ② 월 → 연간 전환: 이번 달 남은 날짜만큼(카드로 낸 금액 × 남은 시간 ÷ 기간, 100원 아래 버림) 연간 결제에서 뺀다.
--      포인트 = 연간 금액의 30% − 이번 달 결제에 쓴 포인트. 등록된 카드로 바로 청구한다(카드 창을 다시 열지 않는다).
--      결제가 끝나면 구독이 연간으로 바뀌고 그날부터 1년. 해지 예약은 풀린다.

alter table public.class_subscription_payments add column if not exists bonus_months integer not null default 0 check (bonus_months between 0 and 6);
alter table public.class_subscription_payments add column if not exists upgrade_to jsonb;
alter table public.class_subscription_payments drop constraint if exists class_subscription_payments_kind_check;
alter table public.class_subscription_payments add constraint class_subscription_payments_kind_check check (kind in ('first','renewal','upgrade'));

-- ── ① 더 드리는 달 ──
create or replace function private.class_subscription_bonus_months(p_user_id uuid, p_plan text, p_cycle text) returns integer
language sql stable security definer set search_path = '' as $$
  select case
    when (now() at time zone 'Asia/Seoul')::date > date '2026-12-31' then 0
    when not exists (select 1 from public.class_trial_signups t where t.user_id = p_user_id) then 0
    when exists (select 1 from public.class_subscription_payments p where p.user_id = p_user_id and p.paid_at is not null) then 0
    when p_cycle = 'year' and p_plan = 'together' then 6
    when p_cycle = 'year' then 3
    when p_plan = 'together' then 2
    else 1 end
$$;
revoke all on function private.class_subscription_bonus_months(uuid, text, text) from public, anon, authenticated;

-- 주문서가 '몇 달 더'를 미리 보여 준다
create or replace function public.class_subscription_bonus(p_user_id uuid, p_plan text, p_cycle text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('months', private.class_subscription_bonus_months(p_user_id, p_plan, p_cycle))
$$;

-- 가입 시작 — 포인트 판(20261113090000)과 같고, 첫 기간에 더 드리는 달을 얹는다.
create or replace function public.class_subscription_begin(
  p_user_id uuid, p_plan text, p_cycle text, p_amount integer, p_list_amount integer, p_owned_count integer,
  p_terms_version text, p_terms_url text, p_points integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sub public.class_subscriptions; v_order text; v_start timestamptz := now(); v_end timestamptz;
  v_points integer := coalesce(p_points, 0); v_member uuid; v_balance integer; v_bonus integer;
begin
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'login_required'); end if;
  if v_points < 0 or v_points > floor(p_amount * 0.3 / 10) then return jsonb_build_object('ok', false, 'error', 'bad_points'); end if;
  if v_points > 0 then
    v_member := private.class_subscription_member(p_user_id);
    if v_member is null then return jsonb_build_object('ok', false, 'error', 'points_short', 'balance', 0); end if;
    select coalesce(sum(t.amount), 0)::integer into v_balance from public.point_transactions t where t.user_id = v_member;
    if v_balance < v_points then return jsonb_build_object('ok', false, 'error', 'points_short', 'balance', v_balance); end if;
  end if;
  select * into v_sub from public.class_subscriptions where user_id = p_user_id and status in ('pending','active','past_due') for update;
  if found and v_sub.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'already_subscribed'); end if;
  if found then
    if exists (select 1 from public.class_subscription_payments p join public.point_transactions t
                 on t.reason = 'subscription' and t.ref_id = 'sub_pay:' || p.id
                where p.subscription_id = v_sub.id and p.status = 'ready') then
      return jsonb_build_object('ok', false, 'error', 'payment_pending');
    end if;
    update public.class_subscriptions set plan = p_plan, cycle = p_cycle, amount = p_amount, list_amount = p_list_amount,
      owned_count = p_owned_count, terms_version = p_terms_version, terms_url = p_terms_url, updated_at = now()
     where id = v_sub.id returning * into v_sub;
    update public.class_subscription_payments set status = 'canceled', updated_at = now() where subscription_id = v_sub.id and status = 'ready';
  else
    insert into public.class_subscriptions (user_id, plan, cycle, amount, list_amount, owned_count, customer_key, terms_version, terms_url)
    values (p_user_id, p_plan, p_cycle, p_amount, p_list_amount, p_owned_count, 'cus' || replace(gen_random_uuid()::text, '-', ''), p_terms_version, p_terms_url)
    returning * into v_sub;
  end if;
  v_bonus := private.class_subscription_bonus_months(p_user_id, p_plan, p_cycle);
  v_end := (case when p_cycle = 'year' then v_start + interval '1 year' else v_start + interval '1 month' end) + make_interval(months => v_bonus);
  v_order := 'sub' || replace(gen_random_uuid()::text, '-', '');
  insert into public.class_subscription_payments (id, subscription_id, user_id, kind, amount, points_used, bonus_months, period_start, period_end)
  values (v_order, v_sub.id, p_user_id, 'first', p_amount - v_points * 10, v_points, v_bonus, v_start, v_end);
  return jsonb_build_object('ok', true, 'subscriptionId', v_sub.id, 'customerKey', v_sub.customer_key, 'orderId', v_order,
    'amount', p_amount, 'cardAmount', p_amount - v_points * 10, 'usePoints', v_points, 'bonusMonths', v_bonus, 'periodEnd', v_end);
end $$;

-- ── ② 월 → 연간 전환 ──
-- 지금 월 구독의 남은 날짜 값어치. 연간 금액은 서버(class-subscription-pricing.mjs)가 정해 넘긴다.
create or replace function public.class_subscription_upgrade_quote(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_sub public.class_subscriptions; v_pay public.class_subscription_payments; v_total numeric; v_left numeric; v_paid integer; v_credit integer;
begin
  select * into v_sub from public.class_subscriptions where user_id = p_user_id and status = 'active' and cycle = 'month';
  if not found or v_sub.billing_key is null or v_sub.current_period_end is null or v_sub.current_period_end <= now() then
    return jsonb_build_object('ok', false, 'error', 'no_monthly_subscription'); end if;
  select * into v_pay from public.class_subscription_payments
   where subscription_id = v_sub.id and status = 'paid' and period_start = v_sub.current_period_start;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_monthly_subscription'); end if;
  v_paid := greatest(v_pay.amount - v_pay.canceled_amount, 0);
  v_total := extract(epoch from (v_pay.period_end - v_pay.period_start));
  v_left := greatest(extract(epoch from (v_pay.period_end - now())), 0);
  v_credit := case when v_total > 0 then (floor(v_paid * v_left / v_total / 100) * 100)::integer else 0 end;
  return jsonb_build_object('ok', true, 'subscriptionId', v_sub.id, 'plan', v_sub.plan, 'credit', v_credit,
    'pointsUsedThisPeriod', v_pay.points_used, 'periodEnd', v_sub.current_period_end,
    'daysLeft', ceil(v_left / 86400)::integer);
end $$;

create or replace function public.class_subscription_upgrade_begin(
  p_user_id uuid, p_plan text, p_amount integer, p_list_amount integer, p_owned_count integer,
  p_terms_version text, p_terms_url text, p_points integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sub public.class_subscriptions; v_q jsonb; v_credit integer; v_points integer := coalesce(p_points, 0); v_max integer;
  v_member uuid; v_balance integer; v_card integer; v_order text; v_start timestamptz := now();
begin
  if p_plan not in ('solo','together') then return jsonb_build_object('ok', false, 'error', 'bad_plan'); end if;
  select * into v_sub from public.class_subscriptions where user_id = p_user_id and status = 'active' and cycle = 'month' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_monthly_subscription'); end if;
  v_q := public.class_subscription_upgrade_quote(p_user_id);
  if not (v_q ->> 'ok')::boolean then return v_q; end if;
  v_credit := (v_q ->> 'credit')::integer;
  v_max := greatest(floor(p_amount * 0.3 / 10)::integer - (v_q ->> 'pointsUsedThisPeriod')::integer, 0);
  if v_points < 0 or v_points > v_max then return jsonb_build_object('ok', false, 'error', 'bad_points', 'pointsMax', v_max); end if;
  if v_points > 0 then
    v_member := private.class_subscription_member(p_user_id);
    if v_member is null then return jsonb_build_object('ok', false, 'error', 'points_short', 'balance', 0); end if;
    select coalesce(sum(t.amount), 0)::integer into v_balance from public.point_transactions t where t.user_id = v_member;
    if v_balance < v_points then return jsonb_build_object('ok', false, 'error', 'points_short', 'balance', v_balance); end if;
  end if;
  -- 결과를 기다리는 전환 주문이 있으면 새로 만들지 않는다(그 결제가 실제로 됐을 수 있다 — 두 번 청구 금지)
  if exists (select 1 from public.class_subscription_payments p
              where p.subscription_id = v_sub.id and p.kind = 'upgrade' and p.status = 'ready' and p.created_at > now() - interval '1 day') then
    return jsonb_build_object('ok', false, 'error', 'payment_pending');
  end if;
  update public.class_subscription_payments set status = 'canceled', updated_at = now()
   where subscription_id = v_sub.id and kind = 'upgrade' and status = 'ready';
  v_card := p_amount - v_credit - v_points * 10;
  if v_card <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  v_order := 'sub' || replace(gen_random_uuid()::text, '-', '');
  insert into public.class_subscription_payments (id, subscription_id, user_id, kind, amount, points_used, period_start, period_end, upgrade_to)
  values (v_order, v_sub.id, p_user_id, 'upgrade', v_card, v_points, v_start, v_start + interval '1 year',
    jsonb_build_object('plan', p_plan, 'amount', p_amount, 'listAmount', p_list_amount, 'ownedCount', p_owned_count,
      'credit', v_credit, 'termsVersion', p_terms_version, 'termsUrl', p_terms_url));
  return jsonb_build_object('ok', true, 'orderId', v_order, 'subscriptionId', v_sub.id, 'customerKey', v_sub.customer_key, 'billingKey', v_sub.billing_key,
    'amount', p_amount, 'credit', v_credit, 'usePoints', v_points, 'cardAmount', v_card, 'plan', p_plan);
end $$;

-- 결제 결과 반영 — 20261112100000 과 같고, 전환 주문(upgrade)이 결제되면 구독을 연간으로 바꾼다.
create or replace function public.class_subscription_settle(
  p_order_id text, p_payment_key text, p_amount integer, p_status text, p_canceled_amount integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pay public.class_subscription_payments; v_sub public.class_subscriptions;
begin
  select * into v_pay from public.class_subscription_payments where id = p_order_id for update;
  if not found or v_pay.amount <> p_amount then return jsonb_build_object('ok', false, 'error', 'payment_mismatch'); end if;
  if v_pay.payment_key is not null and v_pay.payment_key <> p_payment_key then return jsonb_build_object('ok', false, 'error', 'payment_mismatch'); end if;
  select * into v_sub from public.class_subscriptions where id = v_pay.subscription_id for update;
  if p_status = 'DONE' then
    if v_pay.status <> 'paid' then
      update public.class_subscription_payments set status = 'paid', payment_key = p_payment_key, paid_at = now(), updated_at = now() where id = p_order_id;
      if v_pay.kind = 'upgrade' then
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
    if p_status = 'CANCELED' and v_sub.current_period_start = v_pay.period_start then
      update public.class_subscriptions set status = 'canceled', ended_at = now(), next_charge_at = null,
        current_period_end = least(current_period_end, now()), updated_at = now() where id = v_sub.id;
    end if;
    return jsonb_build_object('ok', true, 'status', 'canceled', 'orderId', p_order_id);
  end if;
  return jsonb_build_object('ok', false, 'error', 'payment_pending');
end $$;

-- 청구 실패 — 전환 주문이 거절돼도 월 구독은 그대로다(연체로 만들지 않는다).
create or replace function public.class_subscription_fail(p_order_id text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pay public.class_subscription_payments; v_retry int;
begin
  update public.class_subscription_payments set status = 'failed', failure_code = left(coalesce(p_code, ''), 80), updated_at = now()
   where id = p_order_id and status = 'ready' returning * into v_pay;
  if not found then return jsonb_build_object('ok', false); end if;
  if v_pay.kind in ('first','upgrade') then return jsonb_build_object('ok', true, 'status', 'failed'); end if;
  update public.class_subscriptions set retry_count = retry_count + 1,
    status = case when retry_count + 1 >= 4 then 'expired' else 'past_due' end,
    next_charge_at = case when retry_count + 1 >= 4 then null else now() + interval '1 day' end,
    ended_at = case when retry_count + 1 >= 4 then now() else ended_at end, updated_at = now()
   where id = v_pay.subscription_id returning retry_count into v_retry;
  return jsonb_build_object('ok', true, 'status', 'failed', 'retry', v_retry);
end $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.class_subscription_bonus(uuid,text,text)',
    'public.class_subscription_begin(uuid,text,text,integer,integer,integer,text,text,integer)',
    'public.class_subscription_upgrade_quote(uuid)',
    'public.class_subscription_upgrade_begin(uuid,text,integer,integer,integer,text,text,integer)',
    'public.class_subscription_settle(text,text,integer,text,integer)',
    'public.class_subscription_fail(text,text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

-- 되돌리기(전환 주문·더 드린 달이 0건일 때만): bonus·upgrade 함수 drop · begin/settle/fail 을 앞 파일 본문으로 ·
--   bonus_months·upgrade_to 칸 drop · kind 제약을 ('first','renewal') 로.
