# 관리자 AI 모니터링 대시보드 — 3단계 종합 플랜

> 작성: 2026-06-19 · 근거: 멀티에이전트 워크플로우(이해 4갈래 + 설계 3갈래) 감사
> 목적: 진단앱(룰기반+AI리포트) → 진단×챌린지 연결 → AI봇(RM 1·2·3단계)을 운영자가 한 화면에서 모니터링.

---

## 0. 한 줄 요약 / 가장 중요한 발견

- **모든 Phase의 공통 토대 = 진단앱 Worker에 `service_role` 기반 읽기전용 `/api/admin/*` 엔드포인트 + `isAdmin` 게이트를 Phase 1에서 한 번 세우는 것.** T2 PII 마이그레이션(`migration-2026-06-18-phase1-t2-revoke-pii.sql`)이 이미 브라우저(anon/authenticated)의 `email·phone·ai_report·diag_full_result·marketing_consent` SELECT를 회수했기 때문에, 챌린지앱 클라이언트로는 집계조차 불가. 반드시 Worker(service_role) 경유.
- 🔴 **결정적 모순:** Stage 1 RM은 합의대로 **localStorage 무상태** → 서버에 대화가 0건 → **봇 모니터링이 원천 불가능.** 봇을 모니터링하려면 `rm_messages` 서버 저장이 선행되어야 하고, 이는 "스키마 변경 없이 바로 출시"라는 RM MVP 철학과 정면 충돌. **운영자 결정 필요.**
- **MVP 권장:** Phase 1의 좁은 슬라이스(진단 퍼널 + segment/routing 분포 + `ai_report_runs` 비용/실패 로깅) — 기존 데이터만으로 며칠 내 배포, "유료 전환율"이라는 최상위 사업 질문에 즉답.

---

## 1. 현재 실재 자산 (재활용) vs 신규 구축 (정직한 현황)

**실재(재활용):**
- 진단 Worker `public/_worker.js`: `passesPrivacyGate`(L55-63), service_role fetch 패턴, `corsHeaders`, AI Gateway(`AI_ENDPOINT`), `summarizeBehavior`(L570)·`pickDiagProfile`, `aiData.usage`/`stop_reason` 파싱.
- `diagnosis_events` 테이블 + 퍼널 이벤트(survey_start_click→result_view→email_submit→yanawan_cta_click→ai_route_click, payload.target 포함).
- `users.ai_report` jsonb (segment 5종·routing 4종·schemaVersion 이미 존재).
- 챌린지 `AdminPanel.jsx` 5탭 + `loadData` Promise.all 프레임 + `--ls` 토큰 + `NotificationBell` + `usePolling`.
- 공유 Supabase: `users.email`(조인키)·`auth_uid`·`enrollments`·`check_ins`·`point_transactions`.

**신규 구축(현재 코드에 없음):**
- 관리자 인증 `isAdmin(request,env)` + `ADMIN_EMAILS` 시크릿 (passesPrivacyGate엔 관리자 개념 없음).
- service_role 집계 엔드포인트군 `/api/admin/metrics`·`/api/admin/journey`·`/api/admin/rm-metrics`.
- 신규 테이블: `ai_report_runs`(비용/실패), `diagnoses`(재진단 이력), `rm_messages`(봇 대화), `rm_memory`(Stage3), `rm_pacemaker_interventions`(Stage3).
- RM 채팅 코드: `rmChatResponse`·`/api/rm-chat`·`ReadingMate.jsx`·`sendRmMessage`(계획서만 존재).
- 감정분석 방식·안전 플래그·Cloudflare Cron 페이스메이커.

---

## 2. Phase 1 — 진단앱 단독 모니터링 (룰기반 퍼널 + AI 리포트)

**목표:** 진단 퍼널 전환율 + AI 리포트 생성·품질·라우팅·비용을 가시화. 유료화 판단 근거 확보.

