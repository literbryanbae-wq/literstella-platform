# PortOne V2 Integration Spec — `literstella-api` (Cloudflare Worker + Browser SDK + Supabase)

> 출처: 세션 31-B 멀티에이전트 리서치(공식문서 11개 에이전트 교차검증, 2026-06-17). DESIGN.md의 ★TODO를 이 문서가 대체한다.
> **검증 범례:** **[CONFIRMED]** 공식 V2 소스 · **[CORRECTED]** 검증에서 수정 · **[NEEDS-CONSOLE]/[UNVERIFIED]** 문서로 확정 불가 → 콘솔/운영자/설치시점 확인 필요.

**Use case:** KRW 3,000/월 카드 구독(자동갱신) + 본인인증(중복가입 방지). 정기결제 = **카드 빌링키**(휴대폰 소액결제 아님).

---

## 1. Credentials & Auth
- REST base: `https://api.portone.io` (V2, V1 iamport와 다름) **[CONFIRMED]**
- 인증 헤더(직접): `Authorization: PortOne {V2_API_SECRET}` — 스킴 단어 `PortOne` + 공백 + 시크릿. **Bearer/storeId 아님** **[CONFIRMED]**
- 대안 인증: `POST /login/api-secret` → accessToken → `Authorization: Bearer {accessToken}` (직접 방식이 더 간단) **[CONFIRMED]**
- `storeId` `store-...` 공개(브라우저 호출마다 전달) **[CONFIRMED]** / `channelKey` `channel-key-...` PG채널당 1개, 주 라우팅 필드 **[CONFIRMED]**
- Browser SDK: `@portone/browser-sdk@0.1.8`, `import * as PortOne from "@portone/browser-sdk/v2"` (생성자 없음, 호출마다 storeId) **[CONFIRMED]**
- Server SDK: `@portone/server-sdk@0.19.0`, ESM, 런타임 의존성 0, 서브패스 `./payment ./payment/billingKey ./webhook ./auth ./identityVerification` **[CONFIRMED]**
- Worker 호환: 서버 SDK는 Web Crypto + Fetch만 사용(Node 빌트인 없음) → Worker-safe **[CONFIRMED]**. 단 실제 wrangler 번들 테스트는 미수행 **[UNVERIFIED]** → **본 구현은 SDK 임포트 대신 plain fetch + Web Crypto로 작성**(번들 불확실성 회피).

## 2. Frontend (Browser SDK)
### 2a. 단건 `PortOne.requestPayment({ storeId, channelKey, paymentId:`payment-${uuid}`, orderName, totalAmount, currency:"CURRENCY_KRW", payMethod:"CARD", customer:{fullName,phoneNumber,email}, redirectUrl })`
- 성공판정: 응답 `code === undefined` → 성공 / `code` 있으면 실패 **[CONFIRMED]**
- 응답: `{paymentId, code, message, pgCode?, pgMessage?, transactionType, txId}` **[CORRECTED]**
- `redirectUrl` 모바일 필수, 모바일 리다이렉트에 `?paymentId=<id>` 부착 **[CONFIRMED]**
- `currency` = `"CURRENCY_KRW"` 사용(`"KRW"`도 타입상 유효하나 전자 유지) **[CONFIRMED/CORRECTED]**
### 2b. 빌링키 발급 `PortOne.requestIssueBillingKey({ storeId, channelKey, billingKeyMethod:"CARD", issueId:`issue-${uuid}`, issueName, customer })`
- ⚠️ 파라미터명 구분: `billingKeyMethod`(≠payMethod) · `issueId`(≠paymentId) · `issueName`(≠orderName) · **금액/통화 없음** **[CONFIRMED]**
- 일부 PG는 발급+첫결제 동시 = `requestIssueBillingKeyAndPay(...)` **[CONFIRMED]**
- 카드정보는 PG창으로만(서버 미경유, PCI 유리) **[CONFIRMED]**
### 2c. PG별
- **KG이니시스(카드):** `CARD`. 빌링키=카드전용, 정기결제 MID(사전계약) 필요, `paymentId`/`issueId` **ASCII만**, 모바일 발급 시 `offerPeriod` **[CONFIRMED]**
- 네이버페이/카카오페이: `EASY_PAY`(easyPayProvider 공백 가능) — 네이버 빌링키는 **결제형** 계정만 **[CONFIRMED]**
- 토스페이먼츠(신모듈): `CARD` 빌링키+스케줄 확인 **[CONFIRMED]**
- 다날: §5 본인인증(카드 구독 아님) **[CONFIRMED]**

