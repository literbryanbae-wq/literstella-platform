-- 구독 '기간권'(일반 결제 한 번 = 구독 한 기간) — 운영자 2026-11-14. 🔴 아직 적용하지 않는다(20261113130000 gift 뒤에).
--   토스 자동 결제(빌링) 심사가 끝날 때까지 월·연간 구독을 '한 번 결제'로 판다. 회원 안내 문구:
--     "자동 결제 되지 않아요. 구독이 끝나기 전에 미리 알려 드려요."
--   자동 결제 길(begin/confirm/due/upgrade)은 그대로 둔다 — 나중에 켠다.
--
--   기간권 구독 행: source 'paid' · billing_mode 'once' · billing_key null · next_charge_at null ·
--     cancel_requested_at = 만든 시각(기간이 끝나면 class_subscription_expire 가 정리 — 선물 구독권과 같은 모양) ·
--     status 'active' 는 결제가 확인된 뒤에만(settle). 결제 행(class_subscription_payments)은 첫 결제와 똑같이 만들고 settle 한다 →
--     올인원 전환 차감(class_checkout_quote)·런칭 선물(bonus_months)·포인트(sub_pay:<주문>)·환불(settle CANCELED)이 그대로 센다.
--   이어 사기(갱신): 같은 요금제(solo/together)만 · 끝나기 14일 전부터(또는 끝난 뒤) · 월↔연간은 바꿀 수 있다(운영자 2026-11-14).
--     새 기간은 지금 기간 끝에 이어 붙는다(살아 있으면 그 끝에서, 끝났으면 지금부터). 남은 기간 동안 열리는 책은
--     '지금 시각을 덮는 결제'의 주기를 따른다(private.class_subscription_effective_cycle) — 연간 → 월로 바꿔도 남은 연간 기간엔 10권 그대로.
--   포인트: 기간권은 이어 사기를 포함해 모든 결제에 30%까지(운영자 2026-11-14). 판정 = private.class_subscription_points_allowed 한 곳.
--   환불 견적: class_subscription_refund_quote 가 전환(upgrade) 결제만 계산하던 것을 첫·이어 산 결제(first/renewal)까지 넓힌다
--     (전환 결제 계산은 한 글자도 안 바꾼다). 게시된 제6조: 7일 안 = 전액·포인트 전부 · 7일 뒤 월 = 환불 없음(기간 끝까지 이용) ·
--     7일 뒤 연간 = 카드 결제액 − 지난 개월 수(한 달 미만은 한 달, 런칭 선물 달은 세지 않음 = 최대 12) × 같은 요금제 월 요금, 0 밑 없음, 위약금 없음 ·
--     일부 환불의 포인트 = 카드 환불 비율만큼(class_subscription_points_refund 와 같은 계산).
--     기간권의 일부 환불(연간)은 구독을 끝낸다(settle) · 웹훅이 포인트를 비율만큼 돌려놓는다.
--   자동 결제·선물 구독이 살아 있으면 already_subscribed.
--
--   기존 함수는 손으로 옮기지 않는다 — 지금 정의를 읽어 앵커가 정확히 1곳일 때만 고치고, 이미 고쳐졌으면 건너뛴다.
--
--   되돌리기(기간권 행 0건일 때만):
--     drop function public.class_subscription_once_begin(uuid,text,text,integer,integer,integer,text,text,integer),
--       public.class_subscription_once_claim(uuid,text,text,integer), public.class_subscription_expiring(integer),
--       public.class_subscription_mark_reminded(uuid,timestamptz), private.class_subscription_points_allowed(uuid);
--     아래 ⑤ 치환들을 거꾸로(fail·settle·begin·summary·open_books·books_by_email — 각 블록이 넣은 줄 제거), 그 뒤
--     drop function private.class_subscription_effective_cycle(uuid,text);
--     alter table public.class_subscriptions drop column billing_mode, drop column reminded_period_end;
--     alter table public.class_subscription_payments drop column once_terms;

