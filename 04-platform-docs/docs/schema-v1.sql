-- =============================================================
-- LiterStella Platform — Supabase Schema v1
-- 작성일: 2026-05-29
-- =============================================================
-- 서비스 계층:
--   상위: 나의 영어 독서 다이어리 (MY READING DIARY)
--   하위: 야나완 챌린지 (결제 필요, enrollments.is_yanawan=true)
-- =============================================================


-- ─────────────────────────────────────────
-- 1. SEASONS
-- ─────────────────────────────────────────
CREATE TABLE seasons (
  id          text PRIMARY KEY,           -- 'yanawan-2606', 'yanawan-2607'
  label       text NOT NULL,              -- '야나완 2606'
  starts_at   date NOT NULL,
  ends_at     date NOT NULL,
  goal_days   int  NOT NULL DEFAULT 30,
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2606 시즌 (행동 분석 후 2607 시작 전 check_ins/enrollments/user_badges 리셋)
INSERT INTO seasons (id, label, starts_at, ends_at, goal_days, is_active)
VALUES ('yanawan-2606', '야나완 2606', '2026-06-01', '2026-06-30', 30, true);


-- ─────────────────────────────────────────
-- 2. BOOKS
-- ─────────────────────────────────────────
CREATE TABLE books (
  id           text PRIMARY KEY,          -- 'B001', 'HP001'~'HP007'
  title        text NOT NULL,
  title_ko     text,
  level        text,                      -- 'L1'~'L5'
  ar_level     numeric(4,1),
  lexile_level int,
  types        text[],                    -- ['S','A','E','X']
  route        text,                      -- 'harrypotter' | 'classic'
  cover_image  text,                      -- assets 파일명 (e.g. 'book-daddy-long-legs.webp')
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 리터스텔라 클래식 6종
INSERT INTO books (id, title, title_ko, level, types, route, cover_image) VALUES
  ('B001', 'Daddy-Long-Legs',         '키다리 아저씨',     'L1', '{E,A}',     'classic',      'book-daddy-long-legs.webp'),
  ('B005', 'Anne of Green Gables',    '빨강 머리 앤',       'L2', '{S,E,A}',  'classic',      'book-anne-of-green-gables.webp'),
  ('B009', 'Little Women',            '작은 아씨들',        'L3', '{E,A,S}',  'classic',      'book-little-women.webp'),
  ('B013', 'Pride and Prejudice',     '오만과 편견',        'L4', '{A,E,X}',  'classic',      'book-pride-and-prejudice.webp'),
  ('B017', 'Sherlock Holmes',         '셜록 홈즈',          'L5', '{X,A}',    'classic',      'book-sherlock-holmes.webp'),
  ('B018', 'The Great Gatsby',        '위대한 개츠비',      'L5', '{X,E,A}',  'classic',      'book-the-great-gatsby.webp');

-- 나머지 14종
INSERT INTO books (id, title, title_ko, level, types, route, cover_image) VALUES
  ('B002', 'Charlotte''s Web',        '샬롯의 거미줄',      'L1', '{S,E}',    'classic',      'book-charlottes-web.webp'),
  ('B003', 'The Little Prince',       '어린 왕자',          'L1', '{E,X}',    'classic',      'book-the-little-prince.webp'),
  ('B004', 'Diary of a Wimpy Kid',    '윔피키드 다이어리',  'L1', '{S}',      'classic',      'book-diary-of-a-wimpy-kid.webp'),
  ('B006', 'Peter Pan',               '피터팬',             'L2', '{S,X}',    'classic',      'book-peter-pan.webp'),
  ('B007', 'The Wind in the Willows', '버드나무에 부는 바람','L2', '{E,X}',   'classic',      'book-the-wind-in-the-willows.webp'),
  ('B008', 'Wonder',                  '원더',               'L2', '{S,E}',    'classic',      'book-wonder.webp'),
  ('B010', 'The Giver',               '기억 전달자',        'L3', '{X,S}',    'classic',      'book-the-giver.webp'),
  ('B011', 'Animal Farm',             '동물 농장',          'L3', '{X,A}',    'classic',      'book-animal-farm.webp'),
  ('B012', 'Flipped',                 '플립드',             'L3', '{S,E}',    'classic',      'book-flipped.webp'),
  ('B014', 'To Kill a Mockingbird',   '앵무새 죽이기',      'L4', '{X,E}',    'classic',      'book-to-kill-a-mockingbird.webp'),
  ('B015', '1984',                    '1984',               'L4', '{X,A}',    'classic',      'book-1984.webp'),
  ('B016', 'Of Mice and Men',         '생쥐와 인간',        'L4', '{E,A}',    'classic',      'book-of-mice-and-men.webp'),
  ('B019', 'The Old Man and the Sea', '노인과 바다',        'L5', '{X,E}',    'classic',      'book-the-old-man-and-the-sea.webp'),
  ('B020', 'Brave New World',         '멋진 신세계',        'L5', '{X,A}',    'classic',      'book-brave-new-world.webp');

-- 해리포터 7권
INSERT INTO books (id, title, title_ko, level, types, route, cover_image) VALUES
  ('HP001', 'Harry Potter and the Philosopher''s Stone', '해리포터 1권', 'L2', '{S}', 'harrypotter', 'book-harry-potter-1.webp'),
  ('HP002', 'Harry Potter and the Chamber of Secrets',   '해리포터 2권', 'L2', '{S}', 'harrypotter', 'book-harry-potter-2.webp'),
  ('HP003', 'Harry Potter and the Prisoner of Azkaban',  '해리포터 3권', 'L3', '{S}', 'harrypotter', 'book-harry-potter-3.webp'),
  ('HP004', 'Harry Potter and the Goblet of Fire',       '해리포터 4권', 'L3', '{S}', 'harrypotter', 'book-harry-potter-4.webp'),
  ('HP005', 'Harry Potter and the Order of the Phoenix', '해리포터 5권', 'L4', '{S}', 'harrypotter', 'book-harry-potter-5.webp'),
  ('HP006', 'Harry Potter and the Half-Blood Prince',    '해리포터 6권', 'L4', '{S}', 'harrypotter', 'book-harry-potter-6.webp'),
  ('HP007', 'Harry Potter and the Deathly Hallows',      '해리포터 7권', 'L5', '{S}', 'harrypotter', 'book-harry-potter-7.webp');


-- ─────────────────────────────────────────
-- 3. USERS
-- ─────────────────────────────────────────
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE NOT NULL,
  nickname    text NOT NULL,

  -- 진단 결과 (필수 — 가입 전 진단 완료 전제)
  diag_level        text NOT NULL,   -- 'L1'~'L5'
  diag_type         text NOT NULL,   -- 'S'|'A'|'E'|'X'
  diag_full_result  jsonb,           -- literstella_beta_result_v5 전체 저장

  -- 개인 SNS (신청폼 입력, 선택)
  -- 공개 동의 시 인증기록 옆에 표시됨
  blog_url          text,
  instagram_url     text,
  sns_public        boolean NOT NULL DEFAULT false,
  -- 고지 문구(UI): "나의 인증기록이 다른 참가자에게 영감을 줄 수 있어요.
  --               동의하시면 인증 기록 옆에 개인 SNS 주소가 함께 표시됩니다."

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────
-- 4. ENROLLMENTS
-- ─────────────────────────────────────────
-- 나의 영어 독서 다이어리 가입 + 야나완 챌린지 참가를 통합
-- is_yanawan=true  → 야나완 챌린지 참가 (결제 필요)
-- is_yanawan=false → 나의 영어 독서 다이어리 전용 (결제 불필요 or 동일 3,000원 플랜)
CREATE TABLE enrollments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    text NOT NULL REFERENCES seasons(id),

  -- Q-B: 야나완 참가 여부 (신청폼 기본값 true, 해제 시 다이어리 전용)
  is_yanawan   boolean NOT NULL DEFAULT true,

  -- 독서 계획
  primary_book_id  text REFERENCES books(id),  -- 선택 도서 (B001 등)
  custom_book      text,                         -- 나만의 원서 (직접 입력)
  goal_days        int NOT NULL DEFAULT 30,
  reading_modes    text[],                       -- ['morning','night','cafe' ...]

  -- 결제 (야나완 참가 시 3,000원)
  paid_at      timestamptz,
  amount       int NOT NULL DEFAULT 3000,

  -- 상태
  -- pending   → 신청 완료, 결제 대기
  -- active    → 결제 확인, 진행 중
  -- dropped   → 챌린지 포기 → 다이어리 모드 자동 전환
  -- completed → 챌린지 성공
  status       text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','active','dropped','completed')),
  dropped_at   timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, season_id)
);


