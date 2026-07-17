> ⚠️ **2026-06-18 세션 32-H 배포 직후 상태 반영 (이 4건은 위 본문보다 우선):**
> 1. **spendPoints 멱등화 완료** — 이제 upsert(onConflict) 사용. §2의 spendPoints 항목은 '회귀 검증'으로 수행(2회 호출 시 1회만 차감이어야 정상).
> 2. **신규: 포인트 결제 테스트 카드(PaymentTestCard)** — 연습 모드(PRACTICE_MODE)에서 인증 **완료 화면**에 노출. `CheckinSection.jsx` PaymentTestCard. '🧪 포인트로 결제 테스트(100P 사용)' 버튼 → `spendPoints(reason:'spend_extension', refId:'test_spend:<season>:<today>')`. 검증: (a)잔액≥100이면 차감 성공 메시지+잔액 감소, (b)잔액<100이면 '포인트가 부족합니다' 가드, (c)같은 날 재클릭 시 중복 차감 없음(멱등), (d)`PRACTICE_MODE=false`(시즌 모드)면 카드 **안 보임**, (e)'실제 돈 청구 안 됨'·'7/1 복원' 안내 문구 노출. **실과금 아님(포인트만 차감, 카드결제 아님).**
> 3. **'포인트로 결제' 경로 = PaymentTestCard가 유일** (연장 게이트 §10의 포인트 결제는 여전히 미배선 — 8/1 작업). §10·§11 '포인트 결제 미배선'은 PaymentTestCard 기준으로 갱신해 읽을 것.
> 4. **6월 참가비 안내 숨김** 배포됨 — §6 연습 모드 항목대로 4일차 참가비/계좌 안내가 안 떠야 정상.
>
> **★ 실 포트원 카드결제는 여전히 미배선·플래그 OFF — 절대 트리거 금지(§11 그대로).**

# [버그 테스트 지시문] LiterStella 야나완 챌린지 — 회귀/시나리오 테스트 (2026-06-18)

당신은 LiterStella 야나완 챌린지 앱의 **기능 회귀·시나리오 테스트**를 수행하는 세션입니다. 아래 체크리스트를 그대로 실행하고, 발견한 문제를 정해진 형식으로 보고하세요. **이 프롬프트만으로 완결**되도록 작성했습니다 — 별도 컨텍스트 없이 바로 시작하세요.

## 0. 범위·전제 (반드시 먼저 읽기)
- **대상 앱:** `E:/LiterStella Project/LiterStella-DEV/02-challenge/literstella-challenge` (React + Vite). 결제 백엔드 Worker: `E:/LiterStella Project/LiterStella-DEV/05-secure-api`.
- **로컬 실행:** 챌린지앱 = 포트 5173 (`.claude/launch.json` 참고). `npm run dev`로 띄우고 브라우저 `http://localhost:5173`.
- **DB:** Supabase (anon 키). 활성 시즌 = `yanawan-2606` (=BETA, 연습 모드). 1P = 10원.
- **★ 이 세션이 다루지 않는 것 (다른 세션 담당, 절대 손대지 말 것):**
  - **보안/개인정보 감사** (RLS, 시크릿, 빌링키 소유 검증, OTP, 권한) → 별도 세션.
  - **실제 포트원 결제 SDK 라이브 호출 / 실과금** → **절대 트리거 금지.** 아래 11절은 "현재 코드 상태 확인"까지만, 실 카드 결제는 하지 않는다.
- **이 세션이 다루는 것:** 기능 동작·회귀, 데이터 무결성(포인트 누적=잔액·중복적립·휴식·dedup·날짜엔진), 연습/시즌 모드 분기, MyHistory 탭, 다이어리, 연장 게이트, UI 깨짐, 콘솔 에러.

## 1. 검증 환경 셋업 — DevPanel/콘솔 헬퍼
개발 빌드에서만 노출되는 시드 도구로 자가검증한다 (`import.meta.env.DEV` 게이트, `src/App.jsx:1140-1147`).

