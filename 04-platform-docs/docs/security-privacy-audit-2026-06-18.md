# 개인정보·보안 감사 + 강화안 (2026-06-18)

> ## 🔓🔴 출시 전 재적용 필수 — DEV 임시 해제 (운영자 확정 2026-06-18)
> **상황:** dev/prod가 같은 Supabase 1개. 정식 오픈 전이라 병행 개발 세션의 anon 도구(devSeed·개발 로그인·다이어리 집계)가 동작해야 함. 적용했던 Phase 1/2 RLS 잠금이 이 도구를 막음 → **운영자 지시로 잠금을 임시 해제**(개발 우선). PII 노출 위험은 개발 기간 한정으로 수용.
> - **해제 SQL:** `scripts/migration-2026-06-18-DEV-rollback-security-locks.sql` (운영자 실행) — users SELECT/UPDATE 테이블 GRANT 복구 · check_ins update/delete 정책 복구 · bug_reports/diagnosis_leads anon read 복구.
> - **RPC는 유지** (login_lookup·upsert_user·link_auth_uid·update_my_checkin·my_inquiries) — additive라 앱은 RPC로 계속 동작, api.js 되돌리지 않음.
> - 🔴 **출시 직전 재적용(아래 순서):** ①`phase1-t2-revoke-pii.sql` ②`phase2-c5b-revoke-update.sql` ③`phase2-h1b-drop-policies.sql` ④`phase1-c4-bugreports.sql` + diagnosis_leads anon read 재제거. 그래야 아래 Phase 1/2 CLOSED가 실제로 닫힘. **재적용 전 라이브 = 아래 OPEN 상태와 동일.**
> - ⏳ **근본 해결(권장): dev/prod Supabase 분리** 또는 dev용 별도 anon 정책 → 출시 후 잠가도 개발 안 막힘. 지금은 분리 비용 때문에 임시 해제 선택.
>
> ## 진행 상황 (Phase 0 즉시 완화 — 운영자 컨펌 후 진행 중)
> - ✅ **P0-2 (H4) localStorage 평문 비밀번호 제거** — 배포 완료. 챌린지 `c47349b`(push) · 진단 `wrangler` Version `6addaaea`. 저장 안 함 + 레거시 로드 시 제거 + 자동채움은 email/닉네임만.
> - ✅ **P0-3 (H5) /api/save-result 가입계정 보호** — 배포 완료. 진단 `wrangler` Version `90850e8c`. auth_uid 보유 행은 본인 토큰(세션/OTP) 통과 시만 덮어쓰기, 신규/미가입은 자유 저장. 프론트 4곳 토큰 동봉.
> - 📋 **P0-1 (M2·M3) WAF Rate Limiting** — **스펙 작성 완료** → [`waf-rate-limiting-spec.md`](./waf-rate-limiting-spec.md). 운영자가 Cloudflare 대시보드/API로 적용(IP 기반, send-code 3/분·verify-code 5/분·익명 INSERT 10/분, Block). ⚠️ WAF는 Supabase 직접호출 PII 누출(C1~C4)은 **못 막음** — 그건 Phase 1 RLS 전용.
> - ✅ **Phase 1 (PII read 차단) 완료·검증** (2026-06-18, 보안 리드 트랙):
>   - users PII 읽기 → SECURITY DEFINER RPC 전환 (T0 `login_lookup`/`check_signup_dups`/`find_email_masked` + T3 `upsert_user`). api.js 커밋 ce9cbd9·342a466 배포.
>   - T2 SQL: `revoke select on users from anon,authenticated` + 비-PII 15컬럼 allowlist GRANT → **email·phone·naver_id·diag_full_result·ai_report·marketing_consent 차단**(anon curl 검증: permission denied). diagnosis_leads anon read drop(C3).
>   - 검증: 비-PII read·로그인/중복확인/아이디찾기 RPC·가입 upsert_user·id기반 프로필 update 전부 정상. ⚠️ 교훈: **컬럼 REVOKE는 테이블 GRANT 있으면 무효 → 테이블 REVOKE+allowlist** / on_conflict upsert는 table SELECT 필요 → RPC로.
>   - **C1·C2·C6·C3 CLOSED.**
>   - ✅ **C4 CLOSED** (커밋 2c6080e): bug_reports RLS 활성화 + anon SELECT 차단 + INSERT만 허용 + `my_inquiries(p_email)` RPC(JWT 이메일 일치 시만). INSERT 함수는 .select() 제거. 검증: anon read→[]·INSERT→201·RPC 게이트 OK. ⚠️ 이메일-only(세션無) 사용자는 알림종 본인문의 일시 제한.
> - **✅ Phase 1 (read 누출) 전부 완료 — C1·C2·C3·C4·C6 CLOSED.** 테스트 행 2개(`_t2verify_…`·`_c4verify_…`) 정리 SQL 운영자 대기.
> - ✅ **Phase 2 (C) — C5 auth_uid 탈취 CLOSED** (커밋 1ffcb54): `link_auth_uid` RPC(세션 본인·이메일 일치·미청구 행만) + users UPDATE를 프로필 컬럼만 allowlist(C5a/C5b SQL). 검증(실재 행): auth_uid/email 직접 PATCH→42501 차단·프로필 PATCH 정상. ⚠️ 0-row PATCH는 PostgREST가 권한검사 건너뜀 → 검증은 실재 행으로. 잔여(낮음): 타인 행 프로필컬럼 변조(own-row 미강제) = broader Phase 2.
> - ✅ **Phase 2 — H1 check_ins 위조·삭제 CLOSED** (커밋 e4c8c64·d3fc092): 수정/삭제를 `update_my_checkin`/`delete_my_checkin` RPC(세션 본인·is_yanawan 분기·야나완 reflection 불변 서버강제)로. H1b는 DO블록으로 check_ins 정책 read/insert만 재생성(named drop 미적용 정정). 검증(실재 행): anon UPDATE/DELETE→[] 차단·행 보존. ⚠️ 이메일-only 사용자 수정/삭제 제한.
> - ⏭️ **남음:** H2(point_transactions·user_badges·enrollments 위조 — 랭킹/결제 무결성, **결제 ON 전 service_role Worker 트랙** = 인증 이벤트 서버검증 후 적립) · check_ins SELECT 게이트(비공개 다이어리 읽기) · C5 own-row 강제 · T1.5(admin) · Phase 3(컴플라이언스).


