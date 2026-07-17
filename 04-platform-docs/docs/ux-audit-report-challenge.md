# UX 감사 리포트 — 챌린지앱 (challenge.literstella.co.kr)

> 기준: [`ux-audit-checklist.md`](./ux-audit-checklist.md) (DoD A~H). 감사일: 2026-06-18.
> 방법: 11그룹 다중 에이전트 감사 + blocker/high 적대 검증(12건 confirmed · 0 refuted). 근거=실제 `src/` 라인.
> **LIVE/LOCAL:** 감사 시점 `HEAD=eb158b5=origin/main`, 워킹트리 clean → **전부 커밋·push = LIVE**(Cloudflare 빌드 반영). 미배포(LOCAL) 0건. (도전 날짜 엔진도 이 시점 커밋 완료.)

**요약:** blocker 1 · high 8 · medium 12 · low 14 (총 35)

---

## 🔴 BLOCKER (1)

### B1. 신규 사용자가 비밀번호 없이 가입 완료 가능 → 이후 이메일 로그인 영구 불가 · `[LIVE]`
- 기준 A(필수값/비번) | 화면: `ApplicationSection` 6단 가입 Step1
- 근거: `validators.js:53` `if (app.password) { ... }` — 비번이 **truthy일 때만** 검증 → 빈 칸이면 Step1 통과. 라벨은 '비밀번호 설정 *'(필수 표시, `ApplicationSection.jsx:291`)이나 required 없음. 확인칸은 `application.password &&` 조건부 렌더(`:299`)라 빈 비번이면 안 뜸. `App.jsx:745`는 `password.length>=6`일 때만 `supabase.auth.signUp` 호출 → **빈 비번 가입자는 users 행만 생기고 Auth 자격증명 미생성** → 이메일 비번 로그인 영구 불가(LoginModal setpass 우회로만 가능, 발견 어려움).
- 수정: `validateBasicInfo`에서 비로그인 신규 가입은 비번 **무조건 필수**: 빈값→'비밀번호를 설정해주세요' / `<6`→'6자 이상' / `!== confirm`→'일치하지 않습니다'. 동시에 확인칸 렌더 조건에서 `application.password &&` 제거(항상 노출).

---

## HIGH (8)

### H1. 데모 STEP4 '성공 한 줄' textarea 폰트 14px → iOS 강제 줌인 · `[LIVE]`
- 기준 F(input≥16px) | `DemoExperienceFlow.jsx:123` fontSize:'14px'. 데모는 모바일 첫인상 핵심 동선인데 입력 순간 확대.
- 수정: 16px로 상향.

### H2. 데모 STEP7 대시보드에 '₩10,000 기부금' 원화 환산 노출 · `[LIVE]`
- 기준 H(적립화면 원화환산 금지 + 3,000원 기부 강조 금지) | `DemoExperienceFlow.jsx:184` 스탯 카드 `{ i:'💰', v:'₩10,000', l:'기부금' }`. 누적 포인트(P) 옆에 100일×3,000 환산을 전면화.
- 수정: 원화 대신 비금전 지표(예 '누적 인증 100일')로 교체 또는 카드 제거. **돈 표현=운영자 확인 영역.**

### H3. CertificationFeed marquee가 모바일에서 안 멈춤 → 응원·SNS 링크 탭 불가 · `[LIVE]`
- 기준 F | `CertificationFeed.jsx:191` hover(마우스)로만 정지, 터치 정지 없음. 대조군 `DeclarationFeed.jsx:31/109/114`는 `paused` state + `onPointerDown` 정지 + '다시 흐르기' 제공.
- 수정: DeclarationFeed와 동일 패턴(paused + onPointerDown + 토글) 적용.

### H4. FinalCTA에 '3천원 전액 기부' 고정 강조 — 기부 강조 금지 위반 · `[LIVE]`
- 기준 H | `FinalCTA.jsx:6` TRUST_ITEMS '3천원 전액 교육 소외 아동·청소년 기부' 랜딩 하단 상시. CLAUDE.md '3,000원 기부 강조 금지(시범 임시장치)'.
- 수정: 금액+'전액 기부' 강조 제거. 남길 경우 금액 없이 '참가비는 …에게 기부됩니다' 약화 또는 시범기간 항목 제거 — **운영자 확인.**

### H5. #guide 자기모순 — FAQ '7월 공개 예정' vs PointGuide 실제 가격 공개 · `[LIVE]`
- 기준 H(스테일) | `GuideSection.jsx:52`(a "공개될 예정")·`:53`(tag '7월 공개 예정') vs 같은 섹션 `<PointGuide/>`(`:281`)가 `PointGuide.jsx:222 formatPointPrice`로 '330P/최대 750P' 실가격 노출(운영자 2026-06-18 가격 공개). 한 화면 안 모순.
- 수정: FAQ 답변을 '사용처 공개됨(표 참고), 실제 차감은 정식 오픈 후 단계적'으로 갱신 + tag '사용처 공개'/제거.

