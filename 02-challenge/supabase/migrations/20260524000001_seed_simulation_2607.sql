DO $$
DECLARE
    v_cohort_id UUID;
    v_participant_id UUID;
    v_book_id UUID;
    v_nickname TEXT;
    v_email TEXT;
    v_order_number TEXT;
    v_goal_days INT;
    v_total_days INT;
    v_random_days INT;
    v_books TEXT[] := ARRAY['해리포터와 마법사의 돌', '빨강머리 앤', '키다리 아저씨', '셜록 홈즈'];
    v_modes TEXT[] := ARRAY['혼자 읽기', '강독 강의 수강', '오디오북 동시 청취', '원서 필사하기'];
    v_nicknames TEXT[] := ARRAY[
        '별헤는아침', '책장속여행자', '문학의숲', '은하수독서가', '푸른페이지', 
        '새벽달빛', '종이의온기', '지혜의샘물', '꿈꾸는서재', '햇살가득한날', 
        '노을빛문장', '숲속책방지기', '글향기만리', '책벌레의꿈', '순수한열정',
        '영원한클래식', '단단한내면', '맑은샘물', '고결한영혼', '찬란한순간',
        '그리운문장', '깊은바다의꿈', '산들바람독서', '별빛서재', '기억의조각',
        '담백한일상', '따뜻한위로', '나만의책장', '오늘의한구절', '내일의희망',
        '작은성취', '꾸준한걸음', '성장의기쁨', '몰입의즐거움', '문장의미학',
        '영혼의안식처', '지적인휴식', '독서의향기', '글쓰는마음', '사색의시간',
        '열린세계', '상상력의바다', '진실한삶', '아름다운도전', '멈추지않는열정',
        '새로운시작', '지혜로운삶', '품격있는취미', '인생의나침반', '마음의양식'
    ];
    v_logs TEXT[] := ARRAY[
        '오늘의 독서는 매우 고요하고 평온했습니다. 문장 사이의 여백이 주는 아름다움을 느꼈어요.',
        '새로운 챕터에 들어서니 주인공의 심리가 더 깊게 이해됩니다. 원서로 읽는 묘미가 있네요.',
        '어려운 문법 구조를 만났지만, 전체적인 맥락 속에서 의미를 파악하며 넘겼습니다. 뿌듯합니다.',
        '강독 강의와 함께하니 혼자 읽을 때 놓쳤던 디테일들이 살아나네요. 학습의 즐거움을 느낍니다.',
        '오디오북을 들으며 눈으로 따라가니 리듬감이 생겨 훨씬 몰입이 잘 됩니다. 시간 가는 줄 몰랐어요.',
        '오늘 마음에 드는 문장을 필사하며 하루를 마무리했습니다. 손 끝으로 전해지는 감동이 있네요.',
        '피곤한 하루였지만 책을 펴는 순간 위로를 받았습니다. 리터스텔라와 함께하는 이 시간이 소중합니다.',
        '단어의 뉘앙스를 곱씹으며 천천히 읽어내려갔습니다. 언어의 깊이를 알아가는 과정이 즐겁습니다.',
        '조금씩 쌓이는 페이지들을 보며 성취감을 느낍니다. 내일의 독서가 벌써 기다려지네요.',
        '등장인물의 대사에서 인생의 지혜를 발견했습니다. 고전이 주는 묵직한 힘을 다시금 확인합니다.'
    ];
    i INT;
    j INT;
    v_current_date DATE;
