-- ==========================================
-- PHASE 2.6: SEED REFINEMENT FOR NEW COLUMNS
-- ==========================================

DO $$
DECLARE
    v_participant_id UUID;
    v_book_id UUID;
BEGIN
    -- 1. 기존 도서 중 첫 번째를 대표 도서(is_main)로 설정
    FOR v_participant_id IN SELECT id FROM challenge_participants LOOP
        UPDATE challenge_books 
        SET is_main = TRUE 
        WHERE id = (
            SELECT id FROM challenge_books 
            WHERE participant_id = v_participant_id 
            LIMIT 1
        );

        -- 2. 기본 포인트 지급 (도전 참여 +5P)
        INSERT INTO challenge_points (participant_id, amount, category, description)
        VALUES (v_participant_id, 5, 'declaration', '챌린지 도전 선언 기본 포인트')
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- 3. 추가 포인트 시뮬레이션 (인증당 1P)
    INSERT INTO challenge_points (participant_id, amount, category, description, created_at)
    SELECT 
        participant_id, 
        1, 
        'daily_read', 
        '일일 독서 인증 포인트',
        certified_on
    FROM challenge_certifications;

END $$;
