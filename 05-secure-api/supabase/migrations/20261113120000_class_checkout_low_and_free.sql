-- 올인원 소장 전환가가 구독료 차감으로 낮아질 때(0원 포함) 깨지지 않게(2026-11-13).
--   운영 class_checkout_quote 의 금액 = 398,000 − 50,000 × 소장 권수 − 12/31(KST)까지 낸 구독료(subscriptionCredit).
--   ① 금액 제약: 올인원(class-stella-member-upgrade)은 0 ~ 398,000 으로 넓힌다.
--      · 하한 48,000 → 0  : 구독료 차감으로 48,000 아래(예: 48,000 − 9,900 = 38,100)가 나오면 prepare 의 INSERT 가 제약 위반으로 죽었다.
--      · 상한 348,000 → 398,000 : 10-22 마이그레이션(allinone_new_buyer…)이 소장 0권(newBuyer)을 eligible 로 열어 quote 가 398,000 을 주는데
--        제약 상한이 그대로라 그 주문의 INSERT 가 죽고 있었다(0권 주문 0건). 운영자 2026-11-13: 올인원 결제는 원래 되는 것 → 상한을 맞춘다.
--      단품 강좌 조건(39,000 ~ 128,000)은 그대로.
--   ② 0원이면 토스 결제를 만들 수 없다 → prepare 는 use_free 로 돌려보내고, 새 public.class_checkout_grant_free 가
--      결제 키 없는 주문을 confirming → (지급) → paid 로 UPDATE 해서 기존 after-update 트리거(구독 다음 결제 중단·결제 메일 큐)가 그대로 돈다.
--   ②-b 구독료 차감 뒤 1~999원 자투리는 회사가 부담해 0원(quote 의 v_sub 를 그만큼 올림, 응답 'roundedDown'). 운영자 2026-11-13.
--      주문 행에 따로 칸은 없다 — 결제 메일의 '구독료 차감' 줄은 398,000 − 소장 할인 − 금액 으로 다시 계산하므로 올린 뒤 금액이 나온다.
--   본문은 손으로 옮기지 않는다 — prepare·quote 는 운영 정의를 읽어 앵커 자리에만 덧붙인다(앵커가 정확히 1곳일 때만, 이미 들어 있으면 건너뜀).
--   되돌리기(0원 주문 0건일 때만): drop function public.class_checkout_grant_free(uuid,text,text) ·
--     prepare 에서 use_free 블록을 빼는 반대 치환 · quote 에서 v_round 선언·자투리 블록·'roundedDown' 키를 빼는 반대 치환 ·
--     제약을 (48000~348000 / 39000~128000) 으로.

-- ── ① 금액 제약 ──
alter table public.class_checkout_orders drop constraint if exists class_checkout_orders_amount_check;
alter table public.class_checkout_orders add constraint class_checkout_orders_amount_check check (
 (product_code='class-stella-member-upgrade' and amount between 0 and 398000)
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

-- ── ②-b quote: 구독료 차감 뒤 1~999원 자투리는 회사가 부담 → 0원(운영자 2026-11-13) ──
--   포인트가 10원 단위라 차감 뒤 몇백 원이 남을 수 있는데, 그 금액은 토스 결제가 안 될 수 있다.
--   v_sub(구독 차감)를 그만큼 올려 금액을 0으로 — subscriptionCredit 이 그만큼 늘고, 응답에 'roundedDown'(올린 금액, 없으면 0).
--   🔴 구독 차감이 0인 회원에게는 적용하지 않는다(소장 할인만으로는 1~999 가 나올 수 없지만 방어).
--   앵커 3곳(선언 · 차감 상한 줄 · 응답의 subscriptionCredit)이 각각 정확히 1곳일 때만 · 이미 들어 있으면 건너뜀.
--   화면 계산(src/class-subscription-pricing.mjs conversionQuote)과 같은 규칙.
do $patch$
declare v_def text; n int;
  b1 text := E'  v_sub int := 0;\n';
  b2 text := E'    v_sub := least(v_sub, greatest(398000-v_n*50000,0));\n';
  b3 text := E'''subscriptionCredit'',v_sub,';
begin
  select pg_get_functiondef('public.class_checkout_quote(uuid)'::regprocedure) into v_def;
  if position('roundedDown' in v_def) > 0 then return; end if;
  v_def := replace(v_def, E'\r\n', E'\n');
  n := (length(v_def) - length(replace(v_def, b1, ''))) / length(b1);
  if n <> 1 then raise exception 'class_checkout_quote anchor b1 matched % times', n; end if;
  n := (length(v_def) - length(replace(v_def, b2, ''))) / length(b2);
  if n <> 1 then raise exception 'class_checkout_quote anchor b2 matched % times', n; end if;
  n := (length(v_def) - length(replace(v_def, b3, ''))) / length(b3);
  if n <> 1 then raise exception 'class_checkout_quote anchor b3 matched % times', n; end if;
  v_def := replace(v_def, b1, b1 || E'  v_round int := 0;\n');
  v_def := replace(v_def, b2, b2
    || E'    -- 1~999원 자투리는 회사가 부담 → 0원(구독 차감이 있는 회원만)\n'
    || E'    if v_sub > 0 and greatest(398000-v_n*50000,0)-v_sub between 1 and 999 then\n'
    || E'      v_round := greatest(398000-v_n*50000,0)-v_sub;\n'
    || E'      v_sub := v_sub + v_round;\n'
    || E'    end if;\n');
  v_def := replace(v_def, b3, b3 || E'''roundedDown'',v_round,');
  execute v_def;
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
    'subscriptionCredit',(q->>'subscriptionCredit')::integer,'roundedDown',coalesce((q->>'roundedDown')::integer,0),
    'missingBooks',o.missing_books,'grantedBooks',v_granted);
end $$;

revoke all on function public.class_checkout_grant_free(uuid,text,text) from public, anon, authenticated;
grant execute on function public.class_checkout_grant_free(uuid,text,text) to service_role;
