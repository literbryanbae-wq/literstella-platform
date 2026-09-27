-- Operator-controlled HTTP pilot. Seeded disabled; activation is a separate step.
-- User-approved: fixed first 100 consenting members; results retained for 30 days.
-- Service-role RPC only. No raw audio column or stand-alone enrollment endpoint.
begin;
create schema if not exists private;

create table private.pronunciation_policy_v1 (
  pilot_id text primary key check (pilot_id = 'english-pronunciation-pilot-20260923'),
  enabled boolean not null default false,
  privacy_version text not null default 'etri-member-http-pilot-20260928-v2'
    check (privacy_version = 'etri-member-http-pilot-20260928-v2'),
  audience text not null default 'members' check (audience = 'members'),
  transport text not null default 'http-test' check (transport = 'http-test'),
  runtime text not null default 'operator-controlled' check (runtime = 'operator-controlled'),
  result_retention_days integer not null default 30 check (result_retention_days = 30),
  activated_at timestamptz,
  expires_at timestamptz check (expires_at is null),
  check (not enabled or (activated_at is not null and isfinite(activated_at)))
);
insert into private.pronunciation_policy_v1(pilot_id)
values ('english-pronunciation-pilot-20260923');

create table private.pronunciation_roster_v1 (
  slot smallint primary key check (slot between 1 and 100),
  auth_uid uuid unique references auth.users(id) on delete set null,
  state text not null default 'enrolled' check (state in ('enrolled', 'revoked')),
  enrolled_at timestamptz not null default now()
);
-- Withdrawal erases identity but retains the consumed lifetime pilot slot.
create function private.pronunciation_roster_guard_v1() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'fixed_roster_slot'; end if;
  if new.slot <> old.slot or (new.auth_uid is distinct from old.auth_uid and new.auth_uid is not null)
    then raise exception 'fixed_roster_identity'; end if;
  return new;
end $$;
create trigger pronunciation_fixed_roster before update or delete
on private.pronunciation_roster_v1 for each row execute function private.pronunciation_roster_guard_v1();

create table private.pronunciation_daily_v1 (
  day date primary key,
  reserved integer not null default 0 check (reserved between 0 and 1000)
);
create table private.pronunciation_member_daily_v1 (
  auth_uid uuid not null references auth.users(id) on delete cascade,
  day date not null,
  reserved integer not null default 0 check (reserved between 0 and 10),
  primary key(auth_uid, day)
);
create table private.pronunciation_requests_v1 (
  auth_uid uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  day date not null,
  consent_version text not null,
  consented_at timestamptz not null default clock_timestamp(),
  lease_id uuid not null default gen_random_uuid(),
  state text not null check (state in ('pending','uncertain','completed')),
  reserved_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz not null default clock_timestamp() + interval '5 minutes',
  result jsonb,
  saved_at timestamptz,
  provider text not null default 'etri' check (provider = 'etri'),
  provenance text not null default 'server-provider-response.v1' check (provenance = 'server-provider-response.v1'),
  primary key(auth_uid, request_id),
  check ((state = 'completed') = (result is not null and saved_at is not null))
);
-- Facts only. This is NOT the member effort ledger and NOT a dispatched event.
create table private.pronunciation_effort_outbox_v1 (
  auth_uid uuid not null,
  request_id uuid not null,
  occurred_at timestamptz not null,
  duration_ms integer not null check (duration_ms between 1000 and 60000),
  primary key(auth_uid, request_id),
  foreign key(auth_uid, request_id) references private.pronunciation_requests_v1 on delete cascade
);

alter table private.pronunciation_policy_v1 enable row level security;
alter table private.pronunciation_roster_v1 enable row level security;
alter table private.pronunciation_daily_v1 enable row level security;
alter table private.pronunciation_member_daily_v1 enable row level security;
alter table private.pronunciation_requests_v1 enable row level security;
alter table private.pronunciation_effort_outbox_v1 enable row level security;
revoke all on private.pronunciation_policy_v1, private.pronunciation_roster_v1,
  private.pronunciation_daily_v1, private.pronunciation_member_daily_v1,
  private.pronunciation_requests_v1, private.pronunciation_effort_outbox_v1
  from public, anon, authenticated, service_role;
