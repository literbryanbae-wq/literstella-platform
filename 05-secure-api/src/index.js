// =============================================================
// literstella-api — 보안 백엔드 (관리자 service_role + 포트원 결제)
// ⚠️ 미배포 스캐폴딩. 모든 위험 기능은 env 플래그(ADMIN_API_ENABLED / PAYMENT_ENABLED, 기본 false) 뒤.
//    플래그 OFF면 해당 라우트는 404 → 배포해도 라이브 영향 0.
//    설계: ../DESIGN.md   순서/결정: memory/payment_portone_sequencing.md
//    ★ 표시는 포트원 V2 공식 문서로 정확 스펙 확인 후 채울 자리(추정 금지).
// =============================================================

import { renderEmail, LIFECYCLE } from "./lifecycle-emails.js";

// ── CORS ─────────────────────────────────────────────────
function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allow = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const base = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Token",
    "Access-Control-Max-Age": "86400",
  };
  // 미허용 Origin엔 ACAO 미부여(절대 * 금지) — 결제 API
  return allow.includes(origin) ? { "Access-Control-Allow-Origin": origin, ...base } : base;
}
function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json", ...(cors || {}) } });
}

// ── HMAC (관리자 토큰·OTP 검증) ───────────────────────────
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// 관리자 세션 토큰 발급/검증 (ADMIN_SECRET, 2시간)
async function issueAdminToken(env, email) {
  const exp = Date.now() + 2 * 60 * 60 * 1000;
  const sig = await hmacHex(env.ADMIN_SECRET, `admin:${email}:${exp}`);
  return `${exp}.${sig}`;
}
async function verifyAdminToken(env, token) {
  const [expStr, sig] = String(token || "").split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return null;
  const expected = await hmacHex(env.ADMIN_SECRET, `admin:${env.ADMIN_EMAIL}:${exp}`);
  return timingSafeEq(expected, sig) ? env.ADMIN_EMAIL : null;
}
async function requireAdmin(req, env) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return verifyAdminToken(env, token); // email or null
}
// 사용자 인증: 프론트가 보낸 Supabase access token(X-User-Token)을 서버에서 검증 → {id,email} or null.
// 결제 라우트는 토큰의 검증 user_id만 신뢰(클라가 보낸 userId/email 신뢰 금지 — 타인 빌링키 청구 차단).
async function requireUser(req, env) {
  const tok = req.headers.get("X-User-Token") || "";
  if (!tok) return null;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${tok}` } });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    return u && u.id ? { id: u.id, email: String(u.email || "").toLowerCase() } : null;
  } catch { return null; }
}
// 빌링키가 이 사용자 소유인지 확인(charge/subscribe 시) — 등록(issue) 시 바인딩한 user_id와 대조.
async function billingKeyOwnedBy(env, billingKey, userId) {
  try {
    const r = await sbFetch(env, `subscriptions?billing_key=eq.${encodeURIComponent(billingKey)}&select=user_id`);
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    return !!row && row.user_id === userId;
  } catch { return false; }
}

// ── Supabase REST (service_role — 이 Worker 안에서만) ─────
function sbHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
}
function sbFetch(env, pathAndQuery, init) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, { ...init, headers: { ...sbHeaders(env), ...(init?.headers || {}) } });
}

// ── 관리자 인증: 기존 diag Worker OTP(send-code) 재사용 ───
// 흐름: ① 프론트가 diag Worker /api/send-code 로 운영자 이메일에 코드 발송
//       ② 운영자가 코드 입력 → 여기로 {email, code, token} POST
//       ③ email===ADMIN_EMAIL + OTP 유효 → 관리자 토큰 발급
async function adminOtpRequest(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const email = String(b.email || "").trim().toLowerCase();
  if (!email || email !== String(env.ADMIN_EMAIL || "").trim().toLowerCase()) return json({ ok: false, error: "not_admin" }, 403, cors);
  if (!env.OTP_SECRET) return json({ ok: false, error: "otp_not_configured" }, 503, cors);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const exp = Date.now() + 10 * 60 * 1000;
  const sig = await hmacHex(env.OTP_SECRET, `admin-code:${email}:${code}:${exp}`);
  const token = `${exp}.${sig}`;
  const html = brandEmailHtml(`<div style="font-size:18px;font-weight:800;margin-bottom:12px;">관리자 인증 코드</div><p style="margin:0 0 16px;color:#5a5446;">10분 안에 아래 코드를 관리자 화면에 입력해 주세요.</p><div style="font-size:34px;font-weight:900;letter-spacing:10px;color:#c8a84b;text-align:center;padding:18px;background:#fdf9ee;border:1px dashed #ddca97;border-radius:14px;">${code}</div>`);
  const sent = await sendResendEmail(env, { to: email, subject: "[리터스텔라] 관리자 인증 코드", html });
  if (!sent) return json({ ok: false, error: "send_failed" }, 502, cors);
  return json({ ok: true, token, exp }, 200, cors);
}
async function verifyAdminOtpToken(env, email, code, token) {
  const [expStr, sig] = String(token || "").split(".");
  const exp = Number(expStr);
  if (!env.OTP_SECRET || !exp || !sig || Date.now() > exp) return false;
  const expected = await hmacHex(env.OTP_SECRET, `admin-code:${email}:${code}:${exp}`);
  return timingSafeEq(expected, sig);
}
async function adminAuth(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const email = String(b.email || "").trim().toLowerCase();
  const code = String(b.code || "").trim();
  const token = String(b.token || ""); // diag send-code가 준 OTP 토큰
  if (email !== env.ADMIN_EMAIL) return json({ ok: false, error: "not_admin" }, 403, cors);
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return json({ ok: false, error: "expired" }, 400, cors);
  const valid = await verifyAdminOtpToken(env, email, code, token);
  if (!valid) return json({ ok: false, error: "invalid_code" }, 400, cors);
  return json({ ok: true, adminToken: await issueAdminToken(env, email) }, 200, cors);
}

// ── 관리자 쓰기 (service_role) ────────────────────────────
async function adminWrite(req, env, cors, kind) {
  const admin = await requireAdmin(req, env);
  if (!admin) return json({ ok: false, error: "unauthorized" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  try {
    if (kind === "payment_confirm") {
      const r = await sbFetch(env, `enrollments?id=eq.${encodeURIComponent(b.enrollmentId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: b.paid ? "active" : "pending" }) });
      if (!r.ok) throw new Error("db " + r.status);
    } else if (kind === "enrollment_delete") {
      const r = await sbFetch(env, `enrollments?id=eq.${encodeURIComponent(b.enrollmentId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      if (!r.ok) throw new Error("db " + r.status);
    } else if (kind === "report_status") {
      const patch = { status: b.status }; if (b.adminNote !== undefined) patch.admin_note = b.adminNote;
      const r = await sbFetch(env, `bug_reports?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error("db " + r.status);
    } else if (kind === "book_request_status") {
      const r = await sbFetch(env, `book_requests?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: b.status }) });
      if (!r.ok) throw new Error("db " + r.status);
    } else if (kind === "announce") {
      // 공지 생성/활성토글 — body로 분기 (TODO: submitAnnouncement 스키마 매핑)
      return json({ ok: false, error: "todo_announce" }, 501, cors);
    } else {
      return json({ ok: false, error: "unknown_kind" }, 400, cors);
    }
    return json({ ok: true }, 200, cors);
  } catch (e) { return json({ ok: false, error: "write_failed", detail: String(e).slice(0, 120) }, 502, cors); }
}

// ── 포트원 V2 결제 (검증 스펙: ../PORTONE-V2-SPEC.md, 세션 31-B) ──────────
//    엔드포인트/바디/헤더 모두 공식문서+@portone/server-sdk@0.19.0 .d.ts 대조 완료.
//    금액은 항상 서버 상수(클라 금액 신뢰 금지). 정기결제 = 카드 빌링키 + cron 재청구(이중청구 방지).
const PORTONE_API = "https://api.portone.io";          // V2 base [CONFIRMED]
const YANAWAN_PRICE_KRW = 3000;                         // 서버 가격 상수(빌링키 월구독·레거시)
// 단건 결제 가격표 — 프론트 pricing.js(CHALLENGE_PRICES)와 일치. 금액은 항상 서버가 권위.
const PRICE_BY_GOAL = { 30: 3000, 66: 5800, 100: 9800 };
const YANAWAN_ORDER_NAME = "야나완 영어 챌린지 1개월";
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function portoneHeaders(env, extra) {
  // V2 서버 인증: Authorization: PortOne <API_SECRET> [CONFIRMED]
  return { Authorization: `PortOne ${env.PORTONE_API_SECRET}`, "Content-Type": "application/json", ...(extra || {}) };
}
function newPaymentId() { return `pay${crypto.randomUUID().replace(/-/g, "")}`; } // ASCII·≤40 (이니시스 oid 1~40): 'pay'+32hex=35

// 결제 단건 조회(reconcile) — 웹훅/응답 금액 신뢰 X, 항상 이걸로 확정
async function portoneGetPayment(env, paymentId) {
  const r = await fetch(`${PORTONE_API}/payments/${encodeURIComponent(paymentId)}`, { headers: portoneHeaders(env) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, httpStatus: r.status, status: data?.status, amountTotal: data?.amount?.total, data };
}
// 빌링키 즉시결제: POST /payments/{id}/billing-key (PaymentAmountInput {total} [CONFIRMED .d.ts])
async function portoneChargeBillingKey(env, { paymentId, billingKey, customer }) {
  const body = {
    billingKey, orderName: YANAWAN_ORDER_NAME,
    amount: { total: YANAWAN_PRICE_KRW }, currency: "KRW",   // 서버 통화 = "KRW"
    storeId: env.PORTONE_STORE_ID, channelKey: env.PORTONE_BILLING_CHANNEL_KEY,
    ...(customer ? { customer } : {}),
  };
  const r = await fetch(`${PORTONE_API}/payments/${encodeURIComponent(paymentId)}/billing-key`, {
    method: "POST", headers: portoneHeaders(env, { "Idempotency-Key": paymentId }), body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, httpStatus: r.status, data };
}
async function portoneCancel(env, { paymentId, reason }) {
  const r = await fetch(`${PORTONE_API}/payments/${encodeURIComponent(paymentId)}/cancel`, {
    method: "POST", headers: portoneHeaders(env),
    body: JSON.stringify({ storeId: env.PORTONE_STORE_ID, reason: reason || "user_cancel" }),
  });
  return { ok: r.ok, httpStatus: r.status, data: await r.json().catch(() => ({})) };
}

// payments(id=paymentId PK) 멱등 upsert. on_conflict=id 필수 — 없으면 requested→PAID 갱신이 409로 실패.
async function recordPaymentIdempotent(env, p) {
  try {
    const r = await sbFetch(env, `payments?on_conflict=id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(p) });
    return r.ok;
  } catch { return false; }
}
async function upsertSubscription(env, s) {
  try {
    const r = await sbFetch(env, `subscriptions?on_conflict=billing_key`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(s) });
    return r.ok;
  } catch { return false; }
}
// 1회 청구 + 재조회 확정.
//  paid         = 재조회로 PAID+금액일치 확정
//  pendingVerify = 청구 POST는 접수됐는데 재조회 실패(타임아웃 등) → 절대 재청구 금지, 웹훅/재조회로 확정
async function chargeAndVerify(env, { billingKey, customer, email, userId, source }) {
  const paymentId = newPaymentId();
  await recordPaymentIdempotent(env, { id: paymentId, billing_key: billingKey, email: email || null, user_id: userId || null, amount: YANAWAN_PRICE_KRW, status: "requested", source: source || "charge", created_at: new Date().toISOString() });
  const charge = await portoneChargeBillingKey(env, { paymentId, billingKey, customer });
  const v = await portoneGetPayment(env, paymentId);           // 본문 신뢰 X → 재조회
  const paid = v.ok && v.status === "PAID" && v.amountTotal === YANAWAN_PRICE_KRW;
  // 청구 POST 접수(2xx/paymentId/status 존재)됐는데 재조회가 실패하면 '미확정' — 재청구하면 이중청구
  const chargeAccepted = charge.ok || !!charge.data?.paymentId || !!charge.data?.status;
  const pendingVerify = !paid && !v.ok && chargeAccepted;
  const recordStatus = paid ? "PAID" : pendingVerify ? "pending_verify" : (v.status || (chargeAccepted ? "pending_verify" : "charge_failed"));
  await recordPaymentIdempotent(env, { id: paymentId, status: recordStatus, amount: v.amountTotal ?? null, raw: charge.data, updated_at: new Date().toISOString() });
  return { paid, pendingVerify: recordStatus === "pending_verify", paymentId, portoneStatus: v.status, httpStatus: charge.httpStatus };
}

