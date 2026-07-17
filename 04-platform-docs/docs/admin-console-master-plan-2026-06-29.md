# 리터스텔라 통합 관리자 콘솔 & 자동화 마스터 플랜
> 작성: 2026-06-29 (세션 — 운영·마케팅 최고책임자 관점 기획) · 작성자: Claude(통합 테크리드)
> 운영자 결정 반영: ① 플랜 확정 + **Phase A 즉시 착수** ② 에이전트 = **초안 제안형**(등록·발송·공개는 사람 최종 승인) ③ 5도메인 전부 + **마케팅에 알림톡·이메일 마케팅 채널 검토 포함**

---

## 0. Context — 왜 지금 이 작업인가

현재 관리자 기능은 챌린지앱 `AdminPanel.jsx` **단일 파일 1137줄**에 9개 탭이 몰려 있고, 백엔드는 진단 Worker의 `/api/admin/*`(service_role)로 PII를 안전하게 우회 조회한다. 동작은 하지만:

- **확장 한계:** 단일 파일이라 회원/운영/콘텐츠/마케팅/AI 기능을 더 얹으면 유지보수 붕괴. UX 감사 48건이 보여준 것처럼 "한 파일에 다 넣기"는 누락·회귀의 근원.
- **반응형 약점:** 인라인 `isMobile` 삼항으로만 분기, 테이블 `minWidth:640px` 가로스크롤, 태블릿(768~1024) 전용 처리 없음.
- **수작업 병목:** 원서 등록·문의 답변·점검이 전부 손. "에이전트가 거들고, 매일 자정 자동 점검"이라는 운영자 비전과 거리.
- **자동화 0:** `scheduled()` 핸들러·cron이 전혀 없음. pg_cron 의존 휴지통 정리는 주석으로만 존재.

**목표:** 빅뱅 재작성 없이 → ① 종합 대시보드 + 5도메인 구조로 점진 재편 ② 자정 자동 점검 cron 도입 ③ 에이전트(초안 제안형)로 운영 부담 경감. 현재 규모(시범 12명→7/1 50~100명)에 과하지 않게, 미래 확장은 *설계만* 박제하고 트리거 도달 시 얹는다.

> ⚠️ 불변 원칙(과개발 방지, [[community-roadmap]]): 밀도(인원) 트리거 전엔 밀도 기능 안 만든다. **단, 운영 인프라(관리자·자동화)는 인원 무관하게 필요** — 이건 지금 깐다.

---

## 1. 현재 상태 감사 (검증 완료)

### 1-A. 관리자 UI (챌린지 `src/components/AdminPanel.jsx`, 1137줄)
9탭: `신청자(enrollments)` · `신고·문의(reports)` · `만족도(satisfaction)` · `공지(announce)` · `진단명단(diagleads)` · `원서신청(bookreqs)` · `사용자통계(userstats)` · `진단모니터링(diagmetrics)` · `신호감사(coverage)`.
- 게이트: 헤더 기어 아이콘 → `sessionEmail === 'literbryanbae@gmail.com'`(클라이언트), 모달 오버레이(min/max/close), `App.jsx:2114` `adminOpen`.
- 반응형: 인라인 `isMobile`(≤640px), 모달 풀스크린, 좌측 nav(210px/모바일 드로어). 약점 = enrollments 테이블 `minWidth:640`(가로스크롤), 공지 폼 2단 grid 무브레이크포인트, 일부 내부 테이블 overflow 래퍼 없음, 태블릿 전용 없음.

### 1-B. 백엔드 (진단 Worker `01-reading-diagnosis/.../public/_worker.js`, ~3400줄)
- service_role `/api/admin/*`: metrics·user-stats·coverage·enrollments·diagleads·reports·report-status. 게이트 `adminGate`/`ADMIN_EMAILS`(2026-06-25 세션토큰 완화 — 이메일만 검사, **약함**).
- AI 비용 로깅 `logAiRun` → `ai_report_runs`(+`ai_model_pricing` 단가표), graceful slim-fallback.
- 이메일: `sendUserEmail`(Resend), 운영자 알림 `MAIL_TO`/`MAIL_FROM`. OTP·비번재설정·notify-* 다수.
- 원서 텍스트: 구텐베르크 프록시 `/api/book-text`(`GUTENBERG_ALLOW` ~45권 하드코딩 화이트리스트).
- **cron/scheduled: 전혀 없음.** (`05-secure-api`에 결제 빌링용 cron 주석만.)