> 방법: 5개 영역 다중 에이전트 **정적 분석**(RLS·코드·시크릿·엔드포인트·거버넌스). 실데이터 미조회·프로덕션 미실행.
> 검증 단계는 일시 rate-limit으로 대부분 미완(13/14 실패)이나, **헤드라인 RLS 항목은 grep으로 독립 확인**했고 완료된 검증 1건(bug_reports)은 critical 확정.
> 등급: **critical 6 · high 8 · medium 5 · low 5 (총 24)**. 전부 라이브 상태.

---

## ✅ 검증 완료 — Verified Risk Register (2026-06-18, 정적 분석 직접 확정)
> 적대 검증 워크플로가 API rate-limit으로 반복 실패 → **정본 파일 직접 정독으로 확정**(에이전트와 동일 소스). 근거 핵심 = `rls-policies.sql` 25-35 DO블록이 7개 테이블 기존정책 전부 DROP → phase-a 'own write' 무력 + 40·42·47-64 전부 `USING(true)`.

| ID | 항목 | 원등급 | **검증 등급** | 상태 | 근거 |
|---|---|---|---|---|---|
| C1/C6 | `users` anon SELECT USING(true) — 전 회원 email·phone·naver_id·진단결과 | critical | **CRITICAL ✔** | 🔴 OPEN | rls-policies.sql:40 |
| C2 | `getUserByEmail` select('*') + C1 — 임의 이메일 전체 행 PII | critical | **CRITICAL ✔** | 🔴 OPEN | api.js:85·rls:40 |
| C3 | `diagnosis_leads` anon read USING(true) — 진단 email+result 명단 | critical | **CRITICAL ✔** | 🔴 OPEN | diagnosis-leads-table.sql:23-26 |
| C4 | `bug_reports` anon read(RLS 부재) — 문의·후기 email+본문 | critical | **CRITICAL ✔** | 🔴 OPEN | api.js:875 (RLS SQL 0건) |
| C5 | `users` anon UPDATE USING(true) — 타인 행·auth_uid 변조(탈취 인접) | critical | **HIGH ✔**(하향) | 🔴 OPEN | rls-policies.sql:42 (own-write는 DO블록+`CREATE POLICY IF NOT EXISTS` 문법오류로 미생성) |
| H1 | `check_ins` UPDATE/DELETE USING(true) + 전 행 read | high | **HIGH ✔** | 🔴 OPEN | rls-policies.sql:54-57 |
| H2/H6/H7 | `point_transactions`·`user_badges`·`enrollments` anon write — 포인트·배지·완독·기부 위조 | high | **HIGH ✔** | 🔴 OPEN | rls:47-64·p5-point-ledger.sql:34 |
| H3 | 관리자 패널 게이트=클라 이메일 비교뿐(REST 직접호출 우회) | high | **HIGH ✔** | 🔴 OPEN | AdminPanel.jsx:21,118 |
| H8 | `book_requests`·`bug_reports` anon read(신청자·문의자 email) | high | **HIGH ✔** | 🟡 book_requests=마이그레이션 대기(잠재)·bug_reports=OPEN | book-requests:24-34·api.js:876 |
| **H4** | localStorage 평문 비밀번호 | high | **HIGH** | ✅ **MITIGATED** (P0-2 배포) | app.js·App.jsx 수정 |
| **H5** | `/api/save-result` 무인증 쓰기 | high | **HIGH** | ✅ **MITIGATED** (P0-3 배포) | _worker.js auth_uid 게이트 |