async function paymentRoute(req, env, cors, sub) {
  // 웹훅: 포트원이 직접 호출(서명검증). 사용자 인증 없음.
  if (sub === "webhook") return paymentWebhook(req, env, cors);

  let b; try { b = await req.json(); } catch { b = {}; }
  const customer = b.customer && typeof b.customer === "object" ? b.customer : undefined;
  const billingKey = String(b.billingKey || "");

  // 해지/환불 — 운영자(관리자 토큰) 전용.
  if (sub === "cancel") {
    const admin = await requireAdmin(req, env);
    if (!admin) return json({ ok: false, error: "unauthorized" }, 401, cors);
    let refunded = null;
    if (b.paymentId) { const c = await portoneCancel(env, { paymentId: String(b.paymentId), reason: b.reason }); refunded = c.ok; }
    if (billingKey && refunded !== false) {        // 환불 실패 시 상태 불일치 방지 위해 canceled 보류
      await upsertSubscription(env, { billing_key: billingKey, status: "canceled", updated_at: new Date().toISOString() });
      await fetch(`${PORTONE_API}/billing-keys/${encodeURIComponent(billingKey)}`, { method: "DELETE", headers: portoneHeaders(env) }).catch(() => {}); // 재청구 불가화
    }
    return json({ ok: true, refunded }, 200, cors);
  }

  // 이하 사용자 결제 라우트 = Supabase 토큰 검증 필수. user_id/email은 검증 토큰에서만(클라 입력 신뢰 X).
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401, cors);

  // 단건 결제 검증 — 프론트 PortOne.requestPayment 후 paymentId 전달. 금액은 서버가 결정(클라 신뢰 X).
  //   goalDays(30/66/100)별 가격표로 검증. 미지정·미등록이면 30일(3,000원)로 폴백.
  if (sub === "pay") {
    const paymentId = String(b.paymentId || "");
    if (!paymentId) return json({ ok: false, error: "no_payment_id" }, 400, cors);
    const goalDays = Number(b.goalDays);
    const expected = PRICE_BY_GOAL[goalDays] || YANAWAN_PRICE_KRW;
    const pay = await portoneGetPayment(env, paymentId);          // 본문 신뢰 X → 재조회
    if (!pay.ok) return json({ ok: false, error: "verify_failed" }, 502, cors);
    const paid = pay.status === "PAID" && pay.amountTotal === expected;
    await recordPaymentIdempotent(env, { id: paymentId, user_id: user.id, email: user.email, amount: pay.amountTotal ?? null, status: pay.status || "unknown", source: "single", updated_at: new Date().toISOString() });
    return paid ? json({ ok: true, paymentId }, 200, cors)
                : json({ ok: false, error: "not_paid", portone: { status: pay.status, amount: pay.amountTotal } }, 402, cors);
  }

  // 빌링키 발급 결과 저장(= user 바인딩). 프론트 requestIssueBillingKey 직후 호출.
  if (sub === "billing-key/issue") {
    if (!billingKey) return json({ ok: false, error: "no_billing_key" }, 400, cors);
    const vr = await fetch(`${PORTONE_API}/billing-keys/${encodeURIComponent(billingKey)}`, { headers: portoneHeaders(env) });
    if (!vr.ok) return json({ ok: false, error: "billing_key_invalid", httpStatus: vr.status }, 400, cors);
    const ex = await sbFetch(env, `subscriptions?billing_key=eq.${encodeURIComponent(billingKey)}&select=user_id`);
    const exRows = ex.ok ? await ex.json().catch(() => []) : [];
    if (Array.isArray(exRows) && exRows[0]?.user_id && exRows[0].user_id !== user.id) return json({ ok: false, error: "billing_key_other_user" }, 409, cors);
    await upsertSubscription(env, { billing_key: billingKey, email: user.email, user_id: user.id, status: "registered", created_at: new Date().toISOString() });
    return json({ ok: true }, 200, cors);
  }

  // 단건 청구 / 구독 시작 — 빌링키가 이 사용자 소유여야 함(타인 키 청구 차단).
  if (sub === "charge" || sub === "subscribe") {
    if (!billingKey) return json({ ok: false, error: "no_billing_key" }, 400, cors);
    if (!(await billingKeyOwnedBy(env, billingKey, user.id))) return json({ ok: false, error: "billing_key_not_owned" }, 403, cors);
    const r = await chargeAndVerify(env, { billingKey, customer, email: user.email, userId: user.id, source: sub });
    if (r.pendingVerify) return json({ ok: false, pending: true, error: "charge_pending_verify", paymentId: r.paymentId }, 202, cors); // 재시도 금지
    if (!r.paid) return json({ ok: false, error: "charge_not_paid", portone: { status: r.portoneStatus } }, 402, cors);
    if (sub === "subscribe") {
      const next = new Date(Date.now() + MONTH_MS).toISOString();
      await upsertSubscription(env, { billing_key: billingKey, email: user.email, user_id: user.id, status: "active", next_charge_at: next, last_payment_id: r.paymentId, updated_at: new Date().toISOString() });
      return json({ ok: true, paymentId: r.paymentId, nextChargeAt: next }, 200, cors);
    }
    return json({ ok: true, paymentId: r.paymentId }, 200, cors);
  }

  return json({ ok: false, error: "unknown_payment_route" }, 404, cors);
}

