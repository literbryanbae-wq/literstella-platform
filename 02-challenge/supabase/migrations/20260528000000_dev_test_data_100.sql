-- ==========================================
-- DEV: GENERATE 100 PARTICIPANTS & 100 DAYS DATA
-- ==========================================

DO $$
DECLARE
    v_cohort_id UUID;
    v_participant_id UUID;
    v_book_id UUID;
    i INT;
    j INT;
    v_nickname TEXT;
    v_certified BOOLEAN;
    v_start_date DATE := '2026-02-17';
    v_current_date DATE;
    v_cert_count INT;
    v_books TEXT[] := ARRAY['오만과 편견', '위대한 개츠비', '키다리 아저씨', '빨강머리 앤', '셜록 홈즈', '작은 아씨들', '해리포터 1'];
BEGIN
    -- 1. Create Test Cohort (Dev Test 100)
    INSERT INTO challenge_cohorts (slug, title, default_goal_days, starts_at, ends_at, status)
    VALUES ('dev-test-100', '개발자 테스트 100일 챌린지', 100, v_start_date, v_start_date + INTERVAL '99 days', 'active')
    ON CONFLICT (slug) DO UPDATE SET status = 'active'
    RETURNING id INTO v_cohort_id;

    -- 2. Loop 100 Participants
    FOR i IN 1..100 LOOP
        v_nickname := '도반_' || LPAD(i::text, 3, '0');
        
        INSERT INTO challenge_participants (
            cohort_id, nickname, email, goal_days, status, payment_status, order_number, real_name, phone
        ) VALUES (
            v_cohort_id, v_nickname, 'tester' || i || '@example.com', 100, 'active', 'paid', 'ORD-DEV-' || i, '테스터' || i, '010-0000-' || LPAD(i::text, 4, '0')
        ) RETURNING id INTO v_participant_id;

        -- 3. Add Main Book
        INSERT INTO challenge_books (participant_id, title, author, status, is_main)
        VALUES (v_participant_id, v_books[1 + floor(random() * array_length(v_books, 1))], '테스트 작가', 'reading', TRUE)
        RETURNING id INTO v_book_id;

        -- 4. Loop 100 Days (Simulating progress up to today: 2026-05-28)
        v_cert_count := 0;
        FOR j IN 0..99 LOOP
            v_current_date := v_start_date + (j || ' days')::INTERVAL;
            
            -- Exit if current_date is in the future
            IF v_current_date > '2026-05-28'::DATE THEN
                EXIT;
            END IF;

            -- Randomly certify (70% - 95% probability based on index to create variety)
            v_certified := random() < (0.95 - (i::float / 400.0));
            
            IF v_certified THEN
                v_cert_count := v_cert_count + 1;
                
                INSERT INTO challenge_certifications (
                    participant_id, book_id, challenge_day, certified_on, pages_range, reading_mode, learning_log, status
                ) VALUES (
                    v_participant_id, v_book_id, v_cert_count, v_current_date, 
                    (j*10+1) || '-' || (j*10+10), '혼자 읽기', 
                    v_nickname || '의 ' || v_cert_count || '일차 학습 기록. 원서 읽기의 임계점을 넘어서고 있습니다.', 'approved'
                ) ON CONFLICT (participant_id, challenge_day) DO NOTHING;

                -- Add Points
                INSERT INTO challenge_points (participant_id, amount, category, description)
                VALUES (v_participant_id, 1, 'daily_read', v_cert_count || '일차 인증 포인트');

                -- Add Badges at milestones
                IF v_cert_count = 3 THEN
                    INSERT INTO challenge_badges (participant_id, badge_type) VALUES (v_participant_id, 'badge_day_003_start.webp');
                ELSIF v_cert_count = 7 THEN
                    INSERT INTO challenge_badges (participant_id, badge_type) VALUES (v_participant_id, 'badge_day_007_hurdle.png');
                ELSIF v_cert_count = 10 THEN
                    INSERT INTO challenge_badges (participant_id, badge_type) VALUES (v_participant_id, 'badge_day_010_routine.png');
                ELSIF v_cert_count = 30 THEN
                    INSERT INTO challenge_badges (participant_id, badge_type) VALUES (v_participant_id, 'badge_day_030_basic_success.webp');
                ELSIF v_cert_count = 66 THEN
                    INSERT INTO challenge_badges (participant_id, badge_type) VALUES (v_participant_id, 'badge_day_066_habit_extension.webp');
                ELSIF v_cert_count = 100 THEN
                    INSERT INTO challenge_badges (participant_id, badge_type) VALUES (v_participant_id, 'badge_day_100_finish.webp');
                END IF;
            END IF;
        END LOOP;
        
        -- Update final status
        IF v_cert_count >= 100 THEN
            UPDATE challenge_participants SET status = 'completed' WHERE id = v_participant_id;
        END IF;
    END LOOP;
END;
$$;
