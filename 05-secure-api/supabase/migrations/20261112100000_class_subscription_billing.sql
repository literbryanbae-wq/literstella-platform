-- 구독 정기결제(토스 빌링) — 표·함수 초안. 🔴 아직 적용하지 않는다(토스 빌링 심사 통과 + 운영자 승인 뒤).
--   서버 = 05-secure-api/src/class-subscription.mjs · 금액 계산 정본 = src/class-subscription-pricing.mjs
--   원칙: ① 빌링키·결제 기록은 service_role 만 본다(RLS 켜고 정책 0) ② 결제 한 건 = 주문 번호 한 개(같은 번호로 두 번 청구 못 함)
--        ③ 해지 = 다음 결제만 멈춤, 낸 기간 끝까지 이용 ④ 강의 열림은 check_my_class_access 한 줄(무료 이용과 같은 모양)
--   되돌리기: 맨 아래 주석.

create table if not exists public.class_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  plan                 text not null check (plan in ('solo','together')),
  cycle                text not null check (cycle in ('month','year')),
  status               text not null default 'pending' check (status in ('pending','active','past_due','canceled','expired')),
  customer_key         text not null unique,
  billing_key          text,
  amount               integer not null check (amount > 0),        -- 다음 결제에도 쓰는 금액(가입 때 확정)
  list_amount          integer not null check (list_amount >= amount),
  owned_count          integer not null default 0,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  next_charge_at       timestamptz,
  cancel_requested_at  timestamptz,
  ended_at             timestamptz,
  retry_count          integer not null default 0,
  terms_version        text not null,
  terms_url            text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- 한 회원에 살아 있는 구독은 하나
create unique index if not exists class_subscriptions_one_live on public.class_subscriptions (user_id) where status in ('pending','active','past_due');
create index if not exists class_subscriptions_due on public.class_subscriptions (next_charge_at) where status in ('active','past_due');

create table if not exists public.class_subscription_payments (
  id              text primary key check (id ~ '^sub[a-f0-9]{32}$'),   -- 토스 orderId
  subscription_id uuid not null references public.class_subscriptions(id) on delete cascade,
  user_id         uuid not null,
  kind            text not null check (kind in ('first','renewal')),
  amount          integer not null check (amount > 0),
  status          text not null default 'ready' check (status in ('ready','paid','failed','canceled')),
  payment_key     text unique,
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  paid_at         timestamptz,
  canceled_amount integer not null default 0,
  failure_code    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists class_subscription_payments_sub on public.class_subscription_payments (subscription_id, created_at desc);
-- 같은 기간을 두 번 청구하지 않는다
create unique index if not exists class_subscription_payments_period on public.class_subscription_payments (subscription_id, period_start) where status in ('ready','paid');

alter table public.class_subscriptions enable row level security;
alter table public.class_subscription_payments enable row level security;
revoke all on public.class_subscriptions, public.class_subscription_payments from anon, authenticated;

-- ── 구독으로 열리는 책 ──────────────────────────────────────────────
--   연간 = 오리지널 7 + 핵심 이론 + 오즈 + 어린 왕자 · 월 = 오리지널 7 + 핵심 이론(운영자 2026-11-09)
create or replace function private.class_subscription_books(p_cycle text) returns text[]
language sql immutable set search_path = '' as $$
  select case when p_cycle = 'year'
    then array['kidari','anne','littlewomen1','littlewomen2','pride','sherlock','gatsby','theory','oz','littleprince']
    else array['kidari','anne','littlewomen1','littlewomen2','pride','sherlock','gatsby','theory'] end
$$;

create or replace function private.class_subscription_open_books(p_uid uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.class_subscription_books(s.cycle)
      from public.class_subscriptions s
     where s.user_id = p_uid and s.status in ('active','past_due') and s.current_period_end > now()
     limit 1
  ), array[]::text[])
$$;
revoke all on function private.class_subscription_open_books(uuid) from public, anon;
grant execute on function private.class_subscription_open_books(uuid) to authenticated, service_role;

-- check_my_class_access 에 한 줄 — 본문을 손으로 옮기지 않고 지금 정의를 읽어 덧붙인다(앵커가 정확히 1곳일 때만).
do $patch$
declare v_def text; v_anchor text := 'or ($1 = any(private.class_trial_open_books(auth.uid())))'; v_n int;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_my_class_access';
  if position('class_subscription_open_books' in v_def) > 0 then return; end if;   -- 이미 들어 있으면 건너뜀
  v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_n <> 1 then raise exception 'check_my_class_access anchor matched % times', v_n; end if;
  execute replace(v_def, v_anchor, v_anchor || E'\n    or ($1 = any(private.class_subscription_open_books(auth.uid())))');