// 웹훅: Standard Webhooks(Svix) 서명검증 → 포트원 재조회 → 멱등 DB 반영
async function paymentWebhook(req, env, cors) {
  const raw = await req.text();                              // 반드시 raw 텍스트로 검증
  const ok = await verifyPortoneWebhook(env, raw, req.headers.get("webhook-id"), req.headers.get("webhook-timestamp"), req.headers.get("webhook-signature"));
  if (!ok) return json({ ok: false, error: "bad_signature" }, 400, cors);
  let evt; try { evt = JSON.parse(raw); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const type = String(evt?.type || "");
  const paymentId = evt?.data?.paymentId;
  // 결제(Transaction.*) 이벤트만 처리 — BillingKey.* 등은 paymentId 없음 → 즉시 ack
  if (!paymentId || !type.startsWith("Transaction.")) return json({ ok: true, note: "ignored" }, 200, cors);
  const pay = await portoneGetPayment(env, paymentId);       // 웹훅 본문 금액/상태 신뢰 X → 재조회(권위)
  if (!pay.ok) return json({ ok: false, error: "reverify_failed_retry" }, 500, cors); // 확인 불가 → 포트원 재전송
  const recorded = await recordPaymentIdempotent(env, { id: String(paymentId), status: pay.status || "unknown", amount: pay.amountTotal ?? null, raw: evt, updated_at: new Date().toISOString() });
  if (pay.status === "PAID" && pay.amountTotal === YANAWAN_PRICE_KRW) {
    const okSub = await reconcilePaidSubscription(env, paymentId);
    if (!recorded || !okSub) return json({ ok: false, error: "persist_failed_retry" }, 500, cors); // 비2xx → 포트원 재시도
  }
  return json({ ok: true }, 200, cors);
}
// 결제 성공 → 해당 구독 active 유지 + next_charge_at 보정(없으면 +30일). 청구 자체는 cron이 함.
async function reconcilePaidSubscription(env, paymentId) {
  try {
    const r = await sbFetch(env, `subscriptions?last_payment_id=eq.${encodeURIComponent(paymentId)}&select=billing_key,next_charge_at`);
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.billing_key) return true;                       // 구독 외 단건이면 ack
    const next = row.next_charge_at || new Date(Date.now() + MONTH_MS).toISOString();
    await upsertSubscription(env, { billing_key: row.billing_key, status: "active", next_charge_at: next, updated_at: new Date().toISOString() });
    return true;
  } catch { return false; }
}

// ── Standard Webhooks(Svix) 검증: HMAC-SHA256(base64) over `${id}.${ts}.${raw}` ──
//    key = base64decode(whsec_ 제거), 허용오차 ±300s, sig = "v1,<base64> ..." (v1만)
function b64ToBytes(b64) { const s = atob(b64); const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
async function hmacSha256Base64(keyBytes, msg) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  let bin = ""; for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]);
  return btoa(bin);
}
async function verifyPortoneWebhook(env, raw, id, ts, sig) {
  const secret = env.PORTONE_WEBHOOK_SECRET;
  if (!secret || !id || !ts || !sig) return false;
  const now = Math.floor(Date.now() / 1000), tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 300) return false;      // ±5분
  let keyBytes; try { keyBytes = b64ToBytes(secret.startsWith("whsec_") ? secret.slice(6) : secret); } catch { return false; }
  let expected; try { expected = await hmacSha256Base64(keyBytes, `${id}.${ts}.${raw}`); } catch { return false; }
  return String(sig).split(" ").some(part => {
    const c = part.indexOf(",");
    return c > 0 && part.slice(0, c) === "v1" && timingSafeEq(part.slice(c + 1), expected);
  });
}