## 3. Server (REST, plain fetch)
공통: base `https://api.portone.io`, `Authorization: PortOne {SECRET}`, `encodeURIComponent(paymentId)`.
- **3a. 결제 단건 조회(reconcile):** `GET /payments/{paymentId}` → status 판별유니온(`READY/PAID/CANCELLED/PARTIAL_CANCELLED/FAILED/VIRTUAL_ACCOUNT_ISSUED/PAY_PENDING`), 금액 `amount.total` **[CONFIRMED]**(정확 필드경로 `amount.total`은 [UNVERIFIED] — 첫 테스트로 확인)
- **3b. 서버 금액검증:** 내부 주문금액 vs `payment.amount.total` 비교 + `status==='PAID'` 게이트, 불일치=위조로 거부 **[CONFIRMED]**
- **3c. 빌링키 즉시결제:** `POST /payments/{paymentId}/billing-key` body `{ billingKey(필수), orderName, amount:{total}, currency, customer, storeId, channelKey?, noticeUrls? }`. paymentId = 매 결제 새 고유값. **[CONFIRMED]** (BillingKeyPaymentInput 정확 중첩은 [UNVERIFIED] → 설치 .d.ts로 확인)
- **3d. 정기 = 가맹점 주도 스케줄러(포트원 자동청구 안함):** `POST /payments/{paymentId}/schedule` body `{ timeToPay(RFC3339), payment:{ billingKey, orderName, amount:{total}, currency, customer, storeId, channelKey } }`. 조회 `GET /payment-schedules`, 취소 `DELETE /payment-schedules {billingKey?|scheduleIds[]?, storeId}`(billingKey만 주면 그 키 **전체** 취소). **월 청구는 우리가 실행**(매 사이클 스케줄 또는 cron이 3c 호출) **[CONFIRMED]**
- **3e. 취소/환불:** `POST /payments/{paymentId}/cancel` `{ storeId, amount?(생략=전액), taxFreeAmount?, reason?, refundAccount? }` **[CONFIRMED]**
- **3f. 서버키인 발급(비권장):** `POST /billing-keys` (카드정보 직접 — PCI부담↑, 브라우저 발급 권장). 조회/삭제 `GET|DELETE /billing-keys/{billingKey}` **[CONFIRMED]**
- **3g. 멱등:** 가맹점 고유 `paymentId`가 1차 멱등단위(재사용=중복거부) **[CONFIRMED]**. 추가로 `Idempotency-Key: "<id>"` 헤더(16–256 ASCII, ~3h 재생, 진행중 중복=409) **[CONFIRMED]**

## 4. Webhook — Standard Webhooks(Svix)
- 헤더(대소문자무시): `webhook-id`, `webhook-timestamp`(Unix **초**), `webhook-signature`(`v1,<base64sig>` 공백구분, v1만) — 셋 다 없으면 검증오류 **[CONFIRMED]**
- 알고리즘: **HMAC-SHA256** over `` `${webhook-id}.${webhook-timestamp}.${rawBody}` ``(UTF-8) → **base64** 출력 → timing-safe 비교. **raw 텍스트 body로 검증**(`request.text()`, JSON.parse 먼저 금지) **[CONFIRMED]**
- 시크릿: `whsec_<base64>` → `whsec_` 제거 후 **base64 디코드**한 바이트가 HMAC 키 **[CONFIRMED]**
- 허용오차 ±300s **[CONFIRMED]**
- 검증 방법: `@portone/server-sdk`의 `Webhook.verify(secret, rawString, headers)` 권장(Web표준 API만 → Worker-safe). 또는 위 식 hand-roll. **[CONFIRMED]**
- 페이로드(2024-04-25): `{type, timestamp, data}`. `Transaction.Paid.data = {paymentId, storeId, transactionId}` — **웹훅에 금액/상태 없음** → `getPayment({paymentId})` 재조회 후 금액·상태 비교 **[CONFIRMED]**
- 이벤트: `Transaction.Ready/Paid/VirtualAccountIssued/Failed/PayPending/Confirm/Cancelled/PartialCancelled...`, 빌링키 `BillingKey.Issued/Failed/...`(paymentId 없음 — 월청구는 Transaction.*로 옴) **[CONFIRMED]**
- 멱등 dedupe = **paymentId**(Supabase UNIQUE), at-least-once 전달. 200 반환 전 멱등 DB작업 완료. 검증성공=**200**, 검증실패=**400/401** **[CONFIRMED]**
- 시크릿 발급: 콘솔 → 결제연동 → 연동관리 → **결제알림(Webhook) 관리** → "웹훅 시크릿 발급"(환경당 최대 2개), 엔드포인트 URL 등록 또는 per-request `noticeUrls` **[CONFIRMED]**

