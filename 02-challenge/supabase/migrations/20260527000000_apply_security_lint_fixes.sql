-- ==========================================
-- Resolve Database Linter Errors and Warnings
-- 1. Security Definer View -> Security Invoker
-- 2. RLS Disabled in Public -> Enable RLS and add policies
-- 3. Function Search Path Mutable -> Set search_path
-- 4. Sensitive Data Protection -> Column-level security
-- ==========================================

-- [1. Function Search Path Fix]
-- Linter: function_search_path_mutable
ALTER FUNCTION public.fn_migrate_to_hall_of_fame() SET search_path = public;

-- [2. View Security Fix]
-- Linter: security_definer_view
-- PostgreSQL 15+에서 보안 권장 사항인 security_invoker = true 사용
DROP VIEW IF EXISTS public.challenge_participant_summary;
CREATE VIEW public.challenge_participant_summary 
WITH (security_invoker = true)
AS
SELECT 
    cp.id AS participant_id,
    cp.nickname,
    cp.goal_days,
    cp.status,
    cb.title AS main_book_title,
    (SELECT COUNT(*) FROM public.challenge_certifications cc WHERE cc.participant_id = cp.id) AS total_certifications,
    COALESCE((SELECT SUM(amount) FROM public.challenge_points cpts WHERE cpts.participant_id = cp.id), 0) AS total_points
FROM 
    public.challenge_participants cp
LEFT JOIN 
    public.challenge_books cb ON cp.id = cb.participant_id AND cb.is_main = TRUE;

-- [3. RLS Enablement]
-- Linter: rls_disabled_in_public
ALTER TABLE public.challenge_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_hall_of_fame ENABLE ROW LEVEL SECURITY;

-- [4. RLS Policies]
-- Public Read Access
CREATE POLICY "Allow public read access" ON public.challenge_cohorts FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.projects FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.challenge_hall_of_fame FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.challenge_participants FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.challenge_books FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.challenge_certifications FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.challenge_badges FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.challenge_points FOR SELECT USING (true);

-- Public Insert Access
CREATE POLICY "Allow public insert access" ON public.challenge_participants FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public insert access" ON public.challenge_books FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public insert access" ON public.challenge_certifications FOR INSERT WITH CHECK (true);

-- [5. Column-level Security (Sensitive Data Protection)]
-- anon 역할(비로그인 사용자)이 이메일, 실명 등 민감 정보를 조회하지 못하도록 제한
REVOKE SELECT ON public.challenge_participants FROM anon;
GRANT SELECT (id, cohort_id, nickname, goal_days, status, created_at) ON public.challenge_participants TO anon;
-- 인증 및 도서 정보 등은 전체 조회 허용 (필요시 여기서도 컬럼 제한 가능)