브라우저 콘솔에서 사용 가능한 헬퍼:
```js
// 시드: mode='challenge'(야나완) | 'diary', count=인증일수, opts={...}
await window.__devSeed('challenge', 10)          // 10일 인증된 기본 테스트 계정(devtest@literstella.test)
await window.__devSeed('challenge', 30)          // 30일 → 연장 게이트(66일) 트리거 확인용
await window.__devSeed('challenge', 66)          // 66일 → 연장 게이트(100일) 트리거 확인용
await window.__devSeed('challenge', 100)         // 100일 + honor_win_bronze + finish_HP001 완독 배지
await window.__devSeed('challenge', 0, {fresh:true})   // 완전 신규(가입 직전) 계정
await window.__devSeed('challenge', 5, {fresh:true, status:'pending'})  // 입금 대기 상태
await window.__devSeed('diary', 8)               // 다이어리 기록 8건
window.__devReset()                              // 세션·진단 localStorage 초기화
```
시드 후 **페이지 새로고침**해야 세션이 반영된다. 시드 코드 정본: `src/lib/devSeed.js`. DevDebugPanel 컴포넌트도 화면에 있으면 시나리오 버튼 사용 가능.

⚠️ 시드 한계(테스트 설계 시 인지):
- `devSeed`는 `check_ins.checked_in_at`을 `2026-06-01`부터 연속으로 채운다(휴식일 없음). **연속이 끊긴 케이스·휴식권 케이스는 수동으로 날짜를 비워 시드하거나 콘솔에서 직접 insert** 해야 한다.
- `devSeed`는 **`enrollments.start_date`를 설정하지 않는다.** 날짜 엔진(아래 5절) 카드가 `start_date` 폴백을 어떻게 처리하는지 별도 확인 필요.
- `devSeed`는 **`point_transactions`에 적립을 시드하지 않는다.** 포인트 무결성(2절)은 실제 인증·완독 흐름을 타거나 콘솔 insert로 검증.

## 2. 데이터 무결성 — 포인트 (최우선, 회귀 위험 높음)
정본 함수: `recordPointEarn`(`api.js:761`), `fetchPointBalance`(`api.js:775`), `fetchPointBreakdown`(`api.js:788`), `spendPoints`(`api.js:814`).

- [ ] **누적 적립 합 === 지갑 잔액:** 마이페이지 포인트 표시값과 `fetchPointBreakdown`의 `earned - spent`가 일치하는가. `fetchPointBalance`(전체 합)와 `fetchPointBreakdown`(reason별 합)이 같은 총합을 반환하는지 콘솔로 교차 확인.
- [ ] **중복 적립 차단(멱등):** `recordPointEarn`은 `onConflict: 'user_id,reason,ref_id'` + `ignoreDuplicates`. 같은 인증/완독을 두 번 트리거(예: 완독 체크 후 새로고침 재제출)해도 포인트가 **한 번만** 적립되는가. `recordBookFinishPoints`(`api.js:827`)의 `finish_<bookId>` + `first_book_finish` ref_id가 책당/계정당 1회만 적립되는지.
- [ ] **★ spendPoints 멱등성(세션32-H에서 수정됨 → 회귀 검증):** `spendPoints`(`api.js`)는 이제 `recordPointEarn`과 동일하게 **`upsert(onConflict:'user_id,reason,ref_id', ignoreDuplicates)`** + 차감 후 잔액 재조회. 같은 refId로 2회 호출해도 **한 번만** 차감돼야 정상. 콘솔에서 `await spendPoints({userId, amount:300, reason:'spend_extension', refId:'test1'})`를 2회 호출 → 잔액이 **300만** 줄면 OK, 600 줄면 **회귀 버그 보고**. ⚠️ refId가 null/빈값이면 멱등 안 됨(NULL은 unique에서 distinct) — refId 항상 전달되는지도 확인.
- [ ] **포인트 캡(±3000):** 운영자가 economy-prereqs.sql로 amount CHECK를 ±3000으로 상향. honor_win 골드(3000P) 적립이 DB에서 거부되지 않는지. 거부되면 `recordPointEarn`이 콘솔에 `[recordPointEarn] 적립 실패(비차단)` 경고를 남긴다(`api.js:771`) — **콘솔에 이 경고가 뜨면 캡 마이그레이션 미실행 의심**으로 보고.
- [ ] **reason 화이트리스트:** 화이트리스트(welcome/profile/fidelity/record_bonus/diary/cheer/adjust/badge/profile 등) 외 reason으로 적립 시 무음 실패(콘솔 경고)하는지. 특히 시범 +300P 지급에 쓰일 reason이 화이트리스트에 있는지 확인 (없으면 'grant'는 미등록 — open question으로 보고).
- [ ] **잔액 부족 가드:** `spendPoints`가 잔액 < 필요액일 때 차감 없이 `error: '포인트가 부족합니다'` 반환하는가. 잔액 null(테이블 미생성/0건)일 때 `'포인트 조회에 실패했습니다'` 반환하는가.

