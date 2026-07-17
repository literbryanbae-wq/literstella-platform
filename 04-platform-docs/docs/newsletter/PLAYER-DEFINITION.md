# 커스텀 강독 플레이어 정의서 (Cloudflare Stream)
> 2026-07-10. 5축 검증(Stream역량·시각장애·청각장애·플레이어패리티·전사아키텍처) 종합.
> 🔴 실제 고객: **시각장애 2명·청각장애 1명** → 접근성 = 법적·WCAG 하드요건(정식 판매 전 필수 게이트).

## 0. 질문별 직답
| 기능 | 됨? | 방식 / 상태 |
|---|---|---|
| 스크린리더(시각장애) | 🔴 **지금 조작 불가 → 수정 필수** | 스크러버가 `div+onClick`(role=slider 아님)·live region 0·MediaSession 0. **가능**하나 P0 수정 필요 |
| 한/영 자막(청각장애) | ✅ **가능**(지금 0) | Whisper→WebVTT, **이중언어 자체 오버레이**. CF 자동생성은 트랙당 1언어라 혼재강의 부적합 → 우리 전사 업로드가 정답 |
| 배속 | ✅ **있음** | 0.75~2× (메뉴화 + 0.5× 추가 권장) |
| 해상도 | ✅ **가능**(미장착) | `hls.levels` 수동 메뉴 + `clientBandwidthHint` 데이터세이버 |
| DRM | 🟡 **서명 URL만** | 하드웨어 DRM(Widevine/FairPlay) **Stream 미지원 확정**. 접근제어이지 복제방지 아님 → **사업 결정** |
| 강의 요약 | ✅ **가능** | 전사→AI 3줄 TL;DR + 씬 챕터 타임코드(StreamPlayer chapters 배선 이미 있음) |
| Vimeo/YouTube 눈높이 | 🟡 **기본 견고, gap 있음** | 자막·화질메뉴·볼륨슬라이더(데드코드)·버퍼링·챕터목록 추가 필요 |

## 1. 핵심 아키텍처 — 전사(transcript) 하나 = 4개 뷰
```
강의 오디오 → WhisperX(강제정렬) → transcript[]  {start, end, lang:ko|en, kind:lecture|quote, text}
                                          │
        ┌───────────────┬───────────────┼───────────────┬────────────────┐
     자막(VTT)        가라오케 하이라이트    스크린리더 낭독      AI 요약(3줄+챕터)     챕터 점프
     🦻 청각장애        읽기 따라가기       👁 시각장애(lang 전환)   📝 전원            네비게이션
```
**시각장애·청각장애·요약은 별개 3기능이 아니라, 전사에 [타임코드 + 언어태그] 한 번 붙이는 단일 투자에서 전부 파생.** 원천 Whisper 전사는 이미 보유(clone corpus). 기획 정본(class-integration-plan)도 "하나의 강독 객체→4표면, 접근성=오디오 강독의 부산물"로 이미 확정.

## 2. 플레이어 정의 (무엇인가)
- **엔진:** Cloudflare Stream HLS(`customer-<code>.cloudflarestream.com/<uid>/manifest/video.m3u8`) via hls.js. (Vimeo 아님 — dll.json videoUrl의 Vimeo 잔재는 Stream uid로 이관)
- **접근성 1급(기본 내장, 옵션 아님):** 스크린리더 완전 조작(ARIA 슬라이더·live region·MediaSession) + 이중언어 자막 + 동기 전사 패널.
- **플레이어 컨트롤:** 재생·스크러버(버퍼+챕터+role=slider)·시간·배속(메뉴+0.5×)·볼륨 슬라이더·음소거·자막(CC)·화질·PiP·전체화면·⚙설정통합·버퍼링 스피너·HLS 자동복구·이어보기.
- **보호:** `requireSignedURLs` + 단기 서명토큰(수강인증 Worker 게이트 뒤) + `allowedOrigins`.
- **팟캐스트:** 같은 전사 구동(가라오케·MediaSession 잠금화면·이어듣기) = 시각장애 1급 채널.
- **요약:** 전사→AI 3줄 + 씬 챕터(타임코드).