-- ─────────────────────────────────────────
-- 5. CHECK_INS
-- ─────────────────────────────────────────
-- 야나완 인증 + 나의 영어 독서 다이어리 기록 통합
-- 하루에 두 행 가능: is_yanawan=true 1개 + is_yanawan=false 1개
CREATE TABLE check_ins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    text REFERENCES seasons(id),       -- 다이어리 전용은 NULL 가능

  -- 야나완 인증 여부
  is_yanawan   boolean NOT NULL DEFAULT false,

  -- 독서 기록
  book_id      text REFERENCES books(id),
  custom_book  text,                              -- 나만의 원서
  pages_read   text,                              -- 'pp.24-40'

  -- 다이어리 내용
  sentence     text,   -- 오늘 읽은 문장 (필사)
  reflection   text,   -- 성찰·느낀 점
  template_id  text,   -- 사용한 다이어리 템플릿 ID
  reading_env  text,   -- 독서 환경 (카페, 서재, 침대...)
  mood         text,   -- 오늘 기분 이모지

  -- 인증 URL
  -- Q-C: is_yanawan=true 시 cafe_url 필수 (앱 레벨 강제)
  cafe_url     text,   -- 리터스텔라 카페 인증 게시글 URL

  checked_in_at  date NOT NULL DEFAULT current_date,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- 하루 야나완 인증 1회 제한
  UNIQUE (user_id, season_id, checked_in_at, is_yanawan)
);