## 3. 데이터 무결성 — 연속/휴식/완독 (순수 함수 + UI)
정본: `stats.js`(`computeCurrentStreak`/`computeLongestStreak`/`computePoints`/`computePointBreakdown`).
- [ ] **순수함수 테스트 통과:** `node scripts/stats-test.mjs` 실행 → 전부 PASS인지(문서상 79/79 또는 59/59). 실패 항목 보고.
- [ ] **연속 인증 유예:** 오늘 미인증이어도 어제까지 이어졌으면 streak 인정(`computeCurrentStreak`). 어제도 없으면 0.
- [ ] **completedBookIds 합산:** `computePoints`와 `computePointBreakdown`이 **같은 입력 → 같은 총합**을 반환하는지(불일치 시 보고).
- [ ] **휴식권:** 휴식일(인증 없는 과거 날짜)이 MyHistory 히트맵·달력에 회색으로 표시되고, 휴식 카운트가 과대/과소 집계되지 않는지.
- [ ] **완독 합산(다이어리 포함):** `CheckinSection.bookProgressDays`(`CheckinSection.jsx:124`)가 챌린지 인증 + 다이어리 기록의 '읽은 날짜'를 합산하되 같은 날 중복은 1일로 세는지.

## 4. 데이터 무결성 — 인증 중복/dedup
- [ ] **하루 1회 인증 가드:** 야나완 인증은 하루 1회(`completedToday`, `CheckinSection.jsx:184`). 같은 날 재제출 시 새 행이 아니라 수정 모드(자정까지)로 가는지.
- [ ] **다이어리는 무제한:** 다이어리(is_yanawan=false)는 하루 여러 번 가능. 다이어리만 쓴 날 야나완 인증 폼이 '완료'로 잘못 잠기지 않는지(`yanawanLogs` 필터, `CheckinSection.jsx:120`).
- [ ] **재시딩 멱등:** `__devSeed` 두 번 호출 시 check_ins가 중복 누적되지 않는지(devSeed가 기존 시드 delete 후 insert, `devSeed.js:133`).