### H6. 포인트 내역 모달에 '1P = 10원 가치' 원화 환산 — 적립화면 금지 정책 위반 · `[LIVE]`
- 기준 H | `MyHistory.jsx:1432`(setPointDetailOpen '포인트 내역' = 적립/내역 화면). point_economy 메모리 '적립 UI 원화 환산 금지 — 사용처/결제 화면만'.
- 수정: '1P = 10원 가치' 제거. 원화 환산은 PointGuide(사용처)에만. 적립 화면은 '혜택은 보상 시스템에서 확인'만.

### H7. SuccessReviewModal에 maxHeight/스크롤 없음 → 작은 화면 본문 잘림·제출 불가 · `[LIVE]`
- 기준 F | `SuccessReviewModal.jsx:95-110` 오버레이·카드 모두 maxHeight/overflow 없음. 완독 분기는 인증서+카페등록+textarea로 길어 720px 미만에서 잘림. 타 모달(BugReport `:56`·Admin `:236`·NotificationBell `:122`)은 스크롤 있음.
- 수정: 오버레이 `overflowY:auto` + 카드 `maxHeight:min(90dvh,720px); overflowY:auto`.

### H8. TrialBanner 라이트(기본) 테마에서 본문 글자 안 보임 · `[LIVE]`
- 기준 D | `TrialBanner.jsx:49` inner 배경 하드코딩 다크 그래디언트(`#0d1226→#1a0f00`, 테마 미분기), 글자는 토큰(`:106-108 var(--ls-text)`·`:118 var(--ls-muted)`). 라이트에서 토큰이 #1d2433/#746b5f(어두움) → 다크 카드+검정 글자로 첫 방문 모달 본문 거의 안 읽힘.
- 수정: inner 배경 토큰화(`var(--ls-card-strong)`/페이퍼) + 다크 글로우는 `body.dark-mode`만. 배포 전 ☀️ 라이트 토글 자가검증.

---

## MEDIUM (12)

| # | 화면 | 기준 | 발견 | 근거 | 수정 |
|---|---|---|---|---|---|
| M1 | 데모 모달 공통 | F(100dvh) | maxHeight 92vh — 모바일 주소창서 하단 잘림 | `DemoExperienceFlow.jsx:490` | 92dvh로 |
| M2 | 데모 닫기 ✕ | F/E(터치) | ✕ 패딩/최소크기 없는 20px(~20×24px) | `DemoExperienceFlow.jsx:99,135,152,178,245` | 44~48px grid+placeItems |
| M3 | 데모 STEP4 | H/UX(모순) | '첫 인증' 화면인데 '3일 연속 성공 중'·'3일차 성공하기' | `DemoExperienceFlow.jsx:101/110/124` | 1일차로 일관화 또는 '미리보기' 명시 |
| M4 | 피드 응원(👏) | F/E(터치) | 👏 버튼 ~26px(<44/48px), 흐르는 피드 위 | `CheerButton.jsx:96-103` | min-height 44~48px/히트영역 확대 |
| M5 | ApplicationSection Step2 | H/B(기능) | '나만의 원서 직접 입력' disabled('준비 중🚧') → 100선 검색·등록신청(⑭) 온보딩 경유로만 도달 | `ApplicationSection.jsx:767`(검색 UI는 `:411-432` 완전 배선) | disabled 제거+라벨 변경, 또는 의도면 주석 |
| M6 | ApplicationSection Step1 | A(표시토글/강도) | 가입 비번·확인에 눈 토글/강도 없음(LoginModal엔 있음) | `ApplicationSection.jsx:292,302` vs `LoginModal.jsx:105-110 EyeBtn` | EyeBtn 재사용+'6자 이상' 힌트 |
| M7 | BugReportModal | F(input≥16px) | 닉/이메일/내용 14px → iOS 줌 | `BugReportModal.jsx:43 inputStyle` | 16px |
| M8 | DiagnosticResultRouter | H(여정) | '몰입하는 여정' 진부표현 | `DiagnosticResultRouter.jsx:303` | '조용한 독서' 등 |
| M9 | LiveBoard | C/Zero-Error | 폴링 실패 시 에러UI 없음 + 로딩 영구 고착('인증 없음'으로 오인) | `App.jsx:574-589`(try/catch 없음)·`LiveBoard.jsx:198` | try/catch+error 분기, 최소 loading:false |
| M10 | ReadingDiarySection | F(input≥16px) | 분량/원서 select·템플릿 textarea 14px → iOS 줌 | `ReadingDiarySection.jsx:179 inputStyle` | 16px |
| M11 | SuccessReviewModal | F(input≥16px) | 카페URL input 14px(소감은 16px — 폼 내 불일치) | `SuccessReviewModal.jsx:159` | 16px 통일 |
| M12 | TrackerPreview 일수 배지 | H(성공/완독) | '100일 완독' 라벨(일수=성공이어야) — 정본 badges.js '100일 성공'과 불일치 | `TrackerPreview.jsx:50` vs `badges.js:155` | '100일 성공'으로 |

