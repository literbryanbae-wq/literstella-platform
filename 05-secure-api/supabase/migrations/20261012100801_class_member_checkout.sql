-- Server-only member checkout. New sales remain behind the Worker activation flag.
-- auth.users stays outside the public API; grant only the identity fields this RPC reads.
grant select (id,email,email_confirmed_at) on auth.users to service_role;
create table public.class_checkout_orders (
  id text primary key,
  user_id uuid not null references auth.users(id),
  email text not null,
  product_code text not null default 'class-stella-member-upgrade',
  amount integer not null check (amount between 48000 and 348000),
  owned_books text[] not null,
  missing_books text[] not null,
  terms_version text not null,
  terms_url text not null,
  terms_accepted_at timestamptz not null default now(),
  status text not null default 'ready' check (status in ('ready','confirming','paid','expired','canceled','partial_refund_review')),
  payment_key text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  updated_at timestamptz not null default now()
);
create unique index class_checkout_one_open on public.class_checkout_orders(user_id)
  where status in ('ready','confirming','partial_refund_review');
create table public.class_checkout_grants (
  order_id text not null references public.class_checkout_orders(id),
  email text not null,
  book_code text not null,
  verified_at timestamptz not null,
  primary key (order_id,book_code)
);
alter table public.class_checkout_orders enable row level security;
alter table public.class_checkout_grants enable row level security;
revoke all on public.class_checkout_orders, public.class_checkout_grants from public, anon, authenticated;
grant select,insert,update,delete on public.class_checkout_orders, public.class_checkout_grants to service_role;

