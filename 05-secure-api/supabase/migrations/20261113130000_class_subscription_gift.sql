-- 야나완 성공 선물 '구독권' — 개인 연간 구독 1년권(2026-11-13). 20261113110000 뒤에.
--   모양: 운영자가 선물 코드를 발급 → 회원이 코드를 넣으면 '결제 없는 구독 행'(source='gift')이 생긴다.
--   🔴 class_redemptions·class_access_passes 는 쓰지 않는다 — 소장 원장·올인원 판정(class_checkout_quote·class-gate ownsAllInOne)에 섞인다.
--   선물 구독 행:
--     plan 'solo' · cycle 'year' · status 'active' · source 'gift' · amount = list_amount = 99,000(표시용 — 청구되지 않는다)
--     billing_key null · next_charge_at null → 크론(class_subscription_due)이 청구하지 않는다
--     cancel_requested_at = now() → 기간이 끝나면 class_subscription_expire 가 정리한다(안 넣으면 기간 뒤 새 가입이 already_subscribed 로 막힌다)
--     결제 행(class_subscription_payments)은 만들지 않는다 → 올인원 전환 차감(class_checkout_quote)·런칭 선물(bonus_months)이 세지 않는다.
--   코드: 혼동 글자(I·L·O·0·1) 없는 대문자·숫자 12자(31종 — 함께 읽기 초대 코드와 같은 글자판). 저장은 하이픈 없이, 'XXXX-XXXX-XXXX' 표시는 화면 몫.
--   무차별 대입: 틀린 시도(없는 코드·쓴 코드·만료 코드)를 계정별로 적고, 1시간에 10번이면 too_many_attempts. 성공은 세지 않는다.
--   되돌리기(선물 행 0건일 때만): drop function public.class_subscription_gift_redeem(uuid,text,text,text),
--     public.admin_class_subscription_gift_issue(text,integer,text,text), public.admin_class_subscription_gift_list(), private.class_subscription_gift_code();
--     drop table public.class_subscription_gift_attempts, public.class_subscription_gift_codes;
--     summary 에서 'source' 항목을 빼는 반대 치환; alter table public.class_subscriptions drop column source.

-- ── ① 구독 행의 출처 ──
alter table public.class_subscriptions add column if not exists source text not null default 'paid';
alter table public.class_subscriptions drop constraint if exists class_subscriptions_source_check;
alter table public.class_subscriptions add constraint class_subscriptions_source_check check (source in ('paid','gift'));

-- ── ② 선물 코드 ──
create table if not exists public.class_subscription_gift_codes (
  code            text primary key check (code ~ '^[A-HJKMNP-Z2-9]{12}$'),
  kind            text not null check (kind in ('yanawan66','yanawan100','operator')),
  issued_to       text,
  note            text,
  issued_by       text,
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz,
  redeemed_by     uuid references auth.users(id) on delete set null,
  redeemed_at     timestamptz,
  subscription_id uuid references public.class_subscriptions(id) on delete set null
);
alter table public.class_subscription_gift_codes enable row level security;
revoke all on public.class_subscription_gift_codes from public, anon, authenticated;
grant select, insert, update on public.class_subscription_gift_codes to service_role;

-- ── ③ 틀린 시도 기록(무차별 대입 방어) ──
create table if not exists public.class_subscription_gift_attempts (
  id         bigserial primary key,
  user_id    uuid not null,
  reason     text not null,
  code_head  text,                       -- 넣은 코드의 앞 4자만(전체를 남기지 않는다)
  created_at timestamptz not null default now()
);
create index if not exists class_subscription_gift_attempts_user on public.class_subscription_gift_attempts (user_id, created_at desc);
alter table public.class_subscription_gift_attempts enable row level security;
revoke all on public.class_subscription_gift_attempts from public, anon, authenticated;
grant select, insert, delete on public.class_subscription_gift_attempts to service_role;
grant usage, select on sequence public.class_subscription_gift_attempts_id_seq to service_role;

