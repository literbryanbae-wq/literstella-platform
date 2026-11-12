-- 강의 서버(class-gate)가 구독 회원의 책 목록을 묻는 함수. 🔴 아직 적용하지 않는다 — 20261112100000 과 같은 날.
--   class-gate 는 회원을 이메일로 안다(토큰) → 이메일로 묻는다. service_role 전용.
--   '지금 구독 중이고 낸 기간 안'일 때만 목록을 준다(연간 10권 · 월 8권). 그 밖엔 빈 목록.
create or replace function public.class_subscription_books_by_email(p_email text) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.class_subscription_books(s.cycle)
      from public.class_subscriptions s join auth.users u on u.id = s.user_id
     where lower(u.email) = lower(p_email) and s.status in ('active','past_due') and s.current_period_end > now()
     limit 1
  ), array[]::text[])
$$;
revoke all on function public.class_subscription_books_by_email(text) from public, anon, authenticated;
grant execute on function public.class_subscription_books_by_email(text) to service_role;
-- 되돌리기: drop function public.class_subscription_books_by_email(text);