---

## LOW (14)

| # | 화면 | 기준 | 발견 | 근거 |
|---|---|---|---|---|
| L1 | 데모 STEP3·5 | H | '여정'·'기적' 진부·과장 | `DemoExperienceFlow.jsx:180,390,350` |
| L2 | 랜딩 전반 | H(일관성) | '매일 인증' 잔존(운영자 '꾸준한 인증' 지시와 불일치) | `HowItWorks.jsx:17`·`Hero.jsx:47`·`DiagnosticResultRouter.jsx:6,257` |
| L3 | AccountSettings 비번변경 | A | 표시토글·강도 없음 | `AccountSettingsModal.jsx:425,432` |
| L4 | BugReportModal | F(dvh) | maxHeight 90vh(AdminPanel:236도) | `BugReportModal.jsx:56` |
| L5 | CheckinSection 100일 완료 | H | '100일 성공 대장정 완료' 과장표현 | `CheckinSection.jsx:315` |
| L6 | CheckinSection 4일차 | H/돈 | 입금 안내 '₩3,000 전액 기부' 골드 강조 | `CheckinSection.jsx:438,444,446` (운영자 확인) |
| L7 | Hero | F(dvh) | minHeight 70vh | `Hero.jsx:23` |
| L8 | HonorBoard CurrentSeasonHonor | C(에러) | 조회 실패를 빈 상태로만(에러UI 없음, PointRankingBoard와 불일치) | `HonorBoard.jsx:85,132`·`api.js:603` |
| L9 | ReviewCarousel 화살표 | F(터치) | 좌/우 버튼 36×36px(<44/48px) | `HonorBoard.jsx:167,192` |
| L10 | MyHistory 진단탭 | C(로딩) | 로딩 중 '진단 안 받음' 빈상태 플리커 | `MyHistory.jsx:1139-1151` |
| L11 | MyHistory 프로필 | H(여정) | 폴백 '여정의 시작' | `MyHistory.jsx:788` |
| L12 | SuccessReviewModal | H(여정) | placeholder '…여정은 어떠셨나요?' | `SuccessReviewModal.jsx:175` |
| L13 | TrackerPreview 도전현황 | H(성공/완독) | '완독까지 N일'·'완독 기준 달성'(일수 목표인데 완독 혼용) | `TrackerPreview.jsx:549,567` |
| L14 | TrialBanner CTA | F(터치) | 보조버튼 46px·닫기 ~32px | `TrialBanner.jsx:153,71-83` |

---

## 종합 (챌린지앱)
- **테마 토큰화·모달 stacking은 대체로 견고**(라이트/다크 `--ls-*` 정의, Confetti/모달 분리). 단 **TrialBanner(H8)만 라이트 테마 회귀** — 첫 방문 모달이라 영향 큼.
- **반복 패턴 결함(일괄 수정 효율↑):**
  - **입력칸 14px → iOS 줌** (H1·M7·M10·M11): 데모·문의·다이어리·후기 — 전부 16px 상향.
  - **터치 타깃 <48px** (M2·M4·L9·L14): 모달 닫기·응원·캐러셀 화살표·배너 CTA.
  - **dvh 미사용** (M1·L4·L7): 데모·문의·히어로.
  - **용어/카피** (M8·M12·L1·L2·L5·L11·L12·L13): '여정/대장정/기적' 진부, '매일 인증' vs '꾸준한 인증', 일수배지 '완독'↔'성공'.
  - **돈 표현(운영자 영역)** (H2·H4·H6·L6): 원화 환산·기부 강조 — point_economy/카피 룰 위반, 운영자 컨펌 후 정리.
  - **에러 상태 누락** (M9·L8·L10): LiveBoard 폴링·HonorBoard·진단탭.
- **즉시 처리 권장(코드 명확·저위험):** B1(blocker, 가입 비번 필수) · H1/M7/M10/M11(input 16px) · H3(피드 터치 정지) · H7(후기 모달 스크롤) · H8(TrialBanner 라이트) · M12/L13(일수='성공').
- **운영자 컨펌 필요(돈/카피):** H2·H4·H6·L6 + L2('꾸준한 인증' 전면 적용 여부).