## 5. Identity / Danal (본인인증 vs 휴대폰결제 — 별개 채널·계약·SDK콜)
- 본인인증: 브라우저 `PortOne.requestIdentityVerification({ storeId, channelKey, identityVerificationId:`identity-verification-${uuid}`, redirectUrl })` → 성공 시 서버 `GET /identity-verifications/{id}` → `status==='VERIFIED'` 게이트 → `verifiedCustomer{ci,di,name,gender,birthDate,operator,phoneNumber,isForeigner}`. **CI로 중복가입 방지**(CI/DI는 가변길이 text 저장) **[CONFIRMED]**
- 🔴 **다날 기본 본인인증 = phoneNumber 미제공**(ci,di,name,gender,birthDate만). operator/phoneNumber/isForeigner는 **추가계약**(cs@portone.io) 필요 **[CONFIRMED]**
  → **phoneNumber+CI+DI를 추가계약 없이 원하면 KCP 사용 권장** **[CONFIRMED]**

## 6. OPEN ITEMS — 콘솔/운영자/설치시점
- **[CONSOLE]** 채널 생성: (a) 카드 빌링키 채널(KG이니시스/토스, 정기결제 MID=사전 PG계약), (b) 본인인증 채널(다날보다 KCP 권장). 각 channelKey + storeId 기록.
- **[CONSOLE]** V2 API Secret(결제연동) → Worker secret `PORTONE_API_SECRET` ✅(2026-06-17 주입완료)
- **[CONSOLE]** 웹훅 시크릿(`whsec_...`) 발급 → Worker secret `PORTONE_WEBHOOK_SECRET`, 엔드포인트 `https://<literstella-api>/api/payment/webhook` 등록 **(대기)**
- **[OPERATOR/CONTRACT]** KG이니시스(또는 토스) **정기결제 MID/계약** 활성 확인(테스트는 `INIBillTst`로 가능)
- **[OPERATOR]** 본인인증 PG 결정: 다날(폰번호 추가계약) vs KCP(추가계약 불필요)
- **[SCHEMA]** Supabase `payments`·`subscriptions` 테이블 생성(운영자 SQL — DESIGN.md §6)
- **[INSTALL]** SDK 버전 핀(`0.1.8`/`0.19.0`) + 빌링키 결제 바디 정확 중첩을 .d.ts로 확인
- **[PG]** 간편결제(네이버/카카오/토스)의 서버 스케줄 정기결제 지원여부 — 카드 빌링키가 확정 안전

## 7. Scaffold 엔드포인트 매핑
- `POST /api/payment/billing-key/issue` — 프론트 `requestIssueBillingKey` 결과 `billingKey` 수신 → (선택)`GET /billing-keys/{billingKey}` 검증 → Supabase `user_id`↔`billingKey` 저장.
- `POST /api/payment/subscribe` — 빌링키 후 `POST /payments/{newId}/schedule`(다음 사이클) 또는 첫달 즉시청구 후 스케줄. `paymentScheduleId`+`timeToPay` 저장.
- `POST /api/payment/charge` — `POST /payments/{paymentId}/billing-key` 즉시청구. 매 청구 새 paymentId + `Idempotency-Key`. cron 재청구에도 사용.
- `POST /api/payment/webhook` — `raw=request.text()` → 검증 → `Transaction.Paid`면 `getPayment` 재조회 → `status==='PAID' && amount.total===금액` → Supabase 멱등 upsert(dedupe paymentId) → 다음 스케줄. 성공 200 / 검증실패 400.
- `POST /api/payment/cancel` — `POST /payments/{paymentId}/cancel` + `DELETE /payment-schedules{billingKey}` + (전면해지 시)`DELETE /billing-keys/{billingKey}`.

**금액은 항상 서버 상수(클라 금액 신뢰 금지). KRW 3,000/월 구독은 카드 빌링키(KG이니시스/토스) + 본인인증 KCP로 가면 전부 CONFIRMED 영역.**
