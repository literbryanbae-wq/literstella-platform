-- 강독(클래식 원서 강독) 업데이트 알림 구독 — 운영자 Supabase SQL Editor 실행
-- 운영자 확정 패턴(2026-07-14, hp_subscribers 전례): 스트림별 '별개 구독' = 별도 테이블.
--   클래식 한 문장(sentence_subscribers)·호그와트 편지(hp_subscribers)와 독립 토글.
-- 앱 opt-in(lectureSubscribe.js)이 upsert, 발송은 05 Worker /api/admin/send-content {audience:'lecture'}.

create table if not exists lecture_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  active boolean default true,
  source text default 'lecture',
  created_at timestamptz default now()
);
create unique index if not exists lecture_subscribers_email_uk on lecture_subscribers (lower(email));
alter table lecture_subscribers enable row level security;
drop policy if exists "lecture_subscribers upsert" on lecture_subscribers;
create policy "lecture_subscribers upsert" on lecture_subscribers for insert with check (true);
drop policy if exists "lecture_subscribers update" on lecture_subscribers;
create policy "lecture_subscribers update" on lecture_subscribers for update using (true) with check (true);
-- (구독은 앱에서 로그인 게이트. RLS 관대(anon 토글) — 뉴스레터 opt-in 특성상 저위험. 발송 조회는 service_role.)
