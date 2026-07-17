-- ==========================================
-- PHASE 2: DEFINITIVE CHALLENGE INFRASTRUCTURE DDL
-- Target: Supabase / PostgreSQL 15+
-- ==========================================

-- [기수 마스터 테이블]
CREATE TABLE IF NOT EXISTS challenge_cohorts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    default_goal_days INT NOT NULL DEFAULT 30,
    starts_at DATE NOT NULL,
    ends_at DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'active', 'closed')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- [참가 도반 테이블]
CREATE TABLE IF NOT EXISTS challenge_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id UUID REFERENCES challenge_cohorts(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    email TEXT NOT NULL,
    cafe_nickname TEXT,
    country TEXT DEFAULT '대한민국',
    timezone TEXT DEFAULT 'Asia/Seoul',
    goal_days INT NOT NULL CHECK (goal_days IN (30, 66, 100)),
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'approved', 'active', 'completed', 'dropped')),
    payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'refunded', 'donated')),
    declaration_text TEXT,
    order_number TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- [도전 도서 테이블]
CREATE TABLE IF NOT EXISTS challenge_books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID REFERENCES challenge_participants(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    author TEXT,
    status TEXT NOT NULL DEFAULT 'reading' CHECK (status IN ('planned', 'reading', 'completed', 'paused'))
);

-- [인증 기록 테이블 - 중복 원천 차단 보증]
CREATE TABLE IF NOT EXISTS challenge_certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID REFERENCES challenge_participants(id) ON DELETE CASCADE,
    book_id UUID REFERENCES challenge_books(id) ON DELETE SET NULL,
    challenge_day INT NOT NULL,
    certified_on DATE NOT NULL,
    pages_range TEXT NOT NULL,
    reading_mode TEXT NOT NULL,
    learning_log TEXT NOT NULL,
    proof_url TEXT,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT now(),
    -- 한 참가자가 같은 날짜 혹은 같은 챌린지 일차에 중복 등록하는 것을 데이터베이스 레벨에서 절대 차단
    CONSTRAINT unique_participant_day UNIQUE (participant_id, challenge_day),
    CONSTRAINT unique_participant_date UNIQUE (participant_id, certified_on)
);

-- [배지 보관함 테이블]
CREATE TABLE IF NOT EXISTS challenge_badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID REFERENCES challenge_participants(id) ON DELETE CASCADE,
    badge_type TEXT NOT NULL,
    earned_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- 2. 성능 최적화를 위한 인덱스(Index) 설정
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_certifications_participant ON challenge_certifications(participant_id);
CREATE INDEX IF NOT EXISTS idx_participants_cohort ON challenge_participants(cohort_id);

-- ==========================================
-- 3. 2607기 기수 및 초기 마스터 데이터 주입 (Seed)
-- ==========================================
INSERT INTO challenge_cohorts (slug, title, default_goal_days, starts_at, ends_at, status)
VALUES (
    'yanawan-2607', 
    '영어 챌린지 야나완 13기 (2607기)', 
    30, 
    '2026-06-01', 
    '2026-06-30', 
    'open'
) ON CONFLICT (slug) DO NOTHING;
