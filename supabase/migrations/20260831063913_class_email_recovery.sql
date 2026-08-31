-- Only the signed-in account can inspect its own password readiness. No hashes leave Auth.
create or replace function public.account_login_methods_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', lower(u.email),
    'hasPassword', coalesce(u.encrypted_password, '') <> '')
  from auth.users u where u.id = (select auth.uid());
$$;
revoke all on function public.account_login_methods_v1() from public, anon;
grant execute on function public.account_login_methods_v1() to authenticated;

-- Service-only: the Worker has already verified a purpose/UID/email-bound OTP.
create or replace function public.class_email_recovery_submit_v1(
  p_user uuid, p_email text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u auth.users%rowtype;
  r public.class_link_requests%rowtype;
  proof jsonb;
  contact_match boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text, 31));
  select * into u from auth.users where id = p_user for share;
  if not found or lower(u.email) is distinct from lower(p_email) then
    return jsonb_build_object('ok', false, 'error', 'login_required');
  end if;
  if coalesce(u.encrypted_password, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'password_required');
  end if;
  if coalesce(jsonb_typeof(p_payload->'records'), '') <> 'array'
     or jsonb_array_length(p_payload->'records') not between 1 and 12
     or coalesce(p_payload->>'proofHash', '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_proof');
  end if;
  if exists (select 1 from jsonb_array_elements(p_payload->'records') x
      where not exists (select 1 from public.class_enrollments e
        where e.email = x->>'enrollmentEmail' and e.book_code = x->>'bookCode')) then
    return jsonb_build_object('ok', false, 'error', 'legacy_record_not_found');
  end if;
  if exists (select 1 from public.class_verifications v
      join jsonb_array_elements(p_payload->'records') x on v.enrollment_email = x->>'enrollmentEmail'
      where lower(v.email) <> lower(p_email)) then
    return jsonb_build_object('ok', false, 'error', 'source_already_linked');
  end if;
  select * into r from public.class_link_requests where auth_uid = p_user
    and status in ('pending', 'needinfo') order by created_at desc limit 1 for update;
  if found and r.status = 'pending' then
    if r.roster_match->>'kind' = 'legacy-email-unreachable-v1' and r.claimed_email = p_payload->>'claimed_email' then
      return jsonb_build_object('ok', true, 'already', true, 'id', r.id, 'status', r.status);
    end if;
    return jsonb_build_object('ok', false, 'error', 'existing_request_pending');
  end if;
  select exists (select 1 from public.class_roster_contacts c
    join jsonb_array_elements(p_payload->'records') x on c.email = x->>'enrollmentEmail'
    where c.phone_norm = p_payload->>'phone' and btrim(c.buyer_name) = p_payload->>'name') into contact_match;
  proof := jsonb_build_object('kind', 'legacy-email-unreachable-v1', 'unreachable', true,
    'emailVerifiedAt', now(), 'proofEmail', lower(p_email), 'proofAuthUid', p_user,
    'proofHash', p_payload->>'proofHash', 'records', p_payload->'records',
    'contactNamePhoneMatched', contact_match);
  if r.id is not null then
    update public.class_link_requests set login_email = lower(p_email),
      claimed_email = p_payload->>'claimed_email', name = p_payload->>'name', phone = p_payload->>'phone',
      courses = p_payload->>'courses', paid_at = p_payload->>'paid_at', order_info = p_payload->>'order_info',
      roster_match = proof, status = 'pending', admin_note = null, granted_books = null, updated_at = now()
      where id = r.id returning * into r;
  else
    insert into public.class_link_requests(auth_uid, login_email, claimed_email, name, phone, courses, paid_at, order_info, roster_match)
      values(p_user, lower(p_email), p_payload->>'claimed_email', p_payload->>'name', p_payload->>'phone',
        p_payload->>'courses', p_payload->>'paid_at', p_payload->>'order_info', proof) returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'status', r.status);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'existing_request_pending');
