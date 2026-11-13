-- 구독 안내 메일 — 결제 완료 · 환불 완료 · 끝나기 전 안내(기간권·선물). 🔴 아직 적용하지 않는다(20261114100000 뒤에).
--   모양은 클래스 결제 메일(20261012155826_class_checkout_email_outbox)과 같다: DB 가 보낼 줄(outbox)을 쌓고, Worker 가
--   class_subscription_email_claim 으로 한 줄씩 가져가 Resend 로 보낸다(같은 줄은 같은 Idempotency-Key — 두 번 가지 않는다).
--   🔴 발송 스위치 = Worker 변수 CLASS_SUBSCRIPTION_MAIL_ENABLED === 'true'. 꺼져 있으면 줄은 쌓여도 아무것도 안 나간다.
--      나중에 켰을 때 묵은 줄이 한꺼번에 나가지 않게, 만든 지 3일이 지나도록 한 번도 시도 안 한 줄은 'skipped' 로 닫는다.
--   한 사건에 한 줄: dedup_key unique —
--     결제 완료 = 'paid:<주문>' · 환불 = 'refund:<주문>:<누적 환불액>' · 끝나기 전 안내 = 'reminder:<구독>:<기간 끝(epoch)>'.
--   메일 내용(금액·기간·포인트)은 보낼 때 DB 를 다시 읽어 만든다(claim 이 facts 로 돌려준다). 한 번 만든 봉투는 저장해 재시도에 그대로 쓴다.
--   되돌리기: drop trigger trg_class_subscription_enqueue_email on public.class_subscription_payments;
--     drop function private.class_subscription_enqueue_email(), public.class_subscription_email_claim(text),
--       public.class_subscription_email_queue_reminders(integer); drop table public.class_subscription_email_outbox;

create table if not exists public.class_subscription_email_outbox (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('paid','refund','reminder')),
  dedup_key        text not null unique,
  user_id          uuid not null,
  subscription_id  uuid references public.class_subscriptions(id) on delete cascade,
  payment_id       text references public.class_subscription_payments(id) on delete cascade,
  period_end       timestamptz,          -- 끝나기 전 안내: 안내한 기간의 끝
  refund_amount    integer,              -- 환불: 이 결제의 누적 환불액(카드)
  status           text not null default 'pending' check (status in ('pending','processing','accepted','failed','review','canceled','skipped')),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  first_attempt_at timestamptz,
  lease_token      uuid,
  lease_until      timestamptz,
  envelope         jsonb,
  provider_email_id text,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.class_subscription_email_outbox enable row level security;
revoke all on public.class_subscription_email_outbox from public, anon, authenticated;
grant select, insert, update on public.class_subscription_email_outbox to service_role;
create index if not exists class_subscription_email_pending on public.class_subscription_email_outbox (next_attempt_at)
  where status in ('pending','processing');

