# 강독 클래스 일원화 — UX·버그 감사 리포트 (2026-07-19)

> 방법: 6관점 병렬 조사(45 에이전트) → 각 발견 **적대 검증**(반증 시도) → **확정 29건 / 기각 10건**.
> 발주: 운영자 "강독 클래스 일원화 UX 점검 하면서 버그도 검토" — 플레이어-UX 세션 수행.
> **담당 분리(운영자 2026-07-19)**: 플레이어-UX 세션 = 플레이어·강독 시트 내부 / **Class site planning & integration 세션 = 클래스 사이트·라우팅·랜딩·Q&A·퍼널·정책**.

## 이미 수정·배포 완료 (플레이어 세션)

| 건 | 심각도 | 배포 |
|---|---|---|
| 리더 온보딩이 클래스 이동 카드를 덮음 → 강독 열림 중 미노출 | - | 챌린지 7dd8362 / 클래스 c8c9b95 |
| **ClassOnlyCard useModal 미적용 → ESC·뒤로가기가 리더 전체를 닫음** | high | 09d97dc / 76a1436 |
| 빈 `?room=` 전송 → 클래스가 1강 강제(OT 무시·"듣던 위치" 카피 위배) | medium | 09d97dc / 76a1436 |
| PC에서 카드가 전폭 시트 → wide 반영(440px 검증) | low | 09d97dc / 76a1436 |
| **loadTranscript가 실패를 영구 캐시 → 인증 후에도 대본·자막 빈 채** | high | 8257d9e / 13979a6 |
| (부수) open-class가 항상 /classes/kidari로 튕김 | high | 클래스 13979a6 |

---

## 🔴 Class site planning & integration 세션 몫 (16건)

> 이 세션이 소유: 클래스 앱 라우팅·랜딩·딥링크 수신·Q&A 기능/SQL·진입 퍼널·정책 판단.
> 플레이어 세션은 이 파일들을 건드리지 않습니다(강독 시트 내부만 담당).
>
> ✅ **전건 수정·배포 완료 (클래스 세션 2026-07-19, 챌린지 cf975d9 · 클래스 2742df1 · 진단 feb6127c · 루트 23366bc):**
> #2/#20 ClassPage 5곳 classUrl 직행(goClass 모듈 스코프) · #3 딥링크 다음 틱 발행+room 키만 정리(신규 로드 자동오픈 라이브 검증) ·
> #4 Q&A 레일 탭 승격(PC 검증) · #5 SQL 정본 `scripts/migration-2026-07-19-class-questions.sql` + 상태 3분기·RPC 미배포 정직 표시 ·
> #7/#21 open-class detail.course 왕복 · #10/#18 투어=새 탭 직행+카피 정정 · #11 진단 브리지 클래스 직행+?stella=1 리다이렉트 ·
> #12 헤더 3곳 직행 통일 · #14 빈 room=지정없음 · #15 닉네임 입력+PII 제거+본인삭제 RPC · #24 폼 리셋+등록 강 고정 · #25 터치 48px · #27 워커 박제 동기.
> 🔴 운영자: class_questions SQL 실행(위 파일) — 실행 전엔 Q&A가 '준비 중'으로 정직 표시됨.

### 2. [high] 수강생이 챌린지에서 인증 코드로 잠금 해제해도 강의실이 안 열리고 이동 카드만 뜸
- **파일**: `02-challenge/wide-ux-wt/src/components/ClassPage.jsx:85`
- **관점**: 챌린지앱 → 강독 진입 경로 일원화 정합성 (관점 2/6)
- **재현**: 평생소장 결제자가 ClassPage 하단 '이미 수강생이세요?'에서 ClassUnlockGate로 OTP/인증 코드를 입력해 성공 → onUnlocked가 open-reader{g:157,stella:true}를 발행 → ClassOnlyCard. 방금 '인증 완료'를 본 유료 회원이 강의 대신 '클래스 강의실로 이동' 안내를 받아 인증이 실패한 것처럼 보인다(자격 자체는 서버 class_access라 클래스 앱에서 유효하므로 실제로는 성공). 이미 자격 보유자에게 뜨는 :78 '강의실 가기 — 이어 듣기'도 동일.
- **수정안**: onUnlocked/이어듣기 핸들러를 window.location.assign(`${classUrl}?room=6`) 직행으로 교체하고 '인증 완료 — 클래스 강의실로 이동합니다' 문구 노출.