-- cafe_url 필수 강제 (야나완 인증 시)
ALTER TABLE check_ins
  ADD CONSTRAINT yanawan_requires_cafe_url
  CHECK (
    is_yanawan = false
    OR (is_yanawan = true AND cafe_url IS NOT NULL AND cafe_url <> '')
  );


-- ─────────────────────────────────────────
-- 6. BADGES
-- ─────────────────────────────────────────
CREATE TABLE badges (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  name_ko        text,
  category       text NOT NULL
                  CHECK (category IN ('honor','participation','finish','streak')),
  -- honor:        명예의 전당 배지 (참가·성공·랭킹)
  -- participation: 참가 횟수 배지
  -- finish:       완독 배지 (도서별)
  -- streak:       일수 성공 배지
  image_path     text,  -- 'assets/badge/...'
  condition_json jsonb, -- 자동 부여 조건 정의
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- 배지 이미지 경로 기준: 02-challenge/literstella-challenge/assets/badge/
-- 완독 배지 (나머지 14종): UI에서 books.cover_image 원형 크롭 + 영문 제목 표시
--   → image_path = 'cover:{book_id}' (UI가 books 테이블에서 cover_image 조회)
-- 명예의 전당 랭킹: 별도 이미지 없음 → UI에서 🥇🥈🥉 메달 렌더링
--   → image_path = 'medal:gold' | 'medal:silver' | 'medal:bronze'
-- =============================================================

-- ── 일수 성공 배지 (streak) ──────────────────────────────────
INSERT INTO badges (id, name, name_ko, category, image_path, condition_json) VALUES
  ('streak_3',   '3-Day Streak',   '3일 스타트',    'streak', 'assets/badge/badge_day_003_start.png',          '{"days": 3}'),
  ('streak_7',   '7-Day Streak',   '7일 허들',      'streak', 'assets/badge/badge_day_007_hurdle.png',         '{"days": 7}'),
  ('streak_10',  '10-Day Streak',  '10일 루틴',     'streak', 'assets/badge/badge_day_010_routine.png',        '{"days": 10}'),
  ('streak_30',  '30-Day Streak',  '30일 기본 성공', 'streak', 'assets/badge/badge_day_030_basic_success.png',  '{"days": 30}'),
  ('streak_66',  '66-Day Streak',  '66일 습관 완성', 'streak', 'assets/badge/badge_day_066_habit_extension.png','{"days": 66}'),
  ('streak_100', '100-Day Streak', '100일 피니셔',  'streak', 'assets/badge/badge_day_100_finish.png',         '{"days": 100}');

-- ── 명예의 전당 — 도전의 전당 (누적 참가 횟수 순위) ─────────────
-- UI에서 금/은/동 메달(🥇🥈🥉) 렌더링, image_path = 'medal:*'
-- yanawan_participation_bronze/silver/gold.png 재활용
INSERT INTO badges (id, name, name_ko, category, image_path, condition_json) VALUES
  ('honor_join_bronze', '도전의 전당 Bronze', '도전의 전당 브론즈', 'honor', 'assets/badge/yanawan_participation_bronze.png', '{"join_count": 1}'),
  ('honor_join_silver', '도전의 전당 Silver', '도전의 전당 실버',   'honor', 'assets/badge/yanawan_participation_silver.png', '{"join_count": 3}'),
  ('honor_join_gold',   '도전의 전당 Gold',   '도전의 전당 골드',   'honor', 'assets/badge/yanawan_participation_gold.png',   '{"join_count": 5}');

-- ── 명예의 전당 — 성공의 전당 (완주 성공 횟수 순위) ─────────────
-- yanawan_finisher_bronze/silver/gold.png
INSERT INTO badges (id, name, name_ko, category, image_path, condition_json) VALUES
  ('honor_win_bronze', '성공의 전당 Bronze', '성공의 전당 브론즈', 'honor', 'assets/badge/yanawan_finisher_bronze.png', '{"win_count": 1}'),
  ('honor_win_silver', '성공의 전당 Silver', '성공의 전당 실버',   'honor', 'assets/badge/yanawan_finisher_silver.png', '{"win_count": 2}'),
  ('honor_win_gold',   '성공의 전당 Gold',   '성공의 전당 골드',   'honor', 'assets/badge/yanawan_finisher_gold.png',   '{"win_count": 3}');

-- ── 명예의 전당 — 시즌 랭킹 (도전의 전당 1·2·3위) ──────────────
-- 별도 이미지 없음 → UI가 'medal:gold/silver/bronze' 키로 메달 렌더링
INSERT INTO badges (id, name, name_ko, category, image_path, condition_json) VALUES
  ('honor_rank_1', '시즌 랭킹 1위', '시즌 1위', 'honor', 'medal:gold',   '{"rank": 1}'),
  ('honor_rank_2', '시즌 랭킹 2위', '시즌 2위', 'honor', 'medal:silver', '{"rank": 2}'),
  ('honor_rank_3', '시즌 랭킹 3위', '시즌 3위', 'honor', 'medal:bronze', '{"rank": 3}');

-- ── 참가 횟수 배지 — 숫자 오버레이형 ───────────────────────────
-- yanawan_participation_1count.png (UI에서 누적 횟수 숫자 오버레이)
INSERT INTO badges (id, name, name_ko, category, image_path, condition_json) VALUES
  ('participation', '참가 횟수', '참가 횟수', 'participation',
   'assets/badge/yanawan_participation_1count.png',
   '{"type": "cumulative_count"}');

-- ── 완독 배지 — 리터스텔라 클래식 6종 (전용 배지 이미지) ─────────
INSERT INTO badges (id, name, name_ko, category, image_path, condition_json) VALUES
  ('finish_B001', 'Finished: Daddy-Long-Legs',      '완독: 키다리 아저씨',  'finish', 'assets/badge/daddylonglegs-finish.png',          '{"book_id": "B001"}'),
  ('finish_B005', 'Finished: Anne of Green Gables', '완독: 빨강 머리 앤',   'finish', 'assets/badge/anneofgreengables_finish.png',      '{"book_id": "B005"}'),
  ('finish_B009', 'Finished: Little Women',          '완독: 작은 아씨들',    'finish', 'assets/badge/littlewomen_finish.png',            '{"book_id": "B009"}'),
  ('finish_B013', 'Finished: Pride and Prejudice',   '완독: 오만과 편견',    'finish', 'assets/badge/prideandprejudice_finish.png',      '{"book_id": "B013"}'),
  ('finish_B017', 'Finished: Sherlock Holmes',       '완독: 셜록 홈즈',      'finish', 'assets/badge/sherlok_studyinscarlet_finish.png', '{"book_id": "B017"}'),
  ('finish_B018', 'Finished: The Great Gatsby',      '완독: 위대한 개츠비',  'finish', 'assets/badge/thegreatgatsby_finish.png',         '{"book_id": "B018"}');

-- ── 완독 배지 — HP 7권 (전용 배지 이미지) ────────────────────────
INSERT INTO badges (id, name, name_ko, category, image_path, condition_json) VALUES
  ('finish_HP001', 'Finished: HP Book 1', '완독: 해리포터 1권', 'finish', 'assets/badge/harry1_finish.png', '{"book_id": "HP001"}'),
  ('finish_HP002', 'Finished: HP Book 2', '완독: 해리포터 2권', 'finish', 'assets/badge/harry2_finish.png', '{"book_id": "HP002"}'),
  ('finish_HP003', 'Finished: HP Book 3', '완독: 해리포터 3권', 'finish', 'assets/badge/harry3_finish.png', '{"book_id": "HP003"}'),
  ('finish_HP004', 'Finished: HP Book 4', '완독: 해리포터 4권', 'finish', 'assets/badge/harry4_finish.png', '{"book_id": "HP004"}'),
  ('finish_HP005', 'Finished: HP Book 5', '완독: 해리포터 5권', 'finish', 'assets/badge/harry5_finish.png', '{"book_id": "HP005"}'),
  ('finish_HP006', 'Finished: HP Book 6', '완독: 해리포터 6권', 'finish', 'assets/badge/harry6_finish.png', '{"book_id": "HP006"}'),
  ('finish_HP007', 'Finished: HP Book 7', '완독: 해리포터 7권', 'finish', 'assets/badge/harry7_finish.png', '{"book_id": "HP007"}');

-- ── 완독 배지 — 나머지 14종 (표지 원형 크롭 + 영문 제목) ──────────
-- image_path = 'cover:{book_id}' → UI가 books.cover_image 조회하여 원형 크롭 렌더링
-- 표지 원본 경로: 01-reading-diagnosis/literstella-reading-diagnosis/assets/{cover_image}
INSERT INTO badges (id, name, name_ko, category, image_path, condition_json) VALUES
  ('finish_B002', 'Finished: Charlotte''s Web',        '완독: 샬롯의 거미줄',      'finish', 'cover:B002', '{"book_id": "B002"}'),
  ('finish_B003', 'Finished: The Little Prince',       '완독: 어린 왕자',           'finish', 'cover:B003', '{"book_id": "B003"}'),
  ('finish_B004', 'Finished: Diary of a Wimpy Kid',    '완독: 윔피키드 다이어리',   'finish', 'cover:B004', '{"book_id": "B004"}'),
  ('finish_B006', 'Finished: Peter Pan',               '완독: 피터팬',              'finish', 'cover:B006', '{"book_id": "B006"}'),
  ('finish_B007', 'Finished: The Wind in the Willows', '완독: 버드나무에 부는 바람', 'finish', 'cover:B007', '{"book_id": "B007"}'),
  ('finish_B008', 'Finished: Wonder',                  '완독: 원더',                'finish', 'cover:B008', '{"book_id": "B008"}'),
  ('finish_B010', 'Finished: The Giver',               '완독: 기억 전달자',          'finish', 'cover:B010', '{"book_id": "B010"}'),
  ('finish_B011', 'Finished: Animal Farm',             '완독: 동물 농장',            'finish', 'cover:B011', '{"book_id": "B011"}'),
  ('finish_B012', 'Finished: Flipped',                 '완독: 플립드',              'finish', 'cover:B012', '{"book_id": "B012"}'),
  ('finish_B014', 'Finished: To Kill a Mockingbird',   '완독: 앵무새 죽이기',        'finish', 'cover:B014', '{"book_id": "B014"}'),
  ('finish_B015', 'Finished: 1984',                    '완독: 1984',                'finish', 'cover:B015', '{"book_id": "B015"}'),
  ('finish_B016', 'Finished: Of Mice and Men',         '완독: 생쥐와 인간',          'finish', 'cover:B016', '{"book_id": "B016"}'),
  ('finish_B019', 'Finished: The Old Man and the Sea', '완독: 노인과 바다',          'finish', 'cover:B019', '{"book_id": "B019"}'),
  ('finish_B020', 'Finished: Brave New World',         '완독: 멋진 신세계',          'finish', 'cover:B020', '{"book_id": "B020"}');

-- ── 완독 배지 — 나만의 원서 (제네릭 + 원서명 텍스트 오버레이) ──────
-- myenglishbook_finish.png 위에 UI에서 custom_book 텍스트 오버레이
INSERT INTO badges (id, name, name_ko, category, image_path, condition_json) VALUES
  ('finish_custom', 'Finished: My Own Book', '완독: 나만의 원서', 'finish',
   'assets/badge/myenglishbook_finish.png',
   '{"type": "custom_book"}');


-- ─────────────────────────────────────────
-- 7. USER_BADGES
-- ─────────────────────────────────────────
CREATE TABLE user_badges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id    text NOT NULL REFERENCES badges(id),
  season_id   text REFERENCES seasons(id),  -- 랭킹 배지는 시즌 기록 필요, 나머지는 NULL 가능
  earned_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_id, season_id)
);