end;
$$;
revoke all on function public.class_email_recovery_submit_v1(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.class_email_recovery_submit_v1(uuid,text,jsonb) to service_role;

-- The request, source ownership, grant and audit transition commit together or not at all.
create or replace function public.class_email_recovery_decide_v1(
  p_id uuid, p_action text, p_books text[], p_note text, p_identity_confirmed boolean, p_admin uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.class_link_requests%rowtype;
  u auth.users%rowtype;
  x jsonb;
  books text[];
begin
  select * into r from public.class_link_requests where id = p_id for update;
  if not found or r.roster_match->>'kind' is distinct from 'legacy-email-unreachable-v1' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_action not in ('approve', 'needinfo', 'reject') or p_action is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if r.status = 'approved' and p_action = 'approve' then
    return jsonb_build_object('ok', true, 'already', true, 'request', to_jsonb(r));
  end if;
  if r.status not in ('pending', 'needinfo') then
    return jsonb_build_object('ok', false, 'error', 'request_closed');
  end if;
  if nullif(btrim(p_note), '') is null or p_admin is null then
    return jsonb_build_object('ok', false, 'error', 'review_note_required');
  end if;
  if p_action = 'approve' then
    if p_identity_confirmed is distinct from true then
      return jsonb_build_object('ok', false, 'error', 'identity_review_required');
    end if;
    select * into u from auth.users where id = r.auth_uid for share;
    if not found or lower(u.email) is distinct from r.login_email or r.roster_match->>'proofEmail' is distinct from r.login_email
       or r.roster_match->>'proofAuthUid' is distinct from r.auth_uid::text
       or nullif(r.roster_match->>'emailVerifiedAt', '') is null then
      return jsonb_build_object('ok', false, 'error', 'account_changed');
    end if;
    if coalesce(u.encrypted_password, '') = '' then
      return jsonb_build_object('ok', false, 'error', 'password_required');
    end if;
    select array_agg(distinct b order by b) into books from unnest(p_books) b where b is not null;
    if coalesce(cardinality(books), 0) not between 1 and 12 or exists (
      select 1 from unnest(books) b where not exists (
        select 1 from jsonb_array_elements(r.roster_match->'records') record where record->>'bookCode' = b)
    ) then return jsonb_build_object('ok', false, 'error', 'book_not_in_roster'); end if;
    for x in select value from jsonb_array_elements(r.roster_match->'records') order by value->>'enrollmentEmail', value->>'bookCode' loop
      perform 1 from public.class_enrollments e where e.email = x->>'enrollmentEmail' and e.book_code = x->>'bookCode' for update;
      if not found then return jsonb_build_object('ok', false, 'error', 'legacy_record_not_found'); end if;
      if exists (select 1 from public.class_verifications v where v.enrollment_email = x->>'enrollmentEmail' and v.email <> r.login_email) then
        return jsonb_build_object('ok', false, 'error', 'source_already_linked');
      end if;
    end loop;
    insert into public.class_verifications(email, book_code, enrollment_email)
      select r.login_email, record->>'bookCode', record->>'enrollmentEmail'
      from jsonb_array_elements(r.roster_match->'records') record where record->>'bookCode' = any(books)
      on conflict (email, book_code) do nothing;
  end if;
  update public.class_link_requests set
    status = case p_action when 'approve' then 'approved' when 'needinfo' then 'needinfo' else 'rejected' end,
    admin_note = left(btrim(p_note), 500), granted_books = array_to_string(books, ','), updated_at = now(),
    roster_match = roster_match || jsonb_build_object('reviewedBy', p_admin, 'reviewedAt', now(),
      'identityConfirmed', p_action = 'approve' and p_identity_confirmed, 'decision', p_action)
    where id = r.id returning * into r;
  return jsonb_build_object('ok', true, 'request', to_jsonb(r));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'source_already_linked');
end;
$$;
revoke all on function public.class_email_recovery_decide_v1(uuid,text,text[],text,boolean,uuid) from public, anon, authenticated;
grant execute on function public.class_email_recovery_decide_v1(uuid,text,text[],text,boolean,uuid) to service_role;
