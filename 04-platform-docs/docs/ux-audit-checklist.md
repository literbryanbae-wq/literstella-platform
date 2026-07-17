# UX 감사 체크리스트 (ux-audit-checklist)

> 정본 출처: `CLAUDE.md` — 기본기 DoD · 모바일·반응형 표준 · "?" 툴팁 원칙 · 용어 표준.
> 이 파일은 **지어낸 기준이 아니라 프로젝트가 이미 합의한 기준**을 감사용으로 정리한 것이다.
> 사용법: 아래 **화면 인벤토리**의 각 화면을 **감사 기준(A~H)** 항목과 교차로 점검한다.
> 모든 발견은 **라이브 기준 / 로컬 기준**을 구분해 표기한다(아래 정의).

---

## 라이브 기준 / 로컬 기준 (구분 정의)
- **라이브 기준 (LIVE):** 현재 배포된 사이트에서 사용자가 실제로 보는 상태.
  - 챌린지앱 = `challenge.literstella.co.kr` (git `origin/main`, Cloudflare Pages 자동 빌드). → **커밋되어 push된 코드 = 라이브.**
  - 진단앱 = `read.literstella.co.kr` (수동 `npx wrangler deploy`). → **마지막 배포 시점 코드 = 라이브.** 워킹트리가 더 최신일 수 있음(미배포).
- **로컬 기준 (LOCAL):** 로컬 워킹트리(미커밋/미배포 변경 포함). 예: 챌린지 "도전 날짜 엔진" WIP, 진단앱 미배포 수정.
- 표기 규칙: 각 발견에 `[LIVE]`(배포 반영됨) / `[LOCAL]`(로컬에만 있음, 미배포) / `[BOTH]` 중 하나.
  - 판정법: 해당 파일이 `git log origin/main..HEAD`(챌린지) 또는 커밋/미커밋 상태에 있는지로 1차 판정. 진단앱은 마지막 wrangler 배포와 워킹트리 차이로 판정.

---

## 감사 기준 (A~H) — DoD 정본

### A. 회원가입 / 인증 폼
- [ ] 이메일(아이디) 중복확인 · 닉네임 중복확인
- [ ] 비밀번호 + 비밀번호 확인 필드 · 표시 토글/강도 안내
- [ ] 로그인 이메일 저장(remember me)
- [ ] 아이디·비밀번호 찾기 링크
- [ ] 인라인 에러 메시지 · 중복제출 방지/로딩 상태

### B. 데이터 입력 폼
- [ ] 필수값 검증 · 성공/실패 피드백
- [ ] 옵셔널 체이닝(`?.`)·폴백(`|| []`) (Zero-Error)
- [ ] 모바일 640 / 380 브레이크포인트 정상

### C. 목록 / 조회
- [ ] 로딩 상태 · 빈 상태(empty) · 에러 UI 3종 모두 존재

### D. 모달 / 문서류
- [ ] 다크·라이트 양 테마에서 대비 확인 (글자 가독)
- [ ] 본문 좌측 정렬 · 부모 상속(text-align, stacking context) 점검
- [ ] backdrop-filter 내부 position:fixed 모달 렌더 금지 (stacking 버그)

### E. 액션 버튼 그룹 (2개+)
- [ ] 모바일에서 우측 ragged 줄바꿈 금지
- [ ] 주 CTA 풀폭 + 보조 50/50 (또는 전부 풀폭 스택) · 터치 타깃 ≥48px
- [ ] 데스크톱만 inline row 허용

### F. 반응형 / 모바일·터치 우선 (우선순위: 모바일 → PC → 태블릿)
- [ ] 320px에서 가로 스크롤 없음
- [ ] 전체화면 요소 `100dvh`(+`min-height:100dvh`) — `100vh` 지양
- [ ] 폰트·여백 `clamp()`+`rem`/`vw`, 고정 `width:400px` 금지(`max-width`+`width:100%`)
- [ ] 터치 타깃 ≥48×48px, 인접 ≥8px
- [ ] `grid auto-fit minmax()` 리플로우
- [ ] iOS safe-area(`env(safe-area-inset-*)`)
- [ ] **input 폰트 ≥16px** (iOS 강제 줌 방지)
- [ ] 하단 고정바가 브라우저 UI에 안 가림
- [ ] 2단 컬럼 카드: 모바일 단일 전환 시 데스크톱 `max-width`를 `none`으로 해제

### G. 부가 설명 = "?" 툴팁
- [ ] 필수 아닌 부가 설명은 인라인 장문 대신 "?" 아이콘(데스크톱 호버 / 모바일 탭)
- [ ] 필수 정보(라벨·에러·가격·필수 안내)는 인라인 유지
- [ ] 툴팁 터치 ≥44px · 다크/라이트 대비 · 모바일 화면 밖 안 넘침(클램프)