### 3. [high] ?room= 딥링크가 새 페이지 로드에서 항상 유실됨 — open-reader 발행이 GlobalTools 리스너 등록보다 먼저 실행되고, URL까지 즉시 지워져 복구 불가
- **파일**: `E:/LiterStella Project/LiterStella-DEV/07-class/src/components/ClassDetail.jsx:127-133`
- **관점**: ?room= 딥링크 왕복(챌린지→클래스) 정확성
- **재현**: 챌린지에서 개츠비 강독 시트를 열고(예: ?read=64317&stella=1&ep=6) ClassOnlyCard의 '클래스 강의실로 이동'을 누르면 <a href>로 https://class-new.literstella.co.kr/classes/gatsby?room=6 에 **새 페이지 로드**로 착지한다. 이때 ClassDetail(App.jsx:157 <Routes> 안, 직접 import — lazy 아님)의 useEffect가 GlobalTools(App.jsx:171, 더 뒤 형제)의 useEffect보다 먼저 flush된다(React passive effect = 자식→부모, 형제는 렌더 순서). ClassDetail은 effect 안에서 fire('open-reader')를 **동기 발행**하는데(131행) GlobalTools의 window.addEventListener('open-reader')는 GlobalTools.jsx:56-86 useEffect에서 아직 등록 전이라 이벤트가 허공으로 사라진다. 강의실(리더+강독 시트)이 열리지 않고 강좌 랜딩만 보인다. 게다가 같은 effect의 navigate(location.pathname,{replace:true})(132행)가 ?room=6을 즉시 제거하므로 사용자가 새로고침해도 재시도조차 안 된다. StrictMode 개발 모드에서도 재현(2차 create 순서 동
- **수정안**: ① 발행을 다음 틱 이후로 미룬다 — 챌린지 정본과 동일하게 setTimeout(() => enterRoom(...), 250)(최소 setTimeout 0). 또는 근본적으로 App.jsx에서 <GlobalTools/>를 <Routes> **앞**에 렌더해 리스너를 먼저 등록시킨다(권장 — 모든 라우트의 딥링크가 함께 안전해짐). ② URL 정리는 발행 이후(같은 setTimeout 콜백 끝)로 옮기고, pathname 전체 치환 대신 room 키만 제거한다: const next=new URLSearchParams(location.search); next.delete('room'); navigate({pathname:location.pathname, search:next.toString()?`?${next}`:''},{replace:true}) — 현재 구현은 room 외 파라미터(GlobalTools가 마운트 시 window.location.search에서 읽는 ?story·?s

### 4. [high] PC(≥1024px)에서 '이 강의에 질문하기'가 아예 렌더되지 않음 — 강독 유일 소비처인 클래스 앱에서 데스크톱 수강생은 기능 자체가 없음
- **파일**: `E:/LiterStella Project/LiterStella-DEV/07-class/src/components/reader/StellaLectureSheet.jsx:890`
- **관점**: ClassQnA(강의별 질문하기) 정합성·안전성
- **재현**: ClassQnA 호출부는 파일 전체에서 단 1곳(890행)이고, 그 블록의 조건이 `{data && !wide && !listOpen && mode !== 'story' && (...)}` 즉 모바일 단일열 분기다. ReaderView.jsx:180에서 `wide = window.innerWidth >= 1024`(235행 resize 리스너로 갱신)이므로, 수강생이 PC 브라우저(1024px 이상)로 class-new.literstella.co.kr → 강의실 입장(ClassDetail.enterRoom → open-reader → StellaLectureSheet wide=true)하면 대본/노트/원문/필사 레일만 보이고 질문하기 박스가 어디에도 없다. 창을 1024px 미만으로 줄여야만 나타난다. 운영자(ADMIN_EMAIL)도 PC에서는 '답변 달기' 버튼을 볼 수 없어 답변을 달 수 없다. 추가로 모바일이어도 스토리 극장 탭(mode==='story')에서는 같은 이유로 사라진다. 챌린지 정본(02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:890)도 동일.
- **수정안**: 와이드 분기에도 ClassQnA를 배치한다. 가장 자연스러운 자리는 우측 학습 레일 세그먼트(railItems)에 'Q&A' 탭을 추가해 effRail/effCenter 값에 'qna'를 넣고 `{effRail === 'qna' && <ClassQnA .../>}`로 렌더하는 것(SatisfactionSurvey와 달리 Q&A는 목록형이라 레일에 잘 맞음). 최소 조치로는 중앙 컬럼 스크롤 영역(838~845행 `fillTab` 블록) 하단에 모바일과 동일한 `<ClassQnA bookCode={...} lectureNo={sel ?? 0} email={email} />`를 한 벌 더 넣되, 모바일/와이드 중복 마운트가 되지 않도록 `wide ? (와이드 위치) : (모바일 위치)` 한 곳에서만 렌더할 것. story 모드에서도 노출할지 운영자 확인(강=Day 1:1이므로 노출이 자연스러움).

### 5. [high] 참조된 SQL(migration-2026-07-19-class-questions)이 레포에 존재하지 않아 기능이 통째로 동작 불가 — 실패 문구는 '잠시 후 다시 시도'라 부정직하고, 조회 실패는 '질문 없음'으로 위장됨
- **파일**: `E:/LiterStella Project/LiterStella-DEV/07-class/src/components/reader/ClassQnA.jsx:43`
- **관점**: ClassQnA(강의별 질문하기) 정합성·안전성
- **재현**: 헤더 주석(4행)이 가리키는 `migration-2026-07-19-class-questions` 파일이 02-challenge/wide-ux-wt/scripts, 02-challenge/literstella-challenge/scripts, 07-class, 04-platform-docs 어디에도 없다(레포 전역 grep으로 'submit_class_question'·'public_class_questions' 히트 0건 — 클라이언트 파일 제외). 즉 RPC는 '미배포'가 아니라 '미작성'이라 운영자 SQL 실행조차 불가능하다. 이 상태로 배포되면: (a) 수강생이 질문을 작성해 '질문 등록'을 누르면 PGRST202(function not found)로 catch되어 매번 '질문 등록에 실패했어요. 잠시 후 다시 시도해 주세요.'가 뜬다 — 시간이 지나도 절대 성공하지 않는데 재시도를 권하는 거짓 안내다. (b) fetchQuestions(12~18행)는 error를 삼키고 []를 반환하고 loading 상태가 없어, 82행 빈 상태 문구 '아직 이 강의에 올라온 질문이 없어요. 첫 질문을 남겨 보세요.'가 뜬다 — 백엔드가 없는 상태가 '질문이 아직 없는 게시판'으로 위장되어 사용자가 계속 헛질문을 시도한다(정상 로딩 시에도 fetch 완료 전 이 문구가 잠깐 노출되는 플리커 포함).
- **수정안**: ① migration-2026-07-17-class-reviews.sql을 그대로 본떠 class_questions 테이블 + public_class_questions/submit_class_question/set_class_question_reply 3종 SECURITY DEFINER RPC를 작성해 scripts/에 커밋하고 운영자 실행 대기 목록에 올린다(email은 auth.jwt()로 서버 귀속·조회 반환 제외, body CHECK 길이 제한, grant는 조회·작성=anon/authenticated, 답변=authenticated). ② 그 전까지는 RPC 부재를 감지해 박스 전체를 '질문하기 기능 준비 중이에요'로 표시하거나 렌더하지 않는다. ③ fetchQuestions가 error를 삼키지 말고 상태를 loading/empty/error 3분기로 올려, 에러 시 '질문을 불러오지 못했어요'를 표시(DoD: 목록/조회 = 로딩·빈·에러 UI). ④ submit 실패 문

### 7. [high] 클래스 앱의 '강독 클래스 보기' 버튼이 코스와 무관하게 항상 키다리 랜딩으로 이동 — 개츠비 미수강자가 다른 강좌 판매 페이지로 새어나감
- **파일**: `07-class/src/App.jsx:129`
- **관점**: 개츠비 강독(g64317) 데이터·게이트 정합성
- **재현**: onClass 핸들러가 `navigate('/classes/kidari')`로 하드코딩돼 있다. (1) 개츠비 6강+를 연 비수강자가 잠금 패널의 '아직 수강 전이에요 · 강독 클래스 보기'(StellaLectureSheet.jsx:615)를 누르면 워크벤치가 닫히고 **키다리 아저씨** 상세/판매 페이지가 뜬다 — 개츠비를 사려던 사람이 엉뚱한 강좌로 이동(전환 손실). (2) 개츠비 OT의 STUDY 탭 버튼(StellaLectureSheet.jsx:73)도 동일. `/classes/gatsby` 라우트와 META.gatsby는 이미 존재하므로(ClassDetail.jsx:63, App.jsx:160 `/classes/:id`) 단순 하드코딩 누락이다.
- **수정안**: 두 호출부에서 `new CustomEvent('open-class', { detail: { course: courseMeta?.gateBook || courseMeta?.id } })`로 코스를 실어 보내고, App.jsx onClass를 `const onClass = (e) => { fire('close-global-overlays'); navigate(`/classes/${e?.detail?.course || 'kidari'}`); }`로 변경. SentenceArchive.jsx:324 호출부도 같은 규약으로 정리.

### 10. [medium] 투어(?tour=1)의 '스텔라 강독' 체험이 창 안 체험 약속을 깨고 외부 도메인으로 사용자를 내보냄
- **파일**: `02-challenge/wide-ux-wt/src/components/TourView.jsx:46,149`
- **관점**: 챌린지앱 → 강독 진입 경로 일원화 정합성 (관점 2/6)
- **재현**: 비회원이 공유 링크 ?tour=1 또는 헤더 '서비스 둘러보기'로 투어를 연다. 투어 히어로 카피는 '버튼 하나로, 이 창 안에서 바로 만져보세요 · 가입 없이도 다 써볼 수 있어요'인데, 카드 desc는 '삽화·낭독·해설까지 무료', cta는 '함께 읽어보기'. 클릭 시 ReaderView(openBook=902, autoStella)가 뜨고 곧바로 ClassOnlyCard가 덮는다 → 체험할 것이 없고, '클래스 강의실로 이동'은 target 없는 <a href>라 클릭하면 투어(챌린지 도메인) 자체를 떠난다. 게다가 비로그인 게스트인데 카드는 '로그인은 그대로 이어지고'라고 안내한다. 투어 10회 소프트 게이트·가입 유도 퍼널도 그대로 이탈된다.
- **수정안**: 투어 FEATURES에서 lecture 항목을 (a) 챌린지에 남는 스토리 극장 체험으로 대체하거나 (b) cta를 '클래스 강의실 둘러보기'로 바꾸고 target="_blank" rel="noopener"로 새 탭 오픈해 투어 세션을 보존. desc의 '삽화·낭독·해설까지 무료'는 도착지 기준으로 정정.

### 11. [medium] 진단앱 AI 리포트의 '스텔라 강독 맛보기' 브리지가 맛보기 없이 2단 홉(진단→챌린지→클래스)으로 끝남
- **파일**: `01-reading-diagnosis/literstella-reading-diagnosis/app.js:1932`
- **관점**: 챌린지앱 → 강독 진입 경로 일원화 정합성 (관점 2/6)
- **재현**: 진단 완료자가 AI 리포트 하단 [📖 스텔라 강독 맛보기](data-bridge="lecture_taste") 클릭 → 새 탭으로 https://challenge.literstella.co.kr/?read=902&stella=1 → App.jsx:583이 open-reader{g:902,stella:true} 발행 → ClassOnlyCard. 즉 '맛보기'를 클릭한 리드가 콘텐츠 대신 또 다른 도메인 이동 안내를 받고, 여기서 다시 클릭해야 실제 강독에 닿는다(홉 2회). 전환 계측(lecture_taste)도 실제 청취와 무관해진다. ?ep=N 안내 메일 딥링크(App.jsx:543)도 같은 경로로 카드를 거친다.
- **수정안**: 진단앱 CTA href를 class 앱 직행(https://class-new.literstella.co.kr/classes/happyprince)으로 교체하고 라벨을 '스텔라 강독 맛보기(클래스)'로. 챌린지 App.jsx의 ?stella=1 처리는 classUrl 보유 g일 때 리더를 열지 말고 곧바로 classUrl로 리다이렉트(빈 화면 리더 우회 제거).

### 12. [medium] 헤더 안에서 같은 '강독'이 두 가지로 동작 — 서비스 런처는 클래스 직행, 무료콘텐츠/드로어는 엉뚱한 원서 리더 + 카드
- **파일**: `02-challenge/wide-ux-wt/src/components/Header.jsx:82,455,512`
- **관점**: 챌린지앱 → 강독 진입 경로 일원화 정합성 (관점 2/6)
- **재현**: PC 헤더 ⊞ 서비스 런처의 '🎙️ 클래스 강독'은 services.js:19에서 이미 /classes 직행으로 갱신됐다. 반면 같은 헤더의 '무료 콘텐츠 ▾ → 🎙️ 스텔라 강독(함께 읽기 · 무료)'(:82)과 모바일 드로어의 동일 항목(:455 로그인 / :512 비로그인)은 여전히 open-reader{g:902,stella:true}를 쏜다 → 사용자가 요청한 적 없는 '행복한 왕자' 원서 리더가 열리고 그 위에 이동 카드가 덮인다. 카드를 X로 닫으면 낯선 원서 본문 리더에 그대로 남아 '내가 뭘 누른 거지' 상태가 된다.
- **수정안**: Header의 lecture 항목 3곳을 services.js의 SERVICES lecture(run: window.location.assign('https://class-new.literstella.co.kr/classes'))로 통일 — 헤더가 자체 ITEMS를 중복 정의하지 말고 SERVICES를 import해 단일 소스화.

### 14. [medium] ?room= 빈 값이 1강으로 강제 폴백 → OT를 건너뜀. 같은 파일의 '강의실 입장' CTA(hasOt?0:1)·시트 기본값(OT 우선)과 어긋나고, 카드가 약속한 '듣던 위치 그대로'도 깨짐
- **파일**: `E:/LiterStella Project/LiterStella-DEV/07-class/src/components/ClassDetail.jsx:131`
- **관점**: ?room= 딥링크 왕복(챌린지→클래스) 정확성
- **재현**: 챌린지에서 특정 강 지정 없이(=대다수 경로) 강독 시트를 열면 StellaLectureSheet.jsx:143이 props.initialEp=null로 ClassOnlyCard를 띄우고, 120행이 dest를 `${classUrl}?room=`(빈 값)으로 조립한다. 클래스 앱은 131행에서 ep===''를 1로 폴백해 open-reader{ep:1}을 보내고, StellaLectureSheet.jsx:270-273의 pinned=1이 되어 **1강으로 고정**된다. 그런데 initialEp가 없을 때의 정상 기본값은 'OT 있으면 OT(0)'(273행: j?.ot ? 0 : ...)이고, 같은 ClassDetail 181행 CTA도 enterRoom(hasOt ? 0 : 1)로 OT부터 들어간다. 즉 키다리(157)·개츠비(64317)처럼 OT가 있고 'OT + 1~5강 무료'로 광고하는 코스에서, 챌린지에서 넘어온 사용자만 강좌 소개 회차인 OT(운영자 2026-07-15 결정: 첫인상=OT, '계속 볼지'를 여기서 결정)를 통째로 건너뛰고 1강에 떨어진다. 또 ClassOnlyCard가 '듣던 위치도 그대로예요'(129행)라고 약속하지만 실제로는 이어보기 위치를 무시하고 1강에 핀 고정된다. (ep=0 명시 왕복은 정상: '0'≠'' → Number('0')=0 → Number.isInteger(0) → pinned=0 → O
- **수정안**: 빈 room은 '지정 없음'이므로 ep를 아예 넘기지 말 것 — 131행을 `const n = Number(ep); enterRoom(ep !== '' && Number.isInteger(n) ? n : undefined);`로 바꾸면 enterRoom(124행)이 ep 키를 생략하고 시트가 스스로 OT/이어보기를 고른다(하드코딩 1 제거). 발신 측도 같이 정리: StellaLectureSheet.jsx:120을 `const dest = initialEp == null ? meta.classUrl : `${meta.classUrl}?room=${initialEp}`;`로 바꿔 빈 파라미터 자체를 만들지 않는다(같은 파일 692행의 `${b.classUrl}?room=` 하드코딩도 동일 — 현재는 4개 코스 전부 classUrl 보유라 워크벤치가 챌린지에서 안 뜨므로 비활성 경로지만, 코스 하나라도 classUrl이 빠지면 즉시 같은 버그가 살아난다).

### 15. [medium] 질문 작성자 닉네임을 이메일 앞부분(email.split('@')[0])으로 강제 — 공개 목록에 이메일 로컬파트가 그대로 노출되는 PII 문제
- **파일**: `E:/LiterStella Project/LiterStella-DEV/07-class/src/components/reader/ClassQnA.jsx:39`
- **관점**: ClassQnA(강의별 질문하기) 정합성·안전성
- **재현**: submit()이 `p_nickname: email.split('@')[0]`을 그대로 보낸다. 사용자에게 닉네임 입력칸도, 선택지도 없다. kim.younghee1987@gmail.com 수강생이 질문을 남기면 공개 질문 목록(88행 `{q.nickname || '수강생'}`)에 'kim.younghee1987'이 표시되고, public_class_questions는 anon도 조회하는 공개 RPC이므로 비로그인 방문자에게도 보인다. 이메일 로컬파트는 실명·생년이 섞이는 경우가 많고, 같은 값으로 다른 서비스 계정을 추정당할 수 있다. 게다가 본인 질문을 수정·삭제하는 UI가 전혀 없어 한 번 등록하면 되돌릴 수 없다. 같은 레포의 ClassReviews.jsx:117은 `nick || (email ? email.split('@')[0] : '수강생')`로 사용자가 입력한 닉네임을 우선하는데, ClassQnA만 입력칸 없이 이메일 파생값을 무조건 쓴다.
- **수정안**: ① ClassQnA에 닉네임 입력칸(기본값=users.nickname, 미로그인/미설정 시 '수강생')을 추가하고 `p_nickname`에 그 값을 보낸다. nickname이 프롭으로 안 닿는다면 GlobalTools(App.jsx:171 `reader={{ email }}`) → ReaderView(99행) → StellaLectureSheet → ClassQnA로 nickname을 함께 배선한다. ② 최소 조치라도 폴백을 `email.split('@')[0]` 대신 '수강생'으로 바꾸고, 서버 RPC 쪽에서도 class_reviews와 동일하게 email은 auth.jwt()로 서버가 귀속(반환값에서 제외)하도록 한다. ③ 본인 질문 삭제 RPC(작성자 email 일치 검증)도 함께 설계.

### 18. [medium] 투어(?tour=1) '스텔라 강독' 타일이 무료 체험 대신 타 도메인 이동 카드를 띄워 비회원 획득 퍼널이 끊김
- **파일**: `E:/LiterStella Project/LiterStella-DEV/02-challenge/wide-ux-wt/src/components/TourView.jsx:149`
- **관점**: 회귀(일원화가 기존 기능을 깨뜨렸는지)
- **재현**: 공유 링크로 처음 들어온 비회원(비로그인)이 투어에서 '스텔라 강독 — 삽화·낭독·해설까지 무료 / 함께 읽어보기'(TourView.jsx:46) 타일을 누른다 → run()이 setDemo('lecture') → TourView.jsx:149 `<ReaderView open openBook={902} autoStella .../>` → ReaderView.jsx:228 autoStella가 setStellaOpen(true) → StellaLectureSheet.jsx:143에서 happyprince(902)의 classUrl 때문에 ClassOnlyCard 반환. 결과: 무료 체험 대신 '이 강독 클래스는 리터스텔라 클래스 강의실에서 진행돼요 / 로그인은 그대로 이어지고, 듣던 위치도 그대로예요'라는 카드가 뜬다. 비로그인 첫 방문자에게 '이어진다'는 문구는 무의미하고, '클래스 강의실로 이동'을 누르면 투어를 이탈해 class-new 도메인으로 튕겨나간다. 행복한 왕자는 tierLabel='무료'(stellaLectures.js:30)라 유료 게이트도 아닌데 체험 자체가 사라졌다.
- **수정안**: 투어는 챌린지 잔류 표면이므로 강독 타일을 (a) 워크벤치 예외 허용 — StellaLectureSheet 래퍼에 `allowWorkbench` prop을 추가해 TourView에서만 `<ReaderView ... stellaAllowWorkbench />`로 전달하거나, (b) 타일을 '스토리 극장'(무료·챌린지 잔류)으로 대체하고 강독 타일은 cta를 '클래스에서 보기'로 바꿔 카드가 아니라 classUrl 새 탭으로 직행시킨다. 최소한 FEATURES[lecture].desc의 '무료' 약속과 실제 동작을 일치시킬 것.

### 20. [medium] 챌린지 ClassPage의 수강 인증 완료·'강의실 가기'·무료 맛보기 버튼이 전부 이동 카드로 막다른 길이 됨
- **파일**: `E:/LiterStella Project/LiterStella-DEV/02-challenge/wide-ux-wt/src/components/ClassPage.jsx:85`
- **관점**: 회귀(일원화가 기존 기능을 깨뜨렸는지)
- **재현**: 헤더 '🎓 원서 강독 클래스'(Header.jsx:87) 또는 쿠폰 배너(ClassCoupon.jsx:63)로 챌린지 ClassPage(?class=kidari)를 연 키다리 수강생이, ClassUnlockGate에서 OTP 6자리를 받아 이메일 인증을 끝낸다 → ClassPage.jsx:85 onUnlocked가 open-reader{g:157, stella:true} 발행 → ClassOnlyCard. 즉 '인증 성공 시 강의실로'(ClassPage.jsx:82 주석)라는 약속 대신 '다른 사이트로 가세요' 카드가 뜬다. 같은 증상이 ClassPage.jsx:78('강의실 가기 — 이어 듣기', 이미 수강생 확인된 사용자), :160('OT · 1~5강 강독 듣기 [무료]'), :227/:230(오즈·행복한왕자 맛보기)에서도 발생한다. 게다가 taste()는 ClassPage를 먼저 close()하므로(:132) 사용자가 카드를 닫으면 판매 페이지도 사라지고 맨 리더 화면에 남는다.
- **수정안**: ClassPage의 강의실 진입 버튼들을 open-reader 발행 대신 classUrl 직접 이동으로 바꾼다: `stellaBookFor(G).classUrl` + (있으면) `?room=`. onUnlocked도 `window.location.assign(classUrl)`로. 카드를 한 번 더 보여주는 이중 홉을 없애는 것이 요지.

### 21. [medium] 클래스 앱 open-class 핸들러가 /classes/kidari를 하드코딩해 개츠비·오즈 학습자를 다른 강좌 랜딩으로 튕겨냄
- **파일**: `E:/LiterStella Project/LiterStella-DEV/07-class/src/App.jsx:129`
- **관점**: 회귀(일원화가 기존 기능을 깨뜨렸는지)
- **재현**: 클래스 앱에서 개츠비 강독 6강을 열려다 잠금 화면을 만난 사용자가 '아직 수강 전이에요 · 강독 클래스 보기'(StellaLectureSheet.jsx:615)를 누른다 → open-class 발행 → App.jsx:129 onClass가 close-global-overlays로 리더·강독 오버레이를 전부 닫고 navigate('/classes/kidari')로 이동. 개츠비를 보려던 사용자가 키다리 아저씨 판매 페이지에 도착하고, 듣던 강의 문맥은 사라진다. 오즈·행복한왕자도 동일. 클래스 앱은 /classes/:id 라우트(App.jsx:160)와 4개 코스 META(ClassDetail.jsx:57~69)를 이미 갖고 있어 올바른 목적지가 존재하는데도 쓰이지 않는다. 강의 노트 폴백 버튼(StellaLectureSheet.jsx:73)도 같은 경로다.
- **수정안**: open-class 이벤트에 코스 식별자를 실어 보낸다: 발행측 StellaLectureSheet.jsx:73/:615를 `new CustomEvent('open-class', { detail: { course: stellaBookFor(g)?.gateBook || stellaBookFor(g)?.id } })`로, 수신측 App.jsx:129를 `const onClass = (e) => { ...; navigate(`/classes/${e?.detail?.course || 'kidari'}`); }`로 수정. 챌린지 ClassPage(kidari 전용)는 detail 무시라 무해하다.

### 24. [low] 강의를 이동해도 작성 중인 질문 폼이 초기화되지 않아, 3강에서 쓰던 질문이 4강 스레드에 등록됨
- **파일**: `E:/LiterStella Project/LiterStella-DEV/07-class/src/components/reader/ClassQnA.jsx:32`
- **관점**: ClassQnA(강의별 질문하기) 정합성·안전성
- **재현**: reload()는 bookCode/lectureNo 변경 시 목록만 다시 불러오고(32~33행), writeOpen·body·msg·replyFor·replyText·showAll은 그대로 남는다. 재현: 수강생이 3강 하단에서 '✏️ 질문 쓰기'를 눌러 긴 질문을 타이핑 → (폼을 열어둔 채) 플레이어 상단 ▶ 다음 강 버튼이나 목차로 4강 이동(StellaLectureSheet.jsx:716 setSel) → 화면에는 방금 쓰던 텍스트가 그대로 있어 그대로 '질문 등록'을 누름 → submit이 최신 프롭인 lectureNo=4로 전송되어 3강 질문이 4강 스레드에 박힌다(등록 후 수정·삭제 UI 없음 → 복구 불가). 부수적으로 등록 성공 메시지 '질문이 등록됐어요…'(msg)도 강의를 바꿔도 계속 따라 붙어, 다음 강에서 방금 등록한 것처럼 보인다. 운영자 쪽도 replyFor/replyText가 남아 다른 강 답변창에 이전 텍스트가 잔류한다.
- **수정안**: reload를 감싸는 useEffect에서 컨텍스트 변경 시 폼 상태를 리셋한다: `useEffect(() => { setWriteOpen(false); setBody(''); setMsg(''); setReplyFor(null); setReplyText(''); setShowAll(false); reload(); }, [bookCode, lectureNo])`. body가 비어있지 않을 때 강의 이동으로 폼이 닫히면 '작성 중이던 질문은 3강에 저장되지 않았어요' 안내를 남기거나, submit 시점의 lectureNo를 폼을 연 시점 값으로 고정(ref로 캡처)해 의도한 강에 등록되게 한다.

### 25. [low] 질문 쓰기·더 보기 버튼 터치타깃이 40px(운영자 답변 버튼은 ~33px)로 DoD 48px 미달
- **파일**: `E:/LiterStella Project/LiterStella-DEV/07-class/src/components/reader/ClassQnA.jsx:65`
- **관점**: ClassQnA(강의별 질문하기) 정합성·안전성
- **재현**: ClassQnA가 유일하게 노출되는 환경이 모바일(!wide)인데, 헤더의 '✏️ 질문 쓰기/로그인하고 질문하기' 버튼(65행 minHeight:'40px')과 '질문 N개 더 보기' 버튼(109행 minHeight:'40px')이 프로젝트 DoD의 최소 48×48px에 미달한다. 운영자 답변 영역의 '취소'·'답변 저장'(100~101행)은 minHeight 지정 없이 padding 8px 12px + fontSize 12px라 실제 높이가 약 33px, '답변 달기' 텍스트 버튼(104행)은 fontSize 11.5px·padding 4px 0로 약 24px다. 폰으로 강의를 들으며 한 손으로 조작할 때 오탭이 잦고, 특히 답변 버튼들은 취소/저장이 6px 간격으로 붙어 있어 잘못 눌러 답변 작성이 날아갈 수 있다.
- **수정안**: 65행·109행 minHeight를 '48px'로 올리고, 100·101·104행 버튼에 minHeight:'44px'(가능하면 48px) + 버튼 사이 간격 ≥8px를 적용한다. 텍스트만 있는 '답변 달기'도 padding을 늘려 터치영역을 확보.

### 27. [low] GitHub 박제된 audio-gate 워커 사본이 stale — kidari 하드코딩 + 구식 CORS 화이트리스트(개츠비·클래스 앱 미지원)
- **파일**: `E:/LiterStella Project/workers/audiogate/src/index.js:10`
- **관점**: 개츠비 강독(g64317) 데이터·게이트 정합성
- **재현**: 박제 사본은 `PATH=/^\/lecture\/kidari\/(ot|\d{2})\.mp3$/`, `TPATH=/^\/transcript\/kidari\/…/`, `CORS_ALLOW={challenge.literstella.co.kr, literstella.co.kr, localhost, *.literstella-challenge.pages.dev}`로 고정돼 있다. 반면 배포 정본(E:\LiterStella_전사\audiogate\src\index.js:11·16·29)은 `BOOKS='(kidari|gatsby)'`, `.tr.json` 사이드카 허용, `*.literstella.co.kr` 패턴 CORS로 이미 확장돼 있다. workers/README.md가 '정본 수정 시 이 사본도 갱신할 것'이라 명시했는데 audiogate만 2026-07-17 이후 갱신되지 않았다(git log: audiogate 마지막 커밋 3524d4c, classgate는 9da538c로 갱신됨). 시나리오: 워커를 유실·롤백·재구성하면서 이 사본으로 배포하면 개츠비 전 강(OT 포함) 오디오·전사가 404, EN 사이드카(.tr.json) 404, 클래스 앱(class-new.literstella.co.kr)의 전사 fetch가 CORS 차단 → 개츠비 강독 전체가 죽는다.
- **수정안**: E:\LiterStella_전사\audiogate\src\index.js를 workers/audiogate/src/index.js로 복사 커밋(시크릿 없음 확인됨). 재발 방지로 배포 런북에 '워커 deploy 후 박제 동기화' 스텝 추가 또는 정본을 git 안으로 이전.

---

## 🎬 플레이어-UX 세션 몫 (남은 13건)

### 1. [high] ESC·뒤로가기를 누르면 카드가 아니라 리더 전체가 닫힌다 (useModal 미사용, DoD 닫기 4종 중 2종 누락)
- **파일**: `02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:119-138`
- **관점**: ClassOnlyCard(이동 카드) UX·접근성·DoD 준수
- **재현**: 챌린지 앱에서 개츠비(g=64317)를 리더로 읽던 사용자가 상단 🎓 '스텔라 강독' 버튼을 눌러 ClassOnlyCard를 연다. 카드는 useModal/useBackClose를 전혀 호출하지 않아 history를 push하지 않는다. 이 상태에서 ESC를 누르거나(데스크톱) 안드로이드 물리 뒤로가기를 누르면(모바일), useBackClose의 전역 stack 최상단은 ReaderView가 useModal(open && !minimized, onClose)로 밀어둔 '리더 닫기' 콜백(ReaderView.jsx:197)이므로 → 카드만 닫히는 게 아니라 리더 창 전체가 닫혀 읽던 화면에서 튕겨나간다. 카드를 열었다 ESC로 취소하려던 사용자는 매번 리더를 다시 열고 책·챕터를 다시 찾아야 한다. 추가로 포커스 이동/복귀가 없어(트리거였던 강독 버튼에 포커스가 남음) 키보드·스크린리더 사용자는 Tab을 누르면 오버레이 뒤 리더 본문 컨트롤로 포커스가 새고, role="dialog"만 있고 aria-modal이 없어 배경 콘텐츠가 계속 낭독된다.
- **수정안**: ClassOnlyCard 안에서 `const { dialogProps, backdropProps } = useModal(true, onClose);`를 호출하고, 배경 div에 `{...backdropProps}`(현재의 onClick={onClose} 대체), 카드 div에 `{...dialogProps}`(role/aria-modal/tabIndex/포커스 타깃 자동)를 스프레드한다. ReaderView가 이미 자체 useModal 레이어를 갖고 있어도 useBackClose 스택이 LIFO라 중첩 안전하다. aria-label은 dialogProps를 받는 카드 div로 옮긴다(현재는 배경 div에 붙어 다이얼로그 경계가 오버레이 전체로 잡힘).

### 6. [high] 잠금 해제(OTP 인증·재로그인) 후에도 전사(대본·자막)가 세션 내내 빈 채로 남는다 — 실패 결과를 영구 캐시
- **파일**: `02-challenge/wide-ux-wt/src/lib/stellaLectures.js:91 (동일 사본 07-class/src/lib/stellaLectures.js:91)`
- **관점**: 개츠비 강독(g64317) 데이터·게이트 정합성
- **재현**: 개츠비 수강생이 클래스 앱에서 6강을 연다 → 아직 OTP 미인증이라 mintLectureToken이 403 → loadTranscript가 `tcache.set('gatsby-6', null)`로 **null을 캐시**한다. 그 자리에서 ClassUnlockGate로 OTP 인증을 마치면 onUnlocked→tryMint로 오디오는 즉시 재생되지만, 전사 로딩 useEffect는 deps가 [g, sel]이라 재실행되지 않고, 재실행되더라도 tcache에 null이 박혀 있어 네트워크를 다시 타지 않는다. 결과: '대본' 탭은 계속 "대본이 아직 없어요", 자막 오버레이·전사 하이라이트·필사 담기·스크린리더 낭독이 전부 죽은 상태로 남는다. 다른 강에 갔다 돌아와도 동일(캐시 히트). 새로고침해야만 복구된다. 개츠비는 transcriptsAllGate=true + introKo/insightKo/textEn이 전부 없어(gatsby.json 확인: introKo 0건·textEn 0건) 전사가 사실상 유일한 학습 자산이라 타격이 가장 크다. needLogin→재로그인(onAuthStateChange 자동 re-mint) 경로도 같은 증상.
- **수정안**: 실패(needLogin·locked·!res.ok·catch)는 캐시하지 말고 그대로 return null (성공 결과만 tcache.set). 추가로 stellaLectures.js에 `export function clearTranscriptCache(){ tcache.clear(); }`를 두고 StellaLectureSheet의 onUnlocked(379행)와 supabase onAuthStateChange 핸들러(369행)에서 호출한 뒤 setTranscript(null)+재로드를 트리거(예: transcript useEffect에 gate를 deps로 추가).

### 8. [medium] ?room= 빈 파라미터로 이동해 클래스 앱이 항상 '1강'을 강제로 연다 — 카드 문구('듣던 위치도 그대로')와 실제 동작이 반대
- **파일**: `02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:120`
- **관점**: ClassOnlyCard(이동 카드) UX·접근성·DoD 준수
- **재현**: initialEp(=ReaderView의 stellaEp)는 특정 강 딥링크로 들어온 경우가 아니면 null이다. 이때 dest = `${meta.classUrl}?room=`(값 없는 파라미터)로 만들어지고, a href 클릭 → 클래스 앱 ClassDetail.jsx:129-133이 `p.has('room')`을 true로 판정한 뒤 `enterRoom(ep === '' ? 1 : Number(ep))` → ep=1을 강제한다. 이 값은 StellaLectureSheet.jsx:270의 pinned으로 그대로 들어가 sel=1로 고정되고, OT가 있는 코스(키다리·개츠비)의 기본 진입(OT)조차 덮어쓴다. 결과: 개츠비 37강까지 듣던 수강생이 챌린지 리더에서 카드를 눌러 이동하면 매번 1강으로 떨어진다. 강 단위 이어듣기 로직은 코드에 없고(resumeAt은 한 강 안의 재생 위치뿐) 카드 문구는 "듣던 위치도 그대로예요"라고 약속하므로 사용자는 버그로 인식한다. 같은 패턴이 StellaLectureSheet.jsx:692(원서 메뉴에서 window.location.href = `${b.classUrl}?room=`)에도 있다.
- **수정안**: 빈 값이면 파라미터 자체를 붙이지 않는다: `const dest = meta.classUrl + (initialEp == null ? '' : `?room=${initialEp}`);` (692번 줄도 `?room=` 제거). 동시에 방어적으로 ClassDetail.jsx:131을 `const n = Number(ep); if (Number.isInteger(n) && ep !== '') enterRoom(n);`처럼 고쳐 빈 room을 무시하고 기본 진입(OT/추정 강)으로 떨어지게 한다. 문구 그대로의 '이어듣기'를 지키려면 강 번호를 localStorage(예: ls_lec_last_{id})에 저장해 room 미지정 시 복원하는 배선이 별도로 필요하다.

### 9. [medium] ?room= 빈 파라미터 → 클래스 앱이 항상 1강으로 강제 진입(OT 건너뜀 + '듣던 위치 그대로' 카피 위배)
- **파일**: `02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:120`
- **관점**: 챌린지앱 → 강독 진입 경로 일원화 정합성 (관점 2/6)
- **재현**: ep 없이 열리는 모든 경로(헤더 '스텔라 강독', ClassPage 'OT·1~5강 듣기', 스토리 극장 CTA, 투어)에서 initialEp가 null이라 dest가 `.../classes/kidari?room=`(값 없음)이 된다. 클래스 앱 ClassDetail.jsx:131이 `ep === '' ? 1 : Number(ep)`로 받아 무조건 1강 입장 → dll.json·gatsby.json 모두 OT가 존재하는데(클래스 앱 자체 '강의실 입장' 버튼은 hasOt면 0강부터) 챌린지 경유 사용자만 OT를 영영 못 본다. 동시에 카드 본문 '듣던 위치도 그대로예요'(:129)와 달리 매번 1강으로 리셋된다(마지막 수강 강 번호를 저장하는 키가 챌린지·클래스 어디에도 없음 — cloudSync는 ls_audio_pos_* 재생초만 동기화).
- **수정안**: initialEp가 null이면 room 파라미터를 아예 붙이지 말 것(dest = meta.classUrl) → 클래스 앱 랜딩에서 OT부터 정상 진입. 또는 ClassDetail이 빈 room을 hasOt?0:1로 해석하도록 수정. 카피는 '마지막 재생 위치는 이어져요'처럼 실제 구현(오디오 위치 동기화) 범위로 축소.

### 13. [medium] 이동 카드가 useModal 미사용 — ESC·뒤로가기가 카드가 아니라 리더 전체를 닫고 포커스 관리도 없음
- **파일**: `02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:119-138`
- **관점**: 챌린지앱 → 강독 진입 경로 일원화 정합성 (관점 2/6)
- **재현**: 원서를 읽던 회원이 상단 ✦를 눌러 강독을 확인하려다 마음을 바꿔 ESC(또는 안드로이드 뒤로가기)를 누른다. ClassOnlyCard는 자체 ESC/back 핸들러가 없고(형제 시트 SentenceExamples·NewsletterModal은 useModal 사용), 상위 ReaderView의 useModal(:197)이 그 키를 받아 리더 전체를 닫아버린다 → 읽던 화면이 통째로 사라진다. 포커스도 카드로 이동하지 않아 스크린리더 사용자는 카드 존재를 인지하기 어렵다(프로젝트 DoD 모달 닫기 4종·포커스 규칙 위반).
- **수정안**: ClassOnlyCard에서 const {dialogProps,backdropProps}=useModal(true,onClose)를 적용해 배경 div에 backdropProps, 카드 div에 dialogProps 스프레드(ReaderView useModal과 중첩돼도 useBackClose가 LIFO 처리).

### 16. [medium] 개츠비 OT의 STUDY 탭이 '콘텐츠 준비 중' 플레이스홀더로 표시된다 — OT 전용 정직 안내 분기가 개츠비에서 도달 불가(죽은 코드)
- **파일**: `02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:317`
- **관점**: 개츠비 강독(g64317) 데이터·게이트 정합성
- **재현**: `const draft = isOt ? !!introKo : (cur?.status==='draft' || cur?.nodes?.length>0 || ...)` — 비-OT는 커밋 0f6c61a에서 '콘텐츠 보유 기준'으로 고쳤지만 **OT 분기는 여전히 introKo에만 의존**한다. gatsby.json의 ot는 키가 {title,durationSec,audioUrl,videoUrl}뿐이라 introKo가 없어 draft=false → LectureNotes가 `!draft` 분기(65~76행)로 떨어진다. 그 결과 개츠비 OT를 연 사용자는 STUDY 탭에서 "이 강의(오리엔테이션, p.–)의 해설이 들어올 자리예요" / "③ 핵심 짚기 · ④ 인물·주제 — 원본 강의를 정리해 자동으로 채워집니다" 같은 미완성 문구와 함께 '🎓 지금은 강독 클래스에서 이 강의 보기' 버튼(=이미 클래스 앱인데 키다리로 나감, 위 항목)을 본다. 정작 OT용으로 만들어 둔 정직한 안내(78~84행 "OT는 강좌를 여는 소개 회차예요…")는 draft=false 때문에 개츠비에서 절대 실행되지 않는다. dll(키다리) OT는 introKo가 있어 정상이라 개츠비에서만 재현된다.
- **수정안**: OT는 콘텐츠 유무와 무관하게 OT 분기로 보낸다: `const draft = isOt ? true : (...)` (LectureNotes의 `if (!cur)` 분기가 introKo 유무를 이미 옵셔널로 처리 — `{introKo && <Step .../>}`). 최소 수정으로는 `isOt ? (!!introKo || !!data?.ot?.audioUrl) : ...`.

### 17. [medium] 개츠비 1~39강 STUDY 탭에 '① 도입 · 해설' 헤더만 뜨고 본문이 비어 있다
- **파일**: `02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:88`
- **관점**: 개츠비 강독(g64317) 데이터·게이트 정합성
- **재현**: gatsby.json의 lectures[]는 no·title·durationSec·status·audioUrl·videoUrl·anchorEn·nodes만 갖고 introKo는 39편 전부 없다(집계 확인: introKo 0/39, insightKo 0/39, sentenceEn 0/39). LectureNotes는 nodes가 있으면 draft=true로 본문을 렌더하는데, 1행 `<Step no={1} label="도입 · 해설"><Paras text={introKo}/></Step>`의 Paras는 undefined→빈 배열이라 아무것도 그리지 않는다. 사용자는 개츠비 아무 강이나 STUDY 탭을 열면 금색 '① 도입 · 해설' 헤더 아래가 통째로 빈 상태 → 바로 '③ 핵심 짚기'가 이어지는 화면(고아 헤더)을 본다. 하단 '④ 인물 · 주제'도 insightKo가 없어 "원본 강의를 정리해 자동으로 채워집니다" 플레이스홀더로 남는다.
- **수정안**: LectureNotes에서 Step 1을 조건부로: `{((en && curEn?.intro) || introKo) && <Step no={1} …>}`. Step 4도 동일하게 콘텐츠 없으면 슬롯 문구 대신 섹션 자체를 숨기거나(개츠비처럼 설계상 없는 코스), 코스 단위 플래그로 '이 코스는 대본 중심' 안내 1줄로 대체.

### 19. [medium] ClassOnlyCard가 항상 ?room= 을 붙여 클래스 앱이 1강을 고정 → OT 우선 진입·'지금 읽는 챕터의 강의' 자동 매칭이 사라짐
- **파일**: `E:/LiterStella Project/LiterStella-DEV/02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:120`
- **관점**: 회귀(일원화가 기존 기능을 깨뜨렸는지)
- **재현**: 챌린지 리더에서 개츠비(g=64317) 7챕터를 읽던 사용자가 '✦ 함께 읽기'를 누른다. ReaderView.jsx:1110은 initialEp={stellaEp}=null을 넘기므로 ClassOnlyCard의 dest = `https://class-new.literstella.co.kr/classes/gatsby?room=` (빈 값). 클래스 앱 ClassDetail.jsx:131 `enterRoom(ep === '' || ep == null ? 1 : Number(ep))`가 빈 값을 1로 치환 → open-reader{ep:1} → StellaLectureSheet.jsx:270 pinned=1 → :273 setSel(1). 결과 두 가지 회귀: ① 일원화 전에는 OT가 있는 코스는 setSel(0)으로 OT부터 시작(운영자 2026-07-15 '첫인상=OT' 결정)했는데 이제 OT를 건너뛰고 1강으로 떨어진다. ② 읽던 챕터 본문으로 강의를 추정하는 guessLectureForChapter(stellaLectures.js:145, ✦ 버튼의 존재 이유)가 pinned=1에 덮여 완전히 무력화된다 — 7챕터를 읽다 눌러도 1강이 열린다.
- **수정안**: StellaLectureSheet.jsx:120을 `const dest = initialEp == null ? meta.classUrl : `${meta.classUrl}?room=${initialEp}`;` 로 바꿔 고정할 강이 없으면 room 파라미터 자체를 생략한다. 동시에 ClassDetail.jsx:131의 빈 문자열 → 1 치환도 제거해(`const n = Number(ep); enterRoom(Number.isInteger(n) ? n : undefined)`) '고정 없음'이 OT/챕터 매칭 기본값으로 흐르게 한다.

### 22. [low] wide 값을 무시하고 sheetShell(false)로 고정 — PC에서 카드가 화면 전체 폭 바텀시트로 뜨고 maxW:440 옵션이 죽어 있다
- **파일**: `02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:121`
- **관점**: ClassOnlyCard(이동 카드) UX·접근성·DoD 준수
- **재현**: ReaderView.jsx:1108은 `<StellaLectureSheet wide={wide} ... />`로 wide를 넘기지만 래퍼(143줄)는 ClassOnlyCard에 wide를 전달하지 않고, ClassOnlyCard는 `sheetShell(false, { maxW: 440 })`으로 하드코딩한다. useWide.js:16-35에서 maxWidth는 `wide ? maxW : 'none'`이므로 maxW:440은 절대 적용되지 않고, alignItems도 항상 'flex-end', borderRadius도 '18px 18px 0 0', 배경 padding 0이 된다. 데스크톱(1920px)에서 리더를 열고 강독 버튼을 누르면, 같은 리더의 다른 시트(TocSheet·BookPicker는 wide를 전달)와 달리 이 카드만 화면 하단에 가로 전체를 차지하는 띠로 떠서, 92px 표지와 한 줄 문구가 초대형 여백 가운데 놓인 어색한 레이아웃이 된다.
- **수정안**: 래퍼에서 wide를 넘기고(`<ClassOnlyCard meta={m} wide={props.wide} onClose={...} initialEp={...} />`) ClassOnlyCard에서 `sheetShell(wide, { maxW: 440 })`를 호출한다. 그러면 PC는 440px 중앙 카드, 모바일은 기존 바텀시트로 정상 분기된다.

### 23. [low] 이동 카드가 wide를 무시해 PC에서 440px 카드가 아니라 전폭 하단 시트로 렌더됨
- **파일**: `02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:121,143`
- **관점**: 챌린지앱 → 강독 진입 경로 일원화 정합성 (관점 2/6)
- **재현**: PC(≥1024px)에서 리더를 열고 ✦를 누르면 ClassOnlyCard가 sheetShell(false, {maxW:440})로 그려진다. useWide.js:16의 sheetShell은 wide=false일 때 maxWidth를 'none'으로, alignItems를 'flex-end'로 잡으므로 maxW:440은 완전히 무시되고 카드가 리더 하단에 전폭으로 붙는다(표지·버튼이 넓은 화면에 흩어짐). 래퍼(:143)가 props.wide를 ClassOnlyCard에 전달하지 않는 것이 원인 — 같은 파일의 워크벤치는 wide를 정상 사용한다.
- **수정안**: 래퍼에서 wide를 넘기고(<ClassOnlyCard wide={props.wide} …/>) sheetShell(wide, {maxW:440}) 사용.

### 26. [low] 개츠비 VOD 하단에 의미 없는 '지금 읽는 페이지(p.– – –) = 이 강의' 안내가 항상 노출
- **파일**: `02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:659`
- **관점**: 개츠비 강독(g64317) 데이터·게이트 정합성
- **재현**: vodPageNote는 `p.{cur?.pageStart ?? '–'}–{cur?.pageEnd ?? '–'}`를 무조건 렌더한다. 개츠비 39편에는 pageStart/pageEnd가 하나도 없어(집계 0/39) 사용자는 강독 VOD를 볼 때마다 데스크톱(824행)·모바일(888행) 양쪽에서 "지금 읽는 페이지(p.–––) = 이 강의. 페이지↔강의 매핑은 수강 데이터 기반 자동."이라는 빈 값 + 사실과 다른 설명(개츠비는 페이지 매핑 데이터가 없음)을 본다.
- **수정안**: `{mode === 'vod' && cur?.pageStart && vodPageNote}` 로 가드(두 호출부 824·888행). 뒤의 '커스텀 Cloudflare Stream 플레이어' 문구는 사용자에게 무의미하므로 함께 정리 권장.

### 28. [low] ClassOnlyCard가 wide prop을 넘기지 않아 PC에서 440px 카드가 아닌 전체폭 하단 시트로 렌더됨
- **파일**: `E:/LiterStella Project/LiterStella-DEV/02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:121`
- **관점**: 회귀(일원화가 기존 기능을 깨뜨렸는지)
- **재현**: 데스크톱(≥1024px)에서 챌린지 리더를 열고 '✦ 함께 읽기'를 누른다. StellaLectureSheet.jsx:143이 props.wide를 ClassOnlyCard에 전달하지 않고, :121이 `sheetShell(false, { maxW: 440 })`로 wide=false를 하드코딩한다. useWide.js:16의 sheetShell은 wide=false일 때 sheet.maxWidth='none'(maxW:440 무시), alignItems='flex-end', borderRadius='18px 18px 0 0'을 준다 → 안내 카드가 리더 오버레이 하단에 전체 너비로 눌어붙은 모바일 바텀시트 모양으로 뜬다. 표지·문구·CTA가 모두 중앙정렬(:124)이라 넓은 화면에서 좌우 여백만 크게 빈 채 어색하게 늘어난다. 같은 리더 안의 TocSheet·BookPicker는 wide를 정상 전달받아 가운데 모달로 뜨므로 이 카드만 튄다.
- **수정안**: StellaLectureSheet.jsx:143에서 `wide={props.wide}`를 함께 넘기고, ClassOnlyCard 시그니처를 `({ meta, onClose, initialEp, wide })`로 받아 :121을 `sheetShell(wide, { maxW: 440 })`으로 바꾼다.

### 29. [low] 챌린지 번들에 도달 불가능한 강독 워크벤치 전체와 hls.js가 남아 모든 페이지 로드에 사중(死重)이 됨
- **파일**: `E:/LiterStella Project/LiterStella-DEV/02-challenge/wide-ux-wt/src/components/reader/StellaLectureSheet.jsx:14`
- **관점**: 회귀(일원화가 기존 기능을 깨뜨렸는지)
- **재현**: MAP의 4개 코스가 전부 classUrl을 가지므로(stellaLectures.js:18~30) 챌린지에서 StellaWorkbench(:147~921, 약 780줄)는 어떤 경로로도 렌더되지 않는다. 그런데 StellaLectureSheet는 ReaderView.jsx:25가 정적 import하고, 같은 모듈이 StreamPlayer(:14) → hls.js(StreamPlayer.jsx:6), LectureOriginal(:19), LectureQuizReview(:21) → LectureQuiz, ClassQnA(:31)를 정적 import한다. 실제 빌드로 확인: dist/assets/index-5Rf5k8jW.js(3,773kB / gzip 1,052kB) 안에서 hls 내부 심볼 6건, 'manifest/video.m3u8'(StreamPlayer 전용), 'public_class_questions'(ClassQnA 전용) 문자열이 그대로 검출된다. node_modules/hls.js/dist/hls.min.js만 543kB(≈150kB gzip)로, 모바일 우선 사용자가 절대 실행하지 않을 코드를 매번 내려받는다. 스토리 극장이 필요로 하는 부분(StoryInline·TranscriptPanel·TracePanel·PodcastStage·DayNightToggle)과는 무관하게 분리 가능하다.
- **수정안**: StellaLectureSheet.jsx에서 StellaWorkbench 본문을 별도 파일(StellaWorkbench.jsx)로 분리하고 래퍼에서 `const StellaWorkbench = React.lazy(() => import('./StellaWorkbench'))` + Suspense로 감싼다. 그러면 classUrl 분기가 먼저 반환되는 챌린지에서는 해당 청크(hls.js·StreamPlayer·ClassQnA·LectureQuiz 포함)가 아예 요청되지 않고, 클래스 앱은 워크벤치 진입 시 1회 로드한다. 챌린지 쪽 강독 코드 삭제 예정(stellaLectures.js:23 주석)까지의 중간 조치로도 적절하다.

---

## 기각된 오탐 (10건 — 적대 검증에서 반증됨, 재보고 불필요)

1. 오즈·행복한왕자 코스는 표지 src가 빈 문자열이라 깨진 이미지가 뜬다
2. 같은 탭 이동이라 재생 중이던 듣기(TTS)·오디오와 리더 세션이 경고 없이 끊긴다
3. 클래스 판매 페이지의 핵심 무료 미끼 'OT · 1~5강 강독 듣기(무료)'가 재생 대신 이동 카드만 띄움
4. 스토리 극장(챌린지 잔류 표면)의 '이 원서, 강독으로 이어 듣기' CTA가 이동 카드로 끊김
5. 리더 책장 최상단 '✦ 함께 읽기 · 1~5강 무료' 칩이 챌린지에서는 실현되지 않는 무료 청취를 암시
6. 한 앱 안에서 '클래스' 목적지가 두 곳(class-new 신규 앱 vs class LiveKlass)으로 갈림
7. 운영자 답변 권한이 클라이언트 email 문자열 비교뿐 — 대응 서버 가드(is_ls_admin)가 레포에 존재하지 않아 답변 위조 가능성이 열려 있음
8. 개츠비 39강 제목이 전부 영어 원문 조각 — 목차·상단바·잠금화면에 문장 파편이 그대로 노출
9. gateBook 폴백이 'kidari'라 gate:'points' 코스(오즈·행복한왕자)가 키다리 수강 게이트에 물린다
10. 비로그인 무료 청취자는 도메인 이동 시 이어듣기 위치가 소실되는데 카드는 '듣던 위치도 그대로예요'라고 단언
