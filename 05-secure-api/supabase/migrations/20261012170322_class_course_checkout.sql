-- Individual lifetime courses. Activation remains a separate Worker setting.
create table public.class_checkout_products (
 code text primary key, book_code text not null unique, title text not null,
 amount integer not null check(amount>0), enabled boolean not null default false
);
alter table public.class_checkout_products enable row level security;
revoke all on public.class_checkout_products from public,anon,authenticated;
grant select on public.class_checkout_products to service_role;
insert into public.class_checkout_products(code,book_code,title,amount,enabled) values
 ('class-kidari-lifetime','kidari','키다리 아저씨',69000,true),
 ('class-anne-lifetime','anne','빨강머리 앤',118000,true),
 ('class-pride-lifetime','pride','오만과 편견',128000,true),
 ('class-littlewomen1-lifetime','littlewomen1','작은 아씨들 파트1',99000,true),
 ('class-littlewomen2-lifetime','littlewomen2','작은 아씨들 파트2',99000,true),
 ('class-gatsby-lifetime','gatsby','위대한 개츠비',79000,true),
 ('class-sherlock-lifetime','sherlock','셜록 홈즈',79000,true),
 ('class-theory-lifetime','theory','원서 읽기 핵심 이론',39800,true);
alter table public.class_checkout_orders drop constraint class_checkout_orders_amount_check;
alter table public.class_checkout_orders add constraint class_checkout_orders_amount_check check (
 (product_code='class-stella-member-upgrade' and amount between 48000 and 348000)
 or (product_code in ('class-kidari-lifetime','class-anne-lifetime','class-pride-lifetime','class-littlewomen1-lifetime','class-littlewomen2-lifetime','class-gatsby-lifetime','class-sherlock-lifetime','class-theory-lifetime') and amount between 39800 and 128000)
);

