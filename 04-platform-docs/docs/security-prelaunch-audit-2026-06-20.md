# 출시 전 보안 점검 — 취약점 리포트 + 7/1 재잠금 체크리스트 (2026-06-20)

> **분석 전용 산출물.** 코드·SQL 변경 없음. 기존 감사 `security-privacy-audit-2026-06-18.md`의 갱신·확장.
> 방법: ① RLS PII·원장 위조 = **라이브 anon 키 exploit 실증**(2026-06-20 실측, 테스트행 생성·일부 정리) ② 결제·어뷰즈·진단앱 = 코드 정독(병렬 3트랙). 프로덕션 미파괴(테스트 user `_devverify_h2` + 위조 point_transactions 1행은 service_role 정리 필요 — §7).
> 맥락: Supabase anon 키 프론트 노출. **7/1부터 포인트 결제 + 활동연동 기부(매출 펀딩 서약, 포인트=산정 지표)** → 위조 포인트가 실금전·법적(표시광고법) 영향.

---

## 0. 한 줄 결론
**현금(카드/포트원) 경로는 서버권위로 올바르게 설계됨. 포인트·원장·PII 경로는 서버가 루프에 전혀 없고 프론트 노출 anon 키로 전부 위조·덤프 가능.** 포인트가 돈/기부에 닿는 7/1 전에 **(A) RLS 재잠금 + (B) 원장 service_role 전환**이 출시 차단(blocker)이다.

## 1. 현재 라이브 상태 (2026-06-20 실측)
| 프로브 (anon 키) | 결과 | 의미 |
|---|---|---|
| `GET users?select=email,phone,naver_id,diag_full_result` | **HTTP 200, 실데이터** | 전 회원 PII 덤프 (실제 email·휴대폰·네이버ID·진단전체 노출 확인) |
| `GET diagnosis_leads?select=email,result` | **200** | 진단 신청자 email 명단 |
| `GET bug_reports?select=email,description` | **200** | 문의·후기자 email + 본문 |
| `POST point_transactions {amount:3000,reason:badge,user_id:임의}` | **201** | 임의 회원에 포인트 위조 적립 |
| `PATCH point_transactions` | 200 / **0행** | UPDATE 정책 없음 → 위조행 사후수정 불가 (유일한 방어) |
| `POST enrollments {status:completed,goal_days:100}` | **201** | 완독/성공 도전 위조 |
| `PATCH enrollments {status:completed}` | 200 / **1행** | 도전 상태 변조 |
| `POST user_badges {badge_id:finish_*/honor_win_*}` | **201** (별도 검증) | 완독·성공 배지 위조 |

> ⚠️ PII 노출은 현재 **DEV 임시 해제 상태**(개발 병행 위해 `migration-2026-06-18-DEV-rollback-security-locks.sql` 적용). 원장/enrollment 위조는 **DEV 무관 = H2 미구현(원래 열림)**.

---

## 2. CRITICAL (출시 차단)

### C-1. H2 포인트 원장 위조 — `point_transactions` anon INSERT (실증 201)
- **근본:** `p5-point-ledger.sql:33-34` `point_tx_public_insert with check(true)` + anon 키. 모든 적립이 클라에서 `recordPointEarn`(api.js:894)로 직접 INSERT. 서버 검증 0.
- **Exploit(실증):** 프론트 번들의 anon 키로 `supabase.from('point_transactions').insert({user_id:<임의>, amount:3000, reason:'badge', ref_id:'x'+rand})` 루프. 행당 `amount≤3000`(CHECK) 이나 **행수 무제한 → 사실상 무한 발권**(1000행×3000=300만P 수초). `reason` 화이트리스트·`amount` 캡은 자릿수만 막을 뿐 소유권·잔액·"실제로 벌었나"를 막지 못함.
- **7/1 영향:** ①`spendPoints`로 위조 포인트 현금성 상품(워크북 PDF·강의 바우처 `pricing.js:54`) 구매 ②**활동연동 기부 산정근거 허위 → 표시·광고법 리스크**(기부액이 포인트 지표 기반).
- **Fix:** 적립을 service_role Worker로 이전 — Worker가 트리거 이벤트(실제 check_in/badge 행) 검증 후 INSERT. 이후 `REVOKE INSERT ON point_transactions FROM anon`. CHECK는 방어심층으로 유지하되 경계로 의존 금지.