-- ── ① 칸 ──
alter table public.class_subscriptions add column if not exists billing_mode text not null default 'auto';
alter table public.class_subscriptions drop constraint if exists class_subscriptions_billing_mode_check;
alter table public.class_subscriptions add constraint class_subscriptions_billing_mode_check check (billing_mode in ('auto','once'));
alter table public.class_subscriptions add column if not exists reminded_period_end timestamptz;   -- 끝나기 전 안내를 보낸 기간
-- 기간권 결제가 정한 그 기간의 조건(주기·금액·약관). 자동 결제 행은 null.
alter table public.class_subscription_payments add column if not exists once_terms jsonb;

-- ── ② 판정 두 곳 ──
-- 포인트를 쓸 수 있는가(기간권 결제) — 운영자 2026-11-14: 기간권은 이어 사기를 포함해 모든 결제에 30%까지 쓸 수 있다.
--   규칙을 바꿀 때는 이 함수만 고친다(once_begin·summary 가 여기만 본다). 자동 결제(첫 결제·전환만, 자동 갱신엔 없음)는 이 함수와 무관 — 그대로.
create or replace function private.class_subscription_points_allowed(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
$$;

-- 같은 요금제의 월 구독 요금(연간 환불 공제에 쓴다) — 서버 금액 정본 src/class-subscription-pricing.mjs SUBSCRIPTION_PLANS 의 month 와 같은 값.
--   🔴 월 요금을 바꾸면 여기도 같이(SQL 에 다른 가격 정본이 없다).
create or replace function private.class_subscription_monthly_price(p_plan text) returns integer
language sql immutable set search_path = '' as $$
  select case p_plan when 'solo' then 9900 when 'together' then 14900 end
$$;
revoke all on function private.class_subscription_monthly_price(text) from public, anon, authenticated;
revoke all on function private.class_subscription_points_allowed(uuid) from public, anon, authenticated;

-- 지금 열리는 책의 주기 — 지금 시각을 덮는 결제된 기간권 결제의 주기, 없으면 구독 행의 주기(자동 결제는 늘 구독 행).
create or replace function private.class_subscription_effective_cycle(p_subscription_id uuid, p_cycle text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.once_terms ->> 'cycle' from public.class_subscription_payments p
     where p.subscription_id = p_subscription_id and p.status = 'paid' and p.once_terms is not null
       and p.period_start <= now() and p.period_end > now()
     order by p.period_start desc limit 1), p_cycle)
$$;
revoke all on function private.class_subscription_effective_cycle(uuid, text) from public, anon, authenticated;
grant execute on function private.class_subscription_effective_cycle(uuid, text) to authenticated, service_role;

