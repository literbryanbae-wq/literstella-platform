-- Operator-approved: qualifying applications immediately open English premium.
-- A fixed 100-seat cohort; withdrawal never frees a historical seat.
CREATE TABLE private.english_panel_premium_slots (
  seat integer PRIMARY KEY CHECK (seat BETWEEN 1 AND 100),
  auth_uid uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  source text NOT NULL DEFAULT 'growth-quality-panel-v1'
    CHECK (source = 'growth-quality-panel-v1')
);
ALTER TABLE private.english_panel_premium_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.english_panel_premium_slots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.english_panel_premium_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON private.english_panel_premium_slots TO service_role;

CREATE FUNCTION private.english_panel_premium_active(p_auth_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
  SELECT EXISTS (SELECT 1 FROM private.english_panel_premium_slots
    WHERE auth_uid = p_auth_uid AND revoked_at IS NULL);
$fn$;
REVOKE ALL ON FUNCTION private.english_panel_premium_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.english_panel_premium_active(uuid) TO service_role;

DO $migration$
DECLARE
  definition text;
  updated text;
BEGIN
  LOCK TABLE public.growth_panel_campaigns IN EXCLUSIVE MODE;
  LOCK TABLE public.growth_panel_applications IN EXCLUSIVE MODE;
  SELECT pg_get_functiondef('public.growth_panel_request(text,text,uuid,text,jsonb)'::regprocedure) INTO definition;
  IF md5(definition) <> '9b9c348010c07be663e12852b5b03a3a' THEN
    RAISE EXCEPTION 'Panel RPC changed: inspect before applying';
  END IF;
  updated := replace(definition, '  situation_value text;',
    '  situation_value text;
  seats_issued integer;
  premium_active boolean;');
  updated := replace(updated,
    '  -- Serializes only this campaign/member pair; unrelated applicants are independent.',
    '  -- Campaign-wide admission lock precedes the member lock (fixed cohort).
  IF p_action IN (''submit'', ''withdraw'') THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''english-panel-premium-100'', 0));
  END IF;
  -- Member lock also protects receipt/withdrawal ordering.');
  updated := replace(updated, '  if p_action = ''withdraw'' then',
    '  if p_action = ''withdraw'' then');
  updated := replace(updated,
    '    if application.status <> ''withdrawn'' then',
    '    UPDATE private.english_panel_premium_slots SET revoked_at = clock_timestamp()
      WHERE auth_uid = p_auth_uid AND revoked_at IS NULL;
    if application.status <> ''withdrawn'' then');
  updated := replace(updated, 'public.growth_panel_receipt(application)',
    '(public.growth_panel_receipt(application) || jsonb_build_object(''premiumActive'', private.english_panel_premium_active(p_auth_uid)))');
  updated := replace(updated, '  campaign_json := jsonb_build_object',
    '  SELECT count(*)::integer INTO seats_issued FROM private.english_panel_premium_slots;
  premium_active := private.english_panel_premium_active(p_auth_uid);
  campaign_json := jsonb_build_object');
  updated := replace(updated, '''open'', is_open, ''selectionCapacity'', 100,',
    '''open'', is_open AND (seats_issued < 100 OR premium_active), ''selectionCapacity'', 100,
    ''admissionPolicy'', ''first-100-auto-premium-v1'', ''seatsIssued'', seats_issued,
    ''remainingSeats'', greatest(0, 100 - seats_issued),');
  updated := replace(updated, '''email'', p_auth_email, ''eligible'', eligible)',
    '''email'', p_auth_email, ''eligible'', eligible, ''panelPremium'', premium_active)');
  updated := replace(updated, '  insert into public.growth_panel_applications',
    '  IF EXISTS (SELECT 1 FROM private.english_panel_premium_slots WHERE auth_uid = p_auth_uid AND revoked_at IS NOT NULL) THEN
    RETURN jsonb_build_object(''ok'', false, ''error'', ''panel_withdrawn'');
  END IF;
  IF seats_issued >= 100 AND NOT premium_active THEN
    RETURN jsonb_build_object(''ok'', false, ''error'', ''campaign_full'');
  END IF;
  insert into public.growth_panel_applications');
  updated := replace(updated,
    '  return jsonb_build_object(''ok'', true, ''application'', (public.growth_panel_receipt(application) || jsonb_build_object(''premiumActive'', private.english_panel_premium_active(p_auth_uid))), ''existing'', false);',
    '  IF NOT premium_active THEN
    INSERT INTO private.english_panel_premium_slots (seat, auth_uid)
      SELECT coalesce(max(seat), 0) + 1, p_auth_uid FROM private.english_panel_premium_slots;
  END IF;
  return jsonb_build_object(''ok'', true, ''application'', (public.growth_panel_receipt(application) || jsonb_build_object(''premiumActive'', private.english_panel_premium_active(p_auth_uid))), ''existing'', false);');
  IF updated = definition OR updated NOT LIKE '%INSERT INTO private.english_panel_premium_slots%'
    OR updated NOT LIKE '%''panelPremium'', premium_active%' OR updated NOT LIKE '%''campaign_full''%' THEN
    RAISE EXCEPTION 'Panel replacement did not match';
  END IF;
  EXECUTE updated;

  -- Existing valid applicants receive the same benefit, oldest receipt first.
  INSERT INTO private.english_panel_premium_slots (seat, auth_uid, granted_at)
  SELECT row_number() OVER (ORDER BY a.created_at, a.id)::integer, a.auth_uid, clock_timestamp()
  FROM public.growth_panel_applications a
  JOIN auth.users u ON u.id = a.auth_uid
  WHERE a.campaign_id = 'growth-quality-panel-v1'
    AND a.status IN ('submitted', 'pending', 'selected') AND a.retain_until > clock_timestamp()
    AND EXISTS (
      SELECT 1 FROM public.class_verifications v
        WHERE lower(v.email) = lower(u.email)
          AND lower(v.book_code) IN ('kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock')
      UNION ALL
      SELECT 1 FROM public.class_redemptions r
        WHERE lower(r.redeemed_by) = lower(u.email)
          AND lower(r.book_code) IN ('kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock')
    ) ORDER BY a.created_at, a.id LIMIT 100;

  UPDATE public.growth_panel_campaigns SET
    policy_version = '2026-10-08-auto-premium-v1',
    privacy_version = '2026-10-08-auto-premium-v1',
    retention_version = '2026-10-08-auto-premium-v1',
    privacy_notice = '평가단 접수와 참여 안내를 위해 별명, 계정 이메일, 관심 분야, 연습 영역, 이용 기기 및 선택 입력한 연습 상황을 수집합니다. 강독 수업 1개 이상 소장 자격이 확인된 선착순 100명은 신청 완료 즉시 영어 학습실 프리미엄 이용 권한이 연결됩니다. 동의하지 않으면 신청할 수 없으며, 기존 소장 권한은 그대로 유지됩니다.',
    retention_notice = '신청서 연락처와 답변은 제출일로부터 90일간 보관하며, 철회하면 즉시 삭제합니다. 지속 이용 혜택과 중복 부여 방지를 위한 최소 권한 기록(계정 식별자, 부여·철회 시각, 정원 번호)은 신청서와 분리해 계정 탈퇴까지 보관합니다. 철회하면 평가단으로 받은 권한은 종료되며, 기존 소장 권한과 학습 기록은 유지됩니다. 계정 탈퇴 시 권한 기록의 계정 식별자를 제거합니다.'
    WHERE id = 'growth-quality-panel-v1';
END;
$migration$;