## 5. 도전 날짜 엔진 (이번 변경 — 배선 상태 정직하게 확인)
**현 상태(코드 확인됨):** 순수함수(`challengeDeadline`/`challengeStatus`/`startEligibility`, `stats.js:80-162`)는 완성·테스트 통과. `submitEnrollment`(`api.js:297-318`)는 가입 시 `start_date`를 **비차단 별도 update**로 쓴다(컬럼 부재 시 무음 무시). 연습 모드(BETA)는 가입 즉시 시작, 정식은 `startEligibility`(30·66=매월1일/100=시즌창)로 시작일 결정.
- [ ] **신규 가입(연습 모드):** `__devSeed('challenge',0,{fresh:true})` 후 가입 → `enrollments.start_date`가 **오늘**로 들어가는지(연습 모드는 매월1일 게이트 우회). Supabase에서 행 확인 또는 콘솔 `getMyEnrollment`.
- [ ] **start_date 폴백:** devSeed 계정(start_date 없음)에서 도전 현황 카드/TrackerPreview가 깨지지 않고 '최초 인증일/시즌 시작'으로 폴백하는지(`App.jsx:1114` 주석 참고). **null·undefined로 NaN/Invalid Date가 화면에 노출되면 보고.**
- [ ] **마감일·진행률 표시:** 30일(휴식3)·66일·100일 도전에서 `challengeDeadline`·`daysLeft`·`progressPct`가 카드에 올바로 표시되는지. 단, 이 엔진의 **UI 배선 자체가 미완일 수 있음**(Phase1 잔여) — 카드가 아예 없거나 엔진을 안 쓰면 'open question(배선 미완)'으로 보고.
- [ ] **upcoming/failed 상태:** 정식 시즌 시뮬레이션(6절)에서 시작 전(upcoming)·휴식 초과(failed) 분기가 의도대로 나오는지.

## 6. 연습 모드 ↔ 시즌(정식) 모드 전환 테스트
**현 상태:** `PRACTICE_MODE = BETA_SEASONS.includes(ACTIVE_SEASON)` (`api.js:609`), `BETA_SEASONS=['yanawan-2606']`, `ACTIVE_SEASON='yanawan-2606'` → 현재 true. 시즌 모드 테스트는 **코드값을 임시 변경**해야 한다(되돌리기 전제).
- [ ] **연습 모드(현재):** 4일차(yanawanCount≥3) 인증 시 참가비(농협 계좌) 안내가 **숨겨지는지**(`CheckinSection.jsx:435`, `!PRACTICE_MODE` 가드). TrackerPreview가 '6월 연습 모드 무료'를 보여주는지.
- [ ] **시즌 모드 시뮬레이션:** 로컬에서 `api.js:10`의 `ACTIVE_SEASON`을 BETA가 아닌 값(예: `'yanawan-2607'`)으로 임시 변경 → `PRACTICE_MODE=false`가 되어:
  - 4일차 인증 시 참가비 안내가 **노출**되는지.
  - 포인트 적립이 정식 랭킹(`fetchPointLeaderboard`)에 **포함**되는지(BETA 제외 필터, `api.js:561`).
  - 명예의 전당(`fetchHonor`, `api.js:615`)에 집계되는지.
  - **⚠️ 테스트 후 반드시 `ACTIVE_SEASON`을 `'yanawan-2606'`로 되돌리고 커밋 금지.**
- [ ] **시범 포인트 격리:** BETA 시즌 적립은 **지갑(`fetchPointBalance`)엔 남고 정식 랭킹엔 0**인지(`api.js:559-561`). 마이페이지 잔액은 보이는데 랭킹 보드(PointRankingBoard)엔 안 뜨는지 교차 확인.

## 7. A5 누적포인트 랭킹 (PointRankingBoard)
- [ ] period(week/month/year/season) 전환 시 `rankingSince`(`api.js:542`) 기준이 맞는지.
- [ ] `rank_public === false` 사용자는 랭킹에서 제외되는지(`api.js:577`).
- [ ] goalTier 필터(30/66/100/all)가 enrollment.goal_days 기준으로 동작하는지.
- [ ] 적립(amount>0)만 합산하고 사용(음수) 차감은 제외되는지(`api.js:561`) — 즉 랭킹=누적 적립, 지갑=잔액 분리.
- [ ] 동점/0명/메달(1·2·3위) 렌더 깨짐 없는지.

