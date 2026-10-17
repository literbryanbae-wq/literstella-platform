-- New paid transitions only; do not backfill historical orders.
create table public.class_checkout_email_outbox (
 id uuid primary key default gen_random_uuid(),
 order_id text not null references public.class_checkout_orders(id),
 audience text not null check (audience in ('member','admin')),
 status text not null default 'pending' check (status in ('pending','processing','accepted','failed','review','canceled')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 first_attempt_at timestamptz,
 lease_token uuid,
 lease_until timestamptz,
 envelope jsonb,
 provider_email_id text,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(order_id,audience)
);
alter table public.class_checkout_email_outbox enable row level security;
revoke all on public.class_checkout_email_outbox from public,anon,authenticated;
grant select,insert,update on public.class_checkout_email_outbox to service_role;
create index class_checkout_email_pending on public.class_checkout_email_outbox(next_attempt_at)
 where status in ('pending','processing');

create function private.class_checkout_enqueue_email() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='paid' and old.status is distinct from 'paid' then
  insert into public.class_checkout_email_outbox(order_id,audience)
   values(new.id,'member'),(new.id,'admin') on conflict(order_id,audience) do nothing;
 elsif new.status in ('canceled','partial_refund_review','expired') then
  update public.class_checkout_email_outbox set status='canceled',lease_token=null,lease_until=null,updated_at=now()
   where order_id=new.id and status in ('pending','processing','failed','review');
 end if;
 return new;
end $$;
revoke all on function private.class_checkout_enqueue_email() from public,anon,authenticated;
create trigger class_checkout_enqueue_email after update of status on public.class_checkout_orders
 for each row execute function private.class_checkout_enqueue_email();

create function public.class_checkout_email_claim(p_order_id text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.class_checkout_email_outbox; o public.class_checkout_orders;
begin
 -- Resend deduplicates for 24h only: ambiguous older attempts require manual review.
 update public.class_checkout_email_outbox set status='review',last_error='retry_window_expired',updated_at=now()
 where status in ('pending','processing') and (lease_until is null or lease_until<now())
 and (first_attempt_at<now()-interval '23 hours' or attempts>=10);
 select e.* into j from public.class_checkout_email_outbox e
 where e.status in ('pending','processing') and e.next_attempt_at<=now()
 and (e.lease_until is null or e.lease_until<now()) and (p_order_id is null or e.order_id=p_order_id)
 order by e.created_at,e.audience desc for update skip locked limit 1;
 if not found then return null; end if;
 select * into o from public.class_checkout_orders where id=j.order_id;
 if o.status<>'paid' then
  update public.class_checkout_email_outbox set status='canceled',updated_at=now() where id=j.id;
  return null;
 end if;
 update public.class_checkout_email_outbox set status='processing',attempts=attempts+1,
 first_attempt_at=coalesce(first_attempt_at,now()),lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now()
 where id=j.id returning * into j;
 return jsonb_build_object('job',to_jsonb(j),'order',to_jsonb(o));
end $$;
revoke all on function public.class_checkout_email_claim(text) from public,anon,authenticated;
grant execute on function public.class_checkout_email_claim(text) to service_role;
