-- ==========================================
-- PHASE 2.8: HALL OF FAME AUTOMATION & FINISHERS MIGRATION
-- ==========================================

-- 1. 나만의 명예의 전당 영광의 기록 테이블 생성
CREATE TABLE IF NOT EXISTS public.challenge_hall_of_fame (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID REFERENCES challenge_participants(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    cafe_nickname TEXT,
    cohort_name TEXT NOT NULL,
    completed_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_hall_of_fame_participant ON public.challenge_hall_of_fame(participant_id);

-- 2. 100일 도달 실시간 검증 및 데이터 이관 함수 작성
CREATE OR REPLACE FUNCTION public.fn_migrate_to_hall_of_fame()
RETURNS TRIGGER AS $$
DECLARE
    v_cert_count INT;
    v_nickname TEXT;
    v_cafe_nickname TEXT;
    v_cohort_slug TEXT;
BEGIN
    -- 현재 참가자의 전체 인증 횟수 조회
    SELECT COUNT(*) INTO v_cert_count
    FROM public.challenge_certifications
    WHERE participant_id = NEW.participant_id;

    -- 100일 도달 시 명예의 전당 등록
    IF v_cert_count = 100 THEN
        -- 참가자 정보 및 기수 슬러그 조회
        SELECT p.nickname, p.cafe_nickname, c.slug 
        INTO v_nickname, v_cafe_nickname, v_cohort_slug
        FROM public.challenge_participants p
        INNER JOIN public.challenge_cohorts c ON p.cohort_id = c.id
        WHERE p.id = NEW.participant_id;

        -- 중복 등록 방지 (ON CONFLICT는 PK가 없어 사용 불가하므로 EXISTS 체크)
        IF NOT EXISTS (SELECT 1 FROM public.challenge_hall_of_fame WHERE participant_id = NEW.participant_id) THEN
            INSERT INTO public.challenge_hall_of_fame (participant_id, nickname, cafe_nickname, cohort_name)
            VALUES (NEW.participant_id, v_nickname, v_cafe_nickname, upper(v_cohort_slug));
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. 인증 완료 이벤트 후순위에 자동 트리거 바인딩
DROP TRIGGER IF EXISTS trg_after_certification_insert ON public.challenge_certifications;
CREATE TRIGGER trg_after_certification_insert
AFTER INSERT ON public.challenge_certifications
FOR EACH ROW
EXECUTE FUNCTION public.fn_migrate_to_hall_of_fame();