### C-2. enrollments 위조 — anon INSERT/UPDATE `status='completed'` (실증 201/200)
- **근본:** `rls-policies.sql` enrollments `public_insert/update using(true)`.
- **Exploit(실증):** anon으로 `status:'completed', goal_days:100` enrollment INSERT(201) 또는 기존 행 PATCH(200) → **완독 회수·100일 성공·명예전당·완독배지·누적포인트 랭킹 전부 부정**. `grantHonorWinIfEarned`/완독배지가 이 위조 위에 적립.
- **Fix:** enrollment 생성·상태전이를 Worker 전용. `REVOKE INSERT,UPDATE ON enrollments FROM anon`(읽기만 anon). `user_badges`도 동일(REVOKE INSERT) — finish_*/honor_win_* 위조 차단.

### C-3. RLS PII 전면 덤프 — users·diagnosis_leads·bug_reports anon SELECT (실증 200)
- **근본:** 앱이 "anon 전용"이라 RLS `using(true)`. PII 보유 테이블이 공개읽기 = anon 키로 전 회원 email·phone·naver_id·**diag_full_result** 덤프. (현재 DEV 해제 상태라 라이브 노출 中.)
- **Exploit(실증):** `GET /rest/v1/users?select=*` → 실제 회원 PII 반환.
- **Fix(7/1 재적용):** §6-A 체크리스트. users 테이블 REVOKE SELECT+비-PII allowlist, diagnosis_leads/bug_reports RLS 재활성, PII read는 SECURITY DEFINER RPC(login_lookup·my_inquiries 등 이미 작성됨).

### C-4. `spendPoints` 클라 read-then-write — TOCTOU 이중사용 + 위조잔액 사용 (코드)
- **근거:** api.js:949-963. `fetchPointBalance`(read) → `< amount` 체크 → INSERT(write), 2 왕복·DB 잔액단언 없음.
- **Exploit:** ①C-1로 잔액 위조 후 정상 spend ②**동시 N요청 + 서로 다른 refId**(`buy:1,buy:2…`) → 각자 같은 시작잔액 읽고 통과 → N배 차감/상품. `unique(user,reason,ref_id)`는 다른 refId면 무력.
- **Fix:** 차감을 Worker RPC 단일 트랜잭션(잔액 `SELECT…FOR UPDATE` 또는 `INSERT…WHERE sum>=amount`)으로 원자화. 서버생성 refId 1구매=1차감.

### C-5. 신원검증 부재 → 다계정 핸드아웃 파밍 (코드)
- **근거:** `checkSignupDuplicates`(api.js:156)는 email/nickname 중복만 + **fail-open**. 비번/Auth signUp 선택적(App.jsx:793). 실명·휴대폰·결제 게이트 없음.
- **Exploit:** email만으로 계정 N개. 계정당 무활동 핸드아웃 = join10+welcome300+declaration10+fidelity5 ≈ **325P**, 프로필 위조시 +140 ≈ **465P**. 1P=10원 → 100계정 ≈ ₩46.5만 상당 사용/기부지표 가치. **위조도 아닌 의도된 지급**이라 더 심각.
- **Fix:** 신원(휴대폰/결제) 확인 전엔 핸드아웃 **적립되 사용·기부불산정 잠금**. dup-check fail-closed. welcome을 검증된 신원에 바인딩.

---

## 3. HIGH

### H-1. 적립 캡 전무 (월/시즌) — 코드
- 클라·DB 어디에도 집계 캡 없음(행당 `amount` CHECK만). 정식 계획 ~300P/월 미구현. 정직한 경로도 무캡, 직접 INSERT는 무한(C-1). **Fix:** DB 트리거/RPC로 user·season 집계 캡 + reason별 일캡, anon INSERT revoke.

### H-2. welcome 300P 시즌별 재지급·무게이트 — 코드
- refId `welcome:${ACTIVE_SEASON}`(App.jsx:827). 시즌 앵커(7·11·3월) 바뀌면 **동일 계정 매시즌 300P 재수령**(연 900P). 조건은 `isYanawan`뿐, 결제 전 발화. **Fix:** 1회성이면 시즌 없는 계정단위 refId(`first_book_finish` 패턴), 시즌형이면 결제확정(status='active')+신원 게이트.

