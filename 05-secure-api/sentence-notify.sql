-- 「클래식 영어 한 문장」 알림 발송 — 운영자 Supabase SQL Editor 실행
-- ① sentence_subscribers : 뉴스레터 구독(회원 이메일). 앱 opt-in(sentenceSubscribe.js)이 upsert, 발송 Worker가 조회.
-- ② sentence_broadcasts  : 새 회차 발행 알림. 발송 Worker(service_role)가 insert, Lyra 인앱이 최신 1건 읽어 넛지.

-- ① 구독자
create table if not exists sentence_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  active boolean default true,
  source text default 'sentence',
  created_at timestamptz default now()
);
create unique index if not exists sentence_subscribers_email_uk on sentence_subscribers (lower(email));
alter table sentence_subscribers enable row level security;
drop policy if exists "sentence_subscribers upsert" on sentence_subscribers;
create policy "sentence_subscribers upsert" on sentence_subscribers for insert with check (true);
drop policy if exists "sentence_subscribers update" on sentence_subscribers;
create policy "sentence_subscribers update" on sentence_subscribers for update using (true) with check (true);
-- (구독은 앱에서 로그인 게이트. RLS는 관대(anon 토글 허용) — 뉴스레터 opt-in 특성상 저위험. 발송은 service_role.)

-- ② 발행 알림(Lyra 인앱 넛지용)
create table if not exists sentence_broadcasts (
  id uuid primary key default gen_random_uuid(),
  episode_id text not null,
  book text,
  day int,
  title text,
  sentence_ko text,
  created_at timestamptz default now()
);
create index if not exists sentence_broadcasts_created_idx on sentence_broadcasts (created_at desc);
alter table sentence_broadcasts enable row level security;
drop policy if exists "sentence_broadcasts read" on sentence_broadcasts;
create policy "sentence_broadcasts read" on sentence_broadcasts for select using (true);  -- 공개 읽기(Lyra 넛지가 최신 회차 조회)
-- (insert는 service_role Worker만 — anon insert 정책 없음 = 위조 차단)