BEGIN
    -- 1. Ensure Cohort exists
    INSERT INTO challenge_cohorts (slug, title, default_goal_days, starts_at, ends_at, status)
    VALUES (
        'yanawan-2607', 
        '영어 챌린지 야나완 13기 (2607기)', 
        30, 
        '2026-06-01', 
        '2026-06-30', 
        'active'
    ) ON CONFLICT (slug) DO UPDATE SET status = 'active'
    RETURNING id INTO v_cohort_id;

    -- 2. Profile 1 (15 Participants): 30-day goal, dropped out randomly (1-25 days)
    FOR i IN 1..15 LOOP
        v_nickname := v_nicknames[i];
        v_email := 'user' || lpad(i::text, 2, '0') || '@literstella.example.com';
        v_order_number := 'ORD-2607-' || lpad(i::text, 3, '0');
        v_random_days := floor(random() * 25 + 1)::int;

        INSERT INTO challenge_participants (cohort_id, nickname, email, goal_days, status, payment_status, order_number, declaration_text)
        VALUES (v_cohort_id, v_nickname, v_email, 30, 'dropped', 'paid', v_order_number, '매일의 성장을 기록하며 끝까지 완주하겠습니다.')
        RETURNING id INTO v_participant_id;

        INSERT INTO challenge_books (participant_id, title, author, status)
        VALUES (v_participant_id, v_books[floor(random() * 4 + 1)], 'Classic Author', 'reading')
        RETURNING id INTO v_book_id;

        v_current_date := '2026-06-01';
        FOR j IN 1..v_random_days LOOP
            INSERT INTO challenge_certifications (participant_id, book_id, challenge_day, certified_on, pages_range, reading_mode, learning_log, status)
            VALUES (v_participant_id, v_book_id, j, v_current_date, 'pp. ' || (j*5) || '-' || (j*5+4), v_modes[floor(random() * 4 + 1)], v_logs[floor(random() * 10 + 1)], 'approved');
            v_current_date := v_current_date + INTERVAL '1 day';
        END LOOP;
    END LOOP;

    -- 3. Profile 2 (15 Participants): 30-day goal, 100% completed
    FOR i IN 16..30 LOOP
        v_nickname := v_nicknames[i];
        v_email := 'user' || lpad(i::text, 2, '0') || '@literstella.example.com';
        v_order_number := 'ORD-2607-' || lpad(i::text, 3, '0');

        INSERT INTO challenge_participants (cohort_id, nickname, email, goal_days, status, payment_status, order_number, declaration_text)
        VALUES (v_cohort_id, v_nickname, v_email, 30, 'completed', 'paid', v_order_number, '성실함으로 30일의 기적을 만들어보겠습니다.')
        RETURNING id INTO v_participant_id;

        INSERT INTO challenge_books (participant_id, title, author, status)
        VALUES (v_participant_id, v_books[floor(random() * 4 + 1)], 'Classic Author', 'completed')
        RETURNING id INTO v_book_id;

        v_current_date := '2026-06-01';
        FOR j IN 1..30 LOOP
            INSERT INTO challenge_certifications (participant_id, book_id, challenge_day, certified_on, pages_range, reading_mode, learning_log, status)
            VALUES (v_participant_id, v_book_id, j, v_current_date, 'pp. ' || (j*5) || '-' || (j*5+4), v_modes[floor(random() * 4 + 1)], v_logs[floor(random() * 10 + 1)], 'approved');
            v_current_date := v_current_date + INTERVAL '1 day';
        END LOOP;
    END LOOP;

    -- 4. Profile 3 (10 Participants): 66-day goal, 100% completed
    FOR i IN 31..40 LOOP
        v_nickname := v_nicknames[i];
        v_email := 'user' || lpad(i::text, 2, '0') || '@literstella.example.com';
        v_order_number := 'ORD-2607-' || lpad(i::text, 3, '0');

        INSERT INTO challenge_participants (cohort_id, nickname, email, goal_days, status, payment_status, order_number, declaration_text)
        VALUES (v_cohort_id, v_nickname, v_email, 66, 'completed', 'paid', v_order_number, '습관의 완성을 위해 66일 동안 멈추지 않겠습니다.')
        RETURNING id INTO v_participant_id;

        INSERT INTO challenge_books (participant_id, title, author, status)
        VALUES (v_participant_id, v_books[floor(random() * 4 + 1)], 'Classic Author', 'completed')
        RETURNING id INTO v_book_id;

        v_current_date := '2026-06-01';
        FOR j IN 1..66 LOOP
            INSERT INTO challenge_certifications (participant_id, book_id, challenge_day, certified_on, pages_range, reading_mode, learning_log, status)
            VALUES (v_participant_id, v_book_id, j, v_current_date, 'pp. ' || (j*5) || '-' || (j*5+4), v_modes[floor(random() * 4 + 1)], v_logs[floor(random() * 10 + 1)], 'approved');
            v_current_date := v_current_date + INTERVAL '1 day';
        END LOOP;
    END LOOP;

    -- 5. Profile 4 (10 Participants): 100-day goal, 100% completed (Hall of Fame)
    FOR i IN 41..50 LOOP
        v_nickname := v_nicknames[i];
        v_email := 'user' || lpad(i::text, 2, '0') || '@literstella.example.com';
        v_order_number := 'ORD-2607-' || lpad(i::text, 3, '0');

        INSERT INTO challenge_participants (cohort_id, nickname, email, goal_days, status, payment_status, order_number, declaration_text)
        VALUES (v_cohort_id, v_nickname, v_email, 100, 'completed', 'paid', v_order_number, '나 자신을 뛰어넘는 100일의 여정, 명예의 전당을 향해 달립니다.')
        RETURNING id INTO v_participant_id;

        INSERT INTO challenge_books (participant_id, title, author, status)
        VALUES (v_participant_id, v_books[floor(random() * 4 + 1)], 'Classic Author', 'completed')
        RETURNING id INTO v_book_id;

        v_current_date := '2026-06-01';
        FOR j IN 1..100 LOOP
            INSERT INTO challenge_certifications (participant_id, book_id, challenge_day, certified_on, pages_range, reading_mode, learning_log, status)
            VALUES (v_participant_id, v_book_id, j, v_current_date, 'pp. ' || (j*5) || '-' || (j*5+4), v_modes[floor(random() * 4 + 1)], v_logs[floor(random() * 10 + 1)], 'approved');
            v_current_date := v_current_date + INTERVAL '1 day';
        END LOOP;
    END LOOP;

END $$;