### H-3. refId 클라 선택·비서버유래 — 코드
- 모든 refId가 클라 구성. UNIQUE는 동일refId 재생만 막고 **다른 refId로 같은 이벤트 중복적립** 가능. 이벤트 실재 검증 없음. **Fix:** Worker가 검증된 이벤트에서 refId 유도, 클라 amount/reason 거부.

### H-4. 다이어리 1시간 타이밍룰 클라 전용 — 코드
- `handleDiarySubmit`(App.jsx:1027-1044) `Date.now()`+localStorage 기반. 서버(api.js:451) 무검증. devtools/시계 조작·직접 호출로 우회, record_bonus 파밍. **Fix:** 적립 RPC 내 서버 timestamp 간격 측정.

### H-5. 진단앱 WAF rate-limit 미적용 — 코드+운영
- `_worker.js`에 코드 레벨 rate-limit 0. `/api/send-code`(:287) 쿨다운 없이 Resend 발송 → **이메일 폭탄·비용 소진**. `/api/verify-code` 시도 무제한. WAF는 **스펙만 존재**(`waf-rate-limiting-spec.md` "운영자 적용 대기"). **Fix:** zone WAF 규칙 적용 + Worker KV 이메일 쿨다운(심층).

### H-6. OTP 6자리 brute-force — 코드
- 6자리(1e6)·10분 창·**시도 카운터 없음**(_worker.js:298,319). H-5 미적용시 무차별 가능. **Fix:** KV per-email 실패카운터(≈5회 락), IP 무관.

---

## 4. MEDIUM

### M-1. 단건 vs 구독 billing-key 불일치 — 코드
- UI "이번 도전 1건만 결제"(ChallengePayment.jsx:175)인데 유일 배선은 `subscribeYanawan`(payment.js:32) → 빌링키 발급 + `/api/payment/subscribe` → `subscriptions.status=active` + **cron 30일 재청구**(index.js:366). 올바른 단건 경로(`sub==='pay'` index.js:233)는 프론트가 호출 안 함. 사용자 자가취소 불가(admin 전용). PAYMENT_ENABLED off라 미발화 but **7/1 플립 대상**. **Fix:** 단건은 `requestPayment`+`/api/payment/pay` 경로 사용, 빌링키 미발급. 카피↔코드 정합.

### M-2. 현금+포인트 혼합결제 환불 세탁 (잠재) — 코드
- 현재 양 레일 분리(전액 현금 or 전액 포인트)라 즉시 악용 없음. but `pointCostFor`(pricing.js:87 cap_pct)가 혼합 설계. 환불은 현금만 PortOne 취소, **포인트 재크레딧/소각 미모델**. 혼합 출시 시 포인트구매+소액현금 → 전액 현금환불 → 포인트 회수(기부지표 인플레). **Fix:** 환불을 양 레그 원자적 역전(현금취소+보상 포인트 1회), 포인트분 현금환불 불가 명문화, refId 연결 멱등.

### M-3. OTP HMAC가 service_role 키로 폴백 — 코드
- `otpSecret`(_worker.js:32) `OTP_SECRET || SUPABASE_SERVICE_ROLE_KEY`. 전용 시크릿 미설정 → auth 서명키 = Supabase 갓키. 직접 위조 아님(키 비밀 유지)이나 회전 불가·blast-radius. **Fix:** 전용 `OTP_SECRET` 시크릿 설정 + 폴백 제거(빈값=not_ready 이미 처리).

### M-4. save-result IDOR (비소유 행) + fail-open — 코드
- `saveResultResponse`(_worker.js:171)는 기존 행에 `auth_uid` **있을 때만** 게이트. 신규/미소유 email은 무인증 쓰기 → 가입 전 피해자 진단행 선점·nickname 덮어쓰기. lookup 예외시 fail-open(:187). 영향 한정(PII read 아님, XSS 차단)이라 MEDIUM. **Fix:** 기존 non-empty diag_full_result 덮어쓰기 시 항상 게이트, lookup 실패=insert-if-absent만.