### 1-C. 콘텐츠/문의 데이터 흐름
- **원서 등록:** 신청(`book_requests`) → AdminPanel 검토·등록 → **이미 런타임 DB 머지 존재**(challenge `registeredBooks.js`·diagnosis `app.js loadRegisteredBooks`). 즉 `status='added'`면 양 앱이 무배포 노출. 병목은 *발행*이 아니라 *메타 입력*(ko/AR/Lexile/pages/goalDays/blurb 손입력).
- **리더:** 45권 `bookText.js READER_BOOKS` + 워커 화이트리스트 둘 다 하드코딩 → 추가 = JS 2곳 편집 + 재배포.
- **문의:** `bug_reports` → notify-bug(Resend) → 운영자 메일 → admin_note 답변 → NotificationBell.
- **공지:** `announcements` 테이블 + audience 타깃팅(banner/bell/feed).

---

## 2. 타깃 아키텍처 — 통합 관리자 콘솔

### 2-A. 정보구조 (9탭 → 종합대시보드 + 5도메인)
2단 네비게이션: **도메인(L1) → 하위뷰(L2)**. ✅=기존 탭 이전, ⬜=미래(설계만, 지금 안 만듦).

| L1 도메인 | L2 하위뷰 (현재) | 미래(트리거 도달 시) |
|---|---|---|
| **🏠 종합 대시보드** | KPI 요약(총회원·오늘신규·DAU·입금대기·미처리문의·미검토원서·활성공지) — 각 카드 → 도메인 딥링크. **다른 도메인이 이미 계산한 수치만 모음**(새 집계 파이프 X) | 트렌드 스파크라인, 알림 피드 |
| **👥 회원관리** | ✅신청자 · ✅진단명단 · ✅사용자통계 | ⬜회원 360°상세 · ⬜세그먼트 · ⬜수동 포인트지급 · ⬜리텐션/코호트 |
| **🛠 운영관리** | ✅신고·문의 · ✅만족도 | ⬜환불·결제처리 · ⬜휴식권/제재 · ⬜CS 매크로 · ⬜SLA 보드 |
| **📚 콘텐츠관리** | ✅원서신청(+휴지통) | ⬜카탈로그 직접편집 · ⬜리더 책 등록 · ⬜배지/시즌 설정 · ⬜후기 모더레이션 |
| **📢 마케팅관리** | ✅공지(banner/bell/feed·쿠폰·audience) | ⬜캠페인/쿠폰 성과 · ⬜이메일/알림톡 발송(§5) · ⬜진단→챌린지 퍼널 CTA |
| **🤖 AI관리** | ✅진단모니터링(퍼널·세그먼트·라우팅·AI비용) · ✅신호감사 | ⬜프롬프트/단가표 관리 · ⬜텔라 봇 품질로그 · ⬜AI 예산알림 |

> 메모: `diagmetrics`는 *퍼널(마케팅 렌즈)* + *AI비용(AI 렌즈)*이 한 워커 응답에 섞여 있음. **지금은 통째로 AI관리**에 두고, 마케팅 도메인이 자라면 퍼널/라우팅만 마케팅으로 분리(의도적 분리로 기록).

### 2-B. 컴포넌트 리팩터 — 점진(빅뱅 금지)
목표 구조 `02-challenge/.../src/components/admin/`:
```
admin/
  AdminShell.jsx       # 창 크롬(오버레이·min/max·L1/L2 nav·새로고침). 도메인 무관.
  adminNav.js          # nav 설정 [{domain,label,icon,subviews:[{id,label,badgeKey}]}]
  domains/  OverviewDomain.jsx · MemberDomain · OperationsDomain · ContentDomain · MarketingDomain · AiDomain
  widgets/  StatGrid · DataTable · StatusFlowButton · SectionBlock · PeriodTabs · GateMessage
```
**무중단 단계(각 단계 그대로 동작):**
- **A. 리프 위젯 추출**(동작 무변경): 중복된 StatGrid·게이트에러패널·기간칩·막대 헬퍼를 `widgets/`로. ~150~200줄 감소.
- **B. 도메인 1개 템플릿화 = OperationsDomain**(reports+satisfaction): 읽기·쓰기 모두 이미 워커 경유라 위험 최저. `{data,onRefresh}` prop 계약 증명.
- **C. AdminShell + adminNav 도입 → 2단 nav 전환.** AdminPanel은 얇은 래퍼. 종합대시보드는 스텁 카드그리드.
- **D. 나머지 도메인 1 PR씩 이전**(회원·콘텐츠·마케팅·AI), 각자 같은 prop 계약. 모놀리스 사망 코드 삭제.
- **E. 지연 로딩**: 단일 `Promise.all loadData` → 도메인 열 때만 로드 + 캐시. 마지막에(데이터 타이밍 변경되는 유일 단계).
- 전 과정 준수: Zero-Error 옵셔널체이닝, `--ls-*` 토큰, `ui-lint`(입력≥16px·100vh금지·금지어), `App.jsx`의 `useBackClose` 배선 보존(이중 push 금지).

