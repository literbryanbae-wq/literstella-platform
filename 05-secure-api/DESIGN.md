# LiterStella 보안 API + 포트원(PortOne) V2 결제 — 통합 설계 (초안)

> 상태: **초안 / 미배포**. 포트원 가맹 승인(≈2026-07-01) 후 단계별 배포.
> 라이브 영향 0 — 이 Worker는 아직 어디서도 호출되지 않으며, 모든 기능은 플래그(기본 OFF) 뒤에 있음.
> 관련 결정/순서: `memory/payment_portone_sequencing.md`

---

## 0. 왜 이걸 만드는가 (한 묶음의 이유)

지금 구조의 두 보안 구멍이 **결제를 붙이는 순간 치명적**이 된다:
1. **관리자 쓰기가 anon 키 + 클라이언트 이메일 비교로만 보호됨** (#8b) — localStorage 이메일 위조로 입금토글·삭제가 가능. 결제/정산이 붙으면 돈 문제.
2. **공개 엔드포인트 레이트리밋 없음** (#9 WAF) — OTP 메일폭탄·비용.

그래서 **결제 직전에 #8b(관리자 service_role) + #11c(시즌 동적화) + WAF**를 한 묶음으로 끝내고, 그 위에 포트원을 올린다. 이 Worker(`literstella-api`)가 그 그릇이다.

---

## 1. 아키텍처

```
[challenge Pages]  [diag Worker]            (프론트)
        │                │
        └──────┬─────────┘  fetch(CORS 화이트리스트)
               ▼
     ┌───────────────────────────┐
     │   literstella-api (Worker) │  ← 신규, 단일 보안 백엔드
     │   secrets: service_role,   │
     │   PORTONE_API_SECRET,      │
     │   PORTONE_WEBHOOK_SECRET,  │
     │   OTP_SECRET, ADMIN_SECRET │
     │   flags: ADMIN_API_ENABLED,│
     │          PAYMENT_ENABLED   │
     └───────────────────────────┘
               │ service_role
               ▼
          [Supabase]      [PortOne V2 API]
```

- **새 전용 Worker** `literstella-api` (도메인: `api.literstella.co.kr` 권장, 우선 `*.workers.dev`도 가능).
- 프론트는 anon 직접쓰기 대신 이 API를 호출. **service_role 키는 이 Worker 안에서만** 산다(브라우저 노출 0).
- 모든 위험 기능은 **env 플래그**(기본 false). 켜기 = 시크릿 주입 + 플래그 true + 프론트 재배선.

> 대안: 기존 diag Worker에 라우트 추가(인프라 재사용) vs 신규 Worker(분리). 결제는 민감해서 **분리 권장**. 최종은 배포 직전 결정.

---

## 2. 엔드포인트

### 2-1. 관리자 (#8b — anon 쓰기 폐기)
| 메서드 · 경로 | 역할 |
|---|---|
| `POST /api/admin/auth` | 운영자 이메일 + OTP 코드(이메일 발송) 검증 → **단기 관리자 토큰(HMAC, 2h)** 발급. 클라 이메일 비교 폐기. |
| `POST /api/admin/payment/confirm` | `{enrollmentId, paid}` → service_role로 `enrollments.status` active/pending |
| `POST /api/admin/enrollment/delete` | service_role delete |
| `POST /api/admin/report/status` · `/api/admin/announce` · `/api/admin/book-request/status` | 신고/공지/원서신청 쓰기 |

모든 admin 라우트: `Authorization: Bearer <admin token>` 검증 후 실행. 토큰 없으면 401.

### 2-2. 결제 (포트원 V2)
| 메서드 · 경로 | 역할 |
|---|---|
| `POST /api/payment/billing-key/issue` | 정기결제용 빌링키 등록(클라 SDK로 카드 등록 → 서버가 검증·저장) |
| `POST /api/payment/subscribe` | 빌링키로 첫 결제 + 구독 생성(시즌 자동갱신) |
| `POST /api/payment/charge` | 단건(재도전·연장) |
| `POST /api/payment/webhook` | 포트원 웹훅 수신 → **서명 검증 → 멱등 처리 → DB 반영** |
| `POST /api/payment/cancel` | 구독 해지/환불 |
| `(Cron)` 매일 1회 | `next_charge_at <= 오늘` 구독 빌링키 자동결제 |

### 2-3. PG·결제수단 (포트원 경유 — 운영자 확정 2026-06-17)
- **Store ID(공개):** `store-464ff242-c317-4693-96c2-1052658e14b7` (프론트 SDK `requestPayment({storeId})`용, 비밀 아님)
- **channelKey(받음 2026-06-17, 프론트값):** `channel-key-3917d309-e69b-44b6-a0d5-2c7e3b727165` (프론트 `requestPayment({channelKey})`용 — PG채널 선택, 비밀 아님. 단건/빌링키 채널이 분리돼 있으면 추가 키가 더 필요할 수 있음 — 콘솔 확인)
- **아직 필요(서버 시크릿 1개):** **PORTONE_API_SECRET** — 포트원 콘솔에서 발급해 `wrangler secret put PORTONE_API_SECRET`로만 주입. **채팅/코드 평문 금지.**
- KG이니시스 테스트: 포트원 콘솔에서 KG이니시스 채널 '테스트' 모드 추가 → 테스트 MID+테스트 카드번호. 별도 KG 로그인 계정은 대개 실계약용(테스트 불필요, 콘솔서 확인).
- **카드:** KG이니시스 — 테스트 빌링 MID **`INIBillTst`(받음 2026-06-17, KG 공개 테스트값, 정기결제/빌링키 테스트용)**. 포트원 콘솔 KG이니시스 '테스트' 채널에 매핑 → 프론트는 channelKey로 호출. (일반결제 테스트 MID는 통상 `INIpayTest`)
- **API Secret 상태(2026-06-17):** 운영자 "준비완료" 통보. ⚠️ **아직 Worker secret로 주입 전 — 채팅 평문 금지.** secure-api Worker를 **플래그 OFF로 선배포 → `wrangler secret put PORTONE_API_SECRET`**(테스트 시크릿)로만 주입. 테스트 검증 후 운영 시크릿으로 교체.
- **간편결제:** 네이버페이 · 카카오페이 · 토스페이
- **다날:** 휴대폰 (★ 본인인증인지 휴대폰 소액결제인지 빌드 직전 확인 — 포트원은 둘 다 지원)
- **형태:** 단건결제 + **구독(정기결제, 빌링키)** 둘 다.
- ⚠️ **네이버페이는 "결제형"으로만 연동** (결제만, 배송정보 X). 배송 자동화=네이버페이 "주문형"+스마트스토어 별도 — **실물 배송 보류라 현재 불필요**. 전 상품 디지털(구독·AI·PDF·강의)이라 배송 로직 자체가 없음.
- 빌링키(정기결제) 지원 PG 확인 필요 — 카드(이니시스)는 가능, 간편결제별 정기결제 지원 범위는 포트원 콘솔에서 확인.

---

## 3. 결제 시퀀스 (정기결제/빌링키 — 야나완 월 구독)

```
1. 결제화면 → 포트원 브라우저 SDK로 카드 등록 → billingKey(또는 issueId) 수신
2. 클라 → POST /api/payment/subscribe { billingKey, seasonId }
3. 서버:
   a. 포트원 서버 API로 빌링키 유효성 + 첫 결제 요청  ← (정확 경로/바디는 PortOne V2 docs 대조 ★)
   b. 금액은 서버가 결정(클라 금액 신뢰 X) — 야나완 3,000원/연장가 등 서버 상수
   c. paymentId를 payments 테이블에 멱등 INSERT(UNIQUE) — 중복 방지
   d. 성공 → enrollments.status='active' + subscriptions row + 포인트 적립(시작선물 300P 등)
4. 자동갱신: Workers Cron → next_charge_at<=오늘 구독을 빌링키로 결제 → 결과로 상태 갱신
5. 결과 통지는 웹훅(4번)으로도 들어옴 → 동일 멱등 경로로 합류
```

단건(재도전/연장)은 2~3만 타고 구독 생성 없이 종료.

---

## 4. 웹훅 검증 (필수 — 위조 결제 차단)

- 포트원 V2 웹훅은 **Svix 호환 서명**(`webhook-id`, `webhook-timestamp`, `webhook-signature` 헤더)을 보냄.
  → `PORTONE_WEBHOOK_SECRET`로 HMAC-SHA256 검증. `@portone/server-sdk`의 `Webhook.verify` 또는 수동 구현. **헤더명/포맷은 PortOne V2 docs 대조 ★**
- **멱등:** 웹훅 페이로드의 `paymentId`(또는 txId)를 `payments` UNIQUE로 → 중복 웹훅·재전송 무시.
- 검증 실패 → `401`, **DB 절대 미반영**.
- 처리 순서: 서명검증 → 멱등체크 → 포트원 서버 API로 결제 상태 **재조회**(웹훅 본문만 신뢰 X) → DB 반영.

---

## 5. 보안 원칙

- **시크릿 전부 Worker secret**(`wrangler secret put`). 코드/평문/저장소 금지.
- **금액은 서버가 결정.** 클라가 보낸 금액/상품 신뢰 금지(서버 가격표와 대조).
- **service_role은 Worker 내부에서만.** 프론트엔 절대 노출 안 함.
- 관리자 토큰 단기(2h), OTP는 기존 diag Worker 인프라(이메일 코드 + HMAC) 재사용.
- 본인확인: `real_name` + `email` + (검토)휴대폰 — `memory/payment_identity.md`.
- CORS Origin 화이트리스트(challenge·diag·read 도메인만).

---

## 6. DB 변경 (배포 시 마이그레이션 — 운영자 SQL)

```sql
-- 구독(정기결제)
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  season_id text,
  provider text DEFAULT 'portone',
  billing_key text,
  status text DEFAULT 'active',     -- active | canceled | failed
  next_charge_at timestamptz,
  created_at timestamptz DEFAULT now()
);
-- 결제 원장(멱등 — 웹훅/응답 중복 흡수)
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,              -- 포트원 paymentId
  user_id uuid REFERENCES users(id),
  amount integer,
  status text,                      -- paid | failed | canceled | refunded
  raw jsonb,
  created_at timestamptz DEFAULT now()
);
-- 본인확인
ALTER TABLE users ADD COLUMN IF NOT EXISTS real_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;     -- 이미 있으면 무시
```

RLS: 위 두 테이블은 **anon 접근 전면 차단**(service_role Worker만). 기존 테이블은 #8b 단계에서 anon 쓰기 제거.

---

## 7. 롤백

- 각 단계 **플래그로 즉시 차단**(`ADMIN_API_ENABLED=false`, `PAYMENT_ENABLED=false`).
- **RLS 조이기는 맨 마지막** — 관리자 API가 검증된 뒤에만. 문제 시 `rls-rollback.sql`(anon 정책 복원)로 즉시 되돌림.
- 결제 사고: 포트원 콘솔 환불 + `/api/payment/cancel`. payments 원장으로 추적.
- 신규 Worker라 기존 앱과 독립 배포/롤백.

---

## 8. 배포 순서 (라이브 안 깨지게 — 엄수)

1. `literstella-api` 배포 (플래그 **OFF**) — 무영향.
2. 시크릿 주입: `SUPABASE_SERVICE_ROLE_KEY`, `OTP_SECRET`, `ADMIN_SECRET`, `PORTONE_API_SECRET`, `PORTONE_WEBHOOK_SECRET`.
3. `ADMIN_API_ENABLED=true` + AdminPanel을 새 API로 교체 → **검증**(입금토글·삭제·공지·원서승인 실측).
4. **RLS 조이기**(anon 쓰기 제거) — 운영자 SQL. (3 검증 후에만!)
5. DB 마이그레이션(subscriptions·payments·real_name) → `PAYMENT_ENABLED=true` + 결제 UI + 포트원 콘솔 웹훅 등록.
6. **WAF 레이트리밋** 룰(`/api/send-code`·`/api/verify-code`·결제 경로).
7. 자동갱신 Cron 활성 + 소액 실결제 E2E.

---

## 9. 미확정 / 확인 필요 (포트원 승인 후)

- **포트원 V2 정확 스펙** — 빌링키 발급/결제 엔드포인트·바디, 웹훅 서명 헤더(★ PortOne V2 공식 문서 대조 필수, 추정 금지).
- **정기(빌링키) vs 단건** 최종 결정 — 야나완 자동갱신이면 빌링키.
- **도메인** — `api.literstella.co.kr` 서브도메인 vs `*.workers.dev`.
- **결제 형태별 가격표** — 서버 상수(3,000 / 연장 / 재도전 50%캡) `point_economy` 기준.
- 본인확인 휴대폰 수집 범위 — `payment_identity`.
