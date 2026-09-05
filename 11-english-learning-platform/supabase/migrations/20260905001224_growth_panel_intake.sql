-- Applied by Supabase MCP as remote migration 20260905001640 (growth_panel_intake).
-- Reviewed source for the quality-panel migration. Live deployment authorized 2026-09-05.
-- No campaign row is seeded: installing this draft alone cannot open recruitment.
-- Owner decision 2026-09-05: existing SSO + ALL EIGHT explicit owned courses only.
-- Codes match workers/classgate/src/index.js PACKS['stella-allinone']; its bypass,
-- temporary-pass and derived-theory access logic is intentionally NOT reused.
begin;

create table public.growth_panel_campaigns (
  id text primary key,
  enabled boolean not null default false,
  approved_at timestamptz,
  selection_capacity integer not null default 100 check (selection_capacity = 100),
  required_books text[] not null default array['kidari', 'anne', 'littlewomen1', 'littlewomen2', 'pride', 'gatsby', 'sherlock', 'theory']
    check (cardinality(required_books) = 8
      and required_books @> array['kidari', 'anne', 'littlewomen1', 'littlewomen2', 'pride', 'gatsby', 'sherlock', 'theory']
      and required_books <@ array['kidari', 'anne', 'littlewomen1', 'littlewomen2', 'pride', 'gatsby', 'sherlock', 'theory']),
  ownership_policy text not null default 'classic7-plus-theory-explicit' check (ownership_policy = 'classic7-plus-theory-explicit'),
  policy_version text,
  starts_at timestamptz,
  ends_at timestamptz,
  retain_until timestamptz,
  retention_days integer not null default 90 check (retention_days between 1 and 365),
  privacy_version text,
  feedback_version text,
  retention_version text,
  privacy_notice text,
  feedback_notice text,
  retention_notice text,
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (retain_until is null or ends_at is null or retain_until > ends_at)
);

create table public.growth_panel_applications (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references public.growth_panel_campaigns(id),
  auth_uid uuid not null references auth.users(id) on delete cascade,
  client_submission_id uuid not null,
  status text not null default 'submitted' check (status in ('submitted', 'pending', 'selected', 'not_selected', 'withdrawn')),
  created_at timestamptz not null default clock_timestamp(),
  withdrawn_at timestamptz,
  nickname text,
  email text,
  answers jsonb not null,
  ownership_snapshot jsonb not null,
  notice_snapshot jsonb not null,
  policy_version text not null,
  privacy_version text not null,
  feedback_version text not null,
  retention_version text not null,
  consented_at timestamptz not null default clock_timestamp(),
  retain_until timestamptz not null,
  unique (campaign_id, auth_uid),
  check (jsonb_typeof(answers) = 'object'),
  check (jsonb_typeof(notice_snapshot) = 'object'
    and notice_snapshot ?& array['privacyNotice', 'feedbackNotice', 'retentionNotice']
    and jsonb_typeof(notice_snapshot->'privacyNotice') = 'string'
    and jsonb_typeof(notice_snapshot->'feedbackNotice') = 'string'
    and jsonb_typeof(notice_snapshot->'retentionNotice') = 'string'),
  check (status <> 'withdrawn' or (withdrawn_at is not null and nickname is null and email is null and answers = '{}'::jsonb))
);
create index growth_panel_retention_idx on public.growth_panel_applications(retain_until);

-- No browser/anonymous policies. Only the existing trusted Worker uses service_role.
alter table public.growth_panel_campaigns enable row level security;
alter table public.growth_panel_campaigns force row level security;
alter table public.growth_panel_applications enable row level security;
alter table public.growth_panel_applications force row level security;
revoke all on public.growth_panel_campaigns, public.growth_panel_applications from public, anon, authenticated;
grant select, insert, update, delete on public.growth_panel_campaigns, public.growth_panel_applications to service_role;

create function public.growth_panel_receipt(a public.growth_panel_applications)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'status', a.status, 'createdAt', a.created_at, 'withdrawnAt', a.withdrawn_at,
    'submitted', case when a.status = 'withdrawn' then null else a.answers || jsonb_build_object('nickname', a.nickname, 'email', a.email) end,
    'consents', jsonb_build_object('privacyVersion', a.privacy_version, 'feedbackVersion', a.feedback_version, 'retentionVersion', a.retention_version)
  );
$$;
revoke all on function public.growth_panel_receipt(public.growth_panel_applications) from public, anon, authenticated;
grant execute on function public.growth_panel_receipt(public.growth_panel_applications) to service_role;