### 2-C. 반응형 정비
- **`DataTable` 위젯**(핵심): props `columns/rows/rowKey/cardTitle/cardMeta/actions/empty`.
  - 데스크톱(≥1024): `<table>` + `overflow-x:auto` 래퍼(모든 테이블에 기본 제공 → minWidth 가로스크롤 문제 종결).
  - 모바일(≤767): **카드 리스트**(행→스택 카드, 가로스크롤 0, 320px DoD 충족).
  - 태블릿(768~1023): 우선순위 ①모바일 ②PC ③태블릿 원칙대로 **데스크톱 테이블 재사용** + `priority` 낮은 컬럼 숨김 + 터치타깃 ≥48px. 전용 레이아웃 없음(과개발 회피).
- 인라인 삼항 은퇴 → admin 스코프 `<style>`의 3밴드 미디어쿼리 + 기존 `src/lib/useIsMobile.js`(matchMedia) **단일 브레이크포인트(768) 통일**(현재 640/768 혼재 정리).

### 2-D. 인증·보안 하드닝
현재 약점: `adminGate`가 쿼리파라미터 `email`만 검사(세션토큰 완화됨) + 4개 쓰기(`confirmPayment`/`deleteEnrollment`/공지/원서신청)가 anon Supabase 직격.
- **① `adminGate`에 운영자 세션토큰 복귀**: `Authorization: Bearer <supabase access_token>` 서버검증 + `verified_email === query_email ∈ ADMIN_EMAILS`. 쿼리 email은 교차검증으로 강등. → "운영자 이메일 문자열만 알면 통과" 구멍 차단. **콘솔 출시 블로커**(백로그 아님).
- **② 4개 anon 쓰기를 service_role 워커로 이전**(`report-status`와 동형): `/api/admin/enrollment-status`·`/enrollment-delete`·`/announcement`(+active)·`/book-request`(status/register/purge). 시그니처·반환 유지(드롭인).
- **③ RLS 재잠금**: 쓰기가 전부 워커 경유면 anon write 정책 잠가도 앱 정상 → [[security-audit-2026-06-18]] H2 묶음과 함께 출시 직전 적용(critical 프로토콜·dev/prod 공용DB 주의).
- 멀티관리자: `adminEmails`가 이미 콤마/공백 분리 → env 변경만으로 운영자 추가.

---

## 3. 자동화 인프라 — 자정 점검 cron

### 3-A. 위치·설정
**진단 Worker에 `scheduled()` 추가**(별도 워커 X — 시크릿·헬퍼 중복 무의미). Cloudflare cron은 **UTC 전용** → **KST 자정 = UTC 15:00 = `"0 15 * * *"`**(KST는 DST 없음).
```jsonc
// wrangler.jsonc
"triggers": { "crons": ["0 15 * * *"] }
```
```js
export default {
  async fetch(request, env) { /* 기존 */ },
  async scheduled(event, env, ctx) { ctx.waitUntil(runDailyMaintenance(env).catch(()=>{})); },
};
```

### 3-B. 자정 점검이 실제로 하는 일 (LLM·과금 0, 신규 스키마 불요 — Phase A)
각 단계 독립 try/catch(하나 실패가 전체 중단 X), 전부 graceful:
1. **원서 휴지통 정리** — `DELETE book_requests WHERE status='deleted' AND deleted_at < now()-30d`(pg_cron 의존 제거).
2. **운영 펄스** — 미검토 원서 · 미처리 문의 · 신규가입(24h) · 입금대기 카운트(HEAD count, 본문 미수신).
3. **AI 비용 24h 롤업** — `ai_report_runs` 집계(호출·실패율·토큰·종류별). 신규 스키마 없이 메일에 포함.
4. **헬스** — Supabase 도달성 · Resend 키 · `read` `/api/health` 핑.
5. **이상 감지 → 운영자 디제스트 메일**(운영자→운영자, 계약상 허용 발송). 기본=매일 1통(점검 작동 확인), `MAINT_ALERT_ONLY=true` 설정 시 이상 있을 때만.

> 자정 점검은 **운영 펄스를 매일 메일로** 보내므로, 종합 대시보드 UI가 나오기 전에도 "어제 무슨 일이 있었나"를 매일 받아본다.

---

## 4. 에이전트 (초안 제안형 — 운영자 최종 승인)