-- Same explicit ownership policy as private.stella_upgrade; inferred/free theory
-- access alone is NOT materialized as an extra discounted book here.
create function public.class_checkout_quote(p_user_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_email text;
  v_all text[] := array['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock','theory'];
  v_owned text[];
  v_missing text[];
  v_blocked boolean;
begin
  select lower(email) into v_email from auth.users where id=p_user_id and email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('ok',false,'error','login_required'); end if;
  select coalesce(array_agg(c order by n),array[]::text[]) into v_owned
    from unnest(v_all) with ordinality t(c,n)
    where exists(select 1 from public.class_verifications v where lower(v.email)=v_email and v.book_code=c)
       or exists(select 1 from public.class_redemptions r where lower(r.redeemed_by)=v_email and r.book_code=c);
  select coalesce(array_agg(c order by n),array[]::text[]) into v_missing
    from unnest(v_all) with ordinality t(c,n) where not(c=any(v_owned));
  select exists(select 1 from public.stella_upgrade_requests where user_id=p_user_id
    and status in ('pending','coupon_issued','rejected','completed')) into v_blocked;
  return jsonb_build_object('ok',true,'userId',p_user_id,'email',v_email,
    'baseAmount',398000,'ownedBooks',v_owned,'missingBooks',v_missing,
    'ownedCount',cardinality(v_owned),'creditAmount',least(cardinality(v_owned)*50000,398000),
    'amount',greatest(398000-cardinality(v_owned)*50000,0),'complete',cardinality(v_owned)=8,
    'eligible',cardinality(v_owned) between 1 and 7 and not v_blocked,
    'existingRequest',v_blocked);
end $$;

create function public.class_checkout_prepare(p_user_id uuid, p_expected_amount integer, p_terms_version text, p_terms_url text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare q jsonb; o public.class_checkout_orders; v_owned text[]; v_missing text[];
begin
  -- Coordinate with the old bank/coupon request function as well as other tabs.
  if coalesce(p_terms_version,'')='' or coalesce(p_terms_url,'')='' then
    return jsonb_build_object('ok',false,'error','terms_changed'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stella-upgrade:'||p_user_id::text,0));
  q := public.class_checkout_quote(p_user_id);
  if not coalesce((q->>'ok')::boolean,false) then return q; end if;
  if not (q->>'eligible')::boolean then return jsonb_build_object('ok',false,'error',
    case when (q->>'complete')::boolean then 'already_owned' when (q->>'existingRequest')::boolean then 'existing_request' else 'member_required' end); end if;
  if p_expected_amount is distinct from (q->>'amount')::integer then
    return jsonb_build_object('ok',false,'error','quote_changed'); end if;
  select array_agg(value) into v_owned from jsonb_array_elements_text(q->'ownedBooks');
  select array_agg(value) into v_missing from jsonb_array_elements_text(q->'missingBooks');
  update public.class_checkout_orders set status='expired',updated_at=now()
    where user_id=p_user_id and status='ready' and (expires_at<=now() or owned_books<>v_owned or email<>q->>'email'
      or terms_version<>p_terms_version or terms_url<>p_terms_url);
  select * into o from public.class_checkout_orders where user_id=p_user_id
    and status in ('ready','confirming','partial_refund_review') for update;
  if found and o.status<>'ready' then return jsonb_build_object('ok',false,'error','payment_pending'); end if;
  if o.id is null then
    insert into public.class_checkout_orders(id,user_id,email,amount,owned_books,missing_books,terms_version,terms_url)
      values('cls'||replace(gen_random_uuid()::text,'-',''),p_user_id,q->>'email',(q->>'amount')::integer,v_owned,v_missing,p_terms_version,p_terms_url)
      returning * into o;
  end if;
  return jsonb_build_object('ok',true,'orderId',o.id,'amount',o.amount,'email',o.email,
    'orderName','리터스텔라 올인원 8개 평생소장 · 회원 전환','customerKey',o.user_id,
    'expiresAt',o.expires_at,'ownedBooks',o.owned_books,'missingBooks',o.missing_books);
end $$;

create function public.class_checkout_claim(p_user_id uuid,p_order_id text,p_payment_key text,p_amount integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare o public.class_checkout_orders; q jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stella-upgrade:'||p_user_id::text,0));
  select * into o from public.class_checkout_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if p_amount is distinct from o.amount then return jsonb_build_object('ok',false,'error','amount_mismatch'); end if;
  if o.status not in ('ready','confirming','paid') then return jsonb_build_object('ok',false,'error','order_closed'); end if;
  if o.payment_key is not null and o.payment_key<>p_payment_key then return jsonb_build_object('ok',false,'error','payment_key_mismatch'); end if;
  if o.status='ready' then
    if o.expires_at<=now() then return jsonb_build_object('ok',false,'error','order_expired'); end if;
    q := public.class_checkout_quote(p_user_id);
    if not coalesce((q->>'eligible')::boolean,false) or q->>'email'<>o.email
       or (q->>'amount')::integer<>o.amount or q->'ownedBooks'<>to_jsonb(o.owned_books) then
      return jsonb_build_object('ok',false,'error','quote_changed'); end if;
    update public.class_checkout_orders set status='confirming',payment_key=p_payment_key,updated_at=now() where id=o.id;
  end if;
  return jsonb_build_object('ok',true,'orderId',o.id,'amount',o.amount,'email',o.email,'status',o.status);
end $$;

-- Only the Worker calls this, after GET /payments/{key} validates provider state.
create function public.class_checkout_settle(p_order_id text,p_payment_key text,p_amount integer,p_status text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare o public.class_checkout_orders;
begin
  select * into o from public.class_checkout_orders where id=p_order_id for update;
  if not found or o.payment_key is distinct from p_payment_key or o.amount is distinct from p_amount then
    return jsonb_build_object('ok',false,'error','payment_mismatch'); end if;
  if p_status='CANCELED' then
    -- Remove only rows actually inserted by this order, never prior ownership.
    delete from public.class_verifications v using public.class_checkout_grants g
      where g.order_id=o.id and v.email=g.email and v.book_code=g.book_code
        and v.verified_at=g.verified_at and v.enrollment_email=o.email;
    update public.class_checkout_orders set status='canceled',updated_at=now() where id=o.id;
    return jsonb_build_object('ok',true,'status','canceled','granted',false);
  elsif p_status='PARTIAL_CANCELED' then
    if o.status<>'canceled' then
      update public.class_checkout_orders set status='partial_refund_review',updated_at=now() where id=o.id;
    end if;
    return jsonb_build_object('ok',true,'status','partial_refund_review','granted',false);
  elsif p_status in ('ABORTED','EXPIRED') then
    if o.status in ('ready','confirming') then
      update public.class_checkout_orders set status='expired',updated_at=now() where id=o.id;
      return jsonb_build_object('ok',true,'status','expired','granted',false);
    end if;
    return jsonb_build_object('ok',false,'error','order_closed');
  elsif p_status<>'DONE' then
    return jsonb_build_object('ok',false,'error','payment_pending');
  end if;
  if o.status not in ('confirming','paid') then return jsonb_build_object('ok',false,'error','order_closed'); end if;
  if o.status='confirming' then
    with inserted as (
      insert into public.class_verifications(email,book_code,enrollment_email)
        select o.email,book,o.email from unnest(o.missing_books) book
        where not exists(select 1 from public.class_redemptions r where lower(r.redeemed_by)=o.email and r.book_code=book)
        on conflict(email,book_code) do nothing returning email,book_code,verified_at
    ) insert into public.class_checkout_grants(order_id,email,book_code,verified_at)
      select o.id,email,book_code,verified_at from inserted;
    update public.class_checkout_orders set status='paid',updated_at=now() where id=o.id;
  end if;
  return jsonb_build_object('ok',true,'status','paid','granted',true,'orderId',o.id);
end $$;

revoke all on function public.class_checkout_quote(uuid),public.class_checkout_prepare(uuid,integer,text,text),
 public.class_checkout_claim(uuid,text,text,integer),public.class_checkout_settle(text,text,integer,text) from public,anon,authenticated;
grant execute on function public.class_checkout_quote(uuid),public.class_checkout_prepare(uuid,integer,text,text),
 public.class_checkout_claim(uuid,text,text,integer),public.class_checkout_settle(text,text,integer,text) to service_role;

create function private.guard_class_checkout_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stella-upgrade:'||new.user_id::text,0));
  if new.status in ('pending','coupon_issued','completed') and exists (
    select 1 from public.class_checkout_orders where user_id=new.user_id
      and (status in ('confirming','paid','partial_refund_review') or (status='ready' and expires_at>now()))
  ) then raise exception 'class_checkout_pending'; end if;
  return new;
end $$;
revoke all on function private.guard_class_checkout_request() from public,anon,authenticated;
create trigger guard_class_checkout_request before insert or update on public.stella_upgrade_requests
  for each row execute function private.guard_class_checkout_request();