-- 결제 행이 바뀔 때 줄을 쌓는다(결제 완료 · 전액/부분 환불). 결제 전에 닫힌 주문(ready → canceled)은 메일 없음.
create or replace function private.class_subscription_enqueue_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    insert into public.class_subscription_email_outbox (kind, dedup_key, user_id, subscription_id, payment_id)
    values ('paid', 'paid:' || new.id, new.user_id, new.subscription_id, new.id) on conflict (dedup_key) do nothing;
  elsif new.status = 'canceled' and old.status = 'paid' then
    -- 전액 환불 — 아직 안 나간 결제 완료 메일은 닫는다. 포인트 반환(Worker 가 settle 바로 뒤에 한다)을 기다려 1분 뒤에.
    update public.class_subscription_email_outbox set status = 'canceled', lease_token = null, lease_until = null, updated_at = now()
     where payment_id = new.id and kind = 'paid' and status in ('pending','processing','failed','review');
    insert into public.class_subscription_email_outbox (kind, dedup_key, user_id, subscription_id, payment_id, refund_amount, next_attempt_at)
    values ('refund', 'refund:' || new.id || ':' || new.amount, new.user_id, new.subscription_id, new.id, new.amount, now() + interval '1 minute')
    on conflict (dedup_key) do nothing;
  elsif new.status = 'paid' and coalesce(new.canceled_amount, 0) > coalesce(old.canceled_amount, 0) then
    -- 부분 환불(월 → 연간 전환 결제의 일할 환불 등) — 누적 환불액이 바뀔 때마다 한 통
    insert into public.class_subscription_email_outbox (kind, dedup_key, user_id, subscription_id, payment_id, refund_amount, next_attempt_at)
    values ('refund', 'refund:' || new.id || ':' || new.canceled_amount, new.user_id, new.subscription_id, new.id, new.canceled_amount, now() + interval '1 minute')
    on conflict (dedup_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.class_subscription_enqueue_email() from public, anon, authenticated;
drop trigger if exists trg_class_subscription_enqueue_email on public.class_subscription_payments;
create trigger trg_class_subscription_enqueue_email after update of status, canceled_amount on public.class_subscription_payments
  for each row execute function private.class_subscription_enqueue_email();

-- 끝나기 전 안내 줄 쌓기(크론이 부른다 — 발송 스위치가 켜져 있을 때만). 같은 기간은 한 번만(dedup_key + reminded_period_end).
create or replace function public.class_subscription_email_queue_reminders(p_days integer default 7) returns integer
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_n integer := 0; v_end timestamptz;
begin
  for r in select * from jsonb_array_elements(public.class_subscription_expiring(p_days)) loop
    v_end := (r ->> 'periodEnd')::timestamptz;
    insert into public.class_subscription_email_outbox (kind, dedup_key, user_id, subscription_id, period_end)
    values ('reminder', 'reminder:' || (r ->> 'subscriptionId') || ':' || floor(extract(epoch from v_end))::bigint,
      (r ->> 'userId')::uuid, (r ->> 'subscriptionId')::uuid, v_end)
    on conflict (dedup_key) do nothing;
    if found then v_n := v_n + 1; end if;
    perform public.class_subscription_mark_reminded((r ->> 'subscriptionId')::uuid, v_end);
  end loop;
  return v_n;
end $$;

-- 보낼 줄 하나 가져가기 — 결제 메일 claim 과 같은 규칙(23시간 재시도 창 · 10번 · 3분 임대). 낡거나 뜻이 없어진 줄은 닫고 다음 줄로.
create or replace function public.class_subscription_email_claim(p_payment_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.class_subscription_email_outbox; s public.class_subscriptions; p public.class_subscription_payments;
  v_email text; v_member uuid; v_kept integer; v_facts jsonb;
begin
  -- Resend 중복 막기는 24시간뿐: 애매한 오래된 시도는 사람이 본다
  update public.class_subscription_email_outbox set status = 'review', last_error = 'retry_window_expired', updated_at = now()
   where status in ('pending','processing') and (lease_until is null or lease_until < now())
     and (first_attempt_at < now() - interval '23 hours' or attempts >= 10);
  -- 스위치가 꺼진 동안 쌓여 한 번도 시도 안 한 3일 넘은 줄 = 보내지 않는다
  update public.class_subscription_email_outbox set status = 'skipped', last_error = 'stale', updated_at = now()
   where status = 'pending' and attempts = 0 and created_at < now() - interval '3 days';
  loop
    select e.* into j from public.class_subscription_email_outbox e
     where e.status in ('pending','processing') and e.next_attempt_at <= now()
       and (e.lease_until is null or e.lease_until < now()) and (p_payment_id is null or e.payment_id = p_payment_id)
     order by e.created_at for update skip locked limit 1;
    if not found then return null; end if;
    select * into s from public.class_subscriptions where id = j.subscription_id;
    select lower(u.email) into v_email from auth.users u where u.id = j.user_id;
    select * into p from public.class_subscription_payments where id = j.payment_id;   -- payment_id 가 null 이면 빈 값
    -- 뜻이 없어진 줄: 구독·회원이 없다 · 결제 완료인데 결제가 아니다 · 안내한 기간이 바뀌었거나(이어 샀다) 끝났다
    if s.id is null or v_email is null
       or (j.kind = 'paid' and (p.id is null or p.status <> 'paid'))
       or (j.kind = 'refund' and p.id is null)
       or (j.kind = 'reminder' and (s.status not in ('active','past_due') or s.current_period_end is distinct from j.period_end or s.current_period_end <= now())) then
      update public.class_subscription_email_outbox set status = 'skipped', last_error = 'no_longer_relevant', lease_token = null, lease_until = null, updated_at = now()
       where id = j.id;
      continue;
    end if;
    v_kept := 0;
    if p.id is not null and p.points_used > 0 then
      v_member := private.class_subscription_member(p.user_id);
      select coalesce(-sum(t.amount), 0)::integer into v_kept from public.point_transactions t
       where t.user_id = v_member and t.reason = 'subscription' and t.ref_id = 'sub_pay:' || p.id;
    end if;
    v_facts := jsonb_build_object('kind', j.kind, 'email', v_email, 'plan', s.plan,
      'cycle', coalesce(p.once_terms ->> 'cycle', s.cycle), 'source', s.source, 'billingMode', s.billing_mode,
      'subscriptionStatus', s.status, 'subscriptionPeriodEnd', s.current_period_end, 'nextChargeAt', s.next_charge_at,
      'orderId', p.id, 'paymentKind', p.kind, 'periodStart', p.period_start, 'periodEnd', coalesce(j.period_end, p.period_end),
      'amount', p.amount, 'pointsUsed', coalesce(p.points_used, 0), 'bonusMonths', coalesce(p.bonus_months, 0), 'paidAt', p.paid_at,
      'refundAmount', j.refund_amount, 'pointsReturned', greatest(coalesce(p.points_used, 0) - greatest(v_kept, 0), 0),
      'fullRefund', p.status = 'canceled');
    update public.class_subscription_email_outbox set status = 'processing', attempts = attempts + 1,
      first_attempt_at = coalesce(first_attempt_at, now()), lease_token = gen_random_uuid(), lease_until = now() + interval '3 minutes', updated_at = now()
     where id = j.id returning * into j;
    return jsonb_build_object('job', to_jsonb(j), 'facts', v_facts);
  end loop;
end $$;

do $grants$
declare f text;
begin
  foreach f in array array['public.class_subscription_email_claim(text)', 'public.class_subscription_email_queue_reminders(integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;