create function public.growth_panel_request(
  p_action text, p_campaign_id text, p_auth_uid uuid, p_auth_email text, p_payload jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  campaign public.growth_panel_campaigns%rowtype;
  application public.growth_panel_applications%rowtype;
  has_application boolean;
  is_open boolean := false;
  eligible boolean := null;
  owned text[] := '{}';
  all_books constant text[] := array['kidari', 'anne', 'littlewomen1', 'littlewomen2', 'pride', 'gatsby', 'sherlock', 'theory'];
  campaign_json jsonb;
  nickname_value text;
  situation_value text;
begin
  if p_auth_uid is null or p_auth_email is null or p_auth_email <> lower(btrim(p_auth_email)) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_action is null or p_action not in ('status', 'get', 'submit', 'withdraw') or p_campaign_id is distinct from 'growth-quality-panel-v1' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  -- Serializes only this campaign/member pair; unrelated applicants are independent.
  -- Unique(campaign_id, auth_uid) remains the database's final race guard.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_campaign_id || ':' || p_auth_uid::text, 0));
  -- Every action, including read/retry, removes only this member's expired row
  -- before any receipt can be returned. Bulk maintenance is still necessary for
  -- inactive members who never request their application again.
  delete from public.growth_panel_applications
    where campaign_id = p_campaign_id and auth_uid = p_auth_uid and retain_until <= clock_timestamp();
  select * into application from public.growth_panel_applications
    where campaign_id = p_campaign_id and auth_uid = p_auth_uid for update;
  has_application := found;

  if p_action = 'get' then
    return jsonb_build_object('ok', true, 'application', case when has_application then public.growth_panel_receipt(application) else null end);
  end if;
  if p_action = 'submit' and has_application then
    -- Never overwrite the original date, answers, consents or selection status.
    return jsonb_build_object('ok', true, 'application', public.growth_panel_receipt(application), 'existing', true);
  end if;
  if p_action = 'withdraw' then
    if not has_application then return jsonb_build_object('ok', false, 'error', 'application_not_found'); end if;
    if application.status <> 'withdrawn' then
      update public.growth_panel_applications set status = 'withdrawn', withdrawn_at = clock_timestamp(),
        nickname = null, email = null, answers = '{}'::jsonb
        where id = application.id returning * into application;
    end if;
    return jsonb_build_object('ok', true, 'application', public.growth_panel_receipt(application), 'existing', true);
  end if;

  select * into campaign from public.growth_panel_campaigns where id = p_campaign_id for share;
  if found then
    is_open := coalesce(campaign.enabled and campaign.approved_at is not null
      and campaign.approved_at <= now() and campaign.starts_at <= now()
      and (campaign.ends_at is null or campaign.ends_at > now())
      and (campaign.retain_until is null or campaign.retain_until > coalesce(campaign.ends_at, now()))
      and campaign.retention_days between 1 and 365
      and btrim(campaign.policy_version) <> ''
      and campaign.privacy_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$'
      and campaign.feedback_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$'
      and campaign.retention_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$'
      and btrim(campaign.privacy_notice) <> '' and btrim(campaign.feedback_notice) <> '' and btrim(campaign.retention_notice) <> ''
      and campaign.ownership_policy = 'classic7-plus-theory-explicit' and cardinality(campaign.required_books) = 8
      and campaign.required_books @> all_books and campaign.required_books <@ all_books, false);
  end if;

  if is_open then
    -- Do NOT use point tiers, completions, temporary access or administrator/test bypasses.
    -- These existing tables are the actual explicitly verified/redeemed book sources.
    select coalesce(array_agg(distinct book_code), '{}'::text[]) into owned from (
      select lower(cv.book_code) as book_code from public.class_verifications cv where lower(cv.email) = p_auth_email
      union select lower(cr.book_code) as book_code from public.class_redemptions cr where lower(cr.redeemed_by) = p_auth_email
    ) source where book_code = any(all_books);
    eligible := owned @> all_books;
  end if;
  campaign_json := jsonb_build_object('id', p_campaign_id, 'open', is_open, 'selectionCapacity', 100,
    'requiredBooks', campaign.required_books, 'ownershipPolicy', campaign.ownership_policy, 'policyVersion', campaign.policy_version,
    'privacyVersion', campaign.privacy_version, 'feedbackVersion', campaign.feedback_version, 'retentionVersion', campaign.retention_version,
    'privacyNotice', campaign.privacy_notice, 'feedbackNotice', campaign.feedback_notice, 'retentionNotice', campaign.retention_notice,
    'startsAt', campaign.starts_at, 'endsAt', campaign.ends_at, 'retainUntil', campaign.retain_until,
    'retentionDays', campaign.retention_days);
  if p_action = 'status' then
    return jsonb_build_object('ok', true, 'campaign', campaign_json,
      'member', jsonb_build_object('email', p_auth_email, 'eligible', eligible),
      'application', case when has_application then public.growth_panel_receipt(application) else null end);
  end if;
  if not is_open then return jsonb_build_object('ok', false, 'error', 'campaign_closed'); end if;
  if not eligible then return jsonb_build_object('ok', false, 'error', 'ineligible'); end if;
  -- Identity is verified immediately before this RPC by the existing Worker's
  -- requireUser(/auth/v1/user) boundary. Do not query auth.users here: the
  -- production service_role can execute this private RPC and read the two
  -- ownership ledgers, but intentionally has no direct SELECT on auth.users.
  -- Browser-provided UID/email are never accepted by the Worker adapter.
  if jsonb_typeof(p_payload) is distinct from 'object' then return jsonb_build_object('ok', false, 'error', 'invalid_fields'); end if;
  if p_payload->'privacyConsent' is distinct from 'true'::jsonb or p_payload->'feedbackConsent' is distinct from 'true'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'consent_required');
  end if;
  if p_payload->>'privacyVersion' is distinct from campaign.privacy_version
    or p_payload->>'feedbackVersion' is distinct from campaign.feedback_version
    or p_payload->>'retentionVersion' is distinct from campaign.retention_version then
    return jsonb_build_object('ok', false, 'error', 'policy_changed');
  end if;
  if jsonb_typeof(p_payload->'interests') is distinct from 'array' or jsonb_typeof(p_payload->'skills') is distinct from 'array'
    or jsonb_typeof(p_payload->'nickname') is distinct from 'string' or jsonb_typeof(p_payload->'situation') is distinct from 'string' then
    return jsonb_build_object('ok', false, 'error', 'invalid_fields');
  end if;
  nickname_value := btrim(p_payload->>'nickname');
  situation_value := btrim(p_payload->>'situation');
  if length(nickname_value) not between 1 and 40 or length(situation_value) > 300
    or coalesce(p_payload->>'device', '') not in ('mobile', 'tablet', 'desktop', 'multiple')
    or coalesce(p_payload->>'clientSubmissionId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_array_length(p_payload->'interests') not between 1 and 7 or jsonb_array_length(p_payload->'skills') not between 1 and 4
    or exists (select 1 from jsonb_array_elements_text(p_payload->'interests') item where item is null or item not in ('daily','travel','business','classics','hobby','university','career'))
    or exists (select 1 from jsonb_array_elements_text(p_payload->'skills') item where item is null or item not in ('reading','listening','writing','speaking')) then
    return jsonb_build_object('ok', false, 'error', 'invalid_fields');
  end if;
  insert into public.growth_panel_applications (campaign_id, auth_uid, client_submission_id,
    nickname, email, answers, ownership_snapshot, notice_snapshot, policy_version,
    privacy_version, feedback_version, retention_version, retain_until)
  values (p_campaign_id, p_auth_uid, (p_payload->>'clientSubmissionId')::uuid,
    nickname_value, p_auth_email,
    jsonb_build_object('interests', p_payload->'interests', 'skills', p_payload->'skills', 'device', p_payload->>'device', 'situation', situation_value),
    jsonb_build_object('books', owned, 'requiredBooks', campaign.required_books, 'policy', campaign.ownership_policy, 'checkedAt', clock_timestamp()),
    jsonb_build_object('privacyNotice', campaign.privacy_notice, 'feedbackNotice', campaign.feedback_notice, 'retentionNotice', campaign.retention_notice),
    campaign.policy_version, campaign.privacy_version, campaign.feedback_version, campaign.retention_version,
    coalesce(campaign.retain_until, clock_timestamp() + pg_catalog.make_interval(days => campaign.retention_days)))
  on conflict (campaign_id, auth_uid) do nothing returning * into application;
  if not found then
    select * into application from public.growth_panel_applications where campaign_id = p_campaign_id and auth_uid = p_auth_uid;
    return jsonb_build_object('ok', true, 'application', public.growth_panel_receipt(application), 'existing', true);
  end if;
  return jsonb_build_object('ok', true, 'application', public.growth_panel_receipt(application), 'existing', false);
end;
$$;
revoke all on function public.growth_panel_request(text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.growth_panel_request(text, text, uuid, text, jsonb) to service_role;

-- Explicit retention maintenance; no scheduler/job is installed by this draft.
-- Deployment MUST arrange and verify execution under the approved retention policy.
create function public.growth_panel_purge_expired() returns bigint
language plpgsql security invoker set search_path = '' as $$
declare removed bigint;
begin
  delete from public.growth_panel_applications where retain_until <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.growth_panel_purge_expired() from public, anon, authenticated;
grant execute on function public.growth_panel_purge_expired() to service_role;
commit;
