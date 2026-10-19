begin;
create schema if not exists private;
create table public.class_migration_offer_outbox (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and length(email) between 3 and 254),
  linked_at timestamptz not null check (linked_at >= '2026-10-19T10:01:03Z'),
  status text not null default 'pending' check (status in ('pending','processing','accepted','skipped','failed','review')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  lease_until timestamptz,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  provider_email_id text,
  last_error text,
  envelope jsonb check (envelope is null or (jsonb_typeof(envelope) = 'object' and octet_length(envelope::text) <= 32768)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.class_migration_offer_outbox enable row level security;
revoke all on public.class_migration_offer_outbox from public, anon, authenticated;
grant all on public.class_migration_offer_outbox to service_role;
create policy service_only on public.class_migration_offer_outbox for all to service_role using (true) with check (true);
create index class_migration_offer_due on public.class_migration_offer_outbox(next_attempt_at)
  where status in ('pending','processing');

-- Every successful linking path writes this table, including recovery/admin SQL.
-- Duplicate login upserts do not insert a row, so cannot enqueue another email.
create function private.queue_class_migration_offer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.verified_at >= '2026-10-19T10:01:03Z'::timestamptz
    and nullif(btrim(new.enrollment_email),'') is not null
    and new.book_code in ('kidari','anne','pride','littlewomen1','littlewomen2','gatsby','sherlock','theory') then
    insert into public.class_migration_offer_outbox(email, linked_at)
      values (lower(btrim(new.email)), new.verified_at) on conflict (email) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_class_migration_offer() from public, anon, authenticated;
create trigger class_migration_offer_linked after insert on public.class_verifications
  for each row execute function private.queue_class_migration_offer();

-- Only post-request links are backfilled; old roster rows are not an audience.
insert into public.class_migration_offer_outbox(email,linked_at)
select lower(btrim(email)),min(verified_at) from public.class_verifications
where verified_at >= '2026-10-19T10:01:03Z'::timestamptz
  and nullif(btrim(enrollment_email),'') is not null
  and book_code in ('kidari','anne','pride','littlewomen1','littlewomen2','gatsby','sherlock','theory')
group by lower(btrim(email)) on conflict(email) do nothing;

create function public.class_migration_offer_claim() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare job public.class_migration_offer_outbox;
begin
  -- Never resend an uncertain attempt beyond the provider idempotency window.
  update public.class_migration_offer_outbox
    set status='review',last_error='retry_window_exhausted',lease_token=null,lease_until=null,updated_at=now()
    where (status='pending' or (status='processing' and lease_until < now()))
      and (attempts >= 6 or first_attempt_at < now() - interval '23 hours');
  select * into job from public.class_migration_offer_outbox
    where (status='pending' or (status='processing' and lease_until < now()))
      and next_attempt_at <= now() and attempts < 6
    order by next_attempt_at,id for update skip locked limit 1;
  if not found then return null; end if;
  update public.class_migration_offer_outbox set status='processing',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',
    first_attempt_at=coalesce(first_attempt_at,now()),updated_at=now()
    where id=job.id returning * into job;
  return to_jsonb(job);
end;
$$;
revoke all on function public.class_migration_offer_claim() from public, anon, authenticated;
grant execute on function public.class_migration_offer_claim() to service_role;
commit;
