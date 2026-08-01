// =============================================================
// literstella-api — 보안 백엔드 (관리자 service_role + 포트원 결제)
// ⚠️ 미배포 스캐폴딩. 모든 위험 기능은 env 플래그(ADMIN_API_ENABLED / PAYMENT_ENABLED, 기본 false) 뒤.
//    플래그 OFF면 해당 라우트는 404 → 배포해도 라이브 영향 0.
//    설계: ../DESIGN.md   순서/결정: memory/payment_portone_sequencing.md
//    ★ 표시는 포트원 V2 공식 문서로 정확 스펙 확인 후 채울 자리(추정 금지).
// =============================================================

import { renderEmail, LIFECYCLE } from "./lifecycle-emails.js";
import { contentPointRoute } from "./content-point-service.mjs";
import { stellaUpgradeEmailRoute } from "./stella-upgrade-email-service.mjs";
import { classMemberTierAdminRoute } from "./class-member-tier-admin.mjs";
import {
  CONTENT_AUDIENCE_TABLES,
  contentEmailBodyHtml,
  getContentDeliveryDraft,
  isAllowedContentLink,
} from "./content-delivery.mjs";

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
// 사용자 인증: 프론트가 보낸 Supabase access token(X-User-Token)을 서버에서 검증 → {id,email,metadata} or null.
// 결제 라우트는 토큰의 검증 user_id만 신뢰(클라가 보낸 userId/email 신뢰 금지 — 타인 빌링키 청구 차단).
async function requireUser(req, env) {
  const tok = req.headers.get("X-User-Token") || "";
  if (!tok) return null;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${tok}` } });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    return u && u.id ? {
      id: u.id,
      email: String(u.email || "").toLowerCase(),
      metadata: u.user_metadata && typeof u.user_metadata === "object" ? u.user_metadata : {},
    } : null;
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
// 클래스 상품 카탈로그(토스 다이렉트) — 서버가 가격·해금 매핑의 단일 권위.
//   구조 { won, books:[] } (적대검증 2026-07-29): 가격만 있고 books 매핑이 없으면 '돈 받고 미해금' 사고
//   → books 없는 코드는 unknown_product로 거부된다. 코드 추가 = 판매 개시와 동치(앱에 전 강 실물 선행).
//   추후 후보(콘텐츠 완비 시): anne 118000·pride 128000·littlewomen1/2 각 99000·gatsby 79000·sherlock 79800·
//   littlewomen-pack 179800(books=[littlewomen1,littlewomen2,theory])·kidari-pack 99800(🔴실물 배송 상품 — 앱 판매 부적합, 등록 금지)·
//   stella-allinone 398000(books=강독7+theory 8권 — 스텔라 클럽 즉달 상품. 부분 소유자 이중지불 크레딧 설계 전 등록 보류, 운영자 2026-07-29).
//   ⚠️ 2026-07-29 운영자: 앱 내 실판매 전면 중단(전 상품 클래스 사이트로) — /purchase는 토스 실가맹 심사 동선으로만 유지.
const PRICE_BY_PRODUCT = {
  "class-kidari-lifetime": { won: 69000, books: ["kidari"] },
};
const YANAWAN_ORDER_NAME = "야나완 영어 챌린지 1개월";
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function portoneHeaders(env, extra) {
  // V2 서버 인증: Authorization: PortOne <API_SECRET> [CONFIRMED]
  return { Authorization: `PortOne ${env.PORTONE_API_SECRET}`, "Content-Type": "application/json", ...(extra || {}) };
}
function newPaymentId() { return `pay${crypto.randomUUID().replace(/-/g, "")}`; } // 영숫자 35자 — 토스 orderId 규칙(6~64·영숫자·-_) 충족

// ── 토스페이먼츠 다이렉트 (2026-07-20 PG 전환: 포트원 제거 — 신규 결제는 이 경로만) ──────────
//    승인(confirm) = POST /v1/payments/confirm {paymentKey, orderId, amount} · 금액은 서버 가격표 권위.
//    인증: Basic base64(SECRET_KEY + ':') — 콜론 필수(토스 공식 '가장 흔한 오류').
//    시크릿: wrangler secret put TOSS_SECRET_KEY (test_sk_… → 실가맹 후 live_sk_…).
const TOSS_API = "https://api.tosspayments.com";
function tossHeaders(env, extra) {
  return { Authorization: `Basic ${btoa(`${env.TOSS_SECRET_KEY}:`)}`, "Content-Type": "application/json", ...(extra || {}) };
}

// 클래스 수강 권한 부여 — 결제 승인 시 class_enrollments 적재(check_my_class_access RPC가 즉시 인식 = 6강+ 해금).
//   unique 제약 유무 불명 → 조회 후 삽입(중복 방지). 레이스 시 중복행 무해(존재 판정만 쓰임).
async function grantClassEnrollment(env, email, bookCode, source) {
  try {
    const q = await sbFetch(env, `class_enrollments?email=eq.${encodeURIComponent(email)}&book_code=eq.${encodeURIComponent(bookCode)}&select=email&limit=1`);
    const rows = q.ok ? await q.json().catch(() => []) : [];
    if (Array.isArray(rows) && rows.length) return true;
    const r = await sbFetch(env, `class_enrollments`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ email, book_code: bookCode, source: source || "toss_purchase" }) });
    return r.ok;
  } catch { return false; }
}

// 토스 웹훅 — 토스는 웹훅 서명을 제공하지 않음(공식) → 본문 불신, paymentKey 재조회로만 확정. 10초 내 200 필수.
//   등록: 개발자센터 웹훅 메뉴 → https://literstella-api.literbryanbae.workers.dev/api/payment/toss-webhook
//   역할: 승인 경로(브라우저 복귀 confirm)가 유실된 경우의 2중화 — payments 반영 + 클래스 수강 부여 보강.
async function tossWebhook(req, env, cors) {
  let body; try { body = await req.json(); } catch { body = {}; }
  const pk = String(body?.data?.paymentKey || body?.paymentKey || "");
  if (pk && env.TOSS_SECRET_KEY) {
    try {
      const r = await fetch(`${TOSS_API}/v1/payments/${encodeURIComponent(pk)}`, { headers: tossHeaders(env) });
      const p = r.ok ? await r.json().catch(() => null) : null;
      if (p?.orderId) {
        await recordPaymentIdempotent(env, { id: p.orderId, payment_key: pk, amount: p.totalAmount ?? null, status: p.status || "unknown", updated_at: new Date().toISOString() });
        if (p.status === "DONE") {
          const q = await sbFetch(env, `payments?id=eq.${encodeURIComponent(p.orderId)}&select=email,source`);
          const rows = q.ok ? await q.json().catch(() => []) : [];
          const row = Array.isArray(rows) ? rows[0] : null;
          // source='toss:{product}' → 카탈로그 books 전부 부여(승인 경로 유실 대비 2중화, 다권 지원)
          const code = String(row?.source || "").startsWith("toss:") ? String(row.source).slice(5) : null;
          const def = code ? PRICE_BY_PRODUCT[code] : null;
          if (row?.email && def) { for (const bk of def.books) await grantClassEnrollment(env, row.email, bk, "toss_webhook"); }
        }
      }
    } catch { /* 실패 시 토스가 최대 7회 재시도 */ }
  }
  return json({ ok: true }, 200, cors);
}

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
  // 토스 웹훅(2026-07-20 PG 전환) — …10749 tokens truncated…: "bad_segment", hint: "segment는 1 이상의 정수" }, 400, cors);
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
function contentEmailHtml(p) {
  return brandEmailHtml(contentEmailBodyHtml(p));
}
async function sendContentUpdate(req, env, cors) {
  const admin = await requireAdmin(req, env);
  if (!admin) return json({ ok: false, error: "unauthorized" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const mode = String(b.mode || "dry"); // dry | test | send
  if (!["dry", "test", "send"].includes(mode)) return json({ ok: false, error: "bad_mode", allowed: ["dry", "test", "send"] }, 400, cors);
  const requestedContentId = String(b.contentId || "").trim();
  const draft = requestedContentId ? getContentDeliveryDraft(requestedContentId) : null;
  if (requestedContentId && !draft) return json({ ok: false, error: "content_not_found" }, 404, cors);
  const audience = draft?.audience || String(b.audience || "").trim();
  const table = CONTENT_AUDIENCE_TABLES[audience];
  if (!table) return json({ ok: false, error: "bad_audience", allowed: Object.keys(CONTENT_AUDIENCE_TABLES) }, 400, cors);
  const segment = parseAudienceSegment(b.segment);
  if (!segment) return json({ ok: false, error: "bad_segment", hint: "segment는 1 이상의 정수" }, 400, cors);
  const title = String(draft?.title || b.title || "").trim().slice(0, 120);
  const link = String(draft?.link || b.link || "").trim();
  if (!title) return json({ ok: false, error: "title_required" }, 400, cors);
  if (link && !isAllowedContentLink(link)) return json({ ok: false, error: "bad_link" }, 400, cors);
  if (!draft && !link) return json({ ok: false, error: "link_required" }, 400, cors);
  if (mode === "send" && draft && draft.releaseStatus !== "RELEASE_APPROVED") {
    return json({ ok: false, error: "release_blocked", contentId: draft?.contentId, releaseStatus: draft?.releaseStatus }, 409, cors);
  }
  if (mode === "send" && !link) return json({ ok: false, error: "link_required" }, 400, cors);
  const subject = String(b.subject || "").trim().slice(0, 150) || `[리터스텔라] ${title}`;
  const content = draft || { audience, kicker: b.kicker, title, book: b.book, teaser: String(b.teaser || "").slice(0, 400), link, media: b.media };
  const html = contentEmailHtml(content);
  let subs = [];
  try { const r = await sbFetch(env, `${table}?active=eq.true&select=email&order=email.asc`); subs = r.ok ? await r.json().catch(() => []) : []; } catch { subs = []; }
  const emails = [...new Set((Array.isArray(subs) ? subs : []).map(s => String(s.email || "").toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  const selected = getAudienceSegment(emails, segment);
  if (selected.totalSegments > 0 && segment > selected.totalSegments) {
    return json({ ok: false, error: "segment_out_of_range", mode, audience, contentId: draft?.contentId || null, releaseStatus: draft?.releaseStatus || null, segment, totalSegments: selected.totalSegments, recipients: emails.length }, 400, cors);
  }
  if (mode === "dry") return json({ ok: true, mode, audience, contentId: draft?.contentId || null, releaseStatus: draft?.releaseStatus || null, segment, totalSegments: selected.totalSegments, segmentRecipients: selected.recipients.length, recipients: emails.length }, 200, cors);
  if (mode === "test") {
    const ok = env.ADMIN_EMAIL ? await sendResendEmail(env, { to: env.ADMIN_EMAIL, subject, html }) : false;
    return json({ ok, mode, audience, contentId: draft?.contentId || null, releaseStatus: draft?.releaseStatus || null, segment, totalSegments: selected.totalSegments, segmentRecipients: selected.recipients.length, sentTo: env.ADMIN_EMAIL, recipients: emails.length }, ok ? 200 : 502, cors);
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
    if (path === "/api/health") return json({
      ok: true,
      admin: env.ADMIN_API_ENABLED === "true",
      payment: env.PAYMENT_ENABLED === "true",
      contentPoints: env.CONTENT_POINTS_ENABLED === "true",
    }, 200, cors);

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

    if (path === "/api/class/admin-member-tier") {
      return classMemberTierAdminRoute(req, env, cors, { json, requireUser, sbFetch });
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

    if (path === "/api/marketing/subscribe-stella") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return syncStellaMarketingOptIn(req, env, cors);
    }

    // 스텔라 등급 신청 메일: 회원 신청 → 관리자, 관리자 쿠폰 입력 → 회원 이메일.
    // 금액·수신자는 브라우저 payload가 아니라 service_role로 신청 행을 다시 읽어 확정한다.
    if (path.startsWith("/api/stella-upgrade/")) {
      return stellaUpgradeEmailRoute(
        req,
        env,
        cors,
        path.replace("/api/stella-upgrade/", ""),
        { json, requireUser, sbFetch, sendEmail: sendResendEmail, brandEmailHtml },
      );
    }

    // Point-content purchases are isolated from cash payment routes. Pricing,
    // ownership tiers and balance checks are server-authoritative; the atomic
    // database RPC writes the debit and all permanent entitlements together.
    if (path.startsWith("/api/points/content/")) {
      if (env.CONTENT_POINTS_ENABLED !== "true") {
        return json({ ok: false, error: "disabled" }, 404, cors);
      }
      return contentPointRoute(
        req,
        env,
        cors,
        path.replace("/api/points/content/", ""),
        { json, requireUser, sbFetch },
      );
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
    const scheduledDate = new Date(event.scheduledTime);
    if (event.cron === MIGRATION_CRON) {
      if (scheduledDate.getUTCFullYear() === 2026) ctx.waitUntil(runMigrationNoticeCampaign(env));
      return;
    }
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