## 8. MyHistory 탭 (이번 변경 — 다른 세션과 파일 겹침 주의)
**현 상태:** 세션 32-D에서 `MyHistory.jsx` 변경이 origin/main에 머지됨('챌린지 인증'→'나의 완독 서재' 리네임, 다이어리 탭 월달력 제거(상단 히트맵 중복), 획득배지 전체 카탈로그 토글). **이 변경은 의도된 것이니 되돌리지 말 것.**
- [ ] 3탭(진단 결과 / 나의 완독 서재 / 마이 다이어리) 전환 정상.
- [ ] 상단 365일 히트맵 + (다이어리 탭에 월달력 **없음**이 정상) 중복 없는지.
- [ ] `__devSeed('challenge',100)` 계정에서 완독 서재(BookSlot)·획득 배지 카탈로그 토글·honor_win 배지 표시.
- [ ] 진단 결과 탭 로딩 플리커(문서상 L10 알려진 이슈) — 재현되면 보고.
- [ ] 빈 상태/에러 상태(데이터 없는 신규 계정)에서 무한 로딩·크래시 없는지.

## 9. 독서 다이어리 (이번 변경)
- [ ] 다이어리 작성·저장·목록 표시(`ReadingDiarySection.jsx`).
- [ ] 입력창 폰트 ≥16px인지(문서상 M10: 14→16px iOS 줌 이슈 — 미수정이면 보고).
- [ ] 다이어리 저장 후 '챌린지로도 인증하기' CTA → `sessionStorage('checkin_prefill')` → CheckinSection 자동채움(`CheckinSection.jsx:171`)이 책·문장을 넘기는지.
- [ ] 다이어리 기록이 완독 진행 합산에 반영되는지(3절 마지막 항목과 연계).

## 10. 도전 연장 게이트 (포인트 결제 동작 확인)
**현 상태(코드 확인됨):** `ExtensionGate`(`CheckinSection.jsx:74`)는 30일성공→66일, 66일성공→100일 버튼 노출. `BILLING_ENABLED=false`(`pricing.js:7`)이므로 **가격 비노출 + '시범 기간 무료' 메시지**만. 버튼 클릭 → `onExtendGoal`(`App.jsx:1056`) → `updateEnrollmentGoalDays`만 호출(`api.js:873`). **포인트 차감(`spendPoints`) 호출 경로는 코드에 없음** — 즉 "포인트로 연장 결제" UI/배선은 미구현.
- [ ] `__devSeed('challenge',30)` → 인증 화면에 '30일 성공' 연장 게이트(66일) 뜨는지. `count:66` → 100일 게이트.
- [ ] 연장 버튼 클릭 → goal_days가 66/100으로 **업그레이드만** 되는지(`updateEnrollmentGoalDays`는 `.lt(current,next)`로 다운그레이드·중복 차단, `api.js:878`). 100→66 시도나 중복 클릭이 거부되는지.
- [ ] **★ 포인트 결제 경로 부재 확인:** 연장 시 포인트가 차감되는지 콘솔 잔액으로 확인. **차감 안 됨이 현재 정상**(BILLING_ENABLED=false). 만약 포인트 결제 UI를 새로 붙였다면(이 세션 범위 밖) `spendPoints` + `updateEnrollmentGoalDays` 순서·멱등 검증. UI가 없으면 'open question: 포인트 연장 결제 미배선'으로 보고.
- [ ] `goalDaysLoaded=false`(DB 복원 전)에 게이트가 잘못 깜빡이지 않는지(`CheckinSection.jsx:77` 레이스 가드).

## 11. 결제 모듈 동작 확인 (★ 실과금 절대 금지 — 코드 상태 확인까지만)
**현 상태(코드 확인됨, 추측 아님):**
- `PaymentSubscribe.jsx` 파일은 존재하나 **앱 어디에도 import 안 됨**(grep 결과 자기 정의 1건뿐) → **결제 진입점(카드 등록 CTA)이 화면에 없음.**
- Worker `/api/payment/*`는 `PAYMENT_ENABLED !== "true"`면 **404**(`05-secure-api/src/index.js:356`). 기본 플래그 false.
- Worker는 `YANAWAN_PRICE_KRW=3000` 하드코딩(`index.js:138`), **포인트 기반 결제 엔드포인트 없음.**
- 입금확인은 AdminPanel `confirmPayment`(`AdminPanel.jsx:81`)가 `enrollments.status`를 pending↔active 토글만 — **`paid_at`/감사 필드 기록 없음, +300P 지급 로직 없음.**