// ── 이메일 인증 OTP (회원가입) — Resend 발송 + 무상태 HMAC. 진단 Worker와 OTP_SECRET 공유. ──
//   토큰 = `${exp}.${hmacHex(OTP_SECRET,"code:email:code:exp")}` (admin/diag 동일 서명식).
//   플래그 없이 항상 열림. ⚠️ rate-limit은 WAF/KV 백로그(diag_email_otp). 무료티어 발송한도가 1차 방어.
const OTP_TTL_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 모든 Resend 브랜드 메일 공통 골격(로고 + 야나완/챌린지/클래스 푸터). bodyHtml만 교체.
function brandEmailHtml(bodyHtml) {
  return `<!doctype html><html lang="ko"><body style="margin:0;background:#f4f1ea;font-family:'Apple SD Gothic Neo',Arial,sans-serif;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:32px 0;"><tr><td align="center">`
    + `<table role="presentation" width="100%" style="max-width:480px;background:#fffdf8;border-radius:18px;overflow:hidden;border:1px solid #e8e2d4;">`
    + `<tr><td style="padding:26px 32px 8px;text-align:center;"><img src="https://challenge.literstella.co.kr/logo-symbol.png" alt="" width="46" height="46" style="display:inline-block;margin-bottom:6px;" /><br /><img src="https://challenge.literstella.co.kr/logo-literstella-en.png" alt="LiterStella" height="22" style="display:inline-block;" /></td></tr>`
    + `<tr><td style="padding:12px 32px 28px;color:#1d2433;font-size:15px;line-height:1.7;">${bodyHtml}</td></tr>`
    + `<tr><td style="padding:20px 32px;border-top:1px solid #efe9da;background:#faf7ef;text-align:center;font-size:12px;color:#8a8270;">`
    + `<a href="https://read.literstella.co.kr" style="color:#c8a84b;text-decoration:none;margin:0 8px;">📖 MY READ TO SPEAK</a>`
    + `<a href="https://challenge.literstella.co.kr" style="color:#c8a84b;text-decoration:none;margin:0 8px;">🏆 영어 챌린지 야나완™</a>`
    + `<a href="https://class.literstella.co.kr/classes" style="color:#c8a84b;text-decoration:none;margin:0 8px;">🎓 클래식 원서 강독</a>`
    + `<div style="margin-top:12px;color:#b0a892;">© LiterStella · 영어 원서를 끝까지 읽는 습관</div>`
    + `</td></tr></table></td></tr></table></body></html>`;
}
function otpEmailHtml(code) {
  const body = `<div style="font-size:18px;font-weight:800;margin-bottom:8px;">이메일 인증 코드</div>`
    + `<p style="margin:0 0 16px;color:#5a5446;">아래 6자리 코드를 회원가입 화면에 입력해 주세요. (10분 내 유효)</p>`
    + `<div style="font-size:34px;font-weight:900;letter-spacing:10px;color:#c8a84b;text-align:center;padding:18px;background:#fdf9ee;border:1px dashed #ddca97;border-radius:14px;">${code}</div>`
    + `<p style="margin:16px 0 0;font-size:13px;color:#8a8270;">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>`;
  return brandEmailHtml(body);
}
async function sendResendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) return false;
  const from = env.RESEND_FROM || "LiterStella <onboarding@resend.dev>"; // 도메인 인증 후 인증@literstella.co.kr
  // 429/5xx 지수 백오프 재시도 2회 + 실패 로깅(발송 감사 2026-07-20 P0: 대량 유입 시 순간 레이트 초과가 조용한 send_failed로 전락하던 것).
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, html }),
      });
      if (r.ok) return true;
      const retryable = r.status === 429 || r.status >= 500;
      let detail = "";
      try { detail = (await r.text()).slice(0, 160); } catch { /* noop */ }
      console.log(JSON.stringify({ evt: "resend_fail", status: r.status, attempt, retryable, subject: subject.slice(0, 30), detail }));
      if (!retryable || attempt === 2) return false;
    } catch (e) {
      console.log(JSON.stringify({ evt: "resend_fail", status: "network", attempt, detail: String(e).slice(0, 120) }));
      if (attempt === 2) return false;
    }
    await new Promise((res) => setTimeout(res, 400 * Math.pow(2, attempt))); // 0.4s → 0.8s
  }
  return false;
}

// Resend 마케팅 플랜의 1회 대상 한도에 맞춘 애플리케이션 세그먼트.
// Resend API batch 자체는 최대 100건이므로, 선택된 1,000명 세그먼트를 100건씩 전송한다.
const RESEND_AUDIENCE_SEGMENT_SIZE = 1000;
const RESEND_BATCH_SIZE = 100;
function parseAudienceSegment(raw) {
  const value = raw === undefined || raw === null || raw === "" ? 1 : Number(raw);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}
function getAudienceSegment(emails, segment) {
  const totalSegments = Math.ceil(emails.length / RESEND_AUDIENCE_SEGMENT_SIZE);
  const start = (segment - 1) * RESEND_AUDIENCE_SEGMENT_SIZE;
  return {
    segment,
    totalSegments,
    recipients: emails.slice(start, start + RESEND_AUDIENCE_SEGMENT_SIZE),
  };
}
async function sendResendBatch(env, { to, subject, html, templateId }) {
  if (!env.RESEND_API_KEY || !Array.isArray(to) || !to.length) return { sent: 0, failed: 0 };
  const from = env.RESEND_FROM || "LiterStella <onboarding@resend.dev>";
  let sent = 0;
  let failed = 0;
  for (let offset = 0; offset < to.length; offset += RESEND_BATCH_SIZE) {
    const batch = to.slice(offset, offset + RESEND_BATCH_SIZE).map(email => {
      const message = { from, to: [email] };
      if (templateId) message.template = { id: templateId };
      else Object.assign(message, { subject, html });
      return message;
    });
    let ok = false;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const r = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(batch),
        });
        if (r.ok) { ok = true; break; }
        if (r.status !== 429 && r.status < 500) break;
      } catch { /* retry below */ }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
    if (ok) sent += batch.length;
    else failed += batch.length;
  }
  return { sent, failed };
}

const RESEND_TEMPLATE_ALIASES = { newSpaceAnnouncement: "new-space-announcement" };
async function fetchResendAudienceEmails(env) {
  if (!env.RESEND_API_KEY) return { ok: false, error: "resend_key_missing" };
  try {
    // Resend contacts API supports returning the complete contact list when limit is omitted.
    const r = await fetch("https://api.resend.com/contacts", {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    if (!r.ok) return { ok: false, error: "resend_contacts_failed", status: r.status };
    const body = await r.json().catch(() => null);
    const emails = [...new Set((Array.isArray(body?.data) ? body.data : [])
      .filter(contact => contact && contact.unsubscribed !== true)
      .map(contact => String(contact.email || "").trim().toLowerCase())
      .filter(email => EMAIL_RE.test(email)))].sort();
    return { ok: true, emails };
  } catch { return { ok: false, error: "resend_contacts_network" }; }
}
// 라이프사이클 정보성 메일 발송. {to, key, data} → renderEmail → {{unsubscribe}} 치환 → Resend.
async function lifecycleEmail(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const to = String(b.to || "").trim().toLowerCase();
  const key = String(b.key || "").trim();
  if (!EMAIL_RE.test(to) || to.length > 254) return json({ ok: false, error: "bad_email" }, 400, cors);
  if (!LIFECYCLE[key]) return json({ ok: false, error: "bad_key" }, 400, cors);
  const data = (b.data && typeof b.data === "object") ? b.data : {};
  let rendered;
  try { rendered = renderEmail(key, data); } catch { return json({ ok: false, error: "render" }, 500, cors); }
  // 정보성 수신 설정 링크(마이페이지 알림설정). 추후 토큰형 수신거부로 교체 가능.
  const unsub = `<a href="https://challenge.literstella.co.kr/?view=settings" style="color:#c8a84b;text-decoration:none;">수신 설정</a> · 발신: 리터스텔라`;
  const html = rendered.html.replace(/\{\{unsubscribe\}\}/g, unsub);
  const ok = await sendResendEmail(env, { to, subject: rendered.subject, html });
  return json({ ok }, ok ? 200 : 502, cors);
}
async function otpSend(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const email = String(b.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ ok: false, error: "bad_email" }, 400, cors);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const exp = Date.now() + OTP_TTL_MS;
  const sig = await hmacHex(env.OTP_SECRET, `code:${email}:${code}:${exp}`);
  const sent = await sendResendEmail(env, { to: email, subject: "[리터스텔라] 이메일 인증 코드", html: otpEmailHtml(code) });
  if (!sent) return json({ ok: false, error: "send_failed" }, 502, cors);
  return json({ ok: true, token: `${exp}.${sig}`, exp }, 200, cors);
}
async function otpVerify(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const email = String(b.email || "").trim().toLowerCase();
  const code = String(b.code || "").trim();
  const [expStr, sig] = String(b.token || "").split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return json({ ok: false, error: "expired" }, 400, cors);
  if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  const expected = await hmacHex(env.OTP_SECRET, `code:${email}:${code}:${exp}`);
  if (!timingSafeEq(expected, sig)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  return json({ ok: true }, 200, cors);
}

// ── 강독 클래스 소장회원 인증(6강+ 해금) ──
//   OTP HMAC 검증(otpVerify와 동일 서명식) = 이메일 소유 증명 → class_enrollments(명단) 대조 →
//   진짜 수강생이면 class_verifications(email, book_code) 기록(멱등). 게이트 워커가 이 행만 6강+ 자격으로 인정.
//   ⚠️ 이메일만 알면 signUp으로 JWT 얻어도, 그 이메일 OTP는 못 받으므로 verifications 못 만듦 = 탈취 차단.
async function classVerifyOtp(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const email = String(b.email || "").trim().toLowerCase();
  const code = String(b.code || "").trim();
  const book = String(b.book || "kidari").trim().toLowerCase();
  const [expStr, sig] = String(b.token || "").split(".");
  const exp = Number(expStr);
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ ok: false, error: "bad_email" }, 400, cors);
  if (!exp || !sig || Date.now() > exp) return json({ ok: false, error: "expired" }, 400, cors);
  if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  const expected = await hmacHex(env.OTP_SECRET, `code:${email}:${code}:${exp}`);
  if (!timingSafeEq(expected, sig)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  // 이메일 소유 증명됨 → 수강 명단 대조(service_role).
  //   🔴 인증 1회 = 평생소장 전부(운영자 2026-07-20): 요청한 강좌 하나가 아니라 이 이메일이 명단에 있는
  //   모든 book_code에 verifications를 일괄 심는다 — 다른 소장 강좌는 재인증 없이 즉시 열림.
  const enr = await sbFetch(env, `class_enrollments?email=eq.${encodeURIComponent(email)}&select=book_code`);
  const books = enr.ok ? [...new Set(((await enr.json()) || []).map(r => r.book_code).filter(Boolean))] : [];
  if (!books.length) return json({ ok: false, notEnrolled: true, message: "이 이메일은 강독 클래스 수강 명단에 없어요. 결제하신 이메일이 맞는지 확인해 주세요." }, 200, cors);
  const ins = await sbFetch(env, `class_verifications`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(books.map(bc => ({ email, book_code: bc }))),
  });
  if (!ins.ok && ins.status !== 409) return json({ ok: false, error: "record_failed" }, 502, cors);
  if (!books.includes(book)) {
    return json({ ok: false, notEnrolled: true, granted: books, message: "이 강좌는 수강 명단에 없어요. 대신 소장하신 다른 강좌는 지금 인증으로 함께 열렸어요." }, 200, cors);
  }
  return json({ ok: true, granted: books }, 200, cors);
}

