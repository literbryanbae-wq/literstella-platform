# 퀄리티 평가단 전용 접수 — 공개 전 개발 인수

2026-09-05. 올인원 학습실의 참여·의견 수렴 기반이며 기존 선물 계정 행사, 구매 전환, 포인트 지급과 분리한다.

사용자 확정: **기존 SSO 로그인 + 올인원 8종 전체 실소장 회원만 새 신청 가능**. 7종 선택 모드는 폐기했다. 기존 접수증 조회·재시도·철회는 자격 재검사 때문에 막지 않는다.

## 구현과 미적용의 경계

- `src/growth-panel-service.mjs`: 기존 Worker의 `requireUser` / `sbFetch` / `json`을 주입받는 실행 가능한 전용 라우트 모듈.
- `growth-panel-service-test.mjs`: 네트워크를 금지한 Node 요청/응답 테스트. 초기 18그룹에서 철회 응답 검증·본문 timeout 취소·만료/동의 증빙 회귀를 보강했다. SQL 검사는 문자열 계약 검사이며 실제 PostgreSQL 실행이 아니다.
- `schema.draft.sql`: **미적용 설계 초안**, 마이그레이션 파일이 아니다. DB/권한/캠페인/스케줄을 생성하거나 실행하지 않았다. 캠페인 행을 seed하지 않아 설치만으로 모집이 열리지 않는다.
- `ROUTE-WIRING.md`: 기존 `src/index.js`는 인증·메일 등 타 작업의 dirty 변경이 있어 직접 수정하지 않았다. 최신 승인된 기준에서 두 삽입만 통합한다. 전체 현재 체크아웃을 배포하지 않는다.
- 프런트의 로컬 시안과 실제 접수 화면의 승격·공개는 별도 확인 대상이다. 이번 작업에서 배포·회원 조회·실제 신청·메일·시크릿 작업 없음.

## HTTP 계약

기존 API 호스트의 `/api/growth-panel/` 아래에 배선한다. 모든 경로는 `X-User-Token`을 기존 `requireUser`에 전달해 Supabase `/auth/v1/user` 응답의 UID·이메일·확인 상태를 검증한 뒤, 그 서버 검증값만 전용 RPC에 전달한다. 응답은 `private, no-store`이다. 다른 캠페인 ID, 사용자 ID, 소장 개수는 브라우저에서 선택/전달받지 않는다. 운영 `service_role`에는 `auth.users` 직접 SELECT 권한이 없으므로 접수 RPC가 이를 다시 조회하거나 권한을 넓히지 않는다.

| 경로 | 메서드 | 응답 |
|---|---|---|
| `status` | GET | `{ok:true,campaign,member:{email,eligible},application:receipt|null}` |
| `application` | GET | `{ok:true,application:receipt|null}` |
| `application` | POST | `{ok:true,application:receipt,existing:boolean}` |
| `application/withdraw` | POST | `{ok:true,application:receipt,existing:true}` |

`campaign.id`는 `growth-quality-panel-v1`. `open`, `selectionCapacity:100`, `requiredBooks`, `ownershipPolicy`, `policyVersion`, `privacyVersion`, `feedbackVersion`, `retentionVersion`, `privacyNotice`, `feedbackNotice`, `retentionNotice`, `startsAt`, `endsAt`, `retainUntil`을 반환한다. 정책 미설정/닫힘이면 알 수 없는 항목은 null이고 `member.eligible`은 null이다. 가입 회원의 8종 전체 실소장 확인 결과만 true/false이다. `requiredBooks`는 아래 8종, `ownershipPolicy`는 `classic7-plus-theory-explicit`으로 고정이며 다른 구성이면 Worker도 열린 상태 응답을 거절한다. 100은 **선정 정원**이며 신청 100건 제한이나 자동 선정 규칙이 아니다.

POST 신청 본문:

```json
{
  "nickname": "영어 친구",
  "interests": ["daily", "university"],
  "skills": ["reading", "speaking"],
  "device": "multiple",
  "situation": "원서를 읽고 이야기하고 싶어요.",
  "privacyConsent": true,
  "feedbackConsent": true,
  "privacyVersion": "서버에서 받은 버전",
  "feedbackVersion": "서버에서 받은 버전",
  "retentionVersion": "서버에서 받은 버전",
  "clientSubmissionId": "브라우저가 최초 시도 때 만든 UUID"
}
```

