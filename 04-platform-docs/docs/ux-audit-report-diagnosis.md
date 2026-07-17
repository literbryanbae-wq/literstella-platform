# UX 감사 리포트 — 진단앱 (read.literstella.co.kr)

> 기준: [`ux-audit-checklist.md`](./ux-audit-checklist.md) (DoD A~H). 감사일: 2026-06-18.
> 방법: 11그룹 다중 에이전트 감사 + blocker/high 적대 검증(0 오탐). 근거=실제 `app.js`/`index.html`/`style.css` 라인.
> **LIVE/LOCAL:** 진단앱 워킹트리 clean·전부 커밋됨. ⚠️ **단 진단앱은 `npx wrangler deploy` 수동 배포라 git으로 정확한 라이브 시점 검증 불가** → 표기는 `LIVE(LIKELY)`. 미배포 변경(LOCAL) 0건.

**요약:** blocker 0 · high 3 · medium 5 · low 5 (총 13)

---

## HIGH (3)

### H1. 추천 원서 데이터에 금지어 '완주' 3곳 — 사용자 노출 카피 · `[LIVE]`
- 기준 H(용어) | 화면: 결과·Reading Map·HP 시리즈 책 상세(book-detail 펼침)
- 근거: `app.js:172`(B009 whyPick "단계적으로 완주") · `app.js:269`(HP004 who "꾸준한 루틴으로 완주") · `app.js:273`(HP004 tip "장면 단위로 완주하세요"). 실제 렌더: `app.js:4314`(who)/`4319`(whyPick). CLAUDE.md "🚫 완주 금지(2026-06-13) — 성공/완독으로만, 코드·카피·주석 전부". 챌린지앱은 제거됐으나 진단앱 데이터에 잔존.
- 수정: 172 "단계적으로 완독할 수 있습니다" / 269 "완독하고 싶은 분" / 273 "장면 단위로 끝까지 읽어 나가세요". (책 단위 성취 → '완독')

### H2. 마이페이지에서 닉네임 변경 불가 — 핸들러만 있고 UI(폼)가 없는 죽은 코드 · `[LIVE]`
- 기준 A(닉네임 변경) | 화면: 마이페이지 모달(`showMyDiagHistory` 계정 설정)
- 근거: `app.js:3490-3522` 모달 HTML은 **비밀번호 row만** 렌더, 닉네임 row 없음. 그런데 `app.js:3536-3555`는 `mpNickToggle/mpNickForm/mpNickname/mpNickSave/mpNickDisplay`에 핸들러를 붙임 → DOM 부재로 `?.` no-op(죽은 코드). 'AI 리포트 단일 허브' 리팩터(69489fe) 때 닉네임 row 누락. (세션27 기록은 '닉/비번 변경 토글 완료'이나 실제 회귀.)
- 수정: 비번 row(3510-3513) 패턴으로 닉네임 row 추가(`mpNickDisplay`/`mpNickToggle`/`mpNickForm`/`mpNickname`/`mpNickSave`). 저장 핸들러(3541-3555)에 `checkDiagDuplicates(email,newNick)` 중복확인도 추가(DoD-A).

### H3. AI 리포트 모달·진단 기록 리스트의 인라인 `color:#746b5f` 다크테마 대비 미달 · `[LIVE]`
- 기준 D(다크 대비) | 화면: AI 리포트 모달 + 진단 기록 리스트
- 근거: `app.js:2346·2351·2372·2449`(AI 모달) + `app.js:2880·2887·2904·3060·3091·3094·3114`(기록 리스트) 본문이 인라인 `color:#746b5f`. 다크 모달 배경 `#141c3c`(`style.css:1418`) 위 대비 ≈2.3:1 (WCAG 4.5:1 미달). 인라인 색이라 다크 토큰(`--muted:#cbd5e1`)으로 못 덮음. `#themeToggle`(index.html:103)로 도달 가능한 실 경로.
- 수정: 인라인 `color:#746b5f` 제거 → 공통 클래스(예 `.drm-note{color:var(--muted)}`). `var(--muted)`가 라이트 #746b5f / 다크 #cbd5e1 자동 분기. 11곳 일괄.

---

## MEDIUM (5)

### M1. `.diag-auth-input` 폰트 14px → iOS 강제 줌인 · `[LIVE]`
- 기준 F(input≥16px) | `style.css:1367-1376` font-size:14px. 사용처: `app.js:3515`(비번 변경 `#mpPassword`)·`app.js:3321`(아이디/비번 찾기 입력). 대조군 `.su-input`은 16px(`style.css:7706`).
- 수정: `style.css:1374` 14px → 16px.