end $patch$;

-- ── 가입 시작: 구독 행 + 첫 결제 주문 ─────────────────────────────────
create or replace function public.class_subscription_begin(
  p_user_id uuid, p_plan text, p_cycle text, p_amount integer, p_list_amount integer, p_owned_count integer,
  p_terms_version text, p_terms_url text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sub public.class_subscriptions; v_order text; v_start timestamptz := now(); v_end timestamptz;
begin
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'login_required'); end if;
  select * into v_sub from public.class_subscriptions where user_id = p_user_id and status in ('pending','active','past_due') for update;
  if found and v_sub.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'already_subscribed'); end if;
  if found then
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
  insert into public.class_subscription_payments (id, subscription_id, user_id, kind, amount, period_start, period_end)
  values (v_order, v_sub.id, p_user_id, 'first', p_amount, v_start, v_end);
  return jsonb_build_object('ok', true, 'subscriptionId', v_sub.id, 'customerKey', v_sub.customer_key, 'orderId', v_order, 'amount', p_amount);
end $$;

create or replace function public.class_subscription_attach_key(p_subscription_id uuid, p_billing_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.class_subscriptions set billing_key = p_billing_key, updated_at = now()
   where id = p_subscription_id and status in ('pending','active','past_due');
  return jsonb_build_object('ok', found);
end $$;

-- ── 결제 결과 반영(여러 번 불러도 같은 결과) ───────────────────────────
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
      update public.class_subscriptions set status = 'active', retry_count = 0,
        current_period_start = v_pay.period_start, current_period_end = v_pay.period_end,
        next_charge_at = case when cancel_requested_at is null then v_pay.period_end else null end, updated_at = now()
       where id = v_sub.id and (current_period_end is null or current_period_end < v_pay.period_end);
    end if;
    return jsonb_build_object('ok', true, 'status', 'paid', 'orderId', p_order_id, 'periodEnd', v_pay.period_end);
  elsif p_status in ('CANCELED','PARTIAL_CANCELED') then
    update public.class_subscription_payments set status = case when p_status = 'CANCELED' then 'canceled' else status end,
      payment_key = p_payment_key, canceled_amount = greatest(canceled_amount, coalesce(p_canceled_amount, 0)), updated_at = now() where id = p_order_id;
    if p_status = 'CANCELED' and v_sub.current_period_start = v_pay.period_start then
      -- 지금 기간의 결제가 전액 취소됨 = 이용 종료
      update public.class_subscriptions set status = 'canceled', ended_at = now(), next_charge_at = null,
        current_period_end = least(current_period_end, now()), updated_at = now() where id = v_sub.id;
    end if;
    return jsonb_build_object('ok', true, 'status', 'canceled', 'orderId', p_order_id);
  end if;
  return jsonb_build_object('ok', false, 'error', 'payment_pending');
end $$;

-- 청구 실패 — 하루 뒤 다시, 4번 실패하면 끝(낸 기간까지는 이용)
create or replace function public.class_subscription_fail(p_order_id text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pay public.class_subscription_payments; v_retry int;
begin
  update public.class_subscription_payments set status = 'failed', failure_code = left(coalesce(p_code, ''), 80), updated_at = now()
   where id = p_order_id and status = 'ready' returning * into v_pay;
  if not found then return jsonb_build_object('ok', false); end if;
  if v_pay.kind = 'first' then return jsonb_build_object('ok', true, 'status', 'failed'); end if;
  update public.class_subscriptions set retry_count = retry_count + 1,
    status = case when retry_count + 1 >= 4 then 'expired' else 'past_due' end,
    next_charge_at = case when retry_count + 1 >= 4 then null else now() + interval '1 day' end,
    ended_at = case when retry_count + 1 >= 4 then now() else ended_at end, updated_at = now()
   where id = v_pay.subscription_id returning retry_count into v_retry;
  return jsonb_build_object('ok', true, 'status', 'failed', 'retry', v_retry);
end $$;

-- 오늘 청구할 구독 — 주문 번호를 먼저 만들고 돌려준다(같은 기간 두 번 못 만든다).
create or replace function public.class_subscription_due(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_order text; v_end timestamptz; v_out jsonb := '[]'::jsonb;
begin
  for r in select * from public.class_subscriptions
            where status in ('active','past_due') and cancel_requested_at is null and billing_key is not null
              and next_charge_at is not null and next_charge_at <= now()
            order by next_charge_at limit greatest(1, least(coalesce(p_limit, 20), 100)) for update skip locked
  loop
    v_end := case when r.cycle = 'year' then r.current_period_end + interval '1 year' else r.current_period_end + interval '1 month' end;
    select id into v_order from public.class_subscription_payments
     where subscription_id = r.id and period_start = r.current_period_end and status = 'ready';
    if v_order is null then
      -- 실패한 주문 번호는 다시 쓰지 않는다(토스는 같은 orderId 재사용을 거절한다)
      v_order := 'sub' || replace(gen_random_uuid()::text, '-', '');
      insert into public.class_subscription_payments (id, subscription_id, user_id, kind, amount, period_start, period_end)
      values (v_order, r.id, r.user_id, 'renewal', r.amount, r.current_period_end, v_end);
    end if;
    update public.class_subscriptions set next_charge_at = now() + interval '1 hour', updated_at = now() where id = r.id; -- 겹쳐 돌지 않게
    v_out := v_out || jsonb_build_object('orderId', v_order, 'subscriptionId', r.id, 'userId', r.user_id,
      'billingKey', r.billing_key, 'customerKey', r.customer_key, 'amount', r.amount, 'plan', r.plan, 'cycle', r.cycle);
  end loop;
  return v_out;
end $$;

-- 해지 — 다음 결제만 멈춘다. 낸 기간 끝까지 이용.
create or replace function public.class_subscription_cancel(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sub public.class_subscriptions;
begin
  update public.class_subscriptions set cancel_requested_at = coalesce(cancel_requested_at, now()), next_charge_at = null, updated_at = now()
   where user_id = p_user_id and status in ('active','past_due') returning * into v_sub;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_subscription'); end if;
  return jsonb_build_object('ok', true, 'periodEnd', v_sub.current_period_end);
end $$;

-- 기간이 끝난 해지 구독 정리(매일 크론)
create or replace function public.class_subscription_expire() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.class_subscriptions set status = 'canceled', ended_at = now(), updated_at = now()
   where status in ('active','past_due') and cancel_requested_at is not null and current_period_end <= now();
  get diagnostics v_n = row_count;
  delete from public.class_subscriptions where status = 'pending' and created_at < now() - interval '2 days';
  return v_n;
end $$;

-- 서버가 읽는 요약(상태·낸 금액 — 전환 차감 계산용)
create or replace function public.class_subscription_summary(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'subscription', (select jsonb_build_object('id', s.id, 'plan', s.plan, 'cycle', s.cycle, 'status', s.status, 'amount', s.amount,
        'periodEnd', s.current_period_end, 'nextChargeAt', s.next_charge_at, 'cancelRequested', s.cancel_requested_at is not null)
      from public.class_subscriptions s where s.user_id = p_user_id order by (s.status in ('active','past_due')) desc, s.created_at desc limit 1),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('orderId', p.id, 'amount', p.amount, 'paidAt', p.paid_at,
        'canceledAmount', p.canceled_amount, 'kind', p.kind) order by p.paid_at)
      from public.class_subscription_payments p where p.user_id = p_user_id and p.paid_at is not null), '[]'::jsonb),
    'ownedOriginals', (select private.class_owned_originals(u.email) from auth.users u where u.id = p_user_id))
$$;

-- 회원 본인 화면용(빌링키·결제 키는 주지 않는다)
create or replace function public.my_class_subscription() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then jsonb_build_object('ok', false, 'error', 'login_required')
    else jsonb_build_object('ok', true) || (public.class_subscription_summary(auth.uid()) - 'ownedOriginals') end
$$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.class_subscription_begin(uuid,text,text,integer,integer,integer,text,text)',
    'public.class_subscription_attach_key(uuid,text)',
    'public.class_subscription_settle(text,text,integer,text,integer)',
    'public.class_subscription_fail(text,text)',
    'public.class_subscription_due(integer)',
    'public.class_subscription_cancel(uuid)',
    'public.class_subscription_expire()',
    'public.class_subscription_summary(uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  revoke all on function public.my_class_subscription() from public, anon;
  grant execute on function public.my_class_subscription() to authenticated, service_role;
end $grants$;

-- 되돌리기(구독 0건일 때만):
--   check_my_class_access 에서 class_subscription_open_books 한 줄을 빼고(위 do 블록의 반대 치환),
--   drop function public.my_class_subscription(), public.class_subscription_summary(uuid), ... ; drop table public.class_subscription_payments, public.class_subscriptions;
