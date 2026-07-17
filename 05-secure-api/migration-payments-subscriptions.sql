-- =============================================================
-- literstella-api 결제 스키마 (포트원 V2) — 운영자 Supabase SQL Editor에서 실행
-- ⚠️ PAYMENT_ENABLED=true 켜기 전에 반드시 실행. 미실행 시 on_conflict 제약 부재로
--    모든 구독 upsert가 42P10 에러 → 결제/구독 전부 실패.
-- 컬럼/상태값은 src/index.js가 실제로 쓰는 것과 1:1 일치(검증 2026-06-17 세션 31-B).
-- =============================================================

-- ── 결제 원장(멱등) — id = 포트원 paymentId (우리가 생성, "payment-<uuid>") ──
create table if not exists public.payments (
  id          text primary key,                 -- on_conflict=id 대상 (멱등)
  billing_key text,
  email       text,
  user_id     text,                             -- Supabase auth user id (검증 토큰에서만)
  amount      integer,
  status      text,                             -- requested | pending_verify | PAID | FAILED | CANCELLED | ...
  source      text,                             -- charge | subscribe | cron
  raw         jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists payments_billing_key_idx on public.payments (billing_key);
create index if not exists payments_user_id_idx     on public.payments (user_id);

-- ── 구독 — billing_key UNIQUE (on_conflict=billing_key 대상) ──
create table if not exists public.subscriptions (
  billing_key     text unique not null,         -- ⭐ on_conflict 대상 (이 UNIQUE 없으면 upsert 전부 실패)
  user_id         text,
  email           text,
  status          text default 'registered',    -- registered | active | past_due | pending_verify | canceled
  next_charge_at  timestamptz,
  last_payment_id text,
  retry_count     integer default 0,            -- 던닝 캡(연속 실패 4회 → canceled) 카운터
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists subscriptions_status_next_idx on public.subscriptions (status, next_charge_at);
create index if not exists subscriptions_user_id_idx      on public.subscriptions (user_id);
create index if not exists subscriptions_last_payment_idx on public.subscriptions (last_payment_id);

-- ── RLS: anon 전면 차단 (이 Worker의 service_role만 접근; service_role은 RLS 우회) ──
alter table public.payments      enable row level security;
alter table public.subscriptions enable row level security;
-- 정책 없음 = anon/authenticated 접근 0. 결제 데이터는 절대 클라에 노출 금지.

-- =============================================================
-- 잔여 운영 TODO(코드 주석/스펙에도 표기):
--  · pending_verify 가 장기간 미해소면 수동검토 플래그(현재는 cron이 무한 재조회만) — 후속 보강
--  · 던닝 캡 일수/회차 정책 확정(현재 연속 4일 실패 → 자동 해지)
-- =============================================================