이메일은 저장 시 인증된 계정 값만 사용한다. 선택적 `email` 필드를 보내면 trim/lowercase 후 계정 이메일과 일치해야 한다. 새 신청에는 확인된 계정 이메일이 필요하다. 닉네임은 NFC·공백 정리 후 1~40자, 상황은 최대 300자, 관심사/역량은 각각 1개 이상이다. 관심사 ID는 `daily/travel/business/classics/hobby/university/career`, 역량은 `reading/listening/writing/speaking`, 기기는 `mobile/tablet/desktop/multiple`이다. 약관 버전은 ASCII 영숫자·점·밑줄·하이픈 1~80자이다.

접수증은 `{id,status,createdAt,withdrawnAt,submitted,consents}`. `submitted`는 닉네임·계정 이메일·관심사·역량·기기·상황이며 `consents`는 3개 동의/보관 버전이다. 공개 상태는 `submitted/pending/selected/not_selected/withdrawn`; 이 개발 범위에는 관리자 심사·선정 기능이 없다. 날짜·접수 ID 없는 성공 응답은 실패로 취급한다.

철회 본문은 `{ "confirm": "WITHDRAW" }`. 철회는 신청 행과 원래 접수일·동의 증빙을 정해진 보관기한까지 유지하지만 닉네임·이메일·상황 등 답변을 비우고 `submitted:null`을 반환한다. 응답의 `status:withdrawn`·유효한 철회 시각·비워진 답변을 모두 확인해야 성공으로 인정한다. 재신청으로 상태를 되돌리지 않는다. 철회·재접수 운영 규칙은 공개 전 안내에 반영한다.

오류는 `{ok:false,error}`이며 내부 응답·개인정보는 포함하지 않는다:

| 오류 | HTTP |
|---|---:|
| unauthorized | 401 |
| email_unverified / ineligible | 403 |
| invalid_body / invalid_fields / email_mismatch / consent_required | 400 |
| campaign_closed / policy_changed | 409 |
| application_not_found / not_found | 404 |
| method_not_allowed | 405 |
| upstream_timeout | 504 |
| service_unavailable | 503 |
| invalid_response | 502 |

통신이 끊기면 실패로 단정해 새 접수를 만들지 말고 같은 계정의 GET으로 확인한다. POST 재요청도 기존 접수증을 먼저 돌려준다. HTTP200만으로 접수 성공으로 표시하지 않는다. 본문 읽기 시간 초과 시 요청/상류 응답 스트림을 취소하고 잠금을 해제한다. 기존 `requireUser`는 인증 제공자 오류와 무효 토큰을 모두 null로 반환하므로 이 경로에서는 둘 다 unauthorized가 될 수 있다. 이 기존 공통 인증 동작은 변경하지 않았다.

## 저장·권한·중복

전용 `growth_panel_campaigns` / `growth_panel_applications` 및 RPC만 사용한다. 두 테이블에 RLS/FORCE RLS, PUBLIC/anon/authenticated 권한 회수, service_role만 허용한다. 함수는 SECURITY INVOKER와 고정 빈 search_path를 사용한다. 기존 테이블·정책·함수는 변경하지 않는다.

동일 캠페인/회원 advisory transaction lock과 UNIQUE 제약을 사용한다. 원장 조회가 새 입력/모집 상태/동의 검증보다 먼저이며, 기존 행에 UPSERT UPDATE로 접수일·선정 상태·답변을 덮어쓰지 않는다. DB 함수도 이 순서를 재검증하므로 동시 요청 사이에 프런트 결과를 신뢰하지 않는다.

잠금 직후 본인의 캠페인/UID와 일치하는 만료 행만 정리한 뒤 조회·status·중복·철회 분기로 들어간다. 따라서 보관기한이 지난 신청 답변을 접수증으로 다시 내보내지 않고 조회 결과는 `application:null`이다. 운영 전체 정리 스케줄을 대신하는 기능은 아니므로 미접속 회원의 만료 기록 정리는 별도로 필요하다.