// ── 결제 이메일 ≠ 로그인 이메일 수강생 셀프서비스 연결 (2026-07-18, 운영자: 코드 수동발급은 3천명 규모 불가) ──
//   로그인 계정(X-User-Token JWT) + 결제 이메일 OTP(받은편지함 소유 증명) → 명단 대조 →
//   class_verifications(email=로그인, enrollment_email=결제) 기록 → 게이트는 기존 로직(로그인 이메일 조회) 그대로 통과.
//   🔒 1회 귀속: 한 결제 이메일은 한 계정에만(unique index가 레이스까지 최종 방어) — 수강권 다계정 공유 차단.
//   인증 코드(수동 발급)는 예외 폴백으로 유지.
async function classLinkEnrollment(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user?.email) return json({ ok: false, error: "unauthorized" }, 401, cors);
  const loginEmail = user.email;
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const enrollEmail = String(b.email || "").trim().toLowerCase();
  const code = String(b.code || "").trim();
  const book = String(b.book || "kidari").trim().toLowerCase();
  const [expStr, sig] = String(b.token || "").split(".");
  const exp = Number(expStr);
  if (!EMAIL_RE.test(enrollEmail) || enrollEmail.length > 254) return json({ ok: false, error: "bad_email" }, 400, cors);
  if (!exp || !sig || Date.now() > exp) return json({ ok: false, error: "expired" }, 400, cors);
  if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  const expected = await hmacHex(env.OTP_SECRET, `code:${enrollEmail}:${code}:${exp}`);
  if (!timingSafeEq(expected, sig)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  // 결제 이메일 소유 증명됨 → 수강 명단 대조.
  //   🔴 인증 1회 = 평생소장 전부(운영자 2026-07-20): 이 결제 이메일이 명단에 있는 모든 book_code를 로그인 계정에 일괄 귀속.
  const enr = await sbFetch(env, `class_enrollments?email=eq.${encodeURIComponent(enrollEmail)}&select=book_code`);
  const books = enr.ok ? [...new Set(((await enr.json()) || []).map(r => r.book_code).filter(Boolean))] : [];
  if (!books.length) return json({ ok: false, notEnrolled: true, message: "이 이메일은 수강 명단에 없어요. 결제하신 이메일이 맞는지 확인해 주세요." }, 200, cors);
  // 1회 귀속 사전 확인(친절 메시지용 — 최종 방어는 unique index): 어느 강좌든 다른 계정에 이미 귀속된 메일이면 전체 차단(공유 루프홀 방지).
  const linked = await sbFetch(env, `class_verifications?enrollment_email=eq.${encodeURIComponent(enrollEmail)}&select=email&limit=5`);
  if (linked.ok) {
    const rows = (await linked.json()) || [];
    if (rows.some(r => r.email !== loginEmail)) {
      return json({ ok: false, alreadyLinked: true, message: "이 결제 이메일은 이미 다른 계정에 연결돼 있어요. 그 계정으로 로그인하시거나, 본인 수강권이 맞는데 연결이 안 된다면 카카오 채널로 문의해 주세요." }, 200, cors);
    }
  }
  const ins = await sbFetch(env, `class_verifications`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(books.map(bc => ({ email: loginEmail, book_code: bc, enrollment_email: enrollEmail }))),
  });
  if (!ins.ok) {
    const t = await ins.text().catch(() => "");
    // enrollment_email 컬럼 미존재(운영자 SQL 전) → 기능 대기 안내(코드 폴백 유도)
    if (/enrollment_email|42703|PGRST204/i.test(t)) return json({ ok: false, error: "sql_pending", message: "지금은 자동 연결 준비 중이에요. 인증 코드로 연결해 주세요." }, 200, cors);
    // unique index 충돌(동시 연결 레이스) = 다른 계정이 먼저 귀속
    if (ins.status === 409 || /23505|duplicate/i.test(t)) {
      // 로그인 계정 자신의 (email,book) PK 중복이면 멱등 성공
      const mine = await sbFetch(env, `class_verifications?email=eq.${encodeURIComponent(loginEmail)}&book_code=eq.${encodeURIComponent(book)}&select=email&limit=1`);
      if (mine.ok && (await mine.json()).length) return json({ ok: true, granted: books }, 200, cors);
      return json({ ok: false, alreadyLinked: true, message: "이 결제 이메일은 이미 다른 계정에 연결돼 있어요." }, 200, cors);
    }
    return json({ ok: false, error: "record_failed" }, 502, cors);
  }
  if (!books.includes(book)) {
    return json({ ok: false, notEnrolled: true, granted: books, message: "이 강좌는 수강 명단에 없어요. 대신 소장하신 다른 강좌는 지금 인증으로 함께 연결됐어요." }, 200, cors);
  }
  return json({ ok: true, granted: books }, 200, cors);
}

