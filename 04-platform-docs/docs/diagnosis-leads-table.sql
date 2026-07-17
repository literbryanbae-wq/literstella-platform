-- ══ diagnosis_leads 테이블 생성 (진단앱 이메일 제출 명단) ══
-- Supabase SQL Editor에서 실행하세요

CREATE TABLE IF NOT EXISTS diagnosis_leads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  consent    boolean DEFAULT true,
  result     jsonb,
  source     text DEFAULT 'reading-diagnosis',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagnosis_leads_email   ON diagnosis_leads(email);
CREATE INDEX IF NOT EXISTS idx_diagnosis_leads_created ON diagnosis_leads(created_at DESC);

ALTER TABLE diagnosis_leads ENABLE ROW LEVEL SECURITY;

-- anon INSERT (진단앱 _worker.js → Supabase service_role key로 직접 삽입하므로 사실 불필요하지만 보험)
CREATE POLICY "diagnosis_leads: anon insert"
  ON diagnosis_leads FOR INSERT TO anon
  WITH CHECK (true);

-- anon SELECT (챌린지앱 관리자 패널이 anon key로 조회)
CREATE POLICY "diagnosis_leads: anon read"
  ON diagnosis_leads FOR SELECT TO anon
  USING (true);