-- ── ③ 주문 만들기 ──
create or replace function public.class_subscription_once_begin(
  p_user_id uuid, p_plan text, p_cycle text, p_amount integer, p_list_amount integer, p_owned_count integer,
  p_terms_version text, p_terms_url text, p_points integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sub public.class_subscriptions; v_order text; v_start timestamptz := now(); v_end timestamptz; v_kind text := 'first';
  v_points integer := coalesce(p_points, 0); v_member uuid; v_balance integer; v_bonus integer; v_from timestamptz;
begin
  if p_plan is null or p_plan not in ('solo','together') or p_cycle is null or p_cycle not in ('month','year') then
    return jsonb_build_object('ok', false, 'error', 'bad_plan'); end if;
  if p_amount is null or p_amount <= 0 or p_list_amount is null or p_list_amount < p_amount then
    return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  if coalesce(p_terms_version, '') = '' or coalesce(p_terms_url, '') = '' then return jsonb_build_object('ok', false, 'error', 'terms_changed'); end if;
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'login_required'); end if;
  -- 같은 회원의 동시 주문을 줄 세운다
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('class-subscription-once:' || p_user_id::text, 0));
  if v_points < 0 or v_points > floor(p_amount * 0.3 / 10) then return jsonb_build_object('ok', false, 'error', 'bad_points'); end if;
  if v_points > 0 and not private.class_subscription_points_allowed(p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'points_not_allowed'); end if;
  if v_points > 0 then
    v_member := private.class_subscription_member(p_user_id);
    if v_member is null then return jsonb_build_object('ok', false, 'error', 'points_short', 'balance', 0); end if;
    select coalesce(sum(t.amount), 0)::integer into v_balance from public.point_transactions t where t.user_id = v_member;
    if v_balance < v_points then return jsonb_build_object('ok', false, 'error', 'points_short', 'balance', v_balance); end if;
  end if;
  select * into v_sub from public.class_subscriptions where user_id = p_user_id and status in ('pending','active','past_due') for update;
  if found then
    -- 결과를 기다리는 주문(포인트를 잡았거나 토스 결제 키를 받은 것)이 있으면 새로 만들지 않는다 — 그 결제가 실제로 됐을 수 있다
    if v_sub.billing_key is not null
       or exists (select 1 from public.class_subscription_payments p where p.subscription_id = v_sub.id and p.status = 'ready'
                    and (p.payment_key is not null
                         or exists (select 1 from public.point_transactions t where t.reason = 'subscription' and t.ref_id = 'sub_pay:' || p.id))) then
      if v_sub.status <> 'pending' and (v_sub.billing_mode <> 'once' or v_sub.source <> 'paid') then
        return jsonb_build_object('ok', false, 'error', 'already_subscribed', 'periodEnd', v_sub.current_period_end); end if;
      return jsonb_build_object('ok', false, 'error', 'payment_pending');
    end if;
    if v_sub.status <> 'pending' then
      if v_sub.billing_mode <> 'once' or v_sub.source <> 'paid' then
        return jsonb_build_object('ok', false, 'error', 'already_subscribed', 'periodEnd', v_sub.current_period_end); end if;
      if v_sub.plan <> p_plan then
        return jsonb_build_object('ok', false, 'error', 'plan_fixed', 'plan', v_sub.plan, 'periodEnd', v_sub.current_period_end); end if;
      v_from := v_sub.current_period_end - interval '14 days';
      if v_sub.current_period_end is not null and now() < v_from then
        return jsonb_build_object('ok', false, 'error', 'too_early', 'renewableFrom', v_from, 'periodEnd', v_sub.current_period_end); end if;
      v_kind := 'renewal';
      v_start := greatest(coalesce(v_sub.current_period_end, now()), now());
      update public.class_subscription_payments set status = 'canceled', updated_at = now() where subscription_id = v_sub.id and status = 'ready';
    else
      -- 가입하다 만 행(자동 결제든 기간권이든) = 기간권으로 다시 쓴다
      update public.class_subscription_payments set status = 'canceled', updated_at = now() where subscription_id = v_sub.id and status = 'ready';
      update public.class_subscriptions set plan = p_plan, cycle = p_cycle, amount = p_amount, list_amount = p_list_amount,
        owned_count = p_owned_count, terms_version = p_terms_version, terms_url = p_terms_url,
        billing_mode = 'once', source = 'paid', cancel_requested_at = now(), next_charge_at = null, updated_at = now()
       where id = v_sub.id returning * into v_sub;
    end if;
  else
    insert into public.class_subscriptions (user_id, plan, cycle, amount, list_amount, owned_count, customer_key, terms_version, terms_url,
        billing_mode, source, billing_key, next_charge_at, cancel_requested_at)
    values (p_user_id, p_plan, p_cycle, p_amount, p_list_amount, p_owned_count, 'cus' || replace(gen_random_uuid()::text, '-', ''),
        p_terms_version, p_terms_url, 'once', 'paid', null, null, now())
    returning * into v_sub;
  end if;
  -- 런칭 선물(더 드리는 달) = 자동 결제와 같은 규칙 그대로(이미 결제한 적이 있으면 0)
  v_bonus := private.class_subscription_bonus_months(p_user_id, p_plan, p_cycle);
  v_end := (case when p_cycle = 'year' then v_start + interval '1 year' else v_start + interval '1 month' end) + make_interval(months => v_bonus);
  v_order := 'sub' || replace(gen_random_uuid()::text, '-', '');
  insert into public.class_subscription_payments (id, subscription_id, user_id, kind, amount, points_used, bonus_months, period_start, period_end, once_terms)
  values (v_order, v_sub.id, p_user_id, v_kind, p_amount - v_points * 10, v_points, v_bonus, v_start, v_end,
    jsonb_build_object('cycle', p_cycle, 'amount', p_amount, 'listAmount', p_list_amount, 'ownedCount', p_owned_count,
      'termsVersion', p_terms_version, 'termsUrl', p_terms_url));
  return jsonb_build_object('ok', true, 'subscriptionId', v_sub.id, 'customerKey', v_sub.customer_key, 'orderId', v_order,
    'plan', p_plan, 'cycle', p_cycle, 'amount', p_amount, 'cardAmount', p_amount - v_points * 10, 'usePoints', v_points,
    'bonusMonths', v_bonus, 'periodStart', v_start, 'periodEnd', v_end, 'renewal', v_kind = 'renewal');