신청 순간 캠페인의 개인정보·피드백·보관 안내 원문 3개를 `notice_snapshot`에 함께 저장하고 버전 3개는 기존 독립 필드에 기록한다. 이후 캠페인 문구가 바뀌어도 당시 동의 내용을 재현할 수 있다. 철회에서 일반 답변만 비우고 이 증빙은 정해진 보관기한까지 유지한다. 안내 원문은 브라우저 본문이 아니라 서버 캠페인 설정에서 가져온다.

소장은 `class_verifications` + `class_redemptions`의 실제 book_code 합집합만 사용한다. 정확히 필요한 8종은 `kidari/anne/littlewomen1/littlewomen2/pride/gatsby/sherlock/theory`이다. 여기에 다른 강좌를 추가 소장한 회원을 배제하는 뜻은 아니며, 필수 8종 중 하나라도 없으면 새 신청 자격은 없다. 캠페인 테이블 CHECK와 접수 함수, 열린 상태 응답 검증에서 모두 고정한다. 관리자·테스트 우대, 포인트/완독 등급, 연간 이용권, 이론 자동 보충을 사용하지 않는다.

코드 정본 근거는 `E:/LiterStella Project/workers/classgate/src/index.js:117`의 `PACKS['stella-allinone']`이다. 같은 파일의 `ownsAllInOne`은 관리자 예외·기간 이용권·이론 자동 포함까지 합치는 접근 판정이므로 이번 실소장 모집 판정으로 재사용하지 않는다. 직접 원장에는 7종만 있고 이론 접근만 파생되는 경우도 이번에는 8종 실소장으로 승격하지 않는다. 새 캠페인은 여전히 생성/활성화하지 않았다.

## 공개 전 필수 확인

1. 승인된 최신 Worker 기준에 모듈·라우트만 통합하고 공통 인증/메일/결제 회귀 확인. CORS·기존 binding·vars 보존. 새 키 복사 금지.
2. 로컬 PostgreSQL 또는 격리된 비운영 DB에서 초안을 실행하여 함수 구문, service_role의 기존 소장 원장 읽기 권한, PUBLIC/anon/authenticated 접근 거절, 계정 교차 조회, NULL 입력, 실제 동시 요청을 검증. 운영 카탈로그를 읽기 전용으로 확인한 결과 service_role은 `class_verifications`/`class_redemptions` SELECT가 가능하고 `auth.users` SELECT는 불가능했다. 그래서 인증은 기존 `requireUser` 경계에서 끝내고 RPC에 Auth 직접 조회를 두지 않았다. 실제 PostgreSQL에서 초안 전체를 실행하는 검증은 아직 미완료이다.
3. 8종 전체 실소장 기준은 확정됐다. 실제 모집 기간·정보 수집 목적/항목/보관기한·의견 요청 범위·철회/재신청 규칙은 승인하고 notice/version에 반영한다. 초안 예문을 확정 정책으로 게시하지 않는다.
4. CLI로 정식 마이그레이션 파일 생성 및 보안 점검 후 승인된 환경에 적용. 이 문서를 SQL 적용 승인으로 사용하지 않는다.
5. 보관기한 삭제 RPC `growth_panel_purge_expired()` 실행 주기·담당자를 정하고 결과를 확인한다. **정리 함수만 있으며 자동 실행 스케줄은 없다.** 삭제는 각 신청 당시의 `retain_until`을 사용하며 나중 캠페인 설정으로 기존 보관기간을 자동 연장하지 않는다. Auth 탈퇴 시 FK cascade로 해당 신청도 제거하도록 설계했다.
6. 가상 계정으로 접수→새로고침 조회→닫힌 모집에서 재시도→동의 버전 변경→철회→계정 변경을 확인한다. 운영 회원으로 테스트하지 않는다. 실제 확인 전 신청 완료/선정 완료/영구 보관을 약속하지 않는다.

참고한 공식 문서: [Supabase 함수 권한](https://supabase.com/docs/guides/database/functions), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Workers 권장 구현](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). 현재 함수/권한 문서는 확인했으나 changelog Markdown과 최신 Workers 타입 파일은 웹 도구 응답 오류로 가져오지 못했다. 새 런타임 바인딩·패키지·호환성 설정은 추가하지 않았다.