**요약:** 검증 후 **OPEN = critical 4 + high 5**(전부 RLS `USING(true)`/anon write 근본). **MITIGATED = H4·H5**(이번 세션 배포). 오탐·반박 0건. → **OPEN 9건은 Phase 1(read 차단)·Phase 2(write 무결성)** 대상(다른 세션 진행 중). 한 가지 등급 조정: **C5는 critical→high**(users에 결제/시크릿 직접보관 없음 + 운영자 베타 의도수용·7/1 강화 명시, 단 auth_uid 탈취 인접이라 high 확정).

---

## 한 줄 진단
앱이 처음부터 **"anon 전용"**으로 만들어져 RLS를 `USING(true)`로 사실상 무효화했는데, `users`·`diagnosis_leads`·`bug_reports`에 **PII가 들어있어 "공개 읽기" = "프론트에 노출된 anon 키로 누구나 전 회원 PII 덤프"**가 됩니다. 추가로 공개 INSERT/UPDATE/DELETE = **계정·포인트·배지·완독·기부 위조**.

## ✅ 안심 포인트 (확인됨)
- **service_role 키·NOTIFY_KEY git 미커밋**(git log -S 0건) — 키 유출 아님. rotate 불필요.
- 결제 Worker(`05-secure-api`)는 Origin 화이트리스트 + requireAdmin/requireUser로 **올바르게 설계**됨.
- 앱 자체 피드/리더보드 쿼리는 nickname·SNS·country만 select → **화면엔 PII 안 나옴.** (누출은 anon 키로 REST 직접 호출 시 앱을 우회.)

---

## 🔴 CRITICAL (6) — PII 전면 노출 + 계정 탈취