### M2. 모달 닫기(×) `.diag-auth-x` 터치 영역 ~24px · `[LIVE]`
- 기준 F(터치 48px) | `style.css:1363` padding/min 크기 없음 → 글리프(~24px)가 곧 히트영역. 마이페이지·로그인·찾기 모달 헤더 닫기.
- 수정: `min-width/height:44px; display:inline-flex; align-items/justify-content:center; padding:4px`.

### M3. (H1과 동일 이슈, 결과/리포트 경로) 금지어 '완주' · `[LIVE]`
- H1 참조. 결과화면 추천원서·Reading Map·HP 시리즈에도 동일 노출. (H1 수정 시 함께 해소.)

### M4. AI 생성 실패 시 로딩카드가 안내 없이 사라짐 — 에러/빈 상태 UI 부재 · `[LIVE]`
- 기준 C | `app.js:4604`(`!data.ok` → hidden+빈 innerHTML) + `4633-4636`(catch 동일). 최대 1분 로딩카드 후 실패 시 흔적 없이 사라져 성공/실패 알 수 없음.
- 수정: catch/실패 분기에 한 줄 안내 카드("지금은 AI 리포트를 불러오지 못했어요 · 진단 기록은 안전하게 저장돼 있어요"). 단, 서버 미준비 graceful 비표시 정책은 timeout 로딩 표출된 경우만 에러 안내로 분기.

### M5. authority(원서 100선) 레벨 필터 칩 터치 <48px · `[LIVE]`
- 기준 F | `style.css:7312` `.authority-level-btn` padding 7px 14px·min-height 없음(≈35px), 인접 gap 6px(<8px). 전체/L1~L5 6개 칩.
- 수정: `min-height:44px; display:inline-flex; align-items:center; padding:9px 16px`, `.authority-levels` gap 8px.

---

## LOW (5)

### L1. 설문 이전/다음 버튼 그룹 모바일 패턴 미적용(약식 nav) · `[LIVE]`
- 기준 E | `style.css:271` `.screen-actions` justify/풀폭 미지정. 단 auto-advance(`app.js:765·786·810·814`)로 '다음' 클릭 빈도 낮아 경미.
- 수정(선택): `@media(max-width:620px)`에서 '다음' flex:1 풀폭 + '이전' 보조.

### L2. 진단 기록 조회 네트워크 오류 → '기록 없음' 오인 · `[LIVE]`
- 기준 C | `app.js:3582-3603`/`2877`: `{error:true}`여도 localStorage 폴백만, 비면 '저장된 진단 기록이 없습니다'. 로딩·빈 상태는 있으나 에러 상태 누락.
- 수정: `res.error` 분기 별도 처리("불러오지 못했어요 · 다시 시도"). '없음'은 `res.ok && leads.length===0`일 때만.

### L3. authority 카드 '자세히 보기' 토글 터치 ~24px · `[LIVE]`
- 기준 F | `style.css:7360` `.auth-toggle` padding 4px 0·font 12px. 카드마다 반복 핵심 인터랙션.
- 수정: `min-height:44px; padding:8px 4px`(또는 margin 음수로 히트영역만 확대). `.auth-cta`도 점검.

### L4. authority 레벨/AR 면책 문구 — '?' 툴팁 후보 · `[LIVE]`
- 기준 G | `index.html:407` `.authority-note` 부가 맥락을 인라인 장문 노출. (푸트노트라 인라인도 허용 범위 → 우선순위 낮음.)
- 수정(선택): 레벨/AR 라벨 옆 ? 아이콘(호버/탭, ≥44px·클램프)로 접기.

### L5. 죽은 `.course-tab` 모바일 CSS — 실 마크업은 `.course-tab-card` · `[LIVE]`
- 기준 F(유지보수) | `style.css:7281` `.course-tab`/`.course-tab-label` 규칙 잔재(현 DOM `index.html:325·330` = `.course-tab-card`). 무효 규칙 — 추후 수정 시 함정.
- 수정: 7281~7282 잔재 규칙 삭제(실 적용은 `.course-tab-card`/`.ctc-*`).

---

## 종합 (진단앱)
- **모바일 우선 기반은 견고**: 전역 `overflow-x:hidden`·`box-sizing`, container `min()` 폭, authority `auto-fill` 그리드, 검색 input 16px·빈 상태, 다크테마 토큰화 완비.
- **실사용 결함 집중 영역**: ① 용어('완주' 잔존) ② 다크테마 인라인 색 대비 ③ 일부 입력칸 14px(iOS 줌) ④ 닫기/칩/토글 터치 타깃 ⑤ 마이페이지 닉네임 변경 회귀.
- **빠른 일괄 수정 후보(저위험)**: 입력 14→16px(M1) · 터치 타깃 보강(M2·M5·L3) · '완주' 치환(H1) · 다크 인라인색 클래스화(H3).