create function public.class_course_checkout_quote(p_user_id uuid,p_book_code text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare q jsonb; p public.class_checkout_products; owned boolean;
begin
 select * into p from public.class_checkout_products where book_code=p_book_code and enabled;
 if not found then return jsonb_build_object('ok',false,'error','product_unavailable'); end if;
 q:=public.class_checkout_quote(p_user_id);
 if not coalesce((q->>'ok')::boolean,false) then return q; end if;
 owned:=q->'ownedBooks' ? p_book_code;
 if p_book_code='theory' and (select count(*) from jsonb_array_elements_text(q->'ownedBooks') b where b.value<>'theory')>=2 then owned:=true; end if;
 return q || jsonb_build_object('productCode',p.code,'title',p.title,'baseAmount',p.amount,'amount',p.amount,'creditAmount',0,
 'missingBooks',case when owned then '[]'::jsonb else jsonb_build_array(p_book_code) end,
 'complete',owned,'eligible',not owned and not (q->>'existingRequest')::boolean);
end $$;

create function public.class_course_checkout_prepare(p_user_id uuid,p_book_code text,p_expected_amount integer,p_terms_version text,p_terms_url text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare q jsonb; o public.class_checkout_orders; v_owned text[];
begin
 if coalesce(p_terms_version,'')='' or coalesce(p_terms_url,'')='' then return jsonb_build_object('ok',false,'error','terms_changed'); end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stella-upgrade:'||p_user_id::text,0));
 q:=public.class_course_checkout_quote(p_user_id,p_book_code);
 if not coalesce((q->>'ok')::boolean,false) then return q; end if;
 if not (q->>'eligible')::boolean then return jsonb_build_object('ok',false,'error',case when (q->>'complete')::boolean then 'already_owned' else 'existing_request' end); end if;
 if p_expected_amount is distinct from (q->>'amount')::integer then return jsonb_build_object('ok',false,'error','quote_changed'); end if;
 select coalesce(array_agg(value),array[]::text[]) into v_owned from jsonb_array_elements_text(q->'ownedBooks');
 update public.class_checkout_orders set status='expired',updated_at=now() where user_id=p_user_id and status='ready'
  and (expires_at<=now() or product_code<>q->>'productCode' or amount<>p_expected_amount or owned_books<>v_owned
   or email<>q->>'email' or terms_version<>p_terms_version or terms_url<>p_terms_url);
 select * into o from public.class_checkout_orders where user_id=p_user_id and status in ('ready','confirming','partial_refund_review') for update;
 if found and o.status<>'ready' then return jsonb_build_object('ok',false,'error','payment_pending'); end if;
 if o.id is null then
  insert into public.class_checkout_orders(id,user_id,email,product_code,amount,owned_books,missing_books,terms_version,terms_url)
   values('cls'||replace(gen_random_uuid()::text,'-',''),p_user_id,q->>'email',q->>'productCode',p_expected_amount,v_owned,array[p_book_code],p_terms_version,p_terms_url) returning * into o;
 end if;
 return jsonb_build_object('ok',true,'orderId',o.id,'amount',o.amount,'email',o.email,'orderName','리터스텔라 '||(q->>'title')||' 평생소장',
 'customerKey',o.user_id,'expiresAt',o.expires_at,'ownedBooks',o.owned_books,'missingBooks',o.missing_books);
end $$;

create or replace function public.class_checkout_claim(p_user_id uuid,p_order_id text,p_payment_key text,p_amount integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.class_checkout_orders; q jsonb; book text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stella-upgrade:'||p_user_id::text,0));
 select * into o from public.class_checkout_orders where id=p_order_id and user_id=p_user_id for update;
 if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
 if p_amount is distinct from o.amount then return jsonb_build_object('ok',false,'error','amount_mismatch'); end if;
 if o.status not in ('ready','confirming','paid') then return jsonb_build_object('ok',false,'error','order_closed'); end if;
 if o.payment_key is not null and o.payment_key<>p_payment_key then return jsonb_build_object('ok',false,'error','payment_key_mismatch'); end if;
 if o.status='ready' then
  if o.expires_at<=now() then return jsonb_build_object('ok',false,'error','order_expired'); end if;
  if o.product_code='class-stella-member-upgrade' then q:=public.class_checkout_quote(p_user_id);
  else
   select book_code into book from public.class_checkout_products where code=o.product_code;
   q:=public.class_course_checkout_quote(p_user_id,book);
  end if;
  if not coalesce((q->>'eligible')::boolean,false) or q->>'email'<>o.email or (q->>'amount')::integer<>o.amount
   or q->'ownedBooks'<>to_jsonb(o.owned_books) or q->'missingBooks'<>to_jsonb(o.missing_books) then
   return jsonb_build_object('ok',false,'error','quote_changed'); end if;
  update public.class_checkout_orders set status='confirming',payment_key=p_payment_key,updated_at=now() where id=o.id;
 end if;
 return jsonb_build_object('ok',true,'orderId',o.id,'amount',o.amount,'email',o.email,'status',o.status);
end $$;

-- Keep member pricing intact; invalidate an unconfirmed single-course basket first.
do $$ declare src text; old_text text:= 'expires_at<=now() or owned_books<>v_owned'; begin
 src:=pg_get_functiondef('public.class_checkout_prepare(uuid,integer,text,text)'::regprocedure);
 if strpos(src,old_text)=0 then raise exception 'member prepare changed; review before migration'; end if;
 execute replace(src,old_text,'product_code<>''class-stella-member-upgrade'' or expires_at<=now() or owned_books<>v_owned');
end $$;

create or replace function private.guard_class_checkout_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stella-upgrade:'||new.user_id::text,0));
 if new.status in ('pending','coupon_issued','completed') and exists (
  select 1 from public.class_checkout_orders where user_id=new.user_id and
  (status in ('confirming','partial_refund_review') or (status='paid' and product_code='class-stella-member-upgrade') or (status='ready' and expires_at>now()))
 ) then raise exception 'class_checkout_pending'; end if;
 return new;
end $$;
revoke all on function public.class_course_checkout_quote(uuid,text),public.class_course_checkout_prepare(uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.class_course_checkout_quote(uuid,text),public.class_course_checkout_prepare(uuid,text,integer,text,text) to service_role;