### 4-A. 원서 등록 에이전트 (Phase B)
발행 병목은 *이미 해소*(런타임 DB 머지). 에이전트는 *메타 입력*을 메움.
- 흐름: AdminPanel 'pending 원서' → "메타 조사" → `POST /api/agent/book-research`(adminGate) → Claude(haiku 시작, 약하면 sonnet) + `json_schema`(카탈로그 스키마 강제) → `regForm` 자동채움 → **운영자 검토·수정·승인 클릭**(기존 경로). `logAiRun(kind:'book_research')`.
- `goalDays = ceil(pages/3)`는 결정론적 계산(모델 추측 금지). AR/Lexile은 "참고 추정치" 명시.
- 🔴 **절대 안전선**: 모델은 **책 본문을 절대 타이핑하지 않음**(스키마에 본문 필드 없음). 본문은 구텐베르크 프록시 전용. ([[reader-vocab-system]])

### 4-B. 텔라 리더 등록 에이전트 (Phase B)
- **화이트리스트를 DB화**(`reader_books` 테이블): 워커 `bookTextResponse` 게이트를 in-memory `GUTENBERG_ALLOW` → service_role 조회(엣지캐시)로, 프론트 `READER_BOOKS`는 런타임 fetch(하드45 폴백). **추가 = 무배포.**
- `POST /api/agent/reader-validate`(adminGate): ①구텐베르크 존재 확인(START/END 마커) ②`parseBook` 챕터화 검증(빈 책 방지) ③메타 추출(제목/저자 결정론적, ko/level만 LLM 선택) → 운영자 확인 → INSERT `status='active'`. **검증은 순수 코드(고가치), LLM 최소.**

### 4-C. 문의 자동 유지보수 (Phase C)
- **자동 분류**: insert 경로(`notify-inquiry` 웹훅)에 haiku 분류 → type 교정·`priority`(긴급키워드: 환불/결제/로그인안됨)·`triage_summary`. 신규 컬럼(additive). `logAiRun(kind:'inquiry_triage')`.
- **답변 초안**: `suggested_reply` 컬럼에 제안(❗`admin_note`=사용자노출 필드엔 자동입력 금지). AdminPanel "이 답변 사용" → 운영자 편집 → 발송. **발송은 사람**(계약: 이메일/공개).
- **에스컬레이션/SLA**: urgent 즉시 알림 + 매시간 cron(`0 * * * *`)이 24h+ 미답변 디제스트(운영자→운영자, 자동 OK). FAQ(CLAUDE.md)로 답변 시스템프롬프트 시드(용어 성공/완독, '완주' 금지).

### 4-D. 비용·안전 가드레일
- 단일 로깅 스파인 `logAiRun`(kind별). 토큰 예산 캡(일일 누계 초과 시 LLM 스킵→수동 폴백), `max_tokens` 하드실링, 멱등(`triaged_at IS NULL`).
- 모델 티어: 기본 haiku, 품질 필요시만 sonnet. 개인화 호출 `cf-aig-skip-cache:true`.
- **사람 승인 고정(운영계약)**: 돈/가격/환불/기부 · **사용자향 발송**(답변메일·종알림·공개게시) · **사용자 데이터 삭제**(cron은 *이미 소프트삭제된* 휴지통만, 무결성 이슈는 *보고만*) · 스키마/RLS/시크릿/인증(critical=알리고 진행). 자동 발송 허용 = 운영자→운영자 점검/SLA 디제스트뿐.

---

## 5. 마케팅 채널 검토 — 알림톡 · 이메일 마케팅 (운영자 요청)

> 필요성·타이밍 진단. 둘 다 **돈·외부연동·법적 동의**가 걸려 운영계약상 "운영자에게 가져옴" 영역. 여기선 *권고와 순서*만.

### 5-A. 이메일 마케팅
- **이미 보유**: Resend + 도메인 인증(literstella.co.kr). 트랜잭션 메일(OTP·가입·문의알림) 가동 중.
- **마케팅 메일(뉴스레터·재참여)** 추가에 필요: ① **마케팅 수신 동의**(가입폼 opt-in, 정보통신망법) ② **수신거부 링크 필수** ③ 발신평판 관리(점진 발송). 비용은 낮음(Resend 무료/저가 티어).
- **필요성: 中** — 뉴스레터는 플라이휠 '무료 콘텐츠 허브'·수익화 쿠션([[monetization-routing]])의 일부. **타이밍: 7월 이후**(런칭 안정화 후), 마케팅 도메인 빌드 때 동의/수신거부 토대부터.

