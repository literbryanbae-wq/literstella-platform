-- Approved 2026-10-11: unlimited speaking trial for utilization measurement.
-- Activation, expiry, authentication, entitlement, concurrency and retention stay intact.
-- No recordings/transcripts or additional personal data are introduced.
alter table private.speaking_policy_v1 drop constraint speaking_policy_v1_check;
alter table private.speaking_policy_v1 add constraint speaking_policy_v1_expiry_check
  check (not enabled or expires_at is not null);
alter table private.speaking_policy_v1 add column usage_mode text not null default 'unlimited-trial'
  check (usage_mode='unlimited-trial');
update private.speaking_policy_v1 set service_daily_limit=null where singleton;
alter table private.speaking_policy_v1 add constraint speaking_policy_v1_unlimited_check
  check (service_daily_limit is null);

create or replace function public.speaking_trial_v1(p_action text, p_auth_uid uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  cfg private.speaking_policy_v1;
  item private.speaking_requests_v1;
  today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  id uuid; score jsonb; observation record; outcome jsonb;
  used integer; active integer;
begin
  if p_auth_uid is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'speaking_input_invalid'; end if;
  select * into cfg from private.speaking_policy_v1 where singleton;
  if p_action='policy' then
    return jsonb_build_object('enabled',cfg.enabled,'expiresAt',cfg.expires_at,'usageMode',cfg.usage_mode,'memberDailyLimit',null,
      'serviceDailyLimit',cfg.service_daily_limit,'maxConcurrent',cfg.max_concurrent,
      'resultRetentionDays',30,'privacyVersion','speaking-scores-only-20261009');
  end if;
  if p_action='status' then
    select count(*) into used from private.speaking_requests_v1 where auth_uid=p_auth_uid and day=today;
    return jsonb_build_object('usageMode',cfg.usage_mode,'usedToday',used);
  end if;
  id := (p_payload->>'requestId')::uuid;
  if id is null then raise exception 'speaking_input_invalid'; end if;
  if p_action='claim' then
    -- Global transaction lock serializes concurrency + idempotency checks. Usage is measured, not capped.
    perform pg_advisory_xact_lock(20261011,1);
    select * into cfg from private.speaking_policy_v1 where singleton;
    if not cfg.enabled or cfg.expires_at is null or cfg.expires_at <= clock_timestamp() then raise exception 'speaking_not_ready'; end if;
    if p_payload->>'consentVersion' is distinct from 'speaking-scores-only-20261009'
      or coalesce(p_payload->>'inputHash','') !~ '^[0-9a-f]{64}$' then raise exception 'speaking_input_invalid'; end if;
    select * into item from private.speaking_requests_v1 where auth_uid=p_auth_uid and request_id=id;
    if found then
      return jsonb_build_object('authUid',p_auth_uid,'state',case
        when item.input_hash <> p_payload->>'inputHash' then 'conflict'
        when item.state='reserved' and item.lease_until <= clock_timestamp() then 'uncertain'
        when item.state='reserved' then 'pending' else item.state end);
    end if;
    select count(*) into active from private.speaking_requests_v1 where state='reserved' and lease_until>clock_timestamp();
    if active>=cfg.max_concurrent then return jsonb_build_object('authUid',p_auth_uid,'state','busy'); end if;
    insert into private.speaking_requests_v1(auth_uid,request_id,input_hash,day,consent_version)
      values(p_auth_uid,id,p_payload->>'inputHash',today,p_payload->>'consentVersion') returning * into item;
    return jsonb_build_object('authUid',p_auth_uid,'state','reserved','leaseId',item.lease_id);
  end if;
  select * into item from private.speaking_requests_v1 where auth_uid=p_auth_uid and request_id=id for update;
  if not found or item.reserved_at<=clock_timestamp()-interval '30 days' then return null; end if;
  if p_action='get' then
    return jsonb_build_object('authUid',p_auth_uid,'state',item.state,'result',item.result,'assessedAt',item.saved_at,
      'receipt',case when item.state='completed' then jsonb_build_object('requestId',id,'status','saved','savedAt',item.saved_at) else null end);
  end if;
  if item.lease_id is distinct from (p_payload->>'leaseId')::uuid then raise exception 'speaking_input_invalid'; end if;
  if p_action='uncertain' then
    update private.speaking_requests_v1 set state='uncertain' where auth_uid=p_auth_uid and request_id=id and state='reserved';
    return jsonb_build_object('authUid',p_auth_uid,'state','uncertain');
  end if;
  if p_action<>'complete' or item.state not in ('reserved','completed') then raise exception 'speaking_pending'; end if;
  if item.state='completed' then return jsonb_build_object('requestId',id,'status','saved','savedAt',item.saved_at); end if;
  outcome := p_payload->'result';
  if jsonb_typeof(outcome) is distinct from 'object'
    or outcome - array['example','coreType','metrics','additional'] <> '{}'::jsonb
    or outcome->'example' is distinct from 'false'::jsonb
    or coalesce(outcome->>'coreType','') not in ('asr.eval','para.eval')
    or jsonb_typeof(outcome->'metrics') is distinct from 'array'
    or jsonb_typeof(outcome->'additional') is distinct from 'object' then raise exception 'speaking_result_invalid'; end if;
  if jsonb_array_length(outcome->'metrics') not between 1 and 4
    or (select count(distinct x->>'id') from jsonb_array_elements(outcome->'metrics') x) <> jsonb_array_length(outcome->'metrics')
    then raise exception 'speaking_result_invalid'; end if;
  for score in select * from jsonb_array_elements(outcome->'metrics') loop
    if jsonb_typeof(score) is distinct from 'object' or score-array['id','score'] <> '{}'::jsonb
      or coalesce(score->>'id','') not in ('overall','pronunciation','fluency','rhythm')
      or jsonb_typeof(score->'score') is distinct from 'number'
      or (score->>'score')::numeric not between 0 and 100 then raise exception 'speaking_result_invalid'; end if;
  end loop;
  for observation in select * from jsonb_each(outcome->'additional') loop
    if observation.key in ('integrity','speed','pauseCount') then
      if jsonb_typeof(observation.value)<>'number' or observation.value::numeric<0
        or (observation.key='integrity' and observation.value::numeric>100) then raise exception 'speaking_result_invalid'; end if;
    elsif observation.key='accent' then
      if observation.value not in ('"us"'::jsonb,'"uk"'::jsonb) then raise exception 'speaking_result_invalid'; end if;
    elsif observation.key='rearTone' then
      if observation.value not in ('"rise"'::jsonb,'"fall"'::jsonb) then raise exception 'speaking_result_invalid'; end if;
    elsif observation.key='emphasis' then
      if jsonb_typeof(observation.value) is distinct from 'object'
        or observation.value-array['detected','total']<>'{}'::jsonb
        or jsonb_typeof(observation.value->'detected') is distinct from 'number'
        or jsonb_typeof(observation.value->'total') is distinct from 'number'
        or (observation.value->>'detected')::numeric < 0
        or (observation.value->>'total')::numeric < (observation.value->>'detected')::numeric then raise exception 'speaking_result_invalid'; end if;
    else raise exception 'speaking_result_invalid'; end if;
  end loop;
  update private.speaking_requests_v1 set state='completed',result=outcome,saved_at=clock_timestamp()
    where auth_uid=p_auth_uid and request_id=id returning * into item;
  return jsonb_build_object('requestId',id,'status','saved','savedAt',item.saved_at);
end $$;
revoke all on function public.speaking_trial_v1(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.speaking_trial_v1(text,uuid,jsonb) to service_role;
