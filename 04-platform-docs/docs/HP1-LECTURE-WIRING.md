# HP1 강독 ~112강 → 원서 연결 · 설계 (정본)

> 확정 2026-07-11 (운영자: HP1 = 완독클럽 게이트 → **전체 공개**). 관련 [[access-tiers]] · TRANSCRIPT-SCHEMA.md · newsletter/BATCH-PRODUCTION-HANDOFF.md
> 이해 워크플로 wf_2de7749c 종합. **이 문서가 빌드/배선 정본.**

## 정책
- HP1(해리포터 1권) = **무료 전체 공개**(오즈처럼 리드 마그넷). 강독 강의 ~118개(공개 유튜브 재생목록 `PLARsitvDhfaKdd7XctJriviiskDgGXHxI`)를 원서(HP001)에 연결 + 진단앱 연결.
- **HP 이야기극장(AI 드라마)은 클럽 전용 유지**(이번 범위 아님, hp1 MAP `story:null`).

## 🔴 저작권 (kidari와 결정적 차이)
HP=1997 보호작. kidari(1912 PD)와 달리:
- **`textEn`(원문 연속 산문)·`anchorEn` 전면 금지** — hp1 lecture에 필드 자체 없음. 구텐베르크 전문 리더 불가(HP를 `GUTENBERG_ALLOW`/reader-links 화이트리스트에 **절대 미추가**).
- 영어 = **강의당 `sentenceEn` 1문장만**, 그 문장은 해당 강의 **전사에 verbatim substring**(빌드 assert). 조립·인접페이지 이어붙이기·전역 중복 금지(책 재구성 방지).
- 전사 사이드카 = **영어 낭독 세그먼트 제거한 한국어 해설 전용(redacted)** 만 공개(112강 누적 = 원문 재간행 위험). 영어 청취 대본은 유튜브 자체 CC.
- 영상 = **youtube-nocookie 임베드/링크만**(재호스팅·다운로드·Stream 이관 금지). 강사 공개 재생목록 그대로.
- 강사 IP = 서면계약 ✅(파트너, AI학습·스트리밍 허용 — 배치 핸드오프 기록).

## 데이터 파일 `02-challenge/stella-reader-wt/public/stella/hp1.json`
dll.json 미러 − (textEn·anchorEn·audioUrl). 최상위 신규: `videoProvider:'youtube'`, `playlistId`, `gateFrom:null`(완전공개), `classBook:null`.
lecture: `{no, title(한국어 서술·HP상표회피), chapter, pageStart, pageEnd, newsletterDays, youtubeId, introKo, sentenceEn, sentenceKo, insightKo, nodes[{target,category:'Vocabulary',definition}], status:'draft'}`.
빌더 `E:\LiterStella_전사\hp1_build.py`(현재 1~5강 프루프=`hp/vol1/hp1.proof.json`). 6강~ = 전사 추출 워크플로.

## 합성 g = 예약 대역 900000+ → HP1 = **900001**
구텐베르크 번호와 충돌 없음. `GUTENBERG_ALLOW`에 미추가 → book-text 프록시가 not_allowed 반환하는 상태를 '정상(lecture-only)'으로 취급.

## 연결 지점
| 앱 | 파일 | 변경 | 소유 |
|---|---|---|---|
| challenge | `public/stella/hp1.json` | 신규(빌더 산출) | 나 |
| challenge | `src/lib/stellaLectures.js` | MAP에 `900001:{id:'hp1',bookId:'HP001',ko:'해리포터와 마법사의 돌',course:'…',story:null}` | 나 |
| challenge | `src/lib/bookText.js` | `LECTURE_ONLY` 레지스트리 + `isLectureOnly(g)` export (900001) | 나 |
| challenge | `src/components/reader/ReaderView.jsx` | `isLectureOnly(g)`면 loadBook 스킵→'강독으로 만나요' 랜딩+시트 자동오픈 | 나 |
| challenge | `src/components/reader/StellaLectureSheet.jsx` | ① 게이트 데이터화(`data.gateFrom/classBook`, gateFrom:null=완전공개) ② 유튜브 iframe 분기(youtube-nocookie) ③ audioUrl 전무 시 pod 탭 숨김·기본 vod | 🔴 **플레이어 UX 세션 소유 — 협조 필요** |
| challenge | `StreamPlayer.jsx` | 무수정(유튜브는 시트의 별도 iframe으로) | (owned, 미변경) |
| diagnosis | `app.js` FREE_RESOURCES.harrypotter / HP 콘텐츠 배지 | 게이트 CTA → 공개 강독 딥링크 `challenge.literstella.co.kr/?read=900001` | 나 |
| diagnosis | `reader-links.js` | **무변경**(HP null 유지 = 전문 리더 버튼 미노출) | 나 |

## 리더가 전문 없이 안 깨지는 법
StellaLectureSheet는 이미 전문 의존 0(textEn·anchorEn·pageStart 렌더 전부 `&&` 가드). ReaderView만 `isLectureOnly`면 프록시 스킵+강독 랜딩으로 분기. `guessLectureForChapter`는 chapterText='' → null → 시트 sel=1 폴백(페이지 자동추종만 상실, 치명 아님).

## 빌드 플랜
1. 추출: transcripts index 2~119 순회(001=OT, 120=중복 스킵), day-map 조인(youtubeId·pages·chapter), 전사에서 sentenceEn(하드가드)·insightKo·nodes. Day 중복(영상 50개=2 Day) video_id dedup.
2. hp1.json + redacted 한국어 전사 산출.
3. stellaLectures MAP + bookText lecture-only.
4. 🔴 StellaLectureSheet(게이트 데이터화·유튜브 iframe·pod숨김) = 플레이어 세션.
5. ReaderView lecture-only 분기 + `?read=900001` 자가검증.
6. 진단앱 CTA 딥링크.
7. 저작권 감사(textEn/anchorEn 부재·sentenceEn≤1·dedup·전사 영어세그 부재).
8. 배포: challenge=git push, diagnosis=wrangler deploy.

## 🔴 운영자 결정
- 강의 단위 = 고유 영상 ~118(OT·중복 제외) 확정? (뉴스레터 100일과 다름 — 영상=강의)
- 영어: 강의당 1문장(안전) vs 뉴스레터처럼 다수 taught-quote — 118강 누적 공개라 1문장 권장. **+ 자동추출 sentenceEn은 whisper 전사 품질(간혹 불완전 영어), 출판 원문 아님**(내가 원문 재구성 금지).
- 전사 공개 = 한국어 해설 전용(redacted)만 확정?
- 진단앱 CTA = 공개 강독 딥링크로 완전 교체 vs 클래스 랜딩 병기?
