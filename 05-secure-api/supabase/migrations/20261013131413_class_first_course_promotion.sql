-- First paid course: server-priced orders, order-scoped beta access and 300P.
create table private.first_course_campaign (
 id text primary key check(id='first-course-2026'), enabled boolean not null default false,
 starts_at timestamptz not null default now(), ends_at timestamptz not null default '2027-01-01T00:00:00+09:00',
 premium_enabled boolean not null default true
);
insert into private.first_course_campaign(id) values('first-course-2026');
create table private.first_course_grants (
 order_id text primary key references public.class_checkout_orders(id),
 auth_uid uuid not null unique, identities text[] not null,
 granted_at timestamptz not null default now(), revoked_at timestamptz,
 point_user_id uuid references public.users(id), points_revoked boolean not null default false
);
alter table private.first_course_campaign enable row level security;
alter table private.first_course_grants enable row level security;
revoke all on private.first_course_campaign,private.first_course_grants from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update on private.first_course_campaign,private.first_course_grants to service_role;
alter table public.class_checkout_orders add column promotion jsonb;
alter table public.class_checkout_orders drop constraint class_checkout_orders_amount_check;
alter table public.class_checkout_orders add constraint class_checkout_orders_amount_check check (
 (product_code='class-stella-member-upgrade' and amount between 48000 and 348000)
 or (product_code in ('class-kidari-lifetime','class-anne-lifetime','class-pride-lifetime','class-littlewomen1-lifetime','class-littlewomen2-lifetime','class-gatsby-lifetime','class-sherlock-lifetime','class-theory-lifetime') and amount between 39000 and 128000)
);

create function private.first_course_identities(p_uid uuid) returns text[]
language sql stable security invoker set search_path='' as $$
 select coalesce(array_agg(distinct email order by email),'{}'::text[]) from (
 select lower(btrim(u.email)) email from auth.users u where u.id=p_uid and u.email_confirmed_at is not null
 union select lower(btrim(v.enrollment_email)) from public.class_verifications v join auth.users u on lower(btrim(v.email))=lower(btrim(u.email))
 where u.id=p_uid and u.email_confirmed_at is not null and nullif(btrim(v.enrollment_email),'') is not null
 ) x
$$;

