-- 구독 → 올인원 소장 전환 차감(운영자 2026-11-12 확정). 🔴 아직 적용하지 않는다 — 20261112100000 뒤에, 구독 결제를 여는 날 같이.
--   전환가 = 398,000 − 50,000 × 소장 권수 − 2026-12-31(KST)까지 낸 구독료(취소분 제외). 0원 밑으로 내려가지 않는다. 기한이 지나면 차감 0.
--   올인원 주문서는 class_checkout_prepare 가 class_checkout_quote 의 amount 를 그대로 쓴다 → quote 한 곳만 고치면 결제 금액까지 따라온다.
--   본문을 손으로 옮기지 않고 지금 정의를 읽어 세 군데를 덧붙인다(앵커가 정확히 1곳이 아니면 전체가 되돌아간다).

do $patch$
declare v_def text; v_new text;
  a1 text := E'  v_n int;\nbegin';
  a2 text := E'  v_n := cardinality(v_owned);';
  a3 text := E'''amount'',greatest(398000-v_n*50000,0),';
  n int;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'class_checkout_quote';
  if position('subscriptionCredit' in v_def) > 0 then return; end if;
  v_def := replace(v_def, E'\r\n', E'\n');
  foreach v_new in array array[a1, a2, a3] loop
    n := (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new);
    if n <> 1 then raise exception 'class_checkout_quote anchor "%" matched % times', left(v_new, 30), n; end if;
  end loop;
  v_def := replace(v_def, a1, E'  v_n int;\n  v_sub int := 0;\nbegin');
  v_def := replace(v_def, a2, a2 || E'\n  -- 구독으로 낸 금액만큼 차감(12월 31일 KST 까지 낸 것 · 그날까지만)\n'
    || E'  if (now() at time zone ''Asia/Seoul'')::date <= date ''2026-12-31'' then\n'
    || E'    select coalesce(sum(greatest(sp.amount - sp.canceled_amount, 0)), 0)::int into v_sub\n'
    || E'      from public.class_subscription_payments sp\n'
    || E'     where sp.user_id = p_user_id and sp.paid_at is not null and (sp.paid_at at time zone ''Asia/Seoul'')::date <= date ''2026-12-31'';\n'
    || E'    v_sub := least(v_sub, greatest(398000-v_n*50000,0));\n'
    || E'  end if;');
  v_def := replace(v_def, a3, E'''amount'',greatest(398000-v_n*50000,0)-v_sub,''subscriptionCredit'',v_sub,');
  execute v_def;
end $patch$;

-- 올인원 소장 결제가 끝나면 구독의 다음 결제를 멈춘다(낸 기간 끝까지는 그대로 이용).
create or replace function private.class_subscription_stop_on_ownership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' and (old.status is distinct from 'paid') and new.product_code = 'class-stella-member-upgrade' then
    update public.class_subscriptions set cancel_requested_at = coalesce(cancel_requested_at, now()), next_charge_at = null, updated_at = now()
     where user_id = new.user_id and status in ('active','past_due');
  end if;
  return new;
end $$;
drop trigger if exists trg_class_subscription_stop_on_ownership on public.class_checkout_orders;
create trigger trg_class_subscription_stop_on_ownership after update of status on public.class_checkout_orders
  for each row execute function private.class_subscription_stop_on_ownership();

-- 되돌리기: drop trigger … ; drop function private.class_subscription_stop_on_ownership();
--   class_checkout_quote 는 위 세 치환을 거꾸로(v_sub 선언·계산 블록·'subscriptionCredit' 항목 제거).