| # | 항목 | 노출/조작 | 근거 |
|---|---|---|---|
| C1 | **`users` anon SELECT `USING(true)`** | 전 회원 email·phone·naver_id·**diag_full_result(진단 전체)**·SNS URL 덤프 | `rls-policies.sql:40` |
| C2 | `getUserByEmail`이 `select('*')` + C1 | 임의 이메일로 전체 회원행 PII 조회(로그인 플로우가 정상 경로) | `api.js:85` |
| C3 | **`diagnosis_leads` anon read `USING(true)`** | 진단 리드 전체(email+result 명단) | `diagnosis-leads-table.sql:23-26` |
| C4 | **`bug_reports` anon read (RLS 부재)** ✔검증확정 | 문의·후기·만족도 email+nickname+본문 전체 | `api.js:875` / 레포에 RLS SQL 0건 |
| C5 | **`users` anon UPDATE `USING(true) WITH CHECK(true)`** | 타인 계정 임의 변조 · **auth_uid 재지정=계정 탈취** | `rls-policies.sql:42` |
| C6 | (C1 재확인) anon으로 phone/naver_id/diag 평문 | 전 회원 PII+행동 프로파일 | `rls-policies.sql:40`·`api.js:89` |

> 익스플로잇(논증): 프론트 번들에 있는 anon 키로 `GET /rest/v1/users?select=*` 한 줄 — **인증 불필요.** 화면을 거치지 않고 PostgREST 직접 호출이라 관리자 화면 게이트도 무의미.

## 🟠 HIGH (8) — 위조·IDOR·자격증명

- **H1** `check_ins` UPDATE/DELETE `USING(true)` — 타인 인증/일기 위조·삭제 + 비공개 인증 본문(장소·일기) 노출. `rls-policies.sql:54-57`
- **H2** `point_transactions`·`user_badges`·`enrollments` anon INSERT/UPDATE — 포인트·배지·완독·입금상태 위조(랭킹/명예전당/결제 무결성 붕괴). `p5-point-ledger.sql:34`·`rls-policies.sql:47-64`
- **H3** **관리자 패널 = 클라 이메일 비교만**(별도 비번 없음) — RLS 무방비 테이블의 사실상 유일한 보호막이라 REST 직접호출로 우회. `AdminPanel.jsx:21,118`
- **H4** **localStorage 평문 비밀번호 저장**(`literstella_saved_account.password`) — XSS/공용PC/확장프로그램 탈취 → 계정·비번재사용 연쇄. 진단 `app.js:2680/3035/3572` → 챌린지 `App.jsx:334`
- **H5** **`/api/save-result` 무인증 쓰기(IDOR-write)** — 임의 email로 타인 users 행 진단결과·닉네임 덮어쓰기/계정 선점. `public/_worker.js:142` (게이트 없음)
- **H6** `point_transactions` anon INSERT — 포인트 무한 위조(7/1 포인트결제 시 금전). `p5-point-ledger.sql:34`(파일 주석도 한계 인정)
- **H7** `check_ins`/`enrollments`/`user_badges` anon write — 인증·배지·완독·기부 위조. `rls-policies.sql:47-64`
- **H8** `book_requests`·`bug_reports` anon read — 신청자/문의자 email 열거 + book_requests anon UPDATE(상태 변조). `migration-2026-06-17-book-requests.sql:24-34`

## 🟡 MEDIUM (5)

- **M1** 온보딩/크로스도메인 URL에 **email 평문**(`?onboard=` base64 가역 · `?em=`) — 히스토리·Referer·로그 노출. `app.js:632-663`·`App.jsx:1118`·`MyHistory.jsx:702`
- **M2** `/api/send-code` **rate-limit 부재** — 임의 이메일 인증메일 폭격(피해자 메일함·Resend 비용). `_worker.js:269`(KV 바인딩 없음)
- **M3** OTP `verify-code` 무제한 시도 — 6자리 brute-force(시도 카운터 없음). `_worker.js:301-317`
- **M4** **필수 동의 미기록**(PIPA) — privacy 동의를 클라에서만 게이트, DB에 동의 일시·버전 미저장. `ApplicationSection.jsx:95`
- **M5** 개인정보처리방침 '지체 없이 파기' 약속 vs **실제 삭제 경로 부재**(탈퇴 UI 없음, anon DELETE 불가→운영자 수동만). `PrivacyModal.jsx:45,66`

## ⚪ LOW (5)

