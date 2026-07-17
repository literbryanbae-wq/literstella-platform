# 관리자 모드 계획서 (구현 전 설계)

> 작성: 2026-06-13 (운영자 지시: "구현하지 말고 계획 문서만 — 고도화 대비 포함")
> 대상: 챌린지앱 AdminPanel 확장. 구현 착수 시 이 문서가 스펙의 출발점.

---

## 1. 현재 상태 (있는 그대로)

| 항목 | 현재 | 한계 |
|---|---|---|
| 진입 | Footer "운영" 버튼 (흐리게) | 누구나 버튼은 보임 |
| 인증 | 이메일+PIN 하드코딩 (`literbryanbae@gmail.com`/번들 내 PIN) | **번들에 PIN 노출** — 보안 아님, 가림막 수준 |
| 권한 | 브라우저의 anon key 그대로 사용 | 관리자만 가능한 작업이 사실상 없음 (RLS가 public이라 누구나 같은 권한) |
| 기능 | ①신청자 목록+입금확인 체크 ②버그/문의 목록 | 수동 복원·포인트 조정·회원 관리는 전부 **운영자가 Supabase SQL 직접 실행** |

**문제의 핵심**: "관리자만 할 수 있는 일"이 시스템적으로 존재하지 않음. 관리자 모드의 진짜 가치는 화면이 아니라 **권한 분리**에 있음 → §4 보안이 선행 조건.

---

## 2. 목표

**운영자가 SQL 없이 일상 운영 100%.** 지금 SQL로 하는 일(인증 수동 복원, 테스트 데이터 정리, 포인트 보정)을 전부 버튼으로.

---

## 3. 화면 설계 — 7개 탭

### 탭 1. 📊 대시보드 (통계)
- 오늘: 인증 수 / 인증률 / 신규 가입 / 문의 미답변 수
- 시즌 누적: 참가자·완독 권수·발행 포인트 총량(부채 관점)·응원 수
- 시스템 상태: 카페 API 정상 여부(마지막 성공 게시 시각), Worker 헬스, 네이버 로그인 상태

### 탭 2. 👥 회원 통합 관리
- 검색(이메일·닉네임) → 프로필 카드: 가입일·로그인 수단·국가/지역·SNS·노출 설정
- 참가 상태(enrollment) 보기/변경 (pending→active 입금확인 포함 — 기존 기능 흡수)
- 포인트 잔액 + 원장 바로가기, 인증 이력 바로가기
- ⚠️ 위험 작업(계정 삭제·이메일 변경)은 2차 확인 + 감사 로그 필수

### 탭 3. ✅ 인증 관리
- 인증 목록: 날짜·회원·책·카페링크 필터
- **수동 복원 UI** — 세션 28에서 SQL로 했던 작업(막힌 인증 복원)을 폼으로: 회원 선택 + 날짜 + 책 + "(운영 복원)" 자동 표기
- 인증 무효화(카페 글 부정 등) — 삭제가 아닌 무효 플래그(기록 보존)
- 완독 수동 부여/취소 (finish 배지 + is_complete 동기)

### 탭 4. 💳 결제·입금
- 입금 확인(기존) + 포트원 연동 후: 결제 내역 조회, 환불 처리(환불 규정 연동)
- 그랜드파더링(7월 시작 무료) 대상자 표시

### 탭 5. 🪙 포인트 원장
- 회원별 원장 조회 (적립/사용, ref 추적)
- 수동 적립·차감 — **사유 입력 필수**, 감사 로그 자동 기록
- 이상 감지: 하루 N회 이상 적립, 비정상 ref 패턴 목록

### 탭 6. 🌟 콘텐츠·커뮤니티
- **추천 글(featured) 관리** — 운영자가 좋은 인증글·후기를 골라 라이브보드 상단 고정 (운영자 확정 기능, 응원 표면 정책과 연결)
- 후기 검수: 성공/완독 후기 목록 + 포인트 적립 확인
- 배지 수동 부여/회수