**구현물:**
- 진단 Worker `GET /api/admin/metrics` (service_role로 `diagnosis_events`·`users.ai_report` 집계) + `isAdmin` 게이트.
- `AdminPanel.jsx` 신규 탭 `📈 진단 모니터링` + `api.js fetchDiagMetrics()`(기존 `fetchSavedAiReport` diagGateHeaders POST 패턴 복제).
- 신규 테이블 **`ai_report_runs`**(status[ok/refusal/max_tokens/http_err], model, input/output_tokens, latency_ms, attempts, schema_version, created_at) — `aiReportResponse` 성공/실패 분기에서 **비차단 INSERT**(추가 API 호출 0). AI 비용·실패율의 유일한 영구 기록원.

**모니터 지표:** 진단 완료율·이메일 저장율·CTA 클릭률 / segment 5종·routing 4종 분포 / 캐시 히트율·스키마 커버 / 생성 실패율·토큰 비용.

**⚠️ 주의:** `ai_report` jsonb GROUP BY는 풀스캔 → 사용자 증가 시 컬럼 비정규화 또는 집계 캐시(materialized view/cron) 필요.

**운영자 결정:** `ADMIN_EMAILS` 확정 · `ai_report_runs` SQL 실행 승인(critical) · AI 월 비용 알람 임계값 · 데이터 보존기간 · 개별 리드 PII 드릴다운 허용 범위.

---

## 3. Phase 2 — 진단앱 + 챌린지앱 연결 모니터링

**목표:** 진단완료 → 온보드 → 가입 → 인증 → (재진단)까지 크로스앱 여정. 핵심 KPI = 진단→가입 전환율 + "AI 라우팅 처방이 실제 행동과 맞았는가".

**구현물:**
- `GET /api/admin/journey`(service_role로 `users ⨝ enrollments ⨝ check_ins`, `?email=`로 단일 사용자 타임라인). 챌린지 anon은 T2로 차단되므로 Worker 경유 필수. 기존 검증된 크로스앱 SQL(Query1~5)을 엔드포인트로 승격.
- 신규 테이블 **`diagnoses`**(user_id, result jsonb, version, created_at) — 재진단 델타·이력(현재 `diag_full_result`는 덮어쓰기라 이력 0).
- `enrollments.source` 컬럼(onboard/direct/reactivation) + `buildOnboardUrl`에 source/utm 인코딩.
- `AdminPanel` `🔗 크로스앱 여정` 탭 + 단일 사용자 타임라인.

**모니터 지표:** 진단→가입 전환율(코호트)·소요일(핫리드<7일) / diag_type·level별 완료율 / challengeFit 예측 정확도 / 추천 책 채택률 / routing→실제 전환 / auth_uid 연결율 / 리포트 보유자 전환율.

**운영자 결정:** `diagnoses` 이력 + 재진단 정책(30일) 승인 · `enrollments.source` SQL · PII 표시 범위·접근 로깅 · challengeFit '성공' 정의(목표 80%?) · 콜드리드 너처(7일 후 미가입자 메일) 도입 여부.

---

## 4. Phase 3 — AI 봇 모니터링 (Stage1 RM / Stage2 튜터 / Stage3 소울메이트)

**목표:** RM 대화량·비용·감정·안전·이탈위험·에스컬레이션·페이스메이커 효과 추적.

**🔴 전제조건:** RM MVP가 localStorage 무상태라 **서버 대화 0건**. 모니터링하려면 `rm_messages` 서버 영속화가 선행. 이는 RM 계획서가 명시적으로 'Phase 2+, critical 스키마, 별도 운영자 승인'으로 둔 항목.

**구현물:**
- `rmChatResponse` + `/api/rm-chat`(계획서 설계 완료, 미구현) → 매 턴 **비차단**으로 `rm_messages` 적재(user_message, assistant_reply, usage.input/output_tokens, latency, model). 토큰·지연은 Claude 응답에 이미 있어 추가 호출 0.
- 신규 테이블 **`rm_messages`**(+ sentiment·is_escalated·safety_flagged·session_id), **`rm_memory`**(Stage3 영속 기억, 선택 pgvector), **`rm_pacemaker_interventions`**(Stage3 개입→복귀).
- `GET /api/admin/rm-metrics` + `AdminPanel` `🤖 RM 봇` 탭(DAU/MAU·대화량·턴·토큰비용·감정·안전·품질 샘플 뷰어).
- Stage3 Cloudflare Cron(미인증자 추출) → 기존 `NotificationBell` 발송 채널 재사용.