end $$;

-- ── ④ 결제 키 묶기(토스 결제창이 돌아온 뒤, 승인 전에) — 웹훅·재확인이 이 키로 찾는다. 같은 키로 다시 불러도 같은 답. ──
create or replace function public.class_subscription_once_claim(p_user_id uuid, p_order_id text, p_payment_key text, p_amount integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pay public.class_subscription_payments; v_sub public.class_subscriptions;
begin
  select * into v_pay from public.class_subscription_payments where id = p_order_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  select * into v_sub from public.class_subscriptions where id = v_pay.subscription_id for update;
  if not found or v_sub.billing_mode <> 'once' or v_pay.once_terms is null then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if p_amount is distinct from v_pay.amount then return jsonb_build_object('ok', false, 'error', 'amount_mismatch', 'amount', v_pay.amount); end if;
  if coalesce(p_payment_key, '') = '' or length(p_payment_key) > 200 then return jsonb_build_object('ok', false, 'error', 'bad_payment'); end if;
  if v_pay.payment_key is not null and v_pay.payment_key <> p_payment_key then return jsonb_build_object('ok', false, 'error', 'payment_mismatch'); end if;
  if v_pay.status = 'paid' then
    return jsonb_build_object('ok', true, 'status', 'paid', 'orderId', v_pay.id, 'amount', v_pay.amount, 'periodEnd', v_pay.period_end); end if;
  if v_pay.status <> 'ready' or v_sub.status not in ('pending','active','past_due') then
    return jsonb_build_object('ok', false, 'error', 'order_closed'); end if;
  if v_pay.payment_key is null then
    if exists (select 1 from public.class_subscription_payments p where p.payment_key = p_payment_key and p.id <> v_pay.id) then
      return jsonb_build_object('ok', false, 'error', 'payment_mismatch'); end if;
    update public.class_subscription_payments set payment_key = p_payment_key, updated_at = now() where id = v_pay.id;
  end if;
  return jsonb_build_object('ok', true, 'status', 'ready', 'orderId', v_pay.id, 'amount', v_pay.amount, 'pointsUsed', v_pay.points_used,
    'plan', v_sub.plan, 'cycle', v_pay.once_terms ->> 'cycle', 'periodEnd', v_pay.period_end);
end $$;

-- ── ④-2 첫·이어 산 결제의 환불 견적(계산만, 쓰기 없음) — class_subscription_refund_quote 가 부른다(직접 부르는 길은 없다) ──
--   돌려주는 칸은 전환 결제 견적과 같은 이름 + monthsUsed·rule·cycle·periodStart·periodEnd·monthlyPrice·billingMode.
create or replace function private.class_subscription_refund_quote_plain(p_order_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_pay public.class_subscription_payments; v_sub public.class_subscriptions; v_cycle text; v_since timestamptz;
  v_days integer; v_within boolean; v_months integer := 0; v_monthly integer; v_mode text; v_refund integer; v_points integer;
  v_ends boolean; v_future boolean; v_rule text;
begin
  select * into v_pay from public.class_subscription_payments where id = p_order_id;
  if not found or v_pay.status <> 'paid' then return jsonb_build_object('ok', false, 'error', 'no_payment'); end if;
  select * into v_sub from public.class_subscriptions where id = v_pay.subscription_id;
  -- 그 결제가 산 주기(기간권은 결제마다 정한다 · 자동 결제는 구독 행)
  v_cycle := coalesce(v_pay.once_terms ->> 'cycle', v_sub.cycle);
  v_since := coalesce(v_pay.paid_at, v_pay.period_start);
  v_within := now() < v_since + interval '7 days';
  v_days := greatest(0, ceil(extract(epoch from (now() - v_pay.period_start)) / 86400)::integer);
  v_future := v_pay.period_start > now();   -- 아직 시작 안 한 이어 산 기간
  -- 지난 개월 수 = 기간 시작부터 달력으로 몇 달째인가(한 달 미만은 한 달) · 런칭 선물 달은 세지 않는다(산 기간 = 최대 12달)
  if not v_future then
    while v_pay.period_start + make_interval(months => v_months) < now() and v_months < 12 loop v_months := v_months + 1; end loop;
  end if;
  v_monthly := private.class_subscription_monthly_price(v_sub.plan);
  if v_within then
    v_mode := 'full'; v_rule := 'within_7_days_full'; v_refund := v_pay.amount; v_points := v_pay.points_used;
    v_ends := not (v_sub.billing_mode = 'once' and v_future);   -- 이어 산 기간만 되돌리면 앞 기간은 그대로
  elsif v_cycle = 'month' then
    v_mode := 'none'; v_rule := 'monthly_no_refund_after_7_days'; v_refund := 0; v_points := 0; v_ends := false;
  else
    v_rule := 'annual_minus_used_months';
    v_refund := greatest(0, v_pay.amount - v_months * v_monthly);
    v_mode := case when v_refund >= v_pay.amount then 'full' when v_refund > 0 then 'prorated' else 'none' end;
    v_points := case when v_pay.amount > 0 then floor(v_pay.points_used::numeric * v_refund / v_pay.amount)::integer else 0 end;
    v_ends := v_refund > 0 and not (v_sub.billing_mode = 'once' and v_future and v_mode = 'full');
  end if;
  return jsonb_build_object('ok', true, 'orderId', v_pay.id, 'kind', v_pay.kind, 'billingMode', v_sub.billing_mode, 'cycle', v_cycle,
    'periodStart', v_pay.period_start, 'periodEnd', v_pay.period_end, 'futurePeriod', v_future, 'bonusMonths', v_pay.bonus_months,
    'paidCard', v_pay.amount, 'pointsUsed', v_pay.points_used, 'daysUsed', v_days, 'monthsUsed', v_months, 'monthlyPrice', v_monthly,
    'withinDays7', v_within, 'mode', v_mode, 'rule', v_rule, 'refundCard', v_refund, 'pointsReturn', v_points, 'endsSubscription', v_ends);
end $$;
revoke all on function private.class_subscription_refund_quote_plain(text) from public, anon, authenticated;

-- ── ⑤ 기존 함수 고치기(앵커 치환) ──
do $patch$
declare v_def text; n int; a text; r text;
begin
  -- ⑤-1 fail: 기간권 결제 거절은 구독을 연체로 만들지 않는다(자동 결제 갱신 거절만 하루 뒤 다시·4번이면 끝)
  select pg_get_functiondef('public.class_subscription_fail(text,text)'::regprocedure) into v_def;
  if position('billing_mode' in v_def) = 0 then
    v_def := replace(v_def, E'\r\n', E'\n');
    a := E'if v_pay.kind in (''first'',''upgrade'') then return';
    r := E'if v_pay.kind in (''first'',''upgrade'') or exists (select 1 from public.class_subscriptions s0 where s0.id = v_pay.subscription_id and s0.billing_mode = ''once'') then return';
    n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
    if n <> 1 then raise exception 'class_subscription_fail anchor matched % times', n; end if;
    execute replace(v_def, a, r);
  end if;

  -- ⑤-2 settle: (가) 기간권 결제가 끝나면 그 결제가 정한 조건(주기·금액·약관)을 구독 행에 적는다
  --             (나) 아직 시작 안 한 이어 산 기간을 전액 환불하면 구독을 끝내지 않고 앞 기간 끝으로 되돌린다
  select pg_get_functiondef('public.class_subscription_settle(text,text,integer,text,integer)'::regprocedure) into v_def;
  if position('once_terms' in v_def) = 0 then
    v_def := replace(v_def, E'\r\n', E'\n');
    a := E'         where id = v_sub.id and (current_period_end is null or current_period_end < v_pay.period_end);\n';
    n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
    if n <> 1 then raise exception 'class_subscription_settle anchor A matched % times', n; end if;
    v_def := replace(v_def, a, a
      || E'        if v_pay.once_terms is not null then\n'
      || E'          update public.class_subscriptions set cycle = coalesce(v_pay.once_terms ->> ''cycle'', cycle),\n'
      || E'            amount = coalesce((v_pay.once_terms ->> ''amount'')::integer, amount), list_amount = coalesce((v_pay.once_terms ->> ''listAmount'')::integer, list_amount),\n'
      || E'            owned_count = coalesce((v_pay.once_terms ->> ''ownedCount'')::integer, owned_count),\n'
      || E'            terms_version = coalesce(v_pay.once_terms ->> ''termsVersion'', terms_version), terms_url = coalesce(v_pay.once_terms ->> ''termsUrl'', terms_url),\n'
      || E'            updated_at = now()\n'
      || E'           where id = v_sub.id and current_period_end = v_pay.period_end;\n'
      || E'        end if;\n');
    a := E'    elsif p_status = ''CANCELED'' and v_current then\n';
    n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
    if n <> 1 then raise exception 'class_subscription_settle anchor B matched % times', n; end if;
    v_def := replace(v_def, a,
         E'    elsif p_status = ''CANCELED'' and v_current and v_sub.billing_mode = ''once'' and v_pay.status = ''paid'' and v_pay.period_start > now()\n'
      || E'          and v_sub.status in (''active'',''past_due'') then\n'
      || E'      -- 기간권: 아직 시작 안 한 이어 산 기간의 전액 환불 = 앞 기간 끝으로 되돌린다(앞 기간은 그대로 이용)\n'
      || E'      update public.class_subscriptions s set current_period_end = v_pay.period_start,\n'
      || E'        current_period_start = coalesce((select max(p.period_start) from public.class_subscription_payments p\n'
      || E'          where p.subscription_id = s.id and p.status = ''paid'' and p.period_start < v_pay.period_start), s.current_period_start),\n'
      || E'        cycle = coalesce((select p.once_terms ->> ''cycle'' from public.class_subscription_payments p\n'
      || E'          where p.subscription_id = s.id and p.status = ''paid'' and p.period_start < v_pay.period_start order by p.period_start desc limit 1), s.cycle),\n'
      || E'        updated_at = now()\n'
      || E'       where s.id = v_sub.id;\n'
      || E'    elsif p_status = ''PARTIAL_CANCELED'' and v_current and v_sub.billing_mode = ''once'' and v_sub.status in (''active'',''past_due'') then\n'
      || E'      -- 기간권 연간의 일부 환불(지난 개월 수만큼 빼고) = 구독 종료(제6조). 자동 결제의 부분 취소는 예전처럼 기록만.\n'
      || E'      update public.class_subscriptions set status = ''canceled'', ended_at = now(), next_charge_at = null,\n'
      || E'        current_period_end = least(current_period_end, now()), updated_at = now() where id = v_sub.id;\n'
      || a);
    execute v_def;
  end if;

  -- ⑤-6 refund_quote: 전환(upgrade)이 아닌 결제(first/renewal)도 계산한다 — 'not_upgrade' 로 돌려보내던 한 줄만 바꾼다(전환 계산은 그대로).
  select pg_get_functiondef('public.class_subscription_refund_quote(uuid)'::regprocedure) into v_def;
  if position('refund_quote_plain' in v_def) = 0 then
    v_def := replace(v_def, E'\r\n', E'\n');
    a := E'if v_pay.kind <> ''upgrade'' then return jsonb_build_object(''ok'', false, ''error'', ''not_upgrade''); end if;';
    n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
    if n <> 1 then raise exception 'class_subscription_refund_quote anchor matched % times', n; end if;
    execute replace(v_def, a, E'if v_pay.kind <> ''upgrade'' then return private.class_subscription_refund_quote_plain(v_pay.id); end if;');
  end if;

  -- ⑤-3 begin(자동 결제): 가입하다 만 행을 다시 쓸 때 자동 결제 모양으로 되돌린다(기간권으로 시작했다 만 행일 수 있다).
  --   자동 결제로 만든 가입하다 만 행은 원래 auto·해지 예약 없음이라 동작이 그대로다.
  select pg_get_functiondef('public.class_subscription_begin(uuid,text,text,integer,integer,integer,text,text,integer)'::regprocedure) into v_def;
  if position('billing_mode' in v_def) = 0 then
    v_def := replace(v_def, E'\r\n', E'\n');
    a := 'owned_count = p_owned_count, terms_version = p_terms_version, terms_url = p_terms_url, updated_at = now()';
    n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
    if n <> 1 then raise exception 'class_subscription_begin anchor matched % times', n; end if;
    execute replace(v_def, a, 'owned_count = p_owned_count, terms_version = p_terms_version, terms_url = p_terms_url, billing_mode = ''auto'', cancel_requested_at = null, updated_at = now()');
  end if;

  -- ⑤-4 summary: billingMode · renewableFrom(기간권 = 끝나기 14일 전) · pointsAllowed
  select pg_get_functiondef('public.class_subscription_summary(uuid)'::regprocedure) into v_def;
  if position('billingMode' in v_def) = 0 then
    v_def := replace(v_def, E'\r\n', E'\n');
    a := '''source'', s.source)';
    n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
    if n <> 1 then raise exception 'class_subscription_summary anchor A matched % times (gift 판이 먼저 있어야 한다)', n; end if;
    v_def := replace(v_def, a, '''source'', s.source, ''billingMode'', s.billing_mode, '
      || '''renewableFrom'', case when s.billing_mode = ''once'' and s.current_period_end is not null then s.current_period_end - interval ''14 days'' end)');
    a := '''ownedTheory'', coalesce(';
    n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
    if n <> 1 then raise exception 'class_subscription_summary anchor B matched % times', n; end if;
    v_def := replace(v_def, a, '''pointsAllowed'', private.class_subscription_points_allowed(p_user_id), ' || a);
    execute v_def;
  end if;

  -- ⑤-5 열리는 책: 구독 행의 주기 대신 '지금 시각을 덮는 결제'의 주기(자동 결제는 같은 값)
  foreach r in array array['private.class_subscription_open_books(uuid)', 'public.class_subscription_books_by_email(text)'] loop
    select pg_get_functiondef(r::regprocedure) into v_def;
    if position('effective_cycle' in v_def) = 0 then
      v_def := replace(v_def, E'\r\n', E'\n');
      a := 'private.class_subscription_books(s.cycle)';
      n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
      if n <> 1 then raise exception '% anchor matched % times', r, n; end if;
      execute replace(v_def, a, 'private.class_subscription_books(private.class_subscription_effective_cycle(s.id, s.cycle))');
    end if;
  end loop;
end $patch$;

-- ── ⑥ 끝나기 전 안내(기간권·선물) — 보낼 대상과 '보냈다' 표시. 메일 발송은 따로(20261114110000). ──
create or replace function public.class_subscription_expiring(p_days integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('subscriptionId', s.id, 'userId', s.user_id, 'email', u.email, 'plan', s.plan,
      'cycle', s.cycle, 'source', s.source, 'billingMode', s.billing_mode, 'periodEnd', s.current_period_end)
      order by s.current_period_end), '[]'::jsonb)
    from public.class_subscriptions s join auth.users u on u.id = s.user_id
   where s.status in ('active','past_due') and (s.billing_mode = 'once' or s.source = 'gift')
     and s.current_period_end > now()
     and s.current_period_end <= now() + make_interval(days => greatest(0, least(coalesce(p_days, 7), 60)))
     and s.reminded_period_end is distinct from s.current_period_end
$$;

create or replace function public.class_subscription_mark_reminded(p_subscription_id uuid, p_period_end timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_end timestamptz;
begin
  update public.class_subscriptions set reminded_period_end = current_period_end, updated_at = now()
   where id = p_subscription_id and (p_period_end is null or current_period_end = p_period_end)
  returning reminded_period_end into v_end;
  return jsonb_build_object('ok', found, 'periodEnd', v_end);
end $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.class_subscription_once_begin(uuid,text,text,integer,integer,integer,text,text,integer)',
    'public.class_subscription_once_claim(uuid,text,text,integer)',
    'public.class_subscription_expiring(integer)',
    'public.class_subscription_mark_reminded(uuid,timestamptz)',
    'public.class_subscription_fail(text,text)',
    'public.class_subscription_settle(text,text,integer,text,integer)',
    'public.class_subscription_begin(uuid,text,text,integer,integer,integer,text,text,integer)',
    'public.class_subscription_summary(uuid)',
    'public.class_subscription_books_by_email(text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- 열리는 책 판정은 회원 권한(check_my_class_access)으로도 불린다 — 원래 권한 그대로
  revoke all on function private.class_subscription_open_books(uuid) from public, anon;
  grant execute on function private.class_subscription_open_books(uuid) to authenticated, service_role;
end $grants$;