- **L1** service_role/NOTIFY_KEY **git 미커밋(안전)** — 단 로컬 평문 .env 상주, .gitignore 의존. 권장: pre-commit gitleaks 훅.
- **L2** challenge 레포 `supabase/.temp/` 트래킹(비밀번호 없는 pooler-url·ref — 공개급). `.gitignore`에 추가 + `git rm --cached`.
- **L3** 진단 Worker CORS `ACAO:'*'`(토큰 인증이라 데이터유출은 막힘, 방어심층 위반). 인증 엔드포인트는 Origin 화이트리스트 권장(challenge 오리진 포함 필수).
- **L4** `/api/notify-inquiry` OPTIONS 미처리(가용성, 시크릿 방어 정상).
- **L5** PIPA 고지 불일치 — phone·naver_id·diag_full_result가 PrivacyModal 수집항목에 미기재. 방침 텍스트 정합화.

---

## 강화 계획 (단계별 — 라이브 안 깨지는 순서)

> ⚠️ **핵심 제약:** 라이브가 anon read/write에 전면 의존 → **RLS를 그냥 잠그면 즉시 전면 장애**(6/8 카페링크 사고처럼). 반드시 "백엔드 경로 먼저 → 프론트 전환 → anon 정책 회수" 순서.

### Phase 0 — 즉시 완화 (라이브 무중단, 코드/RLS 거의 무변경)
- **P0-1** Cloudflare **WAF Rate Limiting Rules**: `/api/send-code`·`/api/verify-code` IP+email당 분당 N회 (M2·M3) — 대시보드 설정, 배포 불필요. *(운영자 실행)*
- **P0-2** **localStorage 평문 비번 제거** (H4) — 진단·챌린지 양쪽 1줄 제거 + 로드시 기존값 정리. 저위험·고효과. *(내가 가능, 양앱 배포)*
- **P0-3** **`/api/save-result` 기존행 보호 분기** (H5) — 신규 email은 허용, auth_uid/welcomed_at 보유 행은 OTP 게이트 통과 시만 PATCH. 신규가입 안 깨짐. *(내가 가능)*

### Phase 1 — PII read 차단 (헤드라인 누출 C1~C4, C6)
- 공개 표시 전용 **VIEW**(nickname·country·sns만) 생성 → `fetchLeaderboard`/피드 전환.
- 로그인·중복확인·마이페이지·관리자 조회를 **service_role Worker 엔드포인트**(세션/OTP 게이트, 진단앱 my-leads 패턴)로 이전.
- 그 후 `users`·`diagnosis_leads`·`bug_reports`·`book_requests` **anon SELECT 정책 DROP**. *(SQL=운영자, 코드·Worker=내가)*

### Phase 2 — write/무결성 (결제 ON 전 필수: C5·H1·H2·H6·H7)
- 포인트·배지·enrollment status·입금확인을 **service_role Worker**로 이전 → `check_ins`/`point_transactions`/`user_badges`/`enrollments` anon INSERT/UPDATE/DELETE **정책 DROP**.
- 로그인 사용자는 `own-write`(auth.uid()=auth_uid) RLS, `users` 전면 UPDATE DROP.

### Phase 3 — 컴플라이언스 (M4·M5·L5)
- 동의 레코드(privacy_consent·consent_at·version) append-only 저장.
- 회원 탈퇴/삭제 요청 경로 + service_role CASCADE 삭제, 방침 SLA 정합.
- PrivacyModal 수집항목에 phone·naver_id·진단데이터 명시.

---

## 운영자 컨펌 필요 사항
1. **시작 범위**: Phase 0(즉시 완화)부터? 아니면 Phase 1(PII read 차단)까지 한 번에 설계?
2. **내가 못 하는 것(운영자 실행)**: Supabase RLS SQL 실행, Cloudflare WAF Rate Limiting 규칙, secure-api/진단 Worker `wrangler deploy`·secret.
3. **돈/법무 인접**: 동의 기록·삭제 SLA·방침 텍스트는 운영자 검토 필요.

> 본 문서는 **점검·제안**이며, 코드/RLS는 **컨펌 전 미변경**.