-- 코드 한 개 — gen_random_uuid 의 무작위 바이트 12개(버전·변형 비트가 든 6·8번 바이트는 건너뜀)를 31글자판에 얹는다.
create or replace function private.class_subscription_gift_code() returns text
language plpgsql volatile set search_path = '' as $$
declare a constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea := uuid_send(gen_random_uuid()); i int; o text := '';
begin
  foreach i in array array[0,1,2,3,4,5,7,9,10,11,12,13] loop
    o := o || substr(a, 1 + (get_byte(b, i) % 31), 1);
  end loop;
  return o;
end $$;
revoke all on function private.class_subscription_gift_code() from public, anon, authenticated;

-- ── ④ 발급(운영자) ──
create or replace function public.admin_class_subscription_gift_issue(p_kind text, p_count integer, p_issued_to text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_codes text[] := array[]::text[]; v_code text; v_try int;
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'login_required'; end if;
  if not public.is_ls_admin() then raise exception using errcode = '42501', message = 'admin_only'; end if;
  if p_kind is null or p_kind not in ('yanawan66','yanawan100','operator') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if p_count is null or p_count < 1 or p_count > 20 then return jsonb_build_object('ok', false, 'error', 'bad_count'); end if;
  for n in 1..p_count loop
    v_try := 0;
    loop
      v_try := v_try + 1;
      v_code := private.class_subscription_gift_code();
      insert into public.class_subscription_gift_codes (code, kind, issued_to, note, issued_by)
      values (v_code, p_kind, nullif(left(btrim(coalesce(p_issued_to, '')), 200), ''), nullif(left(btrim(coalesce(p_note, '')), 500), ''),
              lower(auth.jwt() ->> 'email'))
      on conflict (code) do nothing;
      exit when found;
      if v_try >= 5 then raise exception 'gift_code_collision'; end if;
    end loop;
    v_codes := v_codes || v_code;
  end loop;
  return jsonb_build_object('ok', true, 'kind', p_kind, 'count', p_count, 'codes', to_jsonb(v_codes));
end $$;

-- ── ⑤ 조회(운영자) — 사용한 회원 이메일은 가린다 ──
create or replace function public.admin_class_subscription_gift_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'login_required'; end if;
  if not public.is_ls_admin() then raise exception using errcode = '42501', message = 'admin_only'; end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('code', g.code, 'kind', g.kind, 'issuedTo', g.issued_to, 'note', g.note,
        'issuedAt', g.issued_at, 'expiresAt', g.expires_at, 'redeemed', g.redeemed_by is not null, 'redeemedAt', g.redeemed_at,
        'redeemedBy', case when u.email is null then null
          else left(split_part(u.email, '@', 1), 2) || '***@' || split_part(u.email, '@', 2) end)
      order by g.issued_at desc, g.code)
      from public.class_subscription_gift_codes g left join auth.users u on u.id = g.redeemed_by), '[]'::jsonb));
end $$;