create function private.first_course_offer(p_uid uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ids text[]:=private.first_course_identities(p_uid); reason text:='eligible'; c private.first_course_campaign;
begin
 select * into c from private.first_course_campaign where id='first-course-2026';
 if cardinality(ids)=0 then reason:='login_required';
 elsif not c.enabled or now()<c.starts_at or now()>=c.ends_at then reason:='closed';
 elsif exists(select 1 from private.first_course_grants where auth_uid=p_uid or identities && ids) then reason:='used';
 elsif exists(select 1 from public.class_checkout_orders where (user_id=p_uid or lower(email)=any(ids)) and status in ('paid','canceled','partial_refund_review'))
 then reason:='previous_purchase';
 elsif exists(select 1 from public.class_enrollments where lower(btrim(email))=any(ids) and not (book_code='theory' and coalesce(source,'') like 'auto-theory-%'))
 or exists(select 1 from public.class_verifications where lower(btrim(email))=any(ids) and book_code<>'theory')
 or exists(select 1 from public.class_redemptions where lower(btrim(redeemed_by))=any(ids))
 or exists(select 1 from public.class_access_passes where lower(btrim(email))=any(ids))
 then reason:='history_review';
 elsif exists(select 1 from public.class_checkout_orders where user_id<>p_uid and promotion->>'id'='first-course-2026'
 and (status='confirming' or (status='ready' and expires_at>now()))
 and (lower(email)=any(ids) or exists(select 1 from jsonb_array_elements_text(promotion->'identities') a where a.value=any(ids))))
 then reason:='payment_pending'; end if;
 return jsonb_build_object('id','first-course-2026','applied',reason='eligible','reason',reason,'discount',case when reason='eligible' then 30000 else 0 end,
 'endsAt',c.ends_at,'premium','beta','points',300,'policyVersion','first-course-2026-v1','conditionsUrl','https://class-new.literstella.co.kr/events/first-course');
end $$;

alter function public.class_course_checkout_quote(uuid,text) set schema private;
alter function private.class_course_checkout_quote(uuid,text) rename to first_course_quote_base;
create function public.class_course_checkout_quote(p_user_id uuid,p_book_code text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare q jsonb:=private.first_course_quote_base(p_user_id,p_book_code); offer jsonb;
begin
 if q->>'ok'<>'true' then return q; end if;
 if p_book_code='theory' or q->>'eligible'<>'true' then return q; end if;
 offer:=private.first_course_offer(p_user_id);
 return q||jsonb_build_object('amount',(q->>'amount')::integer-(offer->>'discount')::integer,
 'creditAmount',(offer->>'discount')::integer,'promotion',offer);
end $$;

alter function public.class_course_checkout_prepare(uuid,text,integer,text,text) set schema private;
alter function private.class_course_checkout_prepare(uuid,text,integer,text,text) rename to first_course_prepare_base;
create function public.class_course_checkout_prepare(p_user_id uuid,p_book_code text,p_expected_amount integer,p_terms_version text,p_terms_url text,p_promotion_version text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare q jsonb; r jsonb;
begin
 -- All promotion mutations take the same lock before existing order/user locks.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('first-course-2026',0));
 q:=public.class_course_checkout_quote(p_user_id,p_book_code);
 if q#>>'{promotion,applied}'='true' and p_promotion_version is distinct from q#>>'{promotion,policyVersion}' then
  return jsonb_build_object('ok',false,'error','terms_changed');
 end if;
 r:=private.first_course_prepare_base(p_user_id,p_book_code,p_expected_amount,p_terms_version,p_terms_url);
 if r->>'ok'='true' and q#>>'{promotion,applied}'='true' then
  update public.class_checkout_orders set promotion=(q->'promotion')||jsonb_build_object('identities',private.first_course_identities(p_user_id)) where id=r->>'orderId';
 end if;
 return r;
end $$;

alter function public.class_checkout_claim(uuid,text,text,integer) set schema private;
alter function private.class_checkout_claim(uuid,text,text,integer) rename to first_course_claim_base;
create function public.class_checkout_claim(p_user_id uuid,p_order_id text,p_payment_key text,p_amount integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('first-course-2026',0));
 return private.first_course_claim_base(p_user_id,p_order_id,p_payment_key,p_amount);
end $$;

create function private.first_course_sync_points(p_uid uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare g private.first_course_grants; profile uuid;
begin
 select * into g from private.first_course_grants where auth_uid=p_uid for update;
 if not found then return; end if;
 if g.point_user_id is null and g.revoked_at is null then
  select u.id into profile from public.users u join auth.users a on a.id=u.auth_uid and lower(btrim(a.email))=lower(btrim(u.email))
  where a.id=p_uid and a.email_confirmed_at is not null order by u.id limit 1;
  if profile is not null then
   insert into public.point_transactions(user_id,amount,reason,ref_id,memo)
   values(profile,300,'adjust','first-course:'||g.order_id,'첫 유료 수강 이벤트 300P') on conflict(user_id,reason,ref_id) do nothing;
   update private.first_course_grants set point_user_id=profile where order_id=g.order_id;
  end if;
 elsif g.point_user_id is not null and g.revoked_at is not null and not g.points_revoked then
  insert into public.point_transactions(user_id,amount,reason,ref_id,memo)
  values(g.point_user_id,-300,'adjust','first-course-refund:'||g.order_id,'첫 수강 전액 환불 · 이벤트 300P 회수') on conflict(user_id,reason,ref_id) do nothing;
  update private.first_course_grants set points_revoked=true where order_id=g.order_id;
 end if;
end $$;

create function private.first_course_profile_points() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.auth_uid is not null and (auth.uid() is null or auth.uid()=new.auth_uid) then
  perform private.first_course_sync_points(new.auth_uid);
 end if;
 return new;
end $$;
create trigger first_course_profile_points after insert or update of auth_uid,email on public.users
for each row execute function private.first_course_profile_points();

alter function public.class_checkout_settle(text,text,integer,text) set schema private;
alter function private.class_checkout_settle(text,text,integer,text) rename to first_course_settle_base;
create function public.class_checkout_settle(p_order_id text,p_payment_key text,p_amount integer,p_status text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb; o public.class_checkout_orders; ids text[];
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('first-course-2026',0));
 r:=private.first_course_settle_base(p_order_id,p_payment_key,p_amount,p_status);
 if r->>'ok'<>'true' then return r; end if;
 select * into o from public.class_checkout_orders where id=p_order_id;
 if o.promotion->>'id'='first-course-2026' then
  if o.status='paid' then
   select array_agg(value) into ids from jsonb_array_elements_text(o.promotion->'identities');
   insert into private.first_course_grants(order_id,auth_uid,identities) values(o.id,o.user_id,ids) on conflict(order_id) do nothing;
  elsif o.status='canceled' then
   update private.first_course_grants set revoked_at=coalesce(revoked_at,now()) where order_id=o.id;
  end if;
  perform private.first_course_sync_points(o.user_id);
  r:=r||jsonb_build_object('promotion',jsonb_build_object('id','first-course-2026','premiumActive',o.status='paid',
   'points',case when o.status='paid' then 300 else 0 end));
 end if;
 return r;
end $$;

create function private.first_course_premium_active(p_uid uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.first_course_grants g,private.first_course_campaign c
 where g.auth_uid=p_uid and g.revoked_at is null and c.id='first-course-2026' and c.premium_enabled)
$$;

-- Keep panel admission/consent/100-seat accounting separate from purchase access.
alter function public.growth_panel_request(text,text,uuid,text,jsonb) set schema private;
alter function private.growth_panel_request(text,text,uuid,text,jsonb) rename to first_course_panel_base;
create function public.growth_panel_request(p_action text,p_campaign_id text,p_auth_uid uuid,p_auth_email text,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb;
begin
 r:=private.first_course_panel_base(p_action,p_campaign_id,p_auth_uid,p_auth_email,p_payload);
 if p_action='status' and r->>'ok'='true' then
  r:=jsonb_set(r,'{member,firstCoursePremium}',to_jsonb(private.first_course_premium_active(p_auth_uid)));
 end if;
 return r;
end $$;

revoke all on function public.class_course_checkout_quote(uuid,text),public.class_course_checkout_prepare(uuid,text,integer,text,text,text),public.class_checkout_claim(uuid,text,text,integer),public.class_checkout_settle(text,text,integer,text),public.growth_panel_request(text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.class_course_checkout_quote(uuid,text),public.class_course_checkout_prepare(uuid,text,integer,text,text,text),public.class_checkout_claim(uuid,text,text,integer),public.class_checkout_settle(text,text,integer,text),public.growth_panel_request(text,text,uuid,text,jsonb) to service_role;
do $$ declare f record; begin
 for f in select oid::regprocedure sig from pg_proc where pronamespace='private'::regnamespace and proname like 'first_course_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