revoke all on function private.pronunciation_roster_guard_v1() from public, anon, authenticated, service_role;

create function private.pronunciation_require_member_v1(p_auth_uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_auth_uid is null or not exists (select 1 from auth.users u where u.id = p_auth_uid
    and coalesce(u.is_anonymous,false) = false and u.deleted_at is null and u.email_confirmed_at is not null)
    then raise exception 'member_required'; end if;
end $$;
revoke all on function private.pronunciation_require_member_v1(uuid) from public, anon, authenticated, service_role;

create function public.pronunciation_policy_v1(p_auth_uid uuid, p_pilot_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cfg private.pronunciation_policy_v1;
begin
  perform private.pronunciation_require_member_v1(p_auth_uid);
  select * into cfg from private.pronunciation_policy_v1 where pilot_id = p_pilot_id;
  if not found then raise exception 'assessment_not_ready'; end if;
  return jsonb_build_object('authUid',p_auth_uid,'pilotId',cfg.pilot_id,
    'enabled',coalesce(cfg.enabled and cfg.activated_at <= clock_timestamp(),false),
    'privacyVersion',cfg.privacy_version,'activatedAt',cfg.activated_at,'expiresAt',cfg.expires_at,
    'audience',cfg.audience,'transport',cfg.transport,'runtime',cfg.runtime,
    'resultRetentionDays',cfg.result_retention_days);
end $$;

create function private.pronunciation_view_v1(r private.pronunciation_requests_v1) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('authUid', r.auth_uid, 'state',
    case when r.state = 'pending' and r.lease_until < now() then 'uncertain' else r.state end)
  || case when r.state = 'completed' then jsonb_build_object('result', r.result,
       'receipt', jsonb_build_object('requestId', r.request_id, 'status', 'saved', 'savedAt', r.saved_at)) else '{}'::jsonb end;
$$;
revoke all on function private.pronunciation_view_v1(private.pronunciation_requests_v1) from public, anon, authenticated, service_role;

create function public.pronunciation_pilot_v1(p_auth_uid uuid, p_pilot_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pronunciation_require_member_v1(p_auth_uid);
  if p_pilot_id is distinct from 'english-pronunciation-pilot-20260923' then raise exception 'assessment_not_ready'; end if;
  return jsonb_build_object('authUid', p_auth_uid, 'pilotId', p_pilot_id,
    'state', coalesce((select state from private.pronunciation_roster_v1 where auth_uid = p_auth_uid), 'not_enrolled'),
    'enrolledCount', (select count(*) from private.pronunciation_roster_v1));
end;
$$;

create function public.pronunciation_reserve_v1(
  p_auth_uid uuid, p_request_id uuid, p_input_hash text, p_pilot_id text, p_consent_version text,
  p_consent boolean, p_enroll_on_consent boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r private.pronunciation_requests_v1;
  cfg private.pronunciation_policy_v1;
  d date;
  total integer;
  member_total integer;
  roster_state text;
  next_slot smallint;
begin
  if p_auth_uid is null or p_request_id is null or p_input_hash is null
     or p_input_hash !~ '^[0-9a-f]{64}$' or p_consent_version is null
     or length(p_consent_version) not between 1 and 100 then raise exception 'invalid_request'; end if;
  perform private.pronunciation_require_member_v1(p_auth_uid);
  if p_consent is distinct from true or p_enroll_on_consent is distinct from true
     or p_consent_version is distinct from 'etri-member-http-pilot-20260928-v2' then raise exception 'assessment_consent_required'; end if;
  -- Per-request lock also prevents midnight retries reserving twice on different day locks.
  perform pg_advisory_xact_lock(hashtextextended(p_auth_uid::text || ':' || p_request_id::text, 28092026));
  select * into r from private.pronunciation_requests_v1 where auth_uid = p_auth_uid and request_id = p_request_id;
  if found then
    if r.input_hash <> p_input_hash then return jsonb_build_object('authUid',p_auth_uid,'state','conflict'); end if;
    return private.pronunciation_view_v1(r);
  end if;
  -- One pilot policy row serializes first-cohort claims as well as disable/expiry checks.
  select * into cfg from private.pronunciation_policy_v1 where pilot_id = p_pilot_id for update;
  if not found or not cfg.enabled or cfg.privacy_version is distinct from p_consent_version
    or cfg.runtime <> 'operator-controlled' or cfg.result_retention_days <> 30
    or cfg.activated_at is null or not isfinite(cfg.activated_at) or cfg.expires_at is not null
    or cfg.activated_at > clock_timestamp()
    then raise exception 'assessment_not_ready'; end if;
  select state into roster_state from private.pronunciation_roster_v1 where auth_uid = p_auth_uid for share;
  if roster_state = 'revoked' then return jsonb_build_object('authUid',p_auth_uid,'state','pilot_required'); end if;
  if roster_state is null then
    select min(s)::smallint into next_slot from generate_series(1,100) s
      where not exists (select 1 from private.pronunciation_roster_v1 where slot=s);
    if next_slot is null then return jsonb_build_object('authUid',p_auth_uid,'state','pilot_limit'); end if;
  end if;
  -- Internal app budgets use DB time in Asia/Seoul; no caller date/limit is accepted.
  -- ETRI's official account-wide reset timezone is NOT established by this policy.
  d := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  insert into private.pronunciation_daily_v1(day) values(d) on conflict do nothing;
  select reserved into total from private.pronunciation_daily_v1 where day = d for update;
  insert into private.pronunciation_member_daily_v1(auth_uid,day) values(p_auth_uid,d) on conflict do nothing;
  select reserved into member_total from private.pronunciation_member_daily_v1 where auth_uid = p_auth_uid and day = d for update;
  if member_total >= 10 then return jsonb_build_object('authUid',p_auth_uid,'state','daily_limit'); end if;
  if total >= 1000 then return jsonb_build_object('authUid',p_auth_uid,'state','service_limit'); end if;
  if roster_state is null then
    insert into private.pronunciation_roster_v1(slot,auth_uid) values(next_slot,p_auth_uid);
  end if;
  update private.pronunciation_daily_v1 set reserved = reserved + 1 where day = d;
  update private.pronunciation_member_daily_v1 set reserved = reserved + 1 where auth_uid = p_auth_uid and day = d;
  insert into private.pronunciation_requests_v1(auth_uid,request_id,input_hash,day,consent_version,state)
    values(p_auth_uid,p_request_id,p_input_hash,d,p_consent_version,'pending') returning * into r;
  return jsonb_build_object('authUid',p_auth_uid,'state','reserved','leaseId',r.lease_id);
end $$;

create function public.pronunciation_complete_v1(p_auth_uid uuid, p_request_id uuid, p_lease_id uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r private.pronunciation_requests_v1;
  normalized jsonb;
  assessed timestamptz;
  duration integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_auth_uid::text || ':' || p_request_id::text, 28092026));
  select * into r from private.pronunciation_requests_v1 where auth_uid = p_auth_uid and request_id = p_request_id for update;
  if not found or p_lease_id is null or r.lease_id <> p_lease_id then raise exception 'invalid_lease'; end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then raise exception 'invalid_result'; end if;
  if exists (select 1 from jsonb_object_keys(p_result) k where k not in
     ('version','requestId','script','recognized','score','sample','scale','skill','evidence','durationMs','assessedAt'))
     then raise exception 'invalid_result_keys'; end if;
  if (p_result->>'version' = 'sentence-pronunciation.v1'
      and p_result->>'requestId' = p_request_id::text
      and p_result->'sample' = 'false'::jsonb
      and jsonb_typeof(p_result->'script') = 'string' and length(p_result->>'script') between 1 and 500
      and jsonb_typeof(p_result->'recognized') = 'string' and length(p_result->>'recognized') <= 2000
      and jsonb_typeof(p_result->'score') = 'number'
      and jsonb_typeof(p_result->'durationMs') = 'number'
      and jsonb_typeof(p_result->'assessedAt') = 'string') is not true then raise exception 'invalid_result'; end if;
  if (p_result->>'score')::numeric not between 1 and 5
     or (p_result->>'durationMs')::numeric not between 1000 and 60000
     or trunc((p_result->>'durationMs')::numeric) <> (p_result->>'durationMs')::numeric then raise exception 'invalid_result'; end if;
  assessed := (p_result->>'assessedAt')::timestamptz;
  if not isfinite(assessed) or assessed < r.reserved_at - interval '1 minute'
     or assessed > clock_timestamp() + interval '1 minute' then raise exception 'invalid_assessed_time'; end if;
  duration := (p_result->>'durationMs')::integer;
  normalized := p_result || jsonb_build_object('scale',jsonb_build_object('min',1,'max',5),
    'skill','speaking','evidence','sentence_pronunciation');
  if r.state = 'completed' then
    if r.result <> normalized then raise exception 'completion_conflict'; end if;
    return private.pronunciation_view_v1(r)->'receipt';
  end if;
  update private.pronunciation_requests_v1 set state = 'completed', result = normalized, saved_at = clock_timestamp()
    where auth_uid = p_auth_uid and request_id = p_request_id returning * into r;
  insert into private.pronunciation_effort_outbox_v1(auth_uid,request_id,occurred_at,duration_ms)
    values(p_auth_uid,p_request_id,assessed,duration);
  return private.pronunciation_view_v1(r)->'receipt';
end $$;

create function public.pronunciation_uncertain_v1(p_auth_uid uuid, p_request_id uuid, p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r private.pronunciation_requests_v1;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_auth_uid::text || ':' || p_request_id::text, 28092026));
  select * into r from private.pronunciation_requests_v1 where auth_uid = p_auth_uid and request_id = p_request_id for update;
  if not found or p_lease_id is null or r.lease_id <> p_lease_id then raise exception 'invalid_lease'; end if;
  if r.state = 'pending' then
    update private.pronunciation_requests_v1 set state = 'uncertain' where auth_uid = p_auth_uid and request_id = p_request_id returning * into r;
  end if;
  return private.pronunciation_view_v1(r);
end $$;

create function public.pronunciation_get_v1(p_auth_uid uuid, p_request_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select private.pronunciation_view_v1(r) from private.pronunciation_requests_v1 r
    where auth_uid = p_auth_uid and request_id = p_request_id;
$$;

revoke all on function public.pronunciation_pilot_v1(uuid,text), public.pronunciation_policy_v1(uuid,text),
  public.pronunciation_reserve_v1(uuid,uuid,text,text,text,boolean,boolean),
  public.pronunciation_complete_v1(uuid,uuid,uuid,jsonb),
  public.pronunciation_uncertain_v1(uuid,uuid,uuid), public.pronunciation_get_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.pronunciation_pilot_v1(uuid,text), public.pronunciation_policy_v1(uuid,text),
  public.pronunciation_reserve_v1(uuid,uuid,text,text,text,boolean,boolean),
  public.pronunciation_complete_v1(uuid,uuid,uuid,jsonb),
  public.pronunciation_uncertain_v1(uuid,uuid,uuid), public.pronunciation_get_v1(uuid,uuid)
  to service_role;
-- Keep the fixed cohort and non-content counters; remove result-bearing requests
-- and their facts-only outbox after 30 days. Deduplication lasts that same window.
create index pronunciation_request_retention_v1 on private.pronunciation_requests_v1(reserved_at);
create function private.pronunciation_purge_v1() returns bigint
language plpgsql security definer set search_path = '' as $$
declare removed bigint;
begin
  delete from private.pronunciation_requests_v1
    where reserved_at <= clock_timestamp() - interval '30 days'
      and coalesce((result->>'assessedAt')::timestamptz, reserved_at)
        <= clock_timestamp() - interval '30 days';
  get diagnostics removed = row_count;
  delete from private.pronunciation_member_daily_v1
    where day < (clock_timestamp() at time zone 'Asia/Seoul')::date - 30;
  delete from private.pronunciation_daily_v1
    where day < (clock_timestamp() at time zone 'Asia/Seoul')::date - 30;
  return removed;
end $$;
revoke all on function private.pronunciation_purge_v1() from public, anon, authenticated, service_role;
-- BEGIN PRODUCTION CRON
select cron.schedule('pronunciation-results-retention-v1', '15 * * * *',
  'select private.pronunciation_purge_v1()');
-- END PRODUCTION CRON
commit;