## 3. 우선순위 로드맵
### P0 — 장애 고객 하드요건 (유료 정식판매 전 필수 게이트)
> ✅ **구현 완료 (2026-07-10, 커밋 `300ceca` · feat/stella-reader):** 항목 1~5 배선·프리뷰 검증(접근성 트리). StreamPlayer(role=slider·live region·이중언어 자막 오버레이+CC·볼륨·포커스링·키보드)·TranscriptPanel(가라오케·클릭seek·KO/EN·lang속성)·팟캐스트 MediaSession·loadTranscript+dll-1.json(키다리 1강 데모 30세그).
> 🔴 **남은 게이트(운영자 의존):** ⓐ dll.json videoUrl=Vimeo→**Cloudflare Stream uid 이관** + `STREAM_CUSTOMER_CODE`(현재 빈 placeholder) → 실제 영상 재생·자막 동기 라이브 검증 불가. ⓑ 전사=강사 IP → **Worker 수강인증 게이트**(현 public MVP). ⓒ 항목 6 = NVDA/VoiceOver/TalkBack 실기기 + 실고객 3인.
1. **WhisperX 타임코드 전사** — 라이브분(dll OT+1~5·oz 5강)부터. `transcript[]` 필드 + `scriptPipeline: whisper-pending→aligned`. 언어(ko/en) 세그먼트 태깅.
2. **자막 오버레이 + CC 버튼** — `wrapRef` 내부 절대배치 오버레이(전체화면 유지), VTT/transcript 파싱, 이중언어 토글(끄기/한국어/영어/양쪽), `::cue` 대비 4.5:1·배경박스·글자크기 조절, `c` 키, `aria-pressed`. (오버레이 자체엔 aria-live 금지=SR 이중낭독 방지)
3. **스크러버 → ARIA 슬라이더** — `role=slider`+`tabIndex`+`aria-valuenow/valuetext`(3분 12초)+←→↑↓ 조작 + 상태변화 `aria-live` 통보. 챕터 마커 `<button>`화. 버튼 aria 상태 반영(재생/일시정지·음소거 해제·현재 배속). 컨테이너 role+포커스 링 복원. 자동숨김은 키보드 포커스 시 유지.
4. **공용 TranscriptPanel** — 재생 동기 가라오케 하이라이트·클릭 seek·자동스크롤·KO/EN/양쪽·≥16px. **영상 탭 + 팟캐스트 탭 공유**(1.2.1 대본 + 1.2.2 자막 동시 충족).
5. **팟캐스트 업그레이드** — 맨 `<audio>`→ TranscriptPanel + MediaSession(잠금화면/백그라운드/헤드셋) + 이어듣기.
6. **검증** — NVDA/VoiceOver/TalkBack 실제 스크린리더 + 키보드 온리 + **실고객 3인 시나리오**.

### P1 — Vimeo/YouTube 눈높이
볼륨 슬라이더(현 데드코드 배선) · 화질 메뉴(hls.levels) · 버퍼링 스피너(waiting) · 배속 드롭다운+0.5× · 챕터 목록/현재챕터명 · HLS fatal 자동복구 · 키보드 확장(j/l·↑↓·c·?) · **⚙설정 1개로 화질·배속·자막 통합**(컨트롤바 과밀 방지).

### P2 — 있으면 좋음
썸네일 스크럽 프리뷰(Stream storyboard) · 인앱 미니플레이어(도킹) · 다음 강의 자동재생.

### 🔴 사업 결정 (코드로 해결 불가)
**하드웨어 DRM 부재.** 서명 URL+allowedOrigins로 캐주얼 공유·핫링크는 막지만 작정한 다운로드/화면녹화는 못 막음. 강의 플랫폼 업계 표준은 서명 URL(대부분 하드웨어 DRM 미사용) → 이 수준이면 충분한지 운영자 판단. 하드웨어 DRM이 필수면 Cloudflare Stream 불가 → Mux/AWS(SPEKE) 등 별도 검토.

### IP 게이트
전사=강사 IP → Worker 수강인증 게이트 뒤 이전(현 public MVP). 단 자막·스크린리더 낭독은 접근권 있는 콘텐츠 내에서 **무료**(별도 페이월 금지=WCAG/법). 강사 IP 서면합의에 "전사 2차활용(AI·자막·접근성)" 범위 명시 선행.
