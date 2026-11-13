-- 올인원 소장 전환가가 구독료 차감으로 낮아질 때(0원 포함) 깨지지 않게(2026-11-13).
--   운영 class_checkout_quote 의 금액 = 398,000 − 50,000 × 소장 권수 − 12/31(KST)까지 낸 구독료(subscriptionCredit).
--   ① 금액 제약: 올인원(class-stella-member-upgrade)의 하한만 0 으로 내린다(0 ~ 348,000).
--      · 하한 48,000 → 0  : 구독료 차감으로 48,000 아래(예: 48,000 − 9,900 = 38,100)가 나오면 prepare 의 INSERT 가 제약 위반으로 죽었다.
--      · 상한 348,000 은 그대로 둔다 — 운영 quote 는 소장 0권(newBuyer)도 eligible 로 398,000 을 주지만 그 주문은 지금도 이 제약에 막힌다.
--        0권 회원에게 398,000 결제를 여는 것은 판매 결정이라 여기서 바꾸지 않는다(운영자 결정 대기, 2026-11-13).
--      단품 강좌 조건(39,000 ~ 128,000)은 그대로.
--   ② 0원이면 토스 결제를 만들 수 없다 → prepare 는 use_free 로 돌려보내고, 새 public.class_checkout_grant_free 가
--      결제 키 없는 주문을 confirming → (지급) → paid 로 UPDATE 해서 기존 after-update 트리거(구독 다음 결제 중단·결제 메일 큐)가 그대로 돈다.
--   본문은 손으로 옮기지 않는다 — prepare 는 운영 정의를 읽어 한 곳만 덧붙인다(앵커가 정확히 1곳일 때만, 이미 들어 있으면 건너뜀).
--   되돌리기(0원 주문 0건일 때만): drop function public.class_checkout_grant_free(uuid,text,text) ·
--     prepare 에서 use_free 블록을 빼는 반대 치환 · 제약을 (48000~348000 / 39000~128000) 으로.

-- ── ① 금액 제약 ──
alter table public.class_checkout_orders drop constraint if exists class_checkout_orders_amount_check;
alter table public.class_checkout_orders add constraint class_checkout_orders_amount_check check (
 (product_code='class-stella-member-upgrade' and amount between 0 and 348000)
 or (product_code in ('class-kidari-lifetime','class-anne-lifetime','class-pride-lifetime','class-littlewomen1-lifetime','class-littlewomen2-lifetime','class-gatsby-lifetime','class-sherlock-lifetime','class-theory-lifetime') and amount between 39000 and 128000)
);

-- ── ② prepare: 0원이면 토스로 보내지 않는다 ──
do $patch$
declare v_def text; n int;
  a1 text := E'  if p_expected_amount is distinct from (q->>''amount'')::integer then';
begin
  select pg_get_functiondef('public.class_checkout_prepare(uuid,integer,text,text)'::regprocedure) into v_def;
  if position('use_free' in v_def) > 0 then return; end if;
  v_def := replace(v_def, E'\r\n', E'\n');
  n := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'class_checkout_prepare anchor matched % times', n; end if;
  execute replace(v_def, a1,
    E'  -- 0원(구독료 차감 등)은 토스 결제를 만들 수 없다 — 결제 없이 지급하는 길(class_checkout_grant_free)로.\n'
    || E'  if (q->>''amount'')::integer = 0 then\n'
    || E'    return jsonb_build_object(''ok'',false,''error'',''use_free'',''amount'',0); end if;\n'
    || a1);
end $patch$;

-- ── ③ 0원 지급 ──
--   prepare·claim·settle 과 같은 잠금 순서(first-course-2026 → stella-upgrade:<회원>).
--   지급 블록 = class_checkout_settle(DONE) 의 그것(private.first_course_settle_base)과 같은 내용.
create or replace function public.class_checkout_grant_free(p_user_id uuid, p_terms_version text, p_terms_url text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare q jsonb; o public.class_checkout_orders; v_owned text[]; v_missing text[]; v_granted text[];
begin
  if coalesce(p_terms_version,'')='' or coalesce(p_terms_url,'')='' then
    return jsonb_build_object('ok',false,'error','terms_changed'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('first-course-2026',0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stella-upgrade:'||p_user_id::text,0));
  -- 이미 0원으로 받은 회원 = 같은 답(두 번 지급하지 않는다)
  select * into o from public.class_checkout_orders
   where user_id=p_user_id and product_code='class-stella-member-upgrade' and status='paid' and amount=0 and payment_key is null
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('ok',true,'status','paid','granted',true,'orderId',o.id,'free',true,'again',true,'missingBooks',o.missing_books);
  end if;
  q := public.class_checkout_quote(p_user_id);
  if not coalesce((q->>'ok')::boolean,false) then return q; end if;
  if not (q->>'eligible')::boolean then return jsonb_build_object('ok',false,'error',
    case when (q->>'complete')::boolean then 'already_owned' when (q->>'existingRequest')::boolean then 'existing_request' else 'member_required' end); end if;
  if (q->>'amount')::integer <> 0 then
    return jsonb_build_object('ok',false,'error','not_free','amount',(q->>'amount')::integer); end if;
  select coalesce(array_agg(value),array[]::text[]) into v_owned from jsonb_array_elements_text(q->'ownedBooks');
  select coalesce(array_agg(value),array[]::text[]) into v_missing from jsonb_array_elements_text(q->'missingBooks');
  -- 결과를 기다리는 결제(토스 승인 중·부분 환불 검토)가 있으면 손대지 않는다
  if exists (select 1 from public.class_checkout_orders where user_id=p_user_id and status in ('confirming','partial_refund_review')) then
    return jsonb_build_object('ok',false,'error','payment_pending'); end if;
  -- 결제창을 열지 않은(ready) 주문은 닫는다 — prepare 가 금액이 바뀌면 닫는 것과 같다
  update public.class_checkout_orders set status='expired',updated_at=now() where user_id=p_user_id and status='ready';
  insert into public.class_checkout_orders(id,user_id,email,amount,owned_books,missing_books,terms_version,terms_url,status)
    values('cls'||replace(gen_random_uuid()::text,'-',''),p_user_id,q->>'email',0,v_owned,v_missing,p_terms_version,p_terms_url,'confirming')
    returning * into o;
  with inserted as (
    insert into public.class_verifications(email,book_code,enrollment_email)
      select o.email,book,o.email from unnest(o.missing_books) book
      where not exists(select 1 from public.class_redemptions r where lower(r.redeemed_by)=o.email and r.book_code=book)
      on conflict(email,book_code) do nothing returning email,book_code,verified_at
  ), recorded as (
    insert into public.class_checkout_grants(order_id,email,book_code,verified_at)
      select o.id,email,book_code,verified_at from inserted returning book_code
  ) select coalesce(array_agg(book_code),array[]::text[]) into v_granted from recorded;
  -- UPDATE 로 paid — after update of status 트리거들(구독 다음 결제 중단 · 결제 메일 큐)이 그대로 돈다
  update public.class_checkout_orders set status='paid',updated_at=now() where id=o.id;
  return jsonb_build_object('ok',true,'status','paid','granted',true,'orderId',o.id,'free',true,
    'subscriptionCredit',(q->>'subscriptionCredit')::integer,'missingBooks',o.missing_books,'grantedBooks',v_granted);
end $$;

revoke all on function public.class_checkout_grant_free(uuid,text,text) from public, anon, authenticated;
grant execute on function public.class_checkout_grant_free(uuid,text,text) to service_role;