### M-5. user_badges anon INSERT (배지 위조) — C-2 가족
- finish_*/honor_win_* anon INSERT 201. 완독서재·전당 위조. **Fix:** C-2와 함께 REVOKE INSERT.

---

## 5. LOW
- **0-row PATCH 거짓성공**: Worker admin PATCH `return=minimal`이 0행에도 ok(index.js:112). admin 전용이라 권한상승 아님·정합성 버그. → `return=representation`+≥1행 단언.
- **OTP 무상태 재생**: 10분 창 내 동일 code+token 재제출로 다중 access token. → KV nonce 1회소비(선택).
- **CORS `*`**: 진단 Worker `:2` 와일드카드(쿠키 인증 아님이라 CSRF는 아님). → 허용 origin 반사.

## SAFE (확인 — 손대지 말 것)
현금 결제: 금액 서버상수(YANAWAN_PRICE_KRW index.js:138)·클라 "결제됨" 불신(PortOne 재조회)·웹훅 Svix HMAC+±300s·빌링키 소유검증·Idempotency-Key·dunning cap4·CORS allowlist. / 진단: 프라이버시 게이트 token↔email 바인딩(my-leads·ai-report·admin IDOR 없음)·HMAC 상수시간·exp 서명포함·XSS 필터·admin allowlist 빈값-안전기본. / 포인트: `point_transactions` UPDATE/DELETE 정책 없음(위조행 변조·은폐 불가)·cheer→포인트 미연결·완독배지는 자가신고 아닌 카페후기 게이트·streak/honor_win refId 멱등.

---

## 6. 🔴 7/1 직전 재잠금 + 하드닝 체크리스트

### A. RLS 재적용 (DEV 해제 되돌리기) — C-3 닫음
- [ ] `migration-2026-06-18-phase1-t2-revoke-pii.sql` (users 테이블 REVOKE SELECT + 비-PII 15컬럼 allowlist GRANT)
- [ ] `migration-2026-06-18-phase2-c5b-revoke-update.sql` (users UPDATE allowlist)
- [ ] `migration-2026-06-18-phase2-h1b-drop-policies.sql` (check_ins read/insert만)
- [ ] `migration-2026-06-18-phase1-c4-bugreports.sql` (bug_reports RLS 재활성 + my_inquiries RPC) — **현재 RLS OFF 상태이므로 재활성 필수**
- [ ] diagnosis_leads anon read 정책 재제거 (T2 ②)
- [ ] 재적용 후 anon `GET users?select=email` → 401/permission denied 재검증

### B. 원장 무결성 = service_role Worker 트랙 — C-1·C-2·C-4·M-5 닫음 (THE 핵심)
- [ ] 적립: Worker가 트리거 이벤트 서버검증 후 INSERT (인증=실 check_in 행, 배지=서버 판정)
- [ ] 차감: 단일 트랜잭션 잔액단언(`FOR UPDATE`/`INSERT…WHERE sum>=`), 서버생성 refId
- [ ] `REVOKE INSERT ON point_transactions, user_badges FROM anon, authenticated`
- [ ] `REVOKE INSERT, UPDATE ON enrollments FROM anon, authenticated` (생성·상태전이 Worker 전용)
- [ ] anon은 **읽기(own-row 권장)만**. p5-point-ledger.sql:38 자체가 "8/1 전 서버사이드 필수" 명시 — **포인트가 돈/기부에 닿기 전 = 7/1**로 앞당김
- [ ] PAYMENT/BILLING/ADMIN_API_ENABLED 플래그는 B 완료 후에만 ON

### C. 어뷰즈 방지 — C-5·H-1·H-2·H-4 닫음
- [ ] DB 집계 캡: user×season 총적립 캡 + reason별 일캡(1×checkin/day 등) 트리거/RPC
- [ ] welcome refId 계정단위 or 결제·신원 게이트 (시즌 재지급 정책 확정)
- [ ] 신원검증(휴대폰/결제) 전 핸드아웃 = **적립되 사용·기부 비산정 잠금**, dup-check fail-closed
- [ ] 다이어리 타이밍 게이트 서버 측정(RPC 내 timestamp 간격)

