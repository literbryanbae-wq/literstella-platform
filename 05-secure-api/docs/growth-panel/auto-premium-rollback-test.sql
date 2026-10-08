-- Production integration verification: every fixture/write is rolled back.
BEGIN;
LOCK TABLE public.growth_panel_applications IN EXCLUSIVE MODE;
LOCK TABLE private.english_panel_premium_slots IN EXCLUSIVE MODE;
CREATE TEMP TABLE panel_test_members AS
  SELECT a.auth_uid, lower(u.email) AS email, row_number() OVER (ORDER BY a.created_at, a.id) AS position
  FROM public.growth_panel_applications a JOIN auth.users u ON u.id = a.auth_uid
  WHERE a.status = 'submitted' AND a.campaign_id = 'growth-quality-panel-v1'
  ORDER BY a.created_at, a.id LIMIT 2;
GRANT SELECT ON panel_test_members TO service_role;
DELETE FROM private.english_panel_premium_slots;
DELETE FROM public.growth_panel_applications WHERE auth_uid IN (SELECT auth_uid FROM panel_test_members);
INSERT INTO private.english_panel_premium_slots (seat) SELECT generate_series(1, 99);
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  first_member record;
  second_member record;
  policy public.growth_panel_campaigns%rowtype;
  payload jsonb;
  response jsonb;
  receipt_id text;
BEGIN
  SELECT * INTO STRICT first_member FROM panel_test_members WHERE position = 1;
  SELECT * INTO STRICT second_member FROM panel_test_members WHERE position = 2;
  SELECT * INTO STRICT policy FROM public.growth_panel_campaigns WHERE id = 'growth-quality-panel-v1';
  payload := jsonb_build_object('nickname','Rollback test','situation','','interests',jsonb_build_array('daily'),
    'skills',jsonb_build_array('speaking'),'device','desktop','clientSubmissionId',gen_random_uuid(),
    'privacyConsent',true,'feedbackConsent',true,'privacyVersion',policy.privacy_version,
    'feedbackVersion',policy.feedback_version,'retentionVersion',policy.retention_version);
  response := public.growth_panel_request('status',policy.id,first_member.auth_uid,first_member.email);
  IF response #>> '{member,eligible}' <> 'true' OR response #>> '{member,panelPremium}' <> 'false' THEN
    RAISE EXCEPTION 'Eligible non-applicant must not have premium';
  END IF;
  response := public.growth_panel_request('submit',policy.id,first_member.auth_uid,first_member.email,
    payload || jsonb_build_object('privacyConsent',false));
  IF response->>'error' <> 'consent_required' OR (SELECT count(*) FROM private.english_panel_premium_slots) <> 99 THEN
    RAISE EXCEPTION 'Invalid consent consumed a seat';
  END IF;
  response := public.growth_panel_request('submit',policy.id,first_member.auth_uid,first_member.email,payload);
  receipt_id := response #>> '{application,id}';
  IF response->>'ok' <> 'true' OR response #>> '{application,premiumActive}' <> 'true'
    OR (SELECT count(*) FROM private.english_panel_premium_slots) <> 100 THEN
    RAISE EXCEPTION '100th member must receive atomic premium';
  END IF;
  response := public.growth_panel_request('submit',policy.id,first_member.auth_uid,first_member.email,'{}'::jsonb);
  IF response->>'existing' <> 'true' OR response #>> '{application,id}' <> receipt_id
    OR (SELECT count(*) FROM private.english_panel_premium_slots) <> 100 THEN
    RAISE EXCEPTION 'Retry must preserve receipt and capacity';
  END IF;
  response := public.growth_panel_request('submit',policy.id,second_member.auth_uid,second_member.email,
    payload || jsonb_build_object('clientSubmissionId',gen_random_uuid()));
  IF response->>'error' <> 'campaign_full'
    OR EXISTS (SELECT 1 FROM public.growth_panel_applications WHERE auth_uid = second_member.auth_uid) THEN
    RAISE EXCEPTION '101st member was admitted';
  END IF;
  response := public.growth_panel_request('status',policy.id,first_member.auth_uid,first_member.email);
  IF response #>> '{member,panelPremium}' <> 'true' OR response #>> '{campaign,remainingSeats}' <> '0' THEN
    RAISE EXCEPTION 'Premium/capacity status mismatch';
  END IF;
  UPDATE public.growth_panel_applications SET retain_until = clock_timestamp() - interval '1 second'
    WHERE auth_uid = first_member.auth_uid;
  response := public.growth_panel_request('status',policy.id,first_member.auth_uid,first_member.email);
  IF response->'application' <> 'null'::jsonb OR response #>> '{member,panelPremium}' <> 'true' THEN
    RAISE EXCEPTION 'Survey-data expiry removed durable benefit';
  END IF;
  response := public.growth_panel_request('submit',policy.id,first_member.auth_uid,first_member.email,
    payload || jsonb_build_object('clientSubmissionId',gen_random_uuid()));
  IF response #>> '{application,premiumActive}' <> 'true'
    OR (SELECT count(*) FROM private.english_panel_premium_slots) <> 100 THEN
    RAISE EXCEPTION 'Existing grant reapplication consumed another seat';
  END IF;
  response := public.growth_panel_request('withdraw',policy.id,first_member.auth_uid,first_member.email);
  IF response #>> '{application,premiumActive}' <> 'false'
    OR response #>> '{application,status}' <> 'withdrawn'
    OR (SELECT count(*) FROM private.english_panel_premium_slots) <> 100 THEN
    RAISE EXCEPTION 'Withdrawal must revoke only panel benefit and retain cohort count';
  END IF;
  RAISE NOTICE 'PASS: non-applicant, consent, seat100/101, retry, status, retention, reapplication, withdrawal';
END;
$test$;
RESET ROLE;
SELECT 'PASS: 9 rollback checks under service_role; no persistent writes' AS result;
ROLLBACK;