**모니터 지표:** (S1) 대화량·지연·에러율·메시지 캡 도달 / (S1) 토큰·비용(Haiku) / (S2) 에스컬레이션율·감정 분포·품질 샘플 / (S2) 안전 위반 / (S3) 페이스메이커 복귀 전환·영속기억 정확도·이탈위험 자동 플래그.

**운영자 결정(개인정보·돈):**
- 🔴 **RM 대화 서버 저장(`rm_messages`) 승인** — 없으면 봇 모니터링 자체 불가.
- 대화로그 관리자 열람: 평문 vs 가명처리 / 전수 vs 표본 / 권한자 범위 / 접근기록 보존 (개인정보보호법 — 대화엔 기분·건강·고민이 민감정보로 섞임).
- 대화 보관기간/삭제(GDPR erasure) · 한국어 감정분석 방식(Claude 후처리 비용 vs 별도 모델) · 서버측 rate-limit · Stage3 벡터DB 선택 · 미성년 참여 여부와 안전 수위.

---

## 5. 순서 & 의존성 (정직한 시퀀싱)

1. **공통 토대(Phase 1에서 1회):** service_role `/api/admin/*` + `isAdmin`. → Phase 2/3는 엔드포인트·탭만 추가.
2. **Phase 1**은 기존 데이터 위에서 즉시 가능(신규 스키마는 `ai_report_runs` 1개) → 가장 빠름.
3. **Phase 2**는 Phase 1 프레임 의존 + `diagnoses`·`enrollments.source` 추가.
4. **Phase 3**이 가장 무거움: RM 코드가 아직 없고, 모니터링 전제(`rm_messages`)가 RM MVP 철학과 충돌.

**과개발 경고(critic):** Stage 2/3용 모니터링(rm_memory·pgvector·Cron·감정모델)을 Stage 1과 함께 짓지 말 것 — 아직 존재하지 않는 봇의 대시보드. monitorable 절반이 'Stage2/3에서 가능'. Stage1 실측 없이 KPI/임계값 미리 박으면 대부분 폐기.

**순서 오판 위험:** "무상태 MVP 먼저 → 나중에 모니터링"은 휘발된 대화 유실을 강제. **봇 모니터링이 사업상 필수라면 처음부터 서버 저장으로 가야 함.**

---

## 6. 대시보드 위치 & IA (확정 권장)

- **위치:** 신규 통합 관리자 = 챌린지 `AdminPanel.jsx` 확장. `src/components/admin/Dashboard.jsx`로 분리(읽기·집계), 기존 운영(CRUD) 탭 유지. 같은 게이트 진입. (이유: 인증·테마·supabase·NotificationBell 재사용 / 단일 데이터 평면 / 운영-모니터 동선 통합.)
- **네비:** 최상위 모드 토글(📊 대시보드 ↔ 🛠 운영) + Phase 탭(🏠개요/1진단/2전환/3동행봇) + 전역 컨트롤 바(기간·시즌·세그먼트 필터, 60초 폴링).
- **테마:** `--ls` 토큰만(라이트/다크), 의미색 고정(success/warning/error/gold/bluegray), 모바일 reflow, `미연동` graceful 빈 상태.
- 목업: `admin_3phase_ai_monitoring_console` (이 세션 위젯).

---

## 7. 즉시 착수 전 차단요소 확인

T2 마이그레이션 이후 **현재 AdminPanel이 신청자/진단명단 탭에서 PII(email/phone)를 실제로 못 읽고 있을 가능성** → 운영 화면에서 1회 확인. 깨졌다면 그 PII 조회까지 동일 service_role `/api/admin` 경로로 흡수할지 Phase 1 범위에 포함 결정.