### D. 결제 정합 — M-1·M-2
- [ ] 단건 = 프론트가 `requestPayment`+`/api/payment/pay` 경로 호출(빌링키 미발급). 구독 retire면 subscribe/cron 비활성. 카피↔코드 정합 후 PAYMENT_ENABLED ON
- [ ] 혼합결제 출시 시: 환불 양레그 원자 역전 + 포인트분 현금환불 불가 명문화

### E. 진단앱 — H-5·H-6·M-3·M-4
- [ ] WAF rate-limit 규칙 적용(send-code 3/분·verify-code 5/분·익명 INSERT 10/분, Block) — 스펙→적용
- [ ] Worker KV: send-code 이메일 쿨다운 + verify-code per-email 실패카운터(≈5회 락)
- [ ] 전용 `OTP_SECRET` 시크릿 설정, service_role 폴백 제거
- [ ] save-result: 기존 diag 덮어쓰기 항상 게이트 + lookup 실패 fail-closed

### F. 법적/표시광고 (활동연동 기부)
- [ ] 기부 산정이 **B 완료(위조 불가) 후**의 포인트만 반영하도록 컷오버 — 시범기간 위조 포인트가 기부지표에 섞이지 않게 시즌 리셋/스코프
- [ ] 기부 산정식·캡(min(포인트×10원×3%, 매출×5%)) 표기와 실제 일치 [[donation-model]]

---

## 7. 정리 필요 (운영자 — service_role/SQL)
점검 중 생성한 테스트 행 + 위조 실증행. anon으로 `point_transactions`/`users` DELETE 불가 → service_role(SQL Editor) 필요:
```
delete from public.point_transactions where user_id in (select id from public.users where email like '_devverify%');
delete from public.enrollments       where user_id in (select id from public.users where email like '_devverify%');
delete from public.user_badges       where user_id in (select id from public.users where email like '_devverify%');
delete from public.check_ins         where user_id in (select id from public.users where email like '_devverify%');
delete from public.bug_reports       where email like '_devverify%';
delete from public.users             where email like '_devverify%';
```

## 8. 우선순위 요약
| ID | 항목 | 등급 | 실증 | 7/1 차단 |
|---|---|---|---|---|
| C-1 | point_transactions 위조 적립(무한발권) | CRITICAL | ✅ 201 | **YES** |
| C-2 | enrollments 완독/성공 위조 | CRITICAL | ✅ 201/200 | **YES** |
| C-3 | RLS PII 전면 덤프 | CRITICAL | ✅ 200 | **YES**(재잠금) |
| C-4 | spendPoints TOCTOU 이중사용 | CRITICAL | 코드 | **YES** |
| C-5 | 다계정 핸드아웃 파밍(신원부재) | CRITICAL | 코드 | **YES** |
| H-1 | 적립 캡 전무 | HIGH | 코드 | YES |
| H-2 | welcome 시즌 재지급 | HIGH | 코드 | YES |
| H-3 | refId 클라유래 | HIGH | 코드 | YES |
| H-4 | 다이어리 타이밍 클라전용 | HIGH | 코드 | 권장 |
| H-5 | 진단 WAF 미적용(이메일폭탄·OTP brute) | HIGH | 코드 | YES |
| H-6 | OTP 6자리 무차별 | HIGH | 코드 | YES |
| M-1 | 단건/구독 빌링키 불일치 | MED | 코드 | 플립 전 |
| M-2 | 혼합환불 세탁(잠재) | MED | 코드 | 혼합 출시시 |
| M-3 | OTP_SECRET 미설정(갓키 폴백) | MED | 코드 | 하드닝 |
| M-4 | save-result IDOR/ fail-open | MED | 코드 | 하드닝 |
| M-5 | user_badges 위조 | MED | ✅ 201 | YES(B와) |
| L-1~3 | 0-row PATCH·OTP재생·CORS* | LOW | 코드 | 후순위 |

**핵심:** C-1·C-2·C-4·C-5·M-5는 한 구멍 — **신뢰 불가 클라(anon 키)가 무캡·무신원으로 원장을 발권**. 7/1 결제+기부를 금전·법적으로 안전하게 하려면 **B(원장 service_role) + A(RLS 재잠금) + C(어뷰즈/신원)** 가 출시 차단. 그때까지 모든 `point_transactions` 잔액·enrollment·배지는 공격자 통제로 간주.