이 세션이 할 일(실 결제 호출 없이):
- [ ] `/api/health` 호출 → `{payment: false}` 인지 확인(플래그 OFF 정상). true면 **즉시 보고**(실과금 위험).
- [ ] PaymentSubscribe 미배선 사실 재확인(앱에서 카드 등록 버튼이 정말 없는지 화면에서 확인).
- [ ] AdminPanel 입금확인 토글이 status만 바꾸고 audit(paid_at)·포인트 지급을 **안 하는** 현 동작을 그대로 기록(회귀 아님, 현 상태 보고).
- [ ] **실 포트원 SDK 호출·테스트 카드 결제는 하지 않는다.** 결제 E2E는 운영자/별도 세션이 시크릿·DB·웹훅 준비 후 수행.

## 12. 전반 회귀 (UI·콘솔)
- [ ] 320px·380px·640px·데스크톱에서 가로 스크롤·레이아웃 깨짐 없는지(핵심 화면: 히어로·인증 폼·MyHistory·랭킹·연장 게이트).
- [ ] 라이트(기본)/다크 테마 토글 양쪽에서 대비·가독성·하드코딩 색 노출 없는지.
- [ ] 비로그인 → 로그인 → 가입 → 인증 → 완독 → 연장 전여정에서 콘솔 에러(Reference/Syntax/네트워크 미처리) 0건인지.
- [ ] 폴링(LiveBoard 등) try/catch·에러 UI(문서상 M9 알려진 이슈) — 폴링 실패 시 화면이 죽지 않는지.
- [ ] `npm run build` 통과 + `npm run preview`에서 DevPanel/콘솔 헬퍼가 **완전히 사라졌는지**(import.meta.env.DEV 트리쉐이킹 확인).

## 자가검증 명령 모음
```bash
cd "E:/LiterStella Project/LiterStella-DEV/02-challenge/literstella-challenge"
node scripts/stats-test.mjs            # 순수함수 회귀
node scripts/integration-test.mjs      # 백엔드 전여정(가능 시)
npm run build && npm run preview        # 빌드 + 프로덕션 미리보기(개발 UI 제거 확인)
```

## 발견 시 보고 형식 (항목마다)
```
[severity] blocker | high | medium | low
[area]     예: 포인트 무결성 / 날짜엔진 / 연장 게이트 / MyHistory / 결제 / 회귀-UI
[file:line] 예: src/lib/api.js:818
[증상]     무엇이 잘못됐나 (한 줄)
[재현]     1) __devSeed(...) 2) 새로고침 3) ...클릭 4) 관찰값 vs 기대값
[데이터근거] 콘솔/Supabase에서 본 실제 값 (예: 잔액 600 차감, 기대 300)
[비고]     회귀인지 / 미배선(open question)인지 / 다른 세션 범위인지
```
- **추측 금지:** 코드를 읽고 file:line 근거를 댄다. 확인 못 한 건 'open question'으로 분류.
- **우선순위:** 2절(포인트 무결성, 특히 spendPoints 멱등)·5절(날짜엔진 폴백)·6절(연습/시즌 분기)·11절(실과금 방지)을 먼저.
- **되돌리기:** 6절에서 ACTIVE_SEASON을 바꿨다면 반드시 원복. 테스트 중 만든 시드 계정은 운영자 정리용으로 이메일 목록만 남기고 직접 삭제하지 말 것(anon 키는 check_ins/bug_reports DELETE 불가).