// ── 본인인증(통합인증) 결과 조회 — identityVerificationId로 PortOne 조회 → verifiedCustomer. ──
//   PORTONE_API_SECRET 사용. id는 unguessable UUID라 플래그 없이 열되, 운영 시 user 토큰 게이트 권장.
async function identityVerify(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const id = String(b.identityVerificationId || "");
  if (!id) return json({ ok: false, error: "no_id" }, 400, cors);
  if (!env.PORTONE_API_SECRET) return json({ ok: false, error: "no_secret" }, 500, cors);
  const r = await fetch(`${PORTONE_API}/identity-verifications/${encodeURIComponent(id)}`, { headers: portoneHeaders(env) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return json({ ok: false, error: "lookup_failed", httpStatus: r.status }, 502, cors);
  const verified = data?.status === "VERIFIED";
  const vc = data?.verifiedCustomer || {};
  // 비-민감 식별정보만 반환(ci/di는 서버 보관용 — 중복가입 검사 등은 서버에서). 클라엔 표시 필드만.
  return json({ ok: true, verified, customer: verified ? { name: vc.name || null, phoneNumber: vc.phoneNumber || null, gender: vc.gender || null, birthDate: vc.birthDate || null, isForeigner: vc.isForeigner ?? null } : null }, 200, cors);
}

// ── 원서 등록 신청 → 관리자 메일 알림 (Resend). 플래그 없이 항상 열림. ──
function escHtml(s) { return String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
async function notifyBookRequest(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  if (!env.ADMIN_EMAIL) return json({ ok: false, error: "no_admin" }, 200, cors);
  const title = escHtml(String(b.title || "").slice(0, 200));
  const rawUrl = String(b.editionUrl || "").slice(0, 500);
  const safeUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : "";
  const who = escHtml(`${String(b.nickname || "").slice(0, 50)} (${String(b.email || "").slice(0, 120)})`);
  const hasCover = b.hasCover || /^data:image\//.test(String(b.coverData || ""));
  // 메일에 base64 표지를 인라인하면 Gmail 등 웹메일이 data: URI를 차단해 깨짐 → 텍스트 안내 + 관리자 패널에서 실제 표지 확인.
  const body = `<div style="font-size:18px;font-weight:800;margin-bottom:10px;">📚 새 원서 등록 신청</div>`
    + `<p style="margin:0 0 8px;">제목: <strong>${title || "(제목 없음)"}</strong></p>`
    + (safeUrl ? `<p style="margin:0 0 8px;">판본 URL: <a href="${escHtml(safeUrl)}" style="color:#c8a84b;">${escHtml(safeUrl)}</a></p>` : "")
    + (hasCover ? `<p style="margin:0 0 8px;color:#3ab870;">🖼️ 표지 이미지 업로드됨 — 관리자 패널에서 확인</p>` : "")
    + `<p style="margin:0 0 8px;color:#5a5446;">신청자: ${who}</p>`
    + `<p style="margin:16px 0 0;font-size:13px;color:#8a8270;">관리자 패널 '원서 등록 신청' 탭에서 승인 후, Claude에게 알려 정식 등록하세요.</p>`;
  const ok = await sendResendEmail(env, { to: env.ADMIN_EMAIL, subject: `[리터스텔라] 원서 등록 신청: ${String(b.title || "").slice(0, 60)}`, html: brandEmailHtml(body) });
  return json({ ok }, 200, cors);
}

// ── 「클래식 영어 한 문장」 새 회차 알림 발송 (Resend 이메일 + Lyra 인앱 broadcast) ──
//   철칙: 이메일=티저+링크만(해설/낭독은 페이지에만 산다). 회차 데이터는 라이브 공개 JSON에서 조회.
//   mode: 'dry'(수신자 수만) · 'test'(ADMIN_EMAIL만) · 'send'(active 전체, SENTENCE_SEND_ENABLED='true' 필요).
//   발송 스위치 OFF가 기본 → 실수 대량발송 차단. 발행 알림은 sentence_broadcasts에 기록(Lyra 인앱이 읽음).
const SENTENCE_SITE = "https://challenge.literstella.co.kr";
function sentenceEmailHtml(ep) {
  const link = `${SENTENCE_SITE}/?sentence=${encodeURIComponent(ep.id)}`;
  const day = Number(ep.day) || "";
  const body = `<div style="font-size:11px;letter-spacing:2px;color:#c8a84b;font-weight:800;margin-bottom:6px;">오늘의 한 문장 · Day ${day}</div>`
    + `<div style="font-size:17px;font-weight:800;margin-bottom:14px;">${escHtml(ep.book || "")}</div>`
    + `<div style="font-family:Georgia,serif;font-style:italic;font-size:16px;line-height:1.6;color:#2a2416;border-left:3px solid #c8a84b;padding:2px 0 2px 14px;margin-bottom:14px;">“${escHtml(ep.sentenceEn || "")}”</div>`
    + `<p style="margin:0 0 20px;color:#5a5446;font-size:14px;line-height:1.7;">${escHtml(ep.sentenceKo || "")}</p>`
    + `<div style="text-align:center;margin:8px 0 4px;"><a href="${link}" style="display:inline-block;background:#c8a84b;color:#20160a;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:12px;font-size:14px;">스텔라의 낭독·해설 들으러 가기 →</a></div>`
    + `<p style="margin:16px 0 0;font-size:12px;color:#8a8270;text-align:center;">문장의 해설과 3분 오디오는 페이지에서 만나요.</p>`;
  return brandEmailHtml(body);
}
async function sendSentenceDigest(req, env, cors) {
  const admin = await requireAdmin(req, env);
  if (!admin) return json({ ok: false, error: "unauthorized" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const id = String(b.episodeId || "").trim();
  const mode = String(b.mode || "dry"); // dry | test | send
  const segment = parseAudienceSegment(b.segment);
  if (!segment) return json({ ok: false, error: "bad_segment", hint: "segment는 1 이상의 정수" }, 400, cors);
  if (!/^[a-z]+-\d+$/.test(id)) return json({ ok: false, error: "bad_id" }, 400, cors);
  // 회차 데이터 = 라이브 공개 JSON(제목/문장/링크). 해설(reading/oneMin)은 메일에 안 넣음.
  let ep;
  try { const r = await fetch(`${SENTENCE_SITE}/stella/sentence/${id}.json`); ep = r.ok ? await r.json() : null; } catch { ep = null; }
  if (!ep || !ep.sentenceEn) return json({ ok: false, error: "episode_not_found" }, 404, cors);
  const subject = `[💌뉴스레터] ${ep.book} 원서 ☀️오늘 하루를 여는 클래식 영어 한 문장`;
  const html = sentenceEmailHtml(ep);
  // active 구독자
  let subs = [];
  try { const r = await sbFetch(env, `sentence_subscribers?active=eq.true&select=email&order=email.asc`); subs = r.ok ? await r.json().catch(() => []) : []; } catch { subs = []; }
  const emails = [...new Set((Array.isArray(subs) ? subs : []).map(s => String(s.email || "").toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  const selected = getAudienceSegment(emails, segment);
  if (selected.totalSegments > 0 && segment > selected.totalSegments) {
    return json({ ok: false, error: "segment_out_of_range", mode, segment, totalSegments: selected.totalSegments, recipients: emails.length }, 400, cors);
  }
  // Lyra 인앱 발행 알림 기록(test/send 시)
  if (mode === "test" || mode === "send") {
    await sbFetch(env, `sentence_broadcasts`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ episode_id: ep.id, book: ep.book, day: ep.day, title: ep.readingTitle || "", sentence_ko: ep.sentenceKo || "" }) }).catch(() => {});
  }
  if (mode === "dry") return json({ ok: true, mode, segment, totalSegments: selected.totalSegments, segmentRecipients: selected.recipients.length, recipients: emails.length }, 200, cors);
  if (mode === "test") {
    const ok = env.ADMIN_EMAIL ? await sendResendEmail(env, { to: env.ADMIN_EMAIL, subject, html }) : false;
    return json({ ok, mode, segment, totalSegments: selected.totalSegments, segmentRecipients: selected.recipients.length, sentTo: env.ADMIN_EMAIL, recipients: emails.length }, ok ? 200 : 502, cors);
  }
  // mode === 'send' — 대량 발송(스위치 필요)
  if (env.SENTENCE_SEND_ENABLED !== "true") return json({ ok: false, error: "send_disabled", hint: "SENTENCE_SEND_ENABLED=true 설정 후 발송" }, 403, cors);
  const { sent, failed } = await sendResendBatch(env, { to: selected.recipients, subject, html });
  return json({ ok: true, mode, segment, totalSegments: selected.totalSegments, sent, failed, segmentRecipients: selected.recipients.length, recipients: emails.length }, 200, cors);
}

// ── 콘텐츠 업데이트 알림 발송 (강독·HP 편지 등 — send-sentence의 범용 복제) ──
//   audience별 구독 테이블 화이트리스트(운영자 확정: 스트림별 '별개 구독' = 별도 테이블).
//   이메일 = 티저+링크만(콘텐츠는 페이지에만 산다 — 한 문장 철칙과 동일).
//   mode: 'dry'(수신자 수만) · 'test'(ADMIN_EMAIL만) · 'send'(active 전체, CONTENT_SEND_ENABLED='true' 필요).
//   콘텐츠 팩토리 publish 런북이 호출(운영자 GO 후) — E:\LiterStella_전사\factory\runbooks\publish.md
const CONTENT_AUDIENCES = { lecture: "lecture_subscribers", hp: "hp_subscribers" };
const CONTENT_LINK_ORIGINS = ["https://challenge.literstella.co.kr", "https://read.literstella.co.kr", "https://class-new.literstella.co.kr", "https://class.literstella.co.kr"];
function contentEmailHtml(p) {
  const body = `<div style="font-size:11px;letter-spacing:2px;color:#c8a84b;font-weight:800;margin-bottom:6px;">${escHtml(p.kicker || "새 콘텐츠가 올라왔어요")}</div>`
    + `<div style="font-size:17px;font-weight:800;margin-bottom:6px;">${escHtml(p.title || "")}</div>`
    + (p.book ? `<div style="font-size:13px;color:#8a8270;margin-bottom:14px;">${escHtml(p.book)}</div>` : "")
    + (p.teaser ? `<p style="margin:0 0 20px;color:#5a5446;font-size:14px;line-height:1.7;">${escHtml(p.teaser)}</p>` : "")
    + `<div style="text-align:center;margin:8px 0 4px;"><a href="${escHtml(p.link)}" style="display:inline-block;background:#c8a84b;color:#20160a;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:12px;font-size:14px;">지금 보러 가기 →</a></div>`
    + `<p style="margin:16px 0 0;font-size:12px;color:#8a8270;text-align:center;">전체 내용은 페이지에서 만나요.</p>`;
  return brandEmailHtml(body);
}
async function sendContentUpdate(req, env, cors) {
  const admin = await requireAdmin(req, env);
  if (!admin) return json({ ok: false, error: "unauthorized" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const audience = String(b.audience || "").trim();
  const table = CONTENT_AUDIENCES[audience];
  if (!table) return json({ ok: false, error: "bad_audience", allowed: Object.keys(CONTENT_AUDIENCES) }, 400, cors);
  const mode = String(b.mode || "dry"); // dry | test | send
  const segment = parseAudienceSegment(b.segment);
  if (!segment) return json({ ok: false, error: "bad_segment", hint: "segment는 1 이상의 정수" }, 400, cors);
  const title = String(b.title || "").trim().slice(0, 120);
  const link = String(b.link || "").trim();
  if (!title) return json({ ok: false, error: "title_required" }, 400, cors);
  if (!CONTENT_LINK_ORIGINS.some(o => link.startsWith(o + "/") || link.startsWith(o + "?"))) return json({ ok: false, error: "bad_link", allowed: CONTENT_LINK_ORIGINS }, 400, cors);
  const subject = String(b.subject || "").trim().slice(0, 150) || `[리터스텔라] ${title}`;
  const html = contentEmailHtml({ kicker: b.kicker, title, book: b.book, teaser: String(b.teaser || "").slice(0, 400), link });
  let subs = [];
  try { const r = await sbFetch(env, `${table}?active=eq.true&select=email&order=email.asc`); subs = r.ok ? await r.json().catch(() => []) : []; } catch { subs = []; }
  const emails = [...new Set((Array.isArray(subs) ? subs : []).map(s => String(s.email || "").toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  const selected = getAudienceSegment(emails, segment);
  if (selected.totalSegments > 0 && segment > selected.totalSegments) {
    return json({ ok: false, error: "segment_out_of_range", mode, audience, segment, totalSegments: selected.totalSegments, recipients: emails.length }, 400, cors);
  }
  if (mode === "dry") return json({ ok: true, mode, audience, segment, totalSegments: selected.totalSegments, segmentRecipients: selected.recipients.length, recipients: emails.length }, 200, cors);
  if (mode === "test") {
    const ok = env.ADMIN_EMAIL ? await sendResendEmail(env, { to: env.ADMIN_EMAIL, subject, html }) : false;
    return json({ ok, mode, audience, segment, totalSegments: selected.totalSegments, segmentRecipients: selected.recipients.length, sentTo: env.ADMIN_EMAIL, recipients: emails.length }, ok ? 200 : 502, cors);
  }
  if (env.CONTENT_SEND_ENABLED !== "true") return json({ ok: false, error: "send_disabled", hint: "CONTENT_SEND_ENABLED=true 설정 후 발송" }, 403, cors);
  const { sent, failed } = await sendResendBatch(env, { to: selected.recipients, subject, html });
  return json({ ok: true, mode, audience, segment, totalSegments: selected.totalSegments, sent, failed, segmentRecipients: selected.recipients.length, recipients: emails.length }, 200, cors);
}

// Resend native Audience + published template 발송. 템플릿은 운영자가 검토한 alias만 허용한다.
async function sendResendTemplateAudience(req, env, cors) {
  const admin = await requireAdmin(req, env);
  if (!admin) return json({ ok: false, error: "unauthorized" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const mode = String(b.mode || "dry");
  const segment = parseAudienceSegment(b.segment);
  const templateId = String(b.template || RESEND_TEMPLATE_ALIASES.newSpaceAnnouncement).trim();
  if (!segment) return json({ ok: false, error: "bad_segment", hint: "segment는 1 이상의 정수" }, 400, cors);
  if (templateId !== RESEND_TEMPLATE_ALIASES.newSpaceAnnouncement) return json({ ok: false, error: "bad_template" }, 400, cors);
  const audience = await fetchResendAudienceEmails(env);
  if (!audience.ok) return json({ ok: false, error: audience.error, status: audience.status || undefined }, 502, cors);
  const selected = getAudienceSegment(audience.emails, segment);
  if (selected.totalSegments > 0 && segment > selected.totalSegments) {
    return json({ ok: false, error: "segment_out_of_range", mode, template: templateId, segment, totalSegments: selected.totalSegments, recipients: audience.emails.length }, 400, cors);
  }
  if (mode === "dry") return json({ ok: true, mode, template: templateId, segment, totalSegments: selected.totalSegments, segmentRecipients: selected.recipients.length, recipients: audience.emails.length }, 200, cors);
  if (mode === "test") {
    const result = env.ADMIN_EMAIL ? await sendResendBatch(env, { to: [env.ADMIN_EMAIL], templateId }) : { sent: 0, failed: 1 };
    return json({ ok: result.sent === 1, mode, template: templateId, segment, sentTo: env.ADMIN_EMAIL, recipients: audience.emails.length }, result.sent === 1 ? 200 : 502, cors);
  }
  if (mode !== "send") return json({ ok: false, error: "bad_mode" }, 400, cors);
  if (env.RESEND_TEMPLATE_SEND_ENABLED !== "true") return json({ ok: false, error: "send_disabled", hint: "RESEND_TEMPLATE_SEND_ENABLED=true 설정 후 발송" }, 403, cors);
  const result = await sendResendBatch(env, { to: selected.recipients, templateId });
  return json({ ok: true, mode, template: templateId, segment, totalSegments: selected.totalSegments, sent: result.sent, failed: result.failed, segmentRecipients: selected.recipients.length, recipients: audience.emails.length }, 200, cors);
}

// ── 라우터 ────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    const path = url.pathname;

    // health
    if (path === "/api/health") return json({ ok: true, admin: env.ADMIN_API_ENABLED === "true", payment: env.PAYMENT_ENABLED === "true" }, 200, cors);

    // 이메일 인증 OTP (회원가입) — 플래그 없이 항상 열림. RESEND_API_KEY·OTP_SECRET 시크릿 필요.
    if (path === "/api/auth/otp/send" || path === "/api/auth/otp/verify") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return path.endsWith("/send") ? otpSend(req, env, cors) : otpVerify(req, env, cors);
    }

    // 강독 클래스 소장회원 인증 (6강+ 해금) — OTP로 이메일 소유 증명 + 수강 명단 대조 → class_verifications 기록.
    //   목적: signUp이 이메일 미검증 세션을 주는 구멍을 막는다. "이메일을 안다"만으론 6강 못 엶(받은편지함 필요).
    if (path === "/api/class/verify-otp") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return classVerifyOtp(req, env, cors);
    }

    // 결제 이메일 ≠ 로그인 이메일 수강생 셀프서비스 연결 — 로그인 JWT + 결제 이메일 OTP → 1회 귀속.
    if (path === "/api/class/link-enrollment") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return classLinkEnrollment(req, env, cors);
    }

    // 본인인증(통합인증) 결과 조회 — PORTONE_API_SECRET 필요. 플래그 없이 열림(id=unguessable UUID).
    if (path === "/api/identity/verify") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return identityVerify(req, env, cors);
    }

    // 원서 등록 신청 → 관리자 메일 알림 (RESEND_API_KEY·ADMIN_EMAIL 필요).
    if (path === "/api/notify/book-request") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return notifyBookRequest(req, env, cors);
    }

    // 라이프사이클 정보성 메일 (가입·인증·완독·다이어리·Lyra 등). RESEND_API_KEY 필요.
    //   본인 활동 기반 정보성 → 광고 아님. 클라가 자기 이메일+키+data로 호출(멱등은 클라 localStorage).
    //   ⚠️ 서버 rate-limit은 WAF/KV 백로그(OTP와 동일 posture). 무료티어 발송한도가 1차 방어.
    if (path === "/api/lifecycle-email") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return lifecycleEmail(req, env, cors);
    }

    // 관리자 (#8b) — 플래그 OFF면 404
    if (path.startsWith("/api/admin/")) {
      if (env.ADMIN_API_ENABLED !== "true") return json({ ok: false, error: "disabled" }, 404, cors);
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      if (path === "/api/admin/auth") return adminAuth(req, env, cors);
      if (path === "/api/admin/request-otp") return adminOtpRequest(req, env, cors);
      if (path === "/api/admin/payment/confirm") return adminWrite(req, env, cors, "payment_confirm");
      if (path === "/api/admin/enrollment/delete") return adminWrite(req, env, cors, "enrollment_delete");
      if (path === "/api/admin/report/status") return adminWrite(req, env, cors, "report_status");
      if (path === "/api/admin/book-request/status") return adminWrite(req, env, cors, "book_request_status");
      if (path === "/api/admin/announce") return adminWrite(req, env, cors, "announce");
      if (path === "/api/admin/send-sentence") return sendSentenceDigest(req, env, cors);
      if (path === "/api/admin/send-content") return sendContentUpdate(req, env, cors);
      if (path === "/api/admin/send-resend-template") return sendResendTemplateAudience(req, env, cors);
      return json({ ok: false, error: "not_found" }, 404, cors);
    }

    // 결제 — 플래그 OFF면 404 (단, 웹훅은 포트원이 직접 호출하므로 PAYMENT_ENABLED일 때만 열림)
    if (path.startsWith("/api/payment/")) {
      if (env.PAYMENT_ENABLED !== "true") return json({ ok: false, error: "disabled" }, 404, cors);
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return paymentRoute(req, env, cors, path.replace("/api/payment/", ""));
    }

    return json({ ok: false, error: "not_found" }, 404, cors);
  },

  // 자동갱신 Cron (wrangler triggers 활성 후 매일 1회) — next_charge_at 도래 구독 재청구.
  // 단일 모델(cron만 청구, 포트원 스케줄 미사용)이라 이중청구 없음.
  async scheduled(event, env, ctx) {
    if (env.PAYMENT_ENABLED !== "true") return;
    const nowIso = new Date().toISOString();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const DUNNING_CAP = 4;   // 연속 실패 4회 → 자동 해지(빌링키 폐기). 무한 재청구·PG 패널티 방지.
    // 1) 청구 대상: active/past_due 중 next_charge_at 도래 → 빌링키 재청구
    try {
      const r = await sbFetch(env, `subscriptions?status=in.(active,past_due)&next_charge_at=lte.${encodeURIComponent(nowIso)}&select=billing_key,email,user_id,retry_count`);
      const due = r.ok ? await r.json().catch(() => []) : [];
      for (const s of (Array.isArray(due) ? due : [])) {
        if (!s.billing_key) continue;
        const res = await chargeAndVerify(env, { billingKey: s.billing_key, email: s.email, userId: s.user_id, source: "cron" });
        if (res.pendingVerify) {
          await upsertSubscription(env, { billing_key: s.billing_key, status: "pending_verify", last_payment_id: res.paymentId, updated_at: nowIso }); // 재청구 X, 아래 2)서 확정
        } else if (res.paid) {
          await upsertSubscription(env, { billing_key: s.billing_key, status: "active", next_charge_at: new Date(Date.now() + MONTH_MS).toISOString(), retry_count: 0, last_payment_id: res.paymentId, updated_at: nowIso });
        } else {
          const tries = (Number(s.retry_count) || 0) + 1;
          if (tries >= DUNNING_CAP) {     // 던닝 캡 — 무한 재청구 방지, 자동 해지 + 빌링키 폐기
            await upsertSubscription(env, { billing_key: s.billing_key, status: "canceled", retry_count: tries, last_payment_id: res.paymentId, updated_at: nowIso });
            await fetch(`${PORTONE_API}/billing-keys/${encodeURIComponent(s.billing_key)}`, { method: "DELETE", headers: portoneHeaders(env) }).catch(() => {});
          } else {
            await upsertSubscription(env, { billing_key: s.billing_key, status: "past_due", next_charge_at: new Date(Date.now() + DAY_MS).toISOString(), retry_count: tries, last_payment_id: res.paymentId, updated_at: nowIso }); // 내일 재시도
          }
        }
      }
    } catch (_e) { /* best-effort */ }
    // 2) 미확정(pending_verify) 정리: 재청구 없이 last_payment_id 재조회로만 확정
    try {
      const r2 = await sbFetch(env, `subscriptions?status=eq.pending_verify&select=billing_key,last_payment_id`);
      const pend = r2.ok ? await r2.json().catch(() => []) : [];
      for (const s of (Array.isArray(pend) ? pend : [])) {
        if (!s.last_payment_id) continue;
        const v = await portoneGetPayment(env, s.last_payment_id);
        if (!v.ok) continue;                                  // 다음 실행에서 재시도
        if (v.status === "PAID" && v.amountTotal === YANAWAN_PRICE_KRW) {
          await recordPaymentIdempotent(env, { id: s.last_payment_id, status: "PAID", amount: v.amountTotal, updated_at: nowIso });
          await upsertSubscription(env, { billing_key: s.billing_key, status: "active", next_charge_at: new Date(Date.now() + MONTH_MS).toISOString(), updated_at: nowIso });
        } else if (v.status === "FAILED" || v.status === "CANCELLED") {
          await upsertSubscription(env, { billing_key: s.billing_key, status: "past_due", next_charge_at: nowIso, updated_at: nowIso }); // 즉시 재청구 대상
        }
      }
    } catch (_e) { /* best-effort */ }
  },
};