### 탭 7. 💬 문의 (기존 확장)
- bug_reports + 상태(접수/처리중/답변완료) 관리 → 알림종(NotificationBell)과 연동
- 운영자 답변 작성 → 자동 메일(Resend) 발송 옵션

---

## 4. 고도화 대비 아키텍처 (구현 시 반드시 이 순서)

### 4-1. 🔴 보안 — 선행 조건 (이것 없이 기능만 늘리면 위험)
```
현재:  브라우저(anon key) ──직접──> Supabase (RLS public)
목표:  브라우저 ──관리자 토큰──> Worker(/api/admin/*) ──service_role──> Supabase
```
- 관리자 작업은 전부 **Worker 경유 service_role** (진단앱 Worker에 /api/admin/* 추가 — 이미 SERVICE_ROLE_KEY 보유)
- 관리자 인증: 하드코딩 PIN 폐기 → Supabase Auth 로그인 + users.role='admin' 클레임 검증 (Worker가 JWT 검증)
- 이 전환은 **7/1 수익화 전 RLS 강화와 한 묶음** (check_ins INSERT 강화 과제와 동일 시점 권장)

### 4-2. 권한 모델 (미래 대비, 지금은 설계만)
- users.role: 'admin'(운영자) / 'staff'(보조 운영) / null(일반) — 컬럼만 미리. staff는 문의·인증 관리만 등 탭 단위 권한.

### 4-3. 감사 로그 (돈 만지는 순간 필수)
- `admin_actions` 테이블: who(admin id)·what(action)·target(회원/행 id)·before/after(jsonb)·at
- 포인트 조정·환불·계정 변경은 감사 로그 없으면 실행 불가로 설계

### 4-4. 분리 옵션 (규모 커지면)
- 현재: 같은 번들 내 컴포넌트 (import.meta.env로 숨김 불가 — 라이브 노출됨)
- 1차 개선: 코드 스플리팅 + 역할 확인 후 lazy load
- 장기: admin.literstella.co.kr 별도 앱 (일반 번들에서 관리자 코드 완전 제거)

---

## 5. 필요한 스키마 (구현 착수 시 운영자 SQL)

```sql
-- 추천 글 상단 고정
CREATE TABLE IF NOT EXISTS featured_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,            -- 'checkin' | 'review'
  ref_id uuid,                   -- check_ins.id 등
  title text, note text,         -- 운영자 코멘트
  pinned_until date,             -- 자동 해제일
  created_at timestamptz DEFAULT now()
);
-- 관리자 역할 + 감사 로그
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text;  -- 'admin' | 'staff' | null
CREATE TABLE IF NOT EXISTS admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL, action text NOT NULL,
  target text, before_data jsonb, after_data jsonb,
  created_at timestamptz DEFAULT now()
);
-- 문의 상태
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS status text DEFAULT 'open'; -- open|in_progress|answered
-- 인증 무효화 (삭제 대신 보존)
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS voided boolean DEFAULT false;
```

---

## 6. 단계별 로드맵

| 단계 | 시점 | 내용 | 규모 |
|---|---|---|---|
| **P0** | 다음 여유 세션 | 인증 수동 복원 UI + featured 관리 + 문의 상태 (현 anon 구조 위에 — 베타 한정 수용) | 1세션 |
| **P1** | **7/1 수익화 전 필수** | Worker /api/admin/* + service_role 전환 + 관리자 Auth + 포인트 조정·감사 로그 + 대시보드 | 2~3세션 |
| **P2** | 과금 후 | 결제·환불 탭(포트원) + staff 권한 + 이상 감지 | 2세션 |

---

## 7. 리스크 메모

- **P0를 현 구조(anon) 위에 만들면**: 기능은 되지만 "관리자만 가능"이 아님(아는 사람은 콘솔로 동일 작업 가능) — 베타 기간 한정 수용, P1에서 해소. 절대 결제·환불을 P0 구조에 올리지 말 것.
- featured/감사로그 스키마는 P0 착수 시 운영자 SQL 1회.
- 관리자 모드 작업은 챌린지앱 코드라 다른 챌린지앱 작업과 **병렬 세션 금지** (충돌).