-- ── ⑥ 사용(서버만 — 로그인·이메일 인증은 서버가 확인한 회원 id 로) ──
create or replace function public.class_subscription_gift_redeem(p_user_id uuid, p_code text, p_terms_version text, p_terms_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  g public.class_subscription_gift_codes; v_sub public.class_subscriptions; v_new public.class_subscriptions;
begin
  if coalesce(p_terms_version, '') = '' or coalesce(p_terms_url, '') = '' then return jsonb_build_object('ok', false, 'error', 'terms_changed'); end if;
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'login_required'); end if;
  -- 같은 회원의 동시 사용을 줄 세운다(서로 다른 코드 두 장을 동시에 넣어도 하나만)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('class-subscription-gift:' || p_user_id::text, 0));
  if (select count(*) from public.class_subscription_gift_attempts a
       where a.user_id = p_user_id and a.created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts'); end if;
  if v_code !~ '^[A-HJKMNP-Z2-9]{12}$' then
    insert into public.class_subscription_gift_attempts (user_id, reason, code_head) values (p_user_id, 'invalid_code', left(v_code, 4));
    return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;
  select * into g from public.class_subscription_gift_codes where code = v_code for update;
  if not found then
    insert into public.class_subscription_gift_attempts (user_id, reason, code_head) values (p_user_id, 'invalid_code', left(v_code, 4));
    return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;
  if g.redeemed_by is not null then
    if g.redeemed_by = p_user_id then   -- 같은 회원이 다시 보냄(응답을 못 받은 재시도) = 같은 답
      return jsonb_build_object('ok', true, 'again', true, 'subscriptionId', g.subscription_id,
        'periodEnd', (select s.current_period_end from public.class_subscriptions s where s.id = g.subscription_id));
    end if;
    insert into public.class_subscription_gift_attempts (user_id, reason, code_head) values (p_user_id, 'used_code', left(v_code, 4));
    return jsonb_build_object('ok', false, 'error', 'used_code'); end if;
  if g.expires_at is not null and g.expires_at <= now() then
    insert into public.class_subscription_gift_attempts (user_id, reason, code_head) values (p_user_id, 'expired_code', left(v_code, 4));
    return jsonb_build_object('ok', false, 'error', 'expired_code'); end if;
  -- 살아 있는 구독이 있으면 코드를 소진하지 않는다(다른 분께 주거나, 지금 구독이 끝난 뒤 쓸 수 있게)
  select * into v_sub from public.class_subscriptions where user_id = p_user_id and status in ('pending','active','past_due') for update;
  if found and v_sub.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'already_subscribed', 'periodEnd', v_sub.current_period_end); end if;
  if found then
    -- 가입하다 만 행(pending)은 지운다 — 단, 카드가 등록됐거나 포인트를 잡은 채 결과를 기다리는 주문이 있으면 그 결제가 실제로 됐을 수 있다.
    if exists (select 1 from public.class_subscription_payments p
                where p.subscription_id = v_sub.id and p.status = 'ready'
                  and (v_sub.billing_key is not null
                       or exists (select 1 from public.point_transactions t where t.reason = 'subscription' and t.ref_id = 'sub_pay:' || p.id))) then
      return jsonb_build_object('ok', false, 'error', 'payment_pending'); end if;
    delete from public.class_subscriptions where id = v_sub.id;
  end if;
  insert into public.class_subscriptions (user_id, plan, cycle, status, source, customer_key, billing_key, amount, list_amount, owned_count,
      current_period_start, current_period_end, next_charge_at, cancel_requested_at, terms_version, terms_url)
  values (p_user_id, 'solo', 'year', 'active', 'gift', 'cus' || replace(gen_random_uuid()::text, '-', ''), null, 99000, 99000, 0,
      now(), now() + interval '1 year', null, now(), p_terms_version, p_terms_url)
  returning * into v_new;
  update public.class_subscription_gift_codes set redeemed_by = p_user_id, redeemed_at = now(), subscription_id = v_new.id where code = v_code;
  return jsonb_build_object('ok', true, 'subscriptionId', v_new.id, 'kind', g.kind, 'periodEnd', v_new.current_period_end);
end $$;

-- ── ⑦ 요약에 출처 — 운영 정의(20261113110000 판, ownedTheory 포함)를 읽어 한 곳만 덧붙인다 ──
do $patch$
declare v_def text; n int;
  a1 text := '''cancelRequested'', s.cancel_requested_at is not null)';
begin
  select pg_get_functiondef('public.class_subscription_summary(uuid)'::regprocedure) into v_def;
  if position('''source''' in v_def) > 0 then return; end if;
  v_def := replace(v_def, E'\r\n', E'\n');
  n := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'class_subscription_summary anchor matched % times', n; end if;
  execute replace(v_def, a1, '''cancelRequested'', s.cancel_requested_at is not null, ''source'', s.source)');
end $patch$;

do $grants$
declare f text;
begin
  foreach f in array array['public.class_subscription_gift_redeem(uuid,text,text,text)', 'public.class_subscription_summary(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.admin_class_subscription_gift_issue(text,integer,text,text)', 'public.admin_class_subscription_gift_list()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);   -- 게이트(is_ls_admin)가 막는다
  end loop;
end $grants$;