-- ─────────────────────────────────────────
-- 8. RLS (Row Level Security) — 기본 정책
-- ─────────────────────────────────────────
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

-- 본인 데이터만 쓰기 가능
CREATE POLICY "users: own row" ON users
  USING (auth.uid() = id);

CREATE POLICY "enrollments: own row" ON enrollments
  USING (auth.uid() = user_id);

CREATE POLICY "check_ins: own write" ON check_ins
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 야나완 인증 + sns_public 동의한 기록은 전체 공개 읽기
CREATE POLICY "check_ins: public yanawan read" ON check_ins
  FOR SELECT USING (
    is_yanawan = true
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = check_ins.user_id
        AND u.sns_public = true
    )
  );

-- 본인 기록은 항상 읽기 가능
CREATE POLICY "check_ins: own read" ON check_ins
  FOR SELECT USING (auth.uid() = user_id);

-- 시즌·도서·배지 정의는 전체 읽기 공개
ALTER TABLE seasons     ENABLE ROW LEVEL SECURITY;
ALTER TABLE books       ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seasons public read"  ON seasons FOR SELECT USING (true);
CREATE POLICY "books public read"    ON books   FOR SELECT USING (true);
CREATE POLICY "badges public read"   ON badges  FOR SELECT USING (true);
CREATE POLICY "user_badges own read" ON user_badges FOR SELECT USING (auth.uid() = user_id);


-- ─────────────────────────────────────────
-- 9. 시즌 리셋 (2606 → 2607)
-- ─────────────────────────────────────────
-- 유저 데이터 보존, 행동 데이터만 삭제
-- DELETE FROM user_badges  WHERE season_id = 'yanawan-2606';
-- DELETE FROM check_ins    WHERE season_id = 'yanawan-2606';
-- DELETE FROM enrollments  WHERE season_id = 'yanawan-2606';
-- UPDATE seasons SET is_active = false WHERE id = 'yanawan-2606';
-- INSERT INTO seasons ... yanawan-2607 ...