### H. 용어 / 카피 표준
- [ ] **성공**(일수·연속·streak) vs **완독**(책 1권) 엄격 구분
- [ ] 🚫 "완주" 금지 · 🚫 "기수" 금지(→ "야나완 2606") · 🚫 "도반" 금지(→ "함께 읽는 분들")
- [ ] 카피: 3,000원 기부 강조 금지 · 진부 표현("여정/journey") 지양
- [ ] (적립 화면) 원화 환산 표기 금지 — 사용처 화면만 허용

### (보안/개인정보 — 참고)
- [ ] 입력 검증 · RLS · 시크릿은 secret · 개인정보 노출 점검

---

## 화면 인벤토리 (감사 대상)

### 진단앱 (read.literstella.co.kr) — Vanilla JS / `index.html`·`app.js`·`style.css`
1. `intro` — 히어로 + 닉네임/이메일 입력 (B,F,H)
2. `problem` / `diagnosis-value` — 설명 섹션 (F,H)
3. 설문 `screenGoal`(Step1) (B,E,F)
4. 설문 `screenStamina`(Step2) (B,E,F)
5. 설문 `screenLevel`(Step3·문장감각) (B,E,F)
6. 설문 `screenPreference`(Step4·읽기취향) (B,E,F)
7. 설문 `screenRoutine`(Step5·읽기루틴) (B,E,F)
8. `screenResult` — 결과 화면 (B,E,F,H)
9. 결과 1단 정제 카드 모달 (`openDiagResultModal`) (D,E,F,H)
10. 2단 리포트 (`reportPageHtml` / reportPreviewSection) (D,F,H) — PDF/인쇄
11. AI 리포트 모달 (`loadAiReport`) (C,D,F)
12. `courses`(클래식/HP 탭) (E,F,H)
13. `authority`(원서 목록) (C,F,H)
14. `trust` / `faq` (F,G,H)
15. 마이페이지(저장·진단 리스트·닉네임/비번 변경) (A,B,C,D)
16. 공유 토스트/카드 (`renderDiagShareCard`) (D,F)

### 챌린지앱 (challenge.literstella.co.kr) — React / `src/`
**비로그인**
17. `TrialBanner` (모달) (D,E,F,H)
18. `Hero` / `StatsStrip` / `HowItWorks` (E,F,H)
19. `track-select` → `DiagnosticResultRouter`/`DiagnosticSummaryCard` (D,F,H)
20. `ApplicationSection` 6단 가입 폼 + `ApplicationSummaryCard` (A,B,E,F,H)
21. `ReadingDiarySection` (다이어리 트랙) (B,C,E,F)
22. `LiveBoard` + `CertificationFeed` + `DeclarationFeed` (C,F,H)
23. `DemoExperienceFlow` 7단 체험 (모달) (D,E,F,H)
24. `BadgeSystem` (#badges — 미리보기 3단·전체보기) (C,D,F,H)
25. `HonorBoard` (#reviews — PointRankingBoard·CurrentSeasonHonor·ReviewCarousel·PastHonorCollapsible) (C,D,F,H)
26. `GuideSection` + `PointGuide` (#guide — 단계·FAQ·포인트) (F,G,H)
27. `FinalCTA` / `Footer` (E,F,H)
**로그인**
28. `TrackerPreview` (나의 인증 현황) (C,F,H)
29. `CheckinSection` (인증 폼) (B,E,F,G,H)
30. `MyHistory` 4탭(진단결과 / 나의 완독 서재 / 다이어리 / 획득 배지) (C,D,F,H)
31. `AccountSettingsModal` (프로필/설정) (A,B,D)
32. 포인트 내역 모달 · `AiReportModal` (C,D,F)
**공통 모달**
33. `LoginModal`(로그인/회원가입/찾기) (A,B,D)
34. `BugReportModal`(고객 문의) / `NotificationBell` (B,C,D)
35. `SuccessReviewModal` / `SuccessStrategyModal` / `EmailVerifyModal` / `BadgeCelebrationModal` (B,D,E,F)
36. `AdminPanel` (운영자) (B,C,D)

---

## 산출물
- `ux-audit-report-diagnosis.md` — 진단앱 화면별 발견(기준 A~H × LIVE/LOCAL)
- `ux-audit-report-challenge.md` — 챌린지앱 화면별 발견(기준 A~H × LIVE/LOCAL)
- 각 발견: `화면 · 기준 · 심각도(blocker/high/medium/low) · LIVE/LOCAL · 근거(파일:라인) · 제안 수정`
