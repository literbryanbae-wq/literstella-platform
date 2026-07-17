-- ==========================================
-- PHASE 2.7: JUNE 1ST TRIAL RUN SEED
-- ==========================================

DO $$
DECLARE
    v_cohort_id UUID;
    v_participant_id UUID;
    v_book_id UUID;
BEGIN
    -- 1. 6월 1일 트라이얼 기수 상태 확인 및 업데이트
    INSERT INTO challenge_cohorts (slug, title, default_goal_days, starts_at, ends_at, status)
    VALUES (
        'yanawan-2606', 
        '야나완 챌린지 6월 트라이얼 (2606기)', 
        30, 
        '2026-06-01', 
        '2026-06-30', 
        'open'
    ) ON CONFLICT (slug) DO UPDATE SET status = 'open'
    RETURNING id INTO v_cohort_id;

    -- 2. 테스트 참가자 추가 (챌린지 트랙용)
    INSERT INTO challenge_participants (cohort_id, nickname, email, goal_days, status, payment_status, order_number, declaration_text, real_name)
    VALUES (v_cohort_id, '루크', 'luke@literstella.example.com', 30, 'active', 'paid', 'ORD-2606-TEST', '6월 한 달간 영어 원서와 사랑에 빠지겠습니다.', '선루크')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_participant_id;

    -- 3. 도서 등록
    IF v_participant_id IS NOT NULL THEN
        INSERT INTO challenge_books (participant_id, title, author, status, is_main)
        VALUES (v_participant_id, 'The Great Gatsby', 'F. Scott Fitzgerald', 'reading', TRUE)
        ON CONFLICT DO NOTHING;
    END IF;

END $$;