### 5-B. 카카오톡 알림톡/친구톡
- **알림톡(정보성/거래성)**: 한국 지배적 채널, 오픈율 高. 필요 = 카카오 비즈니스 채널(이미 보유 `pf.kakao.com`) + **발신프로필** + **템플릿 사전심사**(1~2주 리드) + **발송 대행사**(솔라피/알리고/NHN Toast 등) 계약. 건당 ~6.5~9원. 정보성만 허용(영수증·도전시작·마일스톤·결제알림).
- **친구톡(마케팅성)**: 채널 친구 대상만, 야간발송 제한. 현재 채널추가 +100P로 친구 적립 중([[kakao-channel-reward]]).
- **필요성**: 결제 도입 시 거래알림으로 **高**(결제 영수증·정기결제 안내). 마케팅 친구톡은 친구수 쌓인 뒤 中.
- **타이밍: 8월 결제 도입과 동반**([[payment-portone-sequencing]]). 템플릿 심사 리드타임 고려해 결제 전 ~2주 착수. **운영자 결정 필요**(대행사 선택=돈+계약+외부).

### 5-C. 권고 순서
1. (완료) Resend 트랜잭션. 2. (마케팅 도메인 빌드) 수신동의 필드 + 수신거부 토대. 3. (8월 결제와) 알림톡 거래알림(대행사·템플릿 심사). 4. (친구 충분 시) 친구톡 마케팅 + 뉴스레터 정기 발송.

---

## 6. 단계별 로드맵 & 과개발 가드

| Phase | 내용 | 리스크 | 시점 |
|---|---|---|---|
| **A (지금·이번 세션)** | 진단 Worker `scheduled()` + `"0 15 * * *"` + 자정 점검(휴지통정리·운영펄스·AI 24h롤업·헬스·디제스트메일) + 수동 트리거 `/api/admin/run-maintenance` | 최저(사용자 영향 0, 신규 스키마 0, 가역) | ✅ 착수 |
| **B (관리자 UI 리팩터)** | 위젯 추출 → Operations 도메인 → AdminShell 2단 nav → 나머지 도메인 이전 + DataTable 반응형 + adminGate 세션토큰 복귀 | 中(점진·무중단) | 런칭 안정화 후 |
| **C (쓰기 하드닝)** | 4개 anon 쓰기 → 워커 + RLS 재잠금(보안 묶음) | 中(critical·dev/prod 주의) | 출시 직전 보안 재적용과 함께 |
| **D (콘텐츠 에이전트)** | reader_books DB화 + reader-validate + book-research(메타 초안) | 中(LLM 소액·사람승인) | 원서 등록 빈도가 손입력 고통될 때 |
| **E (문의 에이전트)** | triage 분류 + suggested_reply + SLA 매시간 cron | 中 | 문의량이 메일 일독으로 버거울 때 |
| **F (마케팅 채널)** | 수신동의/수신거부 → 알림톡(결제) → 친구톡/뉴스레터 | 高(돈·외부·법적) | 7월~8월, 운영자 결정 |

**지금 안 만드는 것(설계만)**: 회원360°·수동포인트·환불처리·카탈로그직접편집·배지/시즌설정·캠페인성과·프롬프트관리·예산알림·전용 태블릿레이아웃·별도 유지보수워커·DO/Queues/Workflows/Agents SDK·KV rate-limiter. nav config에 미래로 표시만.

---

## 7. 운영자 액션 (Phase A)
- 🔴 **진단앱 1회 배포**: `cd 01-reading-diagnosis/literstella-reading-diagnosis && npx wrangler deploy` → cron 등록 + scheduled 활성. (`ADMIN_EMAILS`·`RESEND_API_KEY`·`MAIL_TO`는 이미 설정됨.)
- (선택) `MAINT_ALERT_ONLY=true` 시크릿 설정 시 이상 있을 때만 메일(기본=매일 1통).
- 배포 후 검증: 관리자 로그인 → `/api/admin/run-maintenance?email=...` 수동 호출(또는 대시보드 cron 트리거)로 점검 메일 1통 즉시 확인.

## 8. 검증
- `node --check public/_worker.js`(문법) + `npm run build`(빌드).
- 수동 트리거 엔드포인트로 점검 1회 실행 → 운영자 메일함에 "🌙 자정 점검" 도착 + 본문 정상(휴지통·펄스·AI·헬스).
- Cloudflare 대시보드 Cron Triggers에 `0 15 * * *` 등록 확인.

---
관련 메모리: [[admin-monitoring-plan]] [[community-roadmap]] [[book-requests-migration]] [[security-audit-2026-06-18]] [[reader-vocab-system]] [[monetization-routing]] [[payment-portone-sequencing]] [[kakao-channel-reward]] [[email-system]]
