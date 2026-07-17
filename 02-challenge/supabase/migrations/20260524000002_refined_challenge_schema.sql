-- ==========================================
-- PHASE 2.5: REFINED & UNIFIED INFRASTRUCTURE
-- Target: Supabase / PostgreSQL 15+
-- ==========================================

-- [1. 공통 프로필 테이블 - 전체 서브 프로젝트 통합용]
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS 설정 (기본적으로 자신의 프로필만 수정 가능)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- [2. 서브 프로젝트 마스터 테이블]
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 초기 프로젝트 데이터 주입
INSERT INTO public.projects (slug, title, description)
VALUES ('yanawan-challenge', '야나완 챌린지', '영어 원서 완독 습관 형성 챌린지')
ON CONFLICT (slug) DO NOTHING;

-- [3. 챌린지 참가자 테이블 확장]
-- 기존 컬럼에 추가 정보 필드 반영
ALTER TABLE challenge_participants 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS real_name TEXT,
ADD COLUMN IF NOT EXISTS reading_methods TEXT[], -- ['혼자 읽기', '강독 듣기', ...]
ADD COLUMN IF NOT EXISTS preferred_reading_time TEXT, -- '아침', '점심', ...
ADD COLUMN IF NOT EXISTS agreed_to_privacy BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS agreed_to_marketing BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS agreed_to_ranking_display BOOLEAN DEFAULT FALSE;

-- [4. 도전 도서 테이블 확장]
ALTER TABLE challenge_books 
ADD COLUMN IF NOT EXISTS is_main BOOLEAN DEFAULT FALSE;

-- [5. 포인트 시스템 테이블]
CREATE TABLE IF NOT EXISTS challenge_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID REFERENCES challenge_participants(id) ON DELETE CASCADE,
    amount INT NOT NULL,
    category TEXT NOT NULL, -- 'daily_read', 'declaration', 'completion', etc.
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- [6. 배지 시스템 보강]
-- 기존 challenge_badges 에 메타 정보 추가 (필요시)
ALTER TABLE challenge_badges 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- [7. 뷰(View) 생성: 참가자 현황 요약]
CREATE OR REPLACE VIEW challenge_participant_summary AS
SELECT 
    cp.id AS participant_id,
    cp.nickname,
    cp.goal_days,
    cp.status,
    cb.title AS main_book_title,
    (SELECT COUNT(*) FROM challenge_certifications cc WHERE cc.participant_id = cp.id) AS total_certifications,
    COALESCE((SELECT SUM(amount) FROM challenge_points cpts WHERE cpts.participant_id = cp.id), 0) AS total_points
FROM 
    challenge_participants cp
LEFT JOIN 
    challenge_books cb ON cp.id = cb.participant_id AND cb.is_main = TRUE;

-- ==========================================
-- 성능을 위한 인덱스 추가
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_points_participant ON challenge_points(participant_id);
CREATE INDEX IF NOT EXISTS idx_books_main ON challenge_books(participant_id) WHERE is_main = TRUE;
