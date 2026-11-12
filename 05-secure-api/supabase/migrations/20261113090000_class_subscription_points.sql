-- 구독료의 30%까지 포인트로(1P = 10원, 운영자 2026-11-09). 🔴 아직 적용하지 않는다 — 20261112100000·110000 뒤에, 구독 결제를 여는 날 같이.
--   첫 결제에만 쓴다. 다음 자동 결제는 가입 때 정한 금액 그대로(class_subscriptions.amount).
--   카드 주문 금액(class_subscription_payments.amount) = 구독 금액 − 포인트 × 10. 토스 금액 대조는 이 값으로 한다.
--   잡기(reserve) = 카드 청구 직전에 차감, 같은 주문은 한 번만. 놓기(release) = 결제가 끝나지 않은 주문의 그 줄만 지운다.
--   🔴 올인원 전환 차감(20261112110000)은 카드로 낸 금액만 센다 — 포인트로 낸 몫은 들어가지 않는다.

-- 포인트 원장: 구독 사유를 받고, 한 줄 한도를 넓힌다(함께 읽기 연간 149,000원의 30% = 4,470P > 지금 한도 3,000P).
alter table public.point_transactions drop constraint if exists point_tx_reason_whitelist;
alter table public.point_transactions add constraint point_tx_reason_whitelist check (reason = any (array[
  'checkin','badge','join','declaration','review','spend_extension','adjust','welcome','profile','fidelity','record_bonus','diary','cheer',
  'channel','donation','study','feedback','story','lecture','content_bundle','cafe_share','signup','lyra_extra','starter_activity','starter_lyra',
  'subscription']));
alter table public.point_transactions drop constraint if exists point_tx_amount_range;
alter table public.point_transactions add constraint point_tx_amount_range check (amount >= -5000 and amount <= 3000 and amount <> 0);

alter table public.class_subscription_payments add column if not exists points_used integer not null default 0 check (points_used >= 0);

create or replace function private.class_subscription_member(p_user_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.users u where u.auth_uid = p_user_id limit 1
$$;
revoke all on function private.class_subscription_member(uuid) from public, anon, authenticated;

-- 가입 시작(포인트 받는 판) — 예전 8칸짜리는 지운다(포인트 없이 주문을 만드는 길이 따로 남지 않게).
drop function if exists public.class_subscription_begin(uuid, text, text, integer, integer, integer, text, text);
create or replace function public.class_subscription_begin(
  p_user_id uuid, p_plan text, p_cycle text, p_amount integer, p_list_amount integer, p_owned_count integer,
  p_terms_version text, p_terms_url text, p_points integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sub public.class_subscriptions; v_order text; v_start timestamptz := now(); v_end timestamptz;
  v_points integer := coalesce(p_points, 0); v_member uuid; v_balance integer;
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
    -- 포인트를 잡은 채 결과를 기다리는 주문이 있으면 새 주문을 만들지 않는다(그 결제가 실제로 됐을 수 있다).
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
  v_end := case when p_cycle = 'year' then v_start + interval '1 year' else v_start + interval '1 month' end;
  v_order := 'sub' || replace(gen_random_uuid()::text, '-', '');
  insert into public.class_subscription_payments (id, subscription_id, user_id, kind, amount, points_used, period_start, period_end)
  values (v_order, v_sub.id, p_user_id, 'first', p_amount - v_points * 10, v_points, v_start, v_end);
  return jsonb_build_object('ok', true, 'subscriptionId', v_sub.id, 'customerKey', v_sub.customer_key, 'orderId', v_order,
    'amount', p_amount, 'cardAmount', p_amount - v_points * 10, 'usePoints', v_points);
end $$;

-- 카드 청구 직전에 포인트를 차감한다. 같은 주문은 한 번만(다시 불러도 그대로).
create or replace function public.class_subscription_points_reserve(p_order_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pay public.class_subscription_payments; v_member uuid; v_balance integer; v_ref text := 'sub_pay:' || coalesce(p_order_id, '');
begin
  select * into v_pay from public.class_subscription_payments where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if v_pay.points_used = 0 then return jsonb_build_object('ok', true, 'held', false); end if;
  v_member := private.class_subscription_member(v_pay.user_id);
  if v_member is null then return jsonb_build_object('ok', false, 'error', 'points_short', 'balance', 0); end if;
  perform 1 from public.users u where u.id = v_member for update;   -- 같은 회원의 동시 차감을 줄 세운다
  if exists (select 1 from public.point_transactions t where t.user_id = v_member and t.reason = 'subscription' and t.ref_id = v_ref) then
    return jsonb_build_object('ok', true, 'held', true, 'again', true);
  end if;
  if v_pay.status <> 'ready' then return jsonb_build_object('ok', false, 'error', 'order_closed'); end if;
  select coalesce(sum(t.amount), 0)::integer into v_balance from public.point_transactions t where t.user_id = v_member;
  if v_balance < v_pay.points_used then return jsonb_build_object('ok', false, 'error', 'points_short', 'balance', v_balance); end if;
  insert into public.point_transactions (user_id, amount, reason, ref_id, memo)
  values (v_member, -v_pay.points_used, 'subscription', v_ref, 'card+points');
  return jsonb_build_object('ok', true, 'held', true, 'balance', v_balance - v_pay.points_used);
end $$;

-- 결제가 끝나지 않은(거절·전액 취소) 주문의 포인트를 돌려놓는다. 결제된 주문은 건드리지 않는다.
create or replace function public.class_subscription_points_release(p_order_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pay public.class_subscription_payments; v_member uuid; v_n integer;
begin
  select * into v_pay from public.class_subscription_payments where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if v_pay.status = 'paid' then return jsonb_build_object('ok', false, 'error', 'order_paid'); end if;
  v_member := private.class_subscription_member(v_pay.user_id);
  delete from public.point_transactions t where t.user_id = v_member and t.reason = 'subscription' and t.ref_id = 'sub_pay:' || p_order_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'released', v_n);
end $$;

-- 서버가 읽는 요약 — 포인트 잔액을 더한다(주문서가 '쓸 수 있는 포인트'를 그린다).
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
    'pointsBalance', coalesce((select sum(t.amount)::integer from public.point_transactions t
        where t.user_id = private.class_subscription_member(p_user_id)), 0))
$$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.class_subscription_begin(uuid,text,text,integer,integer,integer,text,text,integer)',
    'public.class_subscription_points_reserve(text)',
    'public.class_subscription_points_release(text)',
    'public.class_subscription_summary(uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

-- 되돌리기(구독 포인트 줄이 0건일 때만): 두 함수 drop · begin 을 20261112100000 의 8칸짜리로 · summary 를 그 파일의 본문으로 ·
--   points_used 칸 drop · 원장 제약 두 개를 예전 값(사유 목록에서 'subscription' 제거, amount >= -3000)으로.
