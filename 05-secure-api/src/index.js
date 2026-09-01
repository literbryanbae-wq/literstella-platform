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
import { classEmailRecoveryRoute, RECOVERY_KIND } from "./class-email-recovery.mjs";
import {
  classBookRequestSatisfied,
  classEnrollmentEmailCandidates,
} from "./class-enrollment-access.mjs";
import {
  cafeRosterMatchLabel,
  evaluateCafeRoster,
  normalizeCafeText,
} from "./cafe-transfer-policy.mjs";

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
// ─────────────────────────────────────────────────────────────
// 셀프 회원 탈퇴 (운영자 승인 2026-08-18) — 접수형(카카오 문의)에서 셀프로 승격.
//   설계 원칙: **개인정보는 파기, 거래 기록은 익명 보존.**
//     · users 행을 지우지 않고 익명화한다 — 포인트 원장·인증 기록이 user_id로 물려 있어
//       하드 DELETE하면 정산·통계 무결성이 깨지고, 전자상거래법상 거래기록 보존(5년)도 못 지킨다.
//     · 식별 정보(이메일·닉네임·연락처·소개·사진·SNS·지역·진단결과)는 그 자리에서 제거한다.
//     · Supabase Auth 계정은 삭제 → 재로그인 불가(탈퇴의 실질).
//   ⚠️ 되돌릴 수 없다. 프론트가 확인 문구 입력을 받은 뒤에만 호출한다.
async function accountDelete(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401, cors);

  const body = await req.json().catch(() => ({}));
  // 오호출 방지 — 프론트 확인 단계를 통과했다는 명시 신호를 요구한다.
  if (body?.confirm !== "DELETE") return json({ ok: false, error: "confirm_required" }, 400, cors);

  const sb = (path, init) => fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const email = String(user.email || "").toLowerCase();
  const stamp = new Date().toISOString();
  // 익명 이메일 — users.email이 NOT NULL·UNIQUE라 값이 필요하다. .invalid는 예약 TLD(실제 발송 불가).
  const anonEmail = `deleted+${user.id}@literstella.invalid`;

  // 1) users 익명화 (auth_uid 우선, 없으면 이메일로 매칭 — 소셜 가입자는 auth_uid가 정본)
  const patch = {
    email: anonEmail, nickname: "탈퇴한 회원",
    phone: null, bio: null, avatar_url: null, blog_url: null, instagram_url: null,
    naver_id: null, country: null, city: null, diag_full_result: null,
    auth_uid: null, marketing_consent: false, deleted_at: stamp,
  };
  let r = await sb(`/rest/v1/users?auth_uid=eq.${user.id}`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch),
  });
  let rows = r.ok ? await r.json().catch(() => []) : [];
  if (!rows.length && email) {
    r = await sb(`/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch),
    });
    rows = r.ok ? await r.json().catch(() => []) : [];
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return json({ ok: false, error: "profile_anonymize_failed", detail: detail.slice(0, 200) }, 500, cors);
  }

  // 2) 개인 식별 정보가 이메일 자체인 부수 테이블 정리 — 남기면 이메일이 계속 저장된 상태가 된다.
  //    (수강권도 함께 사라진다. 프론트가 이 사실을 명시적으로 고지한 뒤 호출한다.)
  if (email) {
    const q = `eq.${encodeURIComponent(email)}`;
    await Promise.all([
      sb(`/rest/v1/class_verifications?email=${q}`, { method: "DELETE" }).catch(() => null),
      sb(`/rest/v1/sentence_subscribers?email=${q}`, { method: "DELETE" }).catch(() => null),
      sb(`/rest/v1/lecture_subscribers?email=${q}`, { method: "DELETE" }).catch(() => null),
    ]);
  }

  // 3) Auth 계정 삭제 — 재로그인 불가(탈퇴의 실질). 실패해도 위 익명화는 이미 끝났다.
  const authDel = await sb(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" }).catch(() => null);

  return json({
    ok: true,
    anonymized: rows.length || 0,
    authDeleted: !!(authDel && authDel.ok),
  }, 200, cors);
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
    // provider·이메일확인 = 소셜 자동 연결 판정용(2026-08-22). 기존 호출부는 id·email·metadata만 쓰므로 필드 추가는 무해.
    const am = u.app_metadata && typeof u.app_metadata === "object" ? u.app_metadata : {};
    const provs = Array.isArray(am.providers) ? am.providers : (am.provider ? [am.provider] : []);
    return u && u.id ? {
      id: u.id,
      email: String(u.email || "").toLowerCase(),
      metadata: u.user_metadata && typeof u.user_metadata === "object" ? u.user_metadata : {},
      providers: provs,
      emailConfirmed: !!u.email_confirmed_at,
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
  const sent = await sendResendEmail(env, { to: email, subject: "[리터스텔라] 관리자 인증 코드", html, lane: "auth" });
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
// 클래스 상품 카탈로그(토스 다이렉트) — 서버가 상품명·가격·권한 범위의 단일 권위.
//   신규 MID는 12개월 이용권만 판매한다. 평생소장 398,000원은 기존 LiveKlass 별도 결제다.
const CLASSICS_ANNUAL_BOOKS = ["kidari", "anne", "littlewomen1", "littlewomen2", "pride", "gatsby", "sherlock", "theory"];
const PRICE_BY_PRODUCT = {
  "class-classics-annual-8": {
    won: 198000,
    books: CLASSICS_ANNUAL_BOOKS,
    kind: "term_pass",
    months: 12,
    orderName: "리터스텔라 클래식 8개 강의 · 12개월 이용권",
  },
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

function addUtcMonths(value, months) {
  const date = new Date(value);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

async function classBooksOwned(env, email, books) {
  for (const book of books) {
    const response = await sbFetch(env, `class_enrollments?email=eq.${encodeURIComponent(email)}&book_code=eq.${encodeURIComponent(book)}&select=email&limit=1`);
    if (!response.ok) return { ok: false, ownedAll: false };
    const rows = await response.json().catch(() => []);
    if (!(Array.isArray(rows) && rows.length)) return { ok: true, ownedAll: false };
  }
  return { ok: true, ownedAll: true };
}

async function activeClassPass(env, email, productCode) {
  const now = new Date().toISOString();
  const response = await sbFetch(env, `class_access_passes?email=eq.${encodeURIComponent(email)}&product_code=eq.${encodeURIComponent(productCode)}&status=eq.active&expires_at=gt.${encodeURIComponent(now)}&select=payment_id,expires_at&limit=1`);
  if (!response.ok) return { ok: false, active: false };
  const rows = await response.json().catch(() => []);
  return { ok: true, active: Array.isArray(rows) && rows.length > 0, row: Array.isArray(rows) ? rows[0] : null };
}

async function grantClassPass(env, { email, paymentId, productCode, books, months, source }) {
  const startsAt = new Date().toISOString();
  const expiresAt = addUtcMonths(startsAt, months);
  try {
    const response = await sbFetch(env, `class_access_passes?on_conflict=payment_id`, {
      method: "POST",
      // 같은 결제의 confirm·웹훅·새로고침이 겹쳐도 최초 만료일을 연장하거나 취소 권한을 되살리지 않는다.
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({
        payment_id: paymentId,
        email,
        product_code: productCode,
        book_codes: books,
        starts_at: startsAt,
        expires_at: expiresAt,
        status: "active",
        source: source || "toss_purchase",
        updated_at: startsAt,
      }),
    });
    const rows = response.ok ? await response.json().catch(() => []) : [];
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row) return { ok: row.status === "active", expiresAt: row.expires_at || expiresAt };
    if (!response.ok) return { ok: false, expiresAt: null };

    const existing = await sbFetch(env, `class_access_passes?payment_id=eq.${encodeURIComponent(paymentId)}&select=status,expires_at&limit=1`);
    const existingRows = existing.ok ? await existing.json().catch(() => []) : [];
    const existingRow = Array.isArray(existingRows) ? existingRows[0] : null;
    return { ok: existingRow?.status === "active", expiresAt: existingRow?.expires_at || null };
  } catch {
    return { ok: false, expiresAt: null };
  }
}

async function revokeClassPass(env, paymentId, reason) {
  try {
    const response = await sbFetch(env, `class_access_passes?payment_id=eq.${encodeURIComponent(paymentId)}&status=eq.active`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "canceled", canceled_reason: String(reason || "payment_canceled").slice(0, 200), canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    return response.ok;
  } catch {
    return false;
  }
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
          const code = String(row?.source || "").startsWith("toss:") ? String(row.source).slice(5) : null;
          const def = code ? PRICE_BY_PRODUCT[code] : null;
          if (row?.email && def?.kind === "term_pass") {
            await grantClassPass(env, { email: row.email, paymentId: p.orderId, productCode: code, books: def.books, months: def.months, source: "toss_webhook" });
          }
        } else if (p.status === "CANCELED") {
          await revokeClassPass(env, p.orderId, "toss_canceled");
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
  // 토스 웹훅(2026-07-20 PG 전환) — 서명 없음 → 재조회 확정 패턴.
  if (sub === "toss-webhook") return tossWebhook(req, env, cors);

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

  // 신규 클래스 결제는 결제창을 열기 전에 서버에서 주문을 만든다.
  //   orderId·상품·금액·이메일을 payments에 먼저 묶어 두므로 복귀 승인 시 브라우저 payload를 신뢰하지 않는다.
  if (sub === "toss-prepare") {
    if (!env.TOSS_SECRET_KEY) return json({ ok: false, error: "toss_not_configured" }, 503, cors);
    const product = String(b.product || "");
    const prodDef = PRICE_BY_PRODUCT[product];
    const email = String(b.email || "").slice(0, 200).trim().toLowerCase();
    if (!prodDef || prodDef.kind !== "term_pass") return json({ ok: false, error: "unknown_product" }, 400, cors);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "bad_email" }, 400, cors);

    const pass = await activeClassPass(env, email, product);
    if (!pass.ok) return json({ ok: false, error: "pass_not_configured" }, 503, cors);
    if (pass.active) return json({ ok: false, error: "already_active", expiresAt: pass.row?.expires_at || null }, 409, cors);

    const ownership = await classBooksOwned(env, email, prodDef.books);
    if (!ownership.ok) return json({ ok: false, error: "ownership_check_failed" }, 503, cors);
    if (ownership.ownedAll) return json({ ok: false, error: "already_owned" }, 409, cors);

    const orderId = newPaymentId();
    const stored = await recordPaymentIdempotent(env, {
      id: orderId,
      email,
      amount: prodDef.won,
      status: "READY",
      source: `toss:${product}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (!stored) return json({ ok: false, error: "order_store_failed" }, 503, cors);
    return json({ ok: true, orderId, amount: prodDef.won, orderName: prodDef.orderName }, 200, cors);
  }

  // ── 토스페이먼츠 다이렉트 단건 승인 (2026-07-20 PG 전환 — 신규 결제 유일 경로) ──
  //   결제창 redirect 복귀 후 프론트가 호출. 금액 = 서버 가격표 권위(redirect amount 신뢰 X — 토스 공식 권고).
  //   토큰 선택: 로그인=user 바인딩 / 게스트(상품 상세 비회원 구매)=email만 기록 → requireUser 게이트 앞에 위치.
  //   승인 없이는 돈이 이동하지 않으므로(인증만으론 미결제) 비인증 호출 허용이 안전 — paymentKey는 결제자만 가짐.
  if (sub === "toss-confirm") {
    if (!env.TOSS_SECRET_KEY) return json({ ok: false, error: "toss_not_configured" }, 503, cors);
    const paymentKey = String(b.paymentKey || "");
    const orderId = String(b.orderId || "");
    if (!paymentKey || !orderId) return json({ ok: false, error: "missing_params" }, 400, cors);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)) return json({ ok: false, error: "bad_order_id" }, 400, cors);
    const maybeUser = await requireUser(req, env); // null 허용(게스트)

    // 클래스 주문은 toss-prepare에서 저장한 행만 승인한다. 챌린지 단건 결제는 기존 goalDays 경로를 유지한다.
    const preparedResponse = await sbFetch(env, `payments?id=eq.${encodeURIComponent(orderId)}&select=id,email,user_id,amount,status,source&limit=1`);
    const preparedRows = preparedResponse.ok ? await preparedResponse.json().catch(() => []) : [];
    const prepared = Array.isArray(preparedRows) ? preparedRows[0] : null;
    const preparedProduct = String(prepared?.source || "").startsWith("toss:") ? String(prepared.source).slice(5) : "";
    const prodDef = preparedProduct ? PRICE_BY_PRODUCT[preparedProduct] : null;
    const isPreparedClassOrder = !!(prepared && prodDef?.kind === "term_pass");
    const goalDays = Number(b.goalDays);
    const expected = isPreparedClassOrder ? Number(prepared.amount) : (PRICE_BY_GOAL[goalDays] || YANAWAN_PRICE_KRW);
    const redirectAmount = Number(b.amount);
    if (isPreparedClassOrder && expected !== prodDef.won) return json({ ok: false, error: "order_amount_invalid" }, 409, cors);
    if (isPreparedClassOrder && redirectAmount !== expected) return json({ ok: false, error: "amount_mismatch" }, 400, cors);
    const email = isPreparedClassOrder
      ? String(prepared.email || "").trim().toLowerCase()
      : (maybeUser?.email || (b.email ? String(b.email).slice(0, 200).toLowerCase().trim() : null));
    if (isPreparedClassOrder && !EMAIL_RE.test(email)) return json({ ok: false, error: "order_email_invalid" }, 409, cors);

    const cr = await fetch(`${TOSS_API}/v1/payments/confirm`, {
      method: "POST", headers: tossHeaders(env, { "Idempotency-Key": orderId }),
      body: JSON.stringify({ paymentKey, orderId, amount: expected }),
    });
    let pay = await cr.json().catch(() => null);
    let paid = cr.ok && pay?.status === "DONE" && pay?.totalAmount === expected;
    // 이미 승인된 주문(복귀 새로고침 재호출) → 조회로 멱등 재검증
    if (!paid && pay?.code === "ALREADY_PROCESSED_PAYMENT") {
      const qr = await fetch(`${TOSS_API}/v1/payments/orders/${encodeURIComponent(orderId)}`, { headers: tossHeaders(env) });
      const qp = qr.ok ? await qr.json().catch(() => null) : null;
      if (qp?.status === "DONE" && qp?.totalAmount === expected) { paid = true; pay = qp; }
    }
    await recordPaymentIdempotent(env, {
      id: orderId, payment_key: paymentKey,
      user_id: maybeUser?.id || prepared?.user_id || null,
      email,
      // 준비 주문은 토스의 일시 오류 응답에 totalAmount가 없어도 서버 확정 금액을 보존한다.
      // null로 덮으면 다음 승인 재시도에서 주문 금액을 복구할 수 없다.
      amount: isPreparedClassOrder ? expected : (pay?.totalAmount ?? null),
      status: paid ? "DONE" : (pay?.code || pay?.status || "confirm_failed"),
      source: isPreparedClassOrder ? prepared.source : "toss_single", updated_at: new Date().toISOString(),
    });

    let granted = false;
    let expiresAt = null;
    if (paid && isPreparedClassOrder && email) {
      const grant = await grantClassPass(env, {
        email,
        paymentId: orderId,
        productCode: preparedProduct,
        books: prodDef.books,
        months: prodDef.months,
        source: "toss_purchase",
      });
      granted = grant.ok;
      expiresAt = grant.expiresAt;
    }
    return paid ? json({ ok: true, orderId, ...(isPreparedClassOrder ? { granted, email, expiresAt } : {}) }, granted || !isPreparedClassOrder ? 200 : 202, cors)
                : json({ ok: false, error: pay?.code || "not_paid", toss: { status: pay?.status, code: pay?.code } }, 402, cors);
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
function otpEmailHtml(code, issuedAt) {
  const body = `<div style="font-size:18px;font-weight:800;margin-bottom:8px;">이메일 인증 코드</div>`
    + `<p style="margin:0 0 16px;color:#5a5446;">아래 6자리 코드를 회원가입 화면에 입력해 주세요. (10분 내 유효)</p>`
    + `<div style="font-size:34px;font-weight:900;letter-spacing:10px;color:#c8a84b;text-align:center;padding:18px;background:#fdf9ee;border:1px dashed #ddca97;border-radius:14px;">${code}</div>`
    + `<p style="margin:12px 0 0;font-size:12px;color:#8a8270;text-align:center;">발급 시각 ${issuedAt} · 가장 최근에 받은 코드만 입력해 주세요.</p>`
    + `<p style="margin:16px 0 0;font-size:13px;color:#8a8270;">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>`;
  return brandEmailHtml(body);
}
// 🔴 시크릿에 섞인 보이지 않는 문자를 제거한다(2026-08-24 실장애).
//   wrangler secret put 에 값을 붙여넣으면 끝에 개행/공백/BOM 이 딸려 들어가는 일이 잦다.
//   그러면 `Authorization: Bearer re_xxx\n` 이 되어 **Resend 에 닿기도 전에 400** 이 난다
//   (Resend API 로그엔 요청이 아예 안 남고, 워커는 detail 빈 400 만 본다 — 원인 추적이 어렵다).
//   같은 함정을 audiogate 가 이미 signSecret() 으로 방어하고 있었다 — 여기에도 같은 처리를 둔다.
// 🔴 인증 메일과 마케팅 메일의 **발송 계정**을 가른다(2026-08-28).
//   Resend 의 차단 목록·일일 한도·도메인 평판은 전부 **계정 단위**다. 지금은 키가 하나라,
//   마케팅 대량 발송에서 반송이 나면 그 주소의 **로그인 인증 메일까지** 막힌다.
//   실제로 7/24 대량 발송 반송으로 OTP 가 3주간 끊겼다(memory: email_suppression_incident).
//   RESEND_FROM_MARKETING 으로 **발신 주소만** 갈라 놨는데, 그건 계정을 안 가르므로 효과가 없다.
//   → 인증·계정 복구·수강 연결 계열은 AUTH_EMAIL_SERVICE(Service Binding)를 쓴다.
//     Resend 키는 진단 Worker 한 곳만 소유하고, 이 Worker에는 복사하지 않는다.
//   로컬 개발처럼 바인딩이 없는 환경에서만 RESEND_API_KEY_AUTH → RESEND_API_KEY 순서로 폴백한다.
function resendKey(env, lane) {
  const raw = lane === "auth" && env.RESEND_API_KEY_AUTH ? env.RESEND_API_KEY_AUTH : env.RESEND_API_KEY;
  const s = String(raw || "");
  let out = "";
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c !== 65279 && c > 32) out += s[i]; }
  return out;
}

// lane="auth" = 로그인·인증코드·비밀번호 재설정처럼 **못 가면 서비스가 멈추는** 메일.
//   그런 메일은 마케팅과 같은 계정에 두지 않는다(위 resendKey 주석 참조).
async function sendResendEmail(env, { to, subject, html, idempotencyKey, lane }) {
  if (lane === "auth" && env.AUTH_EMAIL_SERVICE) {
    try {
      const result = await env.AUTH_EMAIL_SERVICE.sendCriticalEmail({ to, subject, html, idempotencyKey });
      if (result?.ok) return result.id || true;
      console.log(JSON.stringify({ evt: "auth_email_service_fail", status: result?.status || 502, error: result?.error || "send_failed" }));
      return false;
    } catch (e) {
      console.log(JSON.stringify({ evt: "auth_email_service_fail", status: "rpc", detail: String(e).slice(0, 120) }));
      return false;
    }
  }
  if (!resendKey(env, lane)) return false;
  const from = (lane === "auth" && env.RESEND_FROM_AUTH) || env.RESEND_FROM || "LiterStella <onboarding@resend.dev>"; // 도메인 인증 후 인증@literstella.co.kr
  // 429/5xx 지수 백오프 재시도 2회 + 실패 로깅(발송 감사 2026-07-20 P0: 대량 유입 시 순간 레이트 초과가 조용한 send_failed로 전락하던 것).
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const headers = { Authorization: `Bearer ${resendKey(env, lane)}`, "Content-Type": "application/json" };
      if (idempotencyKey) headers["Idempotency-Key"] = String(idempotencyKey).slice(0, 256);
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers,
        body: JSON.stringify({ from, to: [to], subject, html }),
      });
      if (r.ok) {
        // 발송 ID 를 돌려준다(2026-08-26, 카페 이관 감사 요구). 문자열은 truthy 라
        // 기존 14곳의 boolean 검사(if (sent) / if (!sent))는 그대로 동작한다.
        // 🔴 sent === true 강비교만 금지 — 전수 확인 결과 그런 호출부는 없다.
        const d = await r.json().catch(() => null);
        return (d && d.id) ? String(d.id) : true;
      }
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

// 발송 차단(suppression) 사전 조회 — 트랜잭션 메일(OTP·비번재설정) 전용.
//   🔴 왜 필요한가(2026-08-18 사고): Resend는 차단된 주소로 보내려 해도 HTTP 200 + {id}를 준다.
//      sendResendEmail은 r.ok만 보므로 "발송 성공"으로 판정 → 화면엔 "보냈어요"만 뜨고 메일은 안 간다.
//      실제로 7/24 대량 안내 메일 반송으로 카카오·다음 계열 다수가 3주간 인증 코드를 못 받았고,
//      사용자는 10분 뒤 '코드 만료' 문구만 봤다(원인 정보 0). 그래서 보내기 전에 물어본다.
//   ⚠️ fail-open: 조회가 실패(401·5xx·네트워크)하면 "차단"으로 단정하지 않고 발송을 진행한다
//      — 조회 장애가 로그인 전면 차단으로 번지면 안 된다.
// lane 을 받는다 — 차단 목록은 계정 단위라, 인증 레인의 차단 여부는 인증 계정에서 물어야 맞다.
async function isEmailSuppressed(env, email, lane) {
  if (lane === "auth" && env.AUTH_EMAIL_SERVICE) {
    try {
      const result = await env.AUTH_EMAIL_SERVICE.getSuppressionStatus(email);
      if (result?.ok) return Boolean(result.suppressed);
      console.log(JSON.stringify({ evt: "auth_suppression_check_fail", status: result?.status || 502 }));
      return false;
    } catch (e) {
      console.log(JSON.stringify({ evt: "auth_suppression_check_fail", status: "rpc", detail: String(e).slice(0, 100) }));
      return false;
    }
  }
  if (!resendKey(env, lane)) return false;
  try {
    const r = await fetch(`https://api.resend.com/suppressions/${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${resendKey(env, lane)}` },
    });
    if (r.status === 404) return false;  // 목록에 없음 = 정상 주소
    if (r.ok) return true;               // 200 = 차단 중 → 보내봐야 안 간다
    console.log(JSON.stringify({ evt: "suppression_check_fail", status: r.status }));
    return false;
  } catch (e) {
    console.log(JSON.stringify({ evt: "suppression_check_fail", status: "network", detail: String(e).slice(0, 100) }));
    return false;
  }
}

// 차단 자동 회복 — "살아있는데 차단만 된" 주소를 시스템이 스스로 구제한다(2026-08-18).
//   🔴 근거: 7/24 차단분은 죽은 주소가 아니라 대량 발송이 통째로 거부되며 휩쓸린 정상 주소다
//      (표본 36개 중 18개가 유료 수강생·2개는 과거 그 주소로 OTP 성공 이력). 차단만 풀면 메일이 간다.
//   안전장치 3겹 — 없으면 진짜 죽은 주소에 반복 발송해 도메인 평판을 깎는다:
//     ① 우리가 반송을 '관측한' 주소는 풀지 않는다(웹훅 기록이 곧 증거).
//     ② 주소당 1회만 — 풀어봤는데 또 차단됐다면 그건 진짜 문제 주소다.
//     ③ 조회 실패 시 풀지 않는다(모르면 건드리지 않는다).
//   해제 후 또 반송되면 Resend가 다시 차단하고 웹훅이 기록 → 다음부터 ①에 걸려 자동 중단.
async function tryAutoUnsuppress(env, email, lane) {
  if (lane !== "auth" || !env.AUTH_EMAIL_SERVICE) {
    if (!resendKey(env, lane)) return false;
  }
  try {                                                   // ① 관측된 반송 이력(90일)
    const since = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
    const r = await sbFetch(env, `email_bounces?email=eq.${encodeURIComponent(email)}&occurred_at=gte.${encodeURIComponent(since)}&select=id&limit=1`);
    if (!r.ok) return false;
    if ((await r.json()).length) return false;
  } catch { return false; }                               // ③ 모르면 건드리지 않는다
  if (env.OTP_GUARD && await env.OTP_GUARD.get(`auto-unsup:${email}`)) return false;   // ② 주소당 1회
  if (lane === "auth" && env.AUTH_EMAIL_SERVICE) {
    try {
      const result = await env.AUTH_EMAIL_SERVICE.removeSuppression(email);
      console.log(JSON.stringify({ evt: "auth_auto_unsuppress", ok: Boolean(result?.ok), status: result?.status || 200 }));
      if (!result?.ok) return false;
      if (env.OTP_GUARD) await env.OTP_GUARD.put(`auto-unsup:${email}`, "1", { expirationTtl: 90 * 86400 });
      return true;
    } catch (e) {
      console.log(JSON.stringify({ evt: "auth_auto_unsuppress", ok: false, status: "rpc", detail: String(e).slice(0, 100) }));
      return false;
    }
  }
  try {
    const r = await fetch(`https://api.resend.com/suppressions/${encodeURIComponent(email)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${resendKey(env, lane)}` },
    });
    console.log(JSON.stringify({ evt: "auto_unsuppress", ok: r.ok, status: r.status }));
    if (!r.ok) return false;
    if (env.OTP_GUARD) await env.OTP_GUARD.put(`auto-unsup:${email}`, "1", { expirationTtl: 90 * 86400 });
    return true;
  } catch { return false; }
}

// 차단 주소가 인증 코드를 시도했다 = 고객이 지금 로그인을 못 하고 있다는 신호 → 운영자에게 알린다.
//   같은 주소로 하루 1통만(반복 시도 9회에 9통 가는 것 방지 — KV 없으면 알림을 건너뛴다).
async function notifySuppressedAttempt(env, email) {
  try {
    if (env.OTP_GUARD) {
      const k = `sup-notify:${email}`;
      if (await env.OTP_GUARD.get(k)) return;
      await env.OTP_GUARD.put(k, "1", { expirationTtl: 86400 });
    }
    const admin = env.ADMIN_EMAIL || "literbryanbae@gmail.com";
    await sendResendEmail(env, {
      to: admin,
      subject: `[리터스텔라] 인증 메일 차단 — ${maskEmailAddr(email)} 로그인 못 함`,
      html: brandEmailHtml(
        `<p style="margin:0 0 12px;font-size:15px;">아래 주소가 인증 코드를 요청했지만 <b>발송 차단 목록</b>에 있어 메일이 나가지 않았어요.</p>`
        + `<p style="margin:0 0 12px;font-size:15px;"><b>${email}</b></p>`
        + `<p style="margin:0 0 12px;font-size:13px;color:#6b6355;line-height:1.7;">차단 원인이 대량 발송 반송이면 해제해도 안전합니다. Resend 대시보드 → Suppressions에서 확인해 주세요. 사용자에게는 화면에서 카카오 채널로 문의하도록 안내되고 있어요.</p>`
      ),
      idempotencyKey: `supnotify:${email}:${new Date().toISOString().slice(0, 10)}`,
      lane: "auth",
    });
  } catch { /* 알림 실패가 로그인 흐름을 막지 않는다 */ }
}

// ── Resend 반송·스팸신고 웹훅 수신 (2026-08-18 신설) ──────────────────────────
//   🔴 왜: 7/24 대량 안내 메일이 수백 건 반송돼 카카오·다음 계열이 무더기로 차단됐는데,
//      반송을 받아보는 창구가 어디에도 없어 3주 동안 아무도 몰랐다. 그 사이 유료 수강생들이
//      로그인·수강 연결을 못 했다. 이제 반송이 오는 즉시 기록하고, 몰려오면 운영자에게 알린다.
//   서명 = Svix 표준(결제 웹훅과 동일 계산식, 헤더 이름만 svix-*). 검증 실패는 401로 버린다.
async function verifySvixSignature(secret, raw, id, ts, sig) {
  if (!secret || !id || !ts || !sig) return false;
  const now = Math.floor(Date.now() / 1000), tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 300) return false;      // ±5분
  let keyBytes; try { keyBytes = b64ToBytes(secret.startsWith("whsec_") ? secret.slice(6) : secret); } catch { return false; }
  let expected; try { expected = await hmacSha256Base64(keyBytes, `${id}.${ts}.${raw}`); } catch { return false; }
  return String(sig).split(" ").some((part) => {
    const c = part.indexOf(",");
    return c > 0 && part.slice(0, c) === "v1" && timingSafeEq(part.slice(c + 1), expected);
  });
}

const BOUNCE_EVENTS = ["email.bounced", "email.complained", "email.failed", "email.suppressed"];
// 제목으로 트랜잭션 여부를 가른다 — 트랜잭션 반송은 "그 사람이 지금 못 들어온다"는 뜻이라 무게가 다르다.
const TX_SUBJECT_RE = /인증 코드|비밀번호 재설정|수강 연결/;

async function resendWebhook(req, env, cors) {
  const raw = await req.text();
  const ok = await verifySvixSignature(
    env.RESEND_WEBHOOK_SECRET, raw,
    req.headers.get("svix-id"), req.headers.get("svix-timestamp"), req.headers.get("svix-signature"),
  );
  if (!ok) return json({ ok: false, error: "bad_signature" }, 401, cors);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const type = String(ev?.type || "");
  if (!BOUNCE_EVENTS.includes(type)) return json({ ok: true, ignored: type }, 200, cors);

  const d = ev.data || {};
  const to = String(Array.isArray(d.to) ? d.to[0] : (d.to || "")).trim().toLowerCase();
  if (!to) return json({ ok: true, ignored: "no_recipient" }, 200, cors);
  const subject = String(d.subject || "").slice(0, 200);
  const row = {
    email: to,
    event: type.replace(/^email\./, ""),
    bounce_type: d.bounce?.type ? String(d.bounce.type).slice(0, 40) : null,
    bounce_subtype: d.bounce?.subType ? String(d.bounce.subType).slice(0, 40) : null,
    reason: d.bounce?.message ? String(d.bounce.message).slice(0, 500) : null,
    subject,
    resend_email_id: d.email_id ? String(d.email_id).slice(0, 80) : null,
    is_transactional: TX_SUBJECT_RE.test(subject),
    occurred_at: d.created_at || ev.created_at || new Date().toISOString(),
  };
  try {
    // 같은 메일의 같은 이벤트가 재전송돼도 한 줄만 남는다(부분 유니크 인덱스 + ignore-duplicates).
    await sbFetch(env, "email_bounces?on_conflict=resend_email_id,event", {
      method: "POST",
      headers: { Prefer: "return=minimal,resolution=ignore-duplicates" },
      body: JSON.stringify([row]),
    });
  } catch (e) {
    console.log(JSON.stringify({ evt: "bounce_record_fail", detail: String(e).slice(0, 120) }));
  }
  await maybeAlertBounceSurge(env, row);
  return json({ ok: true }, 200, cors);
}

// 반송이 "몰려오는" 순간을 잡는다 — 7/24처럼 대량 발송이 통째로 거부되는 사고를 당일에 알기 위해.
//   트랜잭션 반송은 1건이라도 알린다(그 사람이 못 들어온다는 뜻). 마케팅은 10분 20건 이상일 때만.
async function maybeAlertBounceSurge(env, row) {
  try {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let recent = 0;
    try {
      const r = await sbFetch(env, `email_bounces?occurred_at=gte.${encodeURIComponent(since)}&select=id`, {
        headers: { Prefer: "count=exact", Range: "0-0" },
      });
      const cr = r.headers.get("content-range") || "";
      recent = Number(cr.split("/")[1]) || 0;
    } catch { /* 집계 실패는 알림 판단만 보수적으로 */ }
    const surge = recent >= 20;
    if (!row.is_transactional && !surge) return;
    if (env.OTP_GUARD) {                                   // 폭주 시 알림 자체가 폭주하지 않도록 10분에 1통
      const k = surge ? "bounce-surge-alert" : `bounce-tx-alert:${row.email}`;
      if (await env.OTP_GUARD.get(k)) return;
      await env.OTP_GUARD.put(k, "1", { expirationTtl: surge ? 600 : 86400 });
    }
    const admin = env.ADMIN_EMAIL || "literbryanbae@gmail.com";
    const head = surge
      ? `<p style="margin:0 0 12px;font-size:15px;"><b>최근 10분 동안 반송이 ${recent}건</b> 발생했어요. 대량 발송이 통째로 거부되는 중일 수 있습니다.</p>`
      : `<p style="margin:0 0 12px;font-size:15px;"><b>인증 메일이 반송</b>됐어요. 이 분은 지금 로그인하지 못하는 상태입니다.</p>`;
    await sendResendEmail(env, {
      to: admin,
      subject: surge ? `[리터스텔라] ⚠️ 반송 급증 — 10분 ${recent}건` : `[리터스텔라] 인증 메일 반송 — ${maskEmailAddr(row.email)}`,
      html: brandEmailHtml(
        head
        + `<p style="margin:0 0 10px;font-size:14px;">주소: <b>${row.email}</b><br />제목: ${row.subject || "-"}<br />유형: ${row.bounce_type || "-"} / ${row.bounce_subtype || "-"}</p>`
        + (row.reason ? `<p style="margin:0 0 12px;font-size:12.5px;color:#6b6355;line-height:1.6;">사유: ${row.reason}</p>` : "")
        + `<p style="margin:0;font-size:12.5px;color:#6b6355;line-height:1.7;">반송된 주소는 Resend가 자동으로 차단 목록에 올려 <b>이후 인증 메일까지 막습니다.</b> 대량 발송 거부가 원인이면 Suppressions에서 해제해 주세요.</p>`
      ),
      idempotencyKey: `bouncealert:${surge ? "surge" : row.email}:${new Date().toISOString().slice(0, 13)}`,
      lane: "auth",
    });
  } catch { /* 알림 실패가 웹훅 200을 막지 않는다 */ }
}

const RESEND_MIGRATION_TEMPLATE = "8511cc4c-1f05-412c-a1c0-cfea2358ca2f";
const MIGRATION_CRON = "50 23 30 7 *"; // 2026-07-31 08:50 KST, one-time send

async function fetchAllResendContacts(env) {
  const contacts = [];
  let after = "";
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ limit: "100" });
    if (after) query.set("after", after);
    let response = null;
    for (let attempt = 0; attempt <= 4; attempt++) {
      response = await fetch(
        `https://api.resend.com/contacts?${query}`,
        { headers: { Authorization: `Bearer ${resendKey(env)}` } },
      );
      if (response.ok) break;
      if (response.status !== 429 && response.status < 500) break;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
    if (!response.ok) throw new Error(`resend_contacts_${response.status}`);
    const body = await response.json().catch(() => null);
    const rows = Array.isArray(body?.data) ? body.data : [];
    contacts.push(...rows);
    if (!body?.has_more || !rows.length) break;
    const next = String(rows[rows.length - 1]?.id || "");
    if (!next || next === after) throw new Error("resend_contacts_pagination");
    after = next;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return contacts;
}

async function fetchAllClassEnrollmentEmails(env) {
  const emails = new Set();
  const pageSize = 1000;
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const response = await sbFetch(env, `class_enrollments?select=email&order=email.asc&limit=${pageSize}&offset=${offset}`);
    if (!response.ok) throw new Error(`class_enrollment_audience_${response.status}`);
    const rows = (await response.json().catch(() => [])) || [];
    for (const row of rows) {
      const email = String(row?.email || "").trim().toLowerCase();
      if (EMAIL_RE.test(email)) emails.add(email);
    }
    if (rows.length < pageSize) break;
  }
  if (!emails.size) throw new Error("class_enrollment_audience_empty");
  return emails;
}

// ── 수신거부(원클릭) — RFC 8058 (2026-08-27 신설) ─────────────────────────────
//   🔴 그동안 대량 메일이 `List-Unsubscribe-Post: One-Click` 을 **선언만** 했고, 그 URL 은
//      challenge.literstella.co.kr/?view=settings 라는 정적 SPA 였다. 메일 클라이언트가 규격대로
//      POST 를 보내도 아무것도 바뀌지 않았다 — 선언과 실제가 어긋난 상태다.
//      Gmail·Yahoo 는 대량 발송자에게 '작동하는' 원클릭을 요구하므로, 안 되는 걸 선언하는 건
//      안 붙이는 것보다 나쁠 수 있다(테스트를 한다).
//
//   설계: 수신자별 토큰을 **무상태 HMAC** 으로 만든다. 저장할 게 없고, 비밀키를 바꾸면 전부 무효화된다.
//     토큰 = base64url(email) + "." + channel + "." + HMAC(email:channel)
//   POST = 즉시 처리(확인 화면 없이 — 규격 요구), GET = 사람이 눌렀을 때 보이는 확인 페이지.
const UNSUB_CHANNELS = ["lifecycle", "sentence", "lecture", "hp", "marketing", "all"];

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const pad = str.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(pad + "=".repeat((4 - pad.length % 4) % 4))));
}
async function unsubToken(env, email, channel) {
  const e = normEmail(email);
  const sig = await hmacHex(env.OTP_SECRET || "", `unsub:${e}:${channel}`);
  return `${b64urlEncode(e)}.${channel}.${sig.slice(0, 32)}`;
}
async function parseUnsubToken(env, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [b64, channel, sig] = parts;
  if (!UNSUB_CHANNELS.includes(channel)) return null;
  let email = "";
  try { email = normEmail(b64urlDecode(b64)); } catch { return null; }
  if (!email) return null;
  const expected = (await hmacHex(env.OTP_SECRET || "", `unsub:${email}:${channel}`)).slice(0, 32);
  if (!timingSafeEq(expected, sig)) return null;
  return { email, channel };
}
// 수신자별 헤더 — 이게 있어야 원클릭이 실제로 동작한다.
async function marketingHeadersFor(env, email, channel) {
  const url = `${API_ORIGIN(env)}/api/unsub?t=${await unsubToken(env, email, channel)}`;
  return {
    "List-Unsubscribe": `<${url}>, <mailto:literbryanbae@gmail.com?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
function API_ORIGIN(env) {
  return env.PUBLIC_API_ORIGIN || "https://literstella-api.literbryanbae.workers.dev";
}

// 채널별로 실제 수신을 끈다. 각 채널의 정본 저장소가 다르므로 여기서 한곳에 모아 둔다.
async function applyUnsub(env, email, channel, via, userAgent) {
  const e = normEmail(email);
  const done = [];
  const off = async (table, col) => {
    const r = await sbFetch(env, table, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ email: e, [col]: false }]),
    });
    if (r.ok) done.push(table);
  };
  if (channel === "lifecycle" || channel === "all") {
    const r = await sbFetch(env, "email_prefs", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ email: e, lifecycle: false, updated_at: new Date().toISOString(), updated_by: via }]),
    });
    if (r.ok) done.push("lifecycle");
  }
  if (channel === "sentence" || channel === "all") await off("sentence_subscribers", "active");
  if (channel === "lecture" || channel === "all") await off("lecture_subscribers", "active");
  if (channel === "hp" || channel === "all") await off("hp_subscribers", "active");
  if (channel === "marketing" || channel === "all") {
    // 광고 동의 철회 — 출처·일시를 남긴다(철회도 입증 대상이다).
    await sbFetch(env, `users?email=eq.${encodeURIComponent(e)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ marketing_consent: false, marketing_consent_at: new Date().toISOString(), marketing_consent_source: `unsub:${via}` }),
    });
    done.push("marketing");
  }
  try {
    await sbFetch(env, "email_unsub_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ email: e, channel, via, user_agent: String(userAgent || "").slice(0, 200) }]),
    });
  } catch { /* 기록 실패가 수신거부를 막지는 않는다 */ }
  return done;
}

const UNSUB_LABEL = { lifecycle: "리터스텔라 안내 메일", sentence: "「클래식 영어 한 문장」", lecture: "강독 새 강의 소식", hp: "호그와트 편지", marketing: "혜택·이벤트 안내", all: "모든 메일" };

async function unsubRoute(req, env, cors) {
  const url = new URL(req.url);
  const parsed = await parseUnsubToken(env, url.searchParams.get("t"));
  const page = (title, body) => new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#FCFAF5;color:#1D2433;font:16px/1.7 -apple-system,'Malgun Gothic',sans-serif;padding:24px}` +
    `.c{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#746B5F;margin:0 0 18px}` +
    `a{display:inline-block;padding:12px 20px;border-radius:10px;background:#1D2433;color:#fff;text-decoration:none;font-weight:700}</style>` +
    `<div class="c">${body}</div>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...cors } });

  if (!parsed) {
    return page("링크가 만료되었습니다",
      `<h1>링크가 만료되었어요</h1><p>메일의 수신거부 링크가 오래되었거나 올바르지 않습니다. 계정 설정에서 직접 끄실 수 있어요.</p>` +
      `<a href="https://challenge.literstella.co.kr/?view=settings&tab=notify">수신 설정 열기</a>`);
  }
  const { email, channel } = parsed;
  const label = UNSUB_LABEL[channel] || channel;

  // 🔴 POST = 메일 클라이언트의 원클릭. 규격상 확인 화면 없이 즉시 처리해야 한다.
  if (req.method === "POST") {
    await applyUnsub(env, email, channel, "one-click", req.headers.get("user-agent"));
    return json({ ok: true, channel }, 200, cors);
  }
  // GET 에 confirm=1 이면 처리, 아니면 확인 화면(사람이 실수로 눌렀을 때 되돌릴 여지를 준다)
  if (url.searchParams.get("confirm") === "1") {
    await applyUnsub(env, email, channel, "settings", req.headers.get("user-agent"));
    return page("수신거부 완료",
      `<h1>수신거부 처리했습니다</h1><p><b>${label}</b>을(를) 더 이상 보내지 않습니다.<br>다시 받고 싶으시면 계정 설정에서 켜실 수 있어요.</p>` +
      `<a href="https://challenge.literstella.co.kr/?view=settings&tab=notify">수신 설정 열기</a>`);
  }
  return page("수신거부",
    `<h1>${label} 수신을 끌까요?</h1><p>확인을 누르면 더 이상 보내지 않습니다.</p>` +
    `<a href="${url.pathname}?t=${encodeURIComponent(url.searchParams.get("t"))}&confirm=1">수신거부 확인</a>`);
}

// ── 내 수신 설정 (계정 센터 '알림·수신' 화면용) ─────────────────────────────
//   화면이 네 갈래를 각자 다른 저장소에서 읽던 것을 이 하나로 모은다.
async function myEmailPrefs(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  const email = normEmail(user.email);

  if (req.method === "GET") {
    const one = async (fn) => { try { return await fn(); } catch { return null; } };
    const flag = async (table) => {
      const r = await sbFetch(env, `${table}?email=eq.${encodeURIComponent(email)}&select=active&limit=1`);
      if (!r.ok) return false;
      const row = (await r.json())[0];
      return !!(row && row.active);
    };
    const lifecycle = await one(async () => {
      const r = await sbFetch(env, `email_prefs?email=eq.${encodeURIComponent(email)}&select=lifecycle&limit=1`);
      if (!r.ok) return true;
      const row = (await r.json())[0];
      return row ? !!row.lifecycle : true;   // 행이 없으면 기본 수신
    });
    const marketing = await one(async () => {
      const r = await sbFetch(env, `users?email=eq.${encodeURIComponent(email)}&select=marketing_consent&limit=1`);
      if (!r.ok) return false;
      const row = (await r.json())[0];
      return !!(row && row.marketing_consent);
    });
    return json({
      ok: true,
      prefs: {
        lifecycle: lifecycle !== false,
        sentence: await one(() => flag("sentence_subscribers")) || false,
        lecture: await one(() => flag("lecture_subscribers")) || false,
        hp: await one(() => flag("hp_subscribers")) || false,
        marketing: marketing || false,
      },
    }, 200, cors);
  }

  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const channel = String(b.channel || "");
  const on = b.on === true;
  if (!["lifecycle", "sentence", "lecture", "hp", "marketing"].includes(channel)) {
    return json({ ok: false, error: "bad_channel" }, 400, cors);
  }
  if (!on) {
    await applyUnsub(env, email, channel, "settings", req.headers.get("user-agent"));
    return json({ ok: true, channel, on: false }, 200, cors);
  }
  // 켜기
  const upsert = (table, row) => sbFetch(env, table, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });
  if (channel === "lifecycle") await upsert("email_prefs", { email, lifecycle: true, updated_at: new Date().toISOString(), updated_by: "settings" });
  if (channel === "sentence") await upsert("sentence_subscribers", { email, active: true });
  if (channel === "lecture") await upsert("lecture_subscribers", { email, active: true });
  if (channel === "hp") await upsert("hp_subscribers", { email, active: true });
  if (channel === "marketing") {
    await sbFetch(env, `users?email=eq.${encodeURIComponent(email)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ marketing_consent: true, marketing_consent_at: new Date().toISOString(), marketing_consent_source: "settings-self" }),
    });
  }
  return json({ ok: true, channel, on: true }, 200, cors);
}

// ── 마케팅 대량 발송 규약 (2026-08-18 신설) ──────────────────────────────────
//   🔴 7/24 이관 안내 메일 2,545통을 한 번에 보냈다가 카카오·다음 계열이 무더기로 거부했고,
//      그 반송이 Resend 차단 목록에 쌓여 같은 사람들의 '인증 코드'까지 3주간 막혔다.
//   대량 발송이 거부되는 대표 원인이 수신거부 헤더 부재다 — Gmail·Yahoo는 대량 발송자에게
//   List-Unsubscribe(원클릭)를 요구하고, 없으면 스팸·차단으로 처리한다. 본문 링크만으론 부족하다.
//   ⚠️ 차단 목록(suppression)은 Resend '계정' 단위라 발신 주소만 바꿔도 공유된다.
//      FROM 분리는 평판 격리와 향후 계정 분리를 위한 준비이고, 오염 차단 자체는 아니다.
const MARKETING_UNSUB_URL = "https://challenge.literstella.co.kr/?view=settings";
const MARKETING_HEADERS = {
  "List-Unsubscribe": `<${MARKETING_UNSUB_URL}>, <mailto:literbryanbae@gmail.com?subject=unsubscribe>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
};
// 마케팅 전용 발신 주소. 미설정이면 기존 주소로 폴백(동작 불변) — 서브도메인/별도 계정 전환 시 이 값만 바꾼다.
function marketingFrom(env) {
  return env.RESEND_FROM_MARKETING || env.RESEND_FROM || "LiterStella <onboarding@resend.dev>";
}

async function sendResendTemplateBatches(env, contacts, templateId, variablesFor, campaignKey) {
  const from = marketingFrom(env);
  let sent = 0;
  let failed = 0;
  for (let offset = 0; offset < contacts.length; offset += RESEND_BATCH_SIZE) {
    const selected = contacts.slice(offset, offset + RESEND_BATCH_SIZE);
    // 수신자별 토큰 링크를 만들어야 하므로 map 이 비동기다 — Promise.all 로 모은다.
    //   (정적 URL 이면 원클릭 POST 가 누구인지 알 수 없어 무효였다.)
    const batch = await Promise.all(selected.map(async (contact) => ({
      from,
      to: [contact.email],
      headers: await marketingHeadersFor(env, contact.email, "marketing").catch(() => MARKETING_HEADERS),
      template: { id: templateId, variables: variablesFor(contact) },
    })));
    let ok = false;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const response = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey(env)}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `${campaignKey}-${offset}`,
          },
          body: JSON.stringify(batch),
        });
        if (response.ok) {
          ok = true;
          break;
        }
        const retryable = response.status === 429 || response.status >= 500;
        const detail = await response.text().catch(() => "");
        console.log(JSON.stringify({
          evt: "campaign_batch_fail",
          campaignKey,
          offset,
          status: response.status,
          detail: detail.slice(0, 160),
        }));
        if (!retryable) break;
      } catch { /* retry below */ }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    if (ok) sent += batch.length;
    else failed += batch.length;
    if (offset + RESEND_BATCH_SIZE < contacts.length) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  console.log(JSON.stringify({ evt: "campaign_complete", campaignKey, sent, failed }));
  return { sent, failed };
}

async function runMigrationNoticeCampaign(env) {
  const [contacts, enrollmentEmails] = await Promise.all([
    fetchAllResendContacts(env),
    fetchAllClassEnrollmentEmails(env),
  ]);
  const byEmail = new Map();
  for (const contact of contacts) {
    const email = String(contact?.email || "").trim().toLowerCase();
    const isLifetimeMember = classEnrollmentEmailCandidates(email).some((candidate) => enrollmentEmails.has(candidate));
    if (EMAIL_RE.test(email) && contact?.unsubscribed !== true && isLifetimeMember) byEmail.set(email, { ...contact, email });
  }
  if (!byEmail.size) throw new Error("migration_audience_empty");
  return sendResendTemplateBatches(
    env,
    [...byEmail.values()],
    RESEND_MIGRATION_TEMPLATE,
    (contact) => ({
      MEMBER_NAME: String(contact.first_name || "수강생").trim() || "수강생",
      CONNECTION_URL: "https://class-new.literstella.co.kr/verify?utm_source=resend&utm_medium=email&utm_campaign=lifetime_course_migration_2608",
      STABILIZATION_DATE: "2026년 8월 31일",
      SUPPORT_URL: "http://pf.kakao.com/_xkxdZxeb/chat",
      // 🔴 2026-08-23 정정: read.literstella.co.kr/privacy 는 실재하지 않는다(진단앱 SPA 폴백 →
      //    200을 주지만 진단 랜딩 홈이 뜬다). 발송 메일의 개인정보처리방침 링크가 죽어 있었다.
      PRIVACY_URL: "https://challenge.literstella.co.kr/privacy",
    }),
    "migration-20260801-0800",
  );
}

// 사용자가 클래스 연결 화면에서 선택 마케팅 수신에 명시적으로 동의한 경우에만
// 오후 Stella 혜택 Broadcast 세그먼트에 본인 이메일을 추가한다.
async function syncStellaMarketingOptIn(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "auth" }, 401, cors);
  if (user.metadata?.marketing_opt_in !== true || !user.metadata?.marketing_opt_in_at) {
    return json({ ok: false, error: "consent_required" }, 403, cors);
  }
  if (!env.RESEND_API_KEY || !env.RESEND_STELLA_OPTIN_SEGMENT_ID) {
    return json({ ok: false, error: "resend_config_missing" }, 503, cors);
  }

  const headers = {
    Authorization: `Bearer ${resendKey(env)}`,
    "Content-Type": "application/json",
  };
  const email = encodeURIComponent(user.email);
  const segmentId = encodeURIComponent(env.RESEND_STELLA_OPTIN_SEGMENT_ID);

  try {
    let response = await fetch(`https://api.resend.com/contacts/${email}/segments/${segmentId}`, {
      method: "POST",
      headers,
    });

    if (response.status === 404) {
      response = await fetch("https://api.resend.com/contacts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: user.email,
          unsubscribed: false,
          segments: [{ id: env.RESEND_STELLA_OPTIN_SEGMENT_ID }],
        }),
      });
    }

    if (!response.ok) {
      console.log(JSON.stringify({ evt: "stella_optin_sync_fail", status: response.status, userId: user.id }));
      return json({ ok: false, error: "resend_sync_failed" }, 502, cors);
    }
    return json({ ok: true }, 200, cors);
  } catch {
    return json({ ok: false, error: "resend_network" }, 502, cors);
  }
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
// 🔴 channel 을 받아 **수신자별** 수신거부 링크를 만든다(2026-08-27). 전에는 모두에게 같은
//   정적 URL(MARKETING_HEADERS)을 붙여서, 메일 클라이언트가 원클릭 POST 를 보내도 누가 껐는지
//   알 수 없어 아무 일도 일어나지 않았다. channel 기본값은 "marketing".
async function sendResendBatch(env, { to, subject, html, templateId, channel = "marketing", campaignKey = "" }) {
  if (!env.RESEND_API_KEY || !Array.isArray(to) || !to.length) return { sent: 0, failed: 0 };
  const from = marketingFrom(env);
  let sent = 0;
  let failed = 0;
  let providerStatus = null;
  let providerError = "";
  let providerMessage = "";
  for (let offset = 0; offset < to.length; offset += RESEND_BATCH_SIZE) {
    const slice = to.slice(offset, offset + RESEND_BATCH_SIZE);
    const perRecipientHeaders = {};
    for (const em of slice) {
      try { perRecipientHeaders[em] = await marketingHeadersFor(env, em, channel); } catch { /* 폴백=정적 헤더 */ }
    }
    const batch = slice.map(email => {
      const message = { from, to: [email], headers: perRecipientHeaders[email] || MARKETING_HEADERS };
      if (templateId) message.template = { id: templateId };
      else Object.assign(message, { subject, html });
      return message;
    });
    let ok = false;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const r = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey(env)}`,
            "Content-Type": "application/json",
            ...(campaignKey ? { "Idempotency-Key": `${campaignKey}-batch-${Math.floor(offset / RESEND_BATCH_SIZE) + 1}` } : {}),
          },
          body: JSON.stringify(batch),
        });
        if (r.ok) { ok = true; break; }
        providerStatus = r.status;
        const errorBody = await r.json().catch(() => null);
        providerError = String(errorBody?.name || errorBody?.error || "provider_rejected").slice(0, 80);
        providerMessage = String(errorBody?.message || "")
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
          .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
          .slice(0, 200);
        if (r.status !== 429 && r.status < 500) break;
      } catch { /* retry below */ }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
    if (ok) sent += batch.length;
    else failed += batch.length;
  }
  return { sent, failed, providerStatus, providerError, providerMessage };
}

// One-time service notice for members who are actively certifying the current challenge.
// The audience is always derived server-side; callers cannot provide recipient addresses.
const ACTIVE_CHALLENGE_NOTICE_CAMPAIGN = "active-challenge-continue-20260901-v1";
const ACTIVE_CHALLENGE_NOTICE_SEASON = "yanawan-2607";
const ACTIVE_CHALLENGE_NOTICE_LINK = "https://challenge.literstella.co.kr/?utm_source=email&utm_medium=lifecycle&utm_campaign=active_challenge_continue_20260901";
async function fetchAllRows(env, path, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const joiner = path.includes("?") ? "&" : "?";
    const r = await sbFetch(env, `${path}${joiner}limit=${pageSize}&offset=${offset}`);
    if (!r.ok) throw new Error(`audience_query_${r.status}`);
    const page = await r.json().catch(() => []);
    if (!Array.isArray(page)) throw new Error("audience_query_shape");
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}
async function fetchActiveChallengeNoticeAudience(env) {
  const enrollments = await fetchAllRows(env, `enrollments?season_id=eq.${ACTIVE_CHALLENGE_NOTICE_SEASON}&is_yanawan=eq.true&status=eq.active&select=user_id`);
  const activeUserIds = new Set(enrollments.map(row => String(row?.user_id || "")).filter(Boolean));
  if (!activeUserIds.size) return [];

  const checkIns = await fetchAllRows(env, `check_ins?season_id=eq.${ACTIVE_CHALLENGE_NOTICE_SEASON}&select=user_id`);
  const certifyingUserIds = new Set(checkIns.map(row => String(row?.user_id || "")).filter(id => activeUserIds.has(id)));
  if (!certifyingUserIds.size) return [];

  const users = await fetchAllRows(env, "users?select=id,email");
  const emails = new Set(users
    .filter(row => certifyingUserIds.has(String(row?.id || "")))
    .map(row => normEmail(row?.email))
    .filter(email => EMAIL_RE.test(email)));
  if (!emails.size) return [];

  const [prefs, unsubs, bounces] = await Promise.all([
    fetchAllRows(env, "email_prefs?lifecycle=eq.false&select=email"),
    fetchAllRows(env, "email_unsub_log?channel=in.(lifecycle,all)&select=email"),
    fetchAllRows(env, "email_bounces?or=(event.eq.suppressed,bounce_type.eq.Permanent)&select=email"),
  ]);
  for (const row of [...prefs, ...unsubs, ...bounces]) emails.delete(normEmail(row?.email));
  return [...emails].sort();
}
function activeChallengeNoticeHtml() {
  const body = `<div style="font-size:11px;letter-spacing:2px;color:#c8a84b;font-weight:800;margin-bottom:8px;">야나완 챌린지 안내</div>`
    + `<div style="font-size:20px;font-weight:800;line-height:1.45;margin-bottom:16px;">지금 인증 중인 도전은<br />그대로 이어가세요</div>`
    + `<p style="margin:0 0 12px;color:#5a5446;font-size:14px;line-height:1.75;">2026년 마지막 100일 도전이 시작됐지만, 현재 진행 중인 챌린지는 새로 신청할 필요가 없습니다.</p>`
    + `<div style="margin:0 0 20px;padding:14px 16px;background:#faf7ef;border-left:3px solid #c8a84b;color:#3f3a30;font-size:14px;line-height:1.75;"><strong>중단하거나 다시 신청하지 마세요.</strong><br />기존 시작일, 인증 기록, 포인트와 마감일은 그대로 유지됩니다.</div>`
    + `<div style="text-align:center;margin:8px 0 4px;"><a href="${ACTIVE_CHALLENGE_NOTICE_LINK}" style="display:inline-block;background:#c8a84b;color:#20160a;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:12px;font-size:14px;">오늘 인증 이어가기</a></div>`
    + `<p style="margin:18px 0 0;font-size:12px;color:#8a8270;text-align:center;line-height:1.6;">이 메일은 현재 챌린지 인증 회원에게 드리는 서비스 이용 안내입니다.</p>`;
  return brandEmailHtml(body);
}
async function sendActiveChallengeNotice(req, env, cors) {
  const admin = await requireAdmin(req, env);
  if (!admin) return json({ ok: false, error: "unauthorized" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const mode = String(b.mode || "dry");
  if (!["dry", "test", "send"].includes(mode)) return json({ ok: false, error: "bad_mode" }, 400, cors);
  let recipients;
  try { recipients = await fetchActiveChallengeNoticeAudience(env); }
  catch (error) { return json({ ok: false, error: "audience_failed", detail: String(error?.message || error) }, 502, cors); }
  if (mode === "dry") return json({ ok: true, mode, campaign: ACTIVE_CHALLENGE_NOTICE_CAMPAIGN, recipients: recipients.length }, 200, cors);

  const subject = "[야나완] 지금 인증 중인 도전은 그대로 이어가세요";
  const html = activeChallengeNoticeHtml();
  if (mode === "test") {
    const result = env.ADMIN_EMAIL
      ? await sendResendBatch(env, { to: [env.ADMIN_EMAIL], subject, html, channel: "lifecycle", campaignKey: `${ACTIVE_CHALLENGE_NOTICE_CAMPAIGN}-test` })
      : { sent: 0, failed: 1 };
    return json({ ok: result.sent === 1, mode, campaign: ACTIVE_CHALLENGE_NOTICE_CAMPAIGN, recipients: recipients.length, sent: result.sent, failed: result.failed, providerStatus: result.providerStatus, providerError: result.providerError, providerMessage: result.providerMessage }, result.sent === 1 ? 200 : 502, cors);
  }
  const result = await sendResendBatch(env, { to: recipients, subject, html, channel: "lifecycle", campaignKey: ACTIVE_CHALLENGE_NOTICE_CAMPAIGN });
  return json({ ok: result.failed === 0, mode, campaign: ACTIVE_CHALLENGE_NOTICE_CAMPAIGN, recipients: recipients.length, sent: result.sent, failed: result.failed, providerStatus: result.providerStatus, providerError: result.providerError }, result.failed === 0 ? 200 : 502, cors);
}

const RESEND_TEMPLATE_ALIASES = { newSpaceAnnouncement: "new-space-announcement" };
async function fetchResendAudienceEmails(env) {
  if (!env.RESEND_API_KEY) return { ok: false, error: "resend_key_missing" };
  try {
    const contacts = [];
    let after = "";
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ limit: "100" });
      if (after) query.set("after", after);
      const r = await fetch(`https://api.resend.com/contacts?${query}`, { headers: { Authorization: `Bearer ${resendKey(env)}` } });
      if (!r.ok) return { ok: false, error: "resend_contacts_failed", status: r.status };
      const body = await r.json().catch(() => null);
      const rows = Array.isArray(body?.data) ? body.data : [];
      contacts.push(...rows);
      if (!body?.has_more || !rows.length) break;
      const next = String(rows[rows.length - 1]?.id || "");
      if (!next || next === after) return { ok: false, error: "resend_contacts_pagination" };
      after = next;
    }
    const emails = [...new Set(contacts
      .filter(contact => contact && contact.unsubscribed !== true)
      .map(contact => String(contact.email || "").trim().toLowerCase())
      .filter(email => EMAIL_RE.test(email)))].sort();
    return { ok: true, emails };
  } catch { return { ok: false, error: "resend_contacts_network" }; }
}
// 라이프사이클 정보성 메일 발송. {to, key, data} → renderEmail → {{unsubscribe}} 치환 → Resend.
async function lifecycleEmail(req, env, cors) {
  // 🔴 스팸 중계기를 닫는다 (2026-08-27). 이 라우트는 인증이 없어서 누구나 아무 주소로
  //   리터스텔라 명의 메일(가입 환영·성공 축하·완독 등 14종)을 보낼 수 있었다. 발신 평판이
  //   훼손되고, 7/24 반송 사고로 이미 계정 단위 차단목록을 겪은 이력이 있다.
  //   이제 로그인 세션을 요구하고 **본인 주소로만** 허용한다. 호출부는 전부 로그인 이후 지점이라
  //   정상 흐름에 영향이 없다(클라이언트 토큰 동봉은 bf22c39 로 선배포 확인).
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const to = String(b.to || "").trim().toLowerCase();
  const key = String(b.key || "").trim();
  if (to !== normEmail(user.email)) return json({ ok: false, error: "not_own_address" }, 403, cors);
  if (!EMAIL_RE.test(to) || to.length > 254) return json({ ok: false, error: "bad_email" }, 400, cors);
  if (!LIFECYCLE[key]) return json({ ok: false, error: "bad_key" }, 400, cors);
  // 🔴 수신 거부를 **서버에서** 본다(2026-08-27). 전에는 유일한 스위치가 브라우저 localStorage 라
  //   기기·브라우저를 바꾸면 껐던 사람에게 다시 나갔다.
  try {
    const pr = await sbFetch(env, `email_prefs?email=eq.${encodeURIComponent(to)}&select=lifecycle&limit=1`);
    if (pr.ok) {
      const row = (await pr.json())[0];
      if (row && row.lifecycle === false) return json({ ok: true, skipped: "opted_out" }, 200, cors);
    }
  } catch { /* 조회 실패가 발송을 막지는 않는다 — 정보성이라 기본 수신 */ }
  const data = (b.data && typeof b.data === "object") ? b.data : {};
  let rendered;
  try { rendered = renderEmail(key, data); } catch { return json({ ok: false, error: "render" }, 500, cors); }
  // 정보성 수신 설정 링크(마이페이지 알림설정). 추후 토큰형 수신거부로 교체 가능.
  // 본문 수신거부 링크도 실제로 동작하는 토큰 링크로 바꾼다(전에는 설정 화면으로만 보냈다).
  const unsubUrl = `${API_ORIGIN(env)}/api/unsub?t=${await unsubToken(env, to, "lifecycle")}`;
  const unsub = `<a href="${unsubUrl}" style="color:#c8a84b;text-decoration:none;">수신거부</a> · <a href="https://challenge.literstella.co.kr/?view=settings&tab=notify" style="color:#c8a84b;text-decoration:none;">수신 설정</a> · 발신: 리터스텔라`;
  const html = rendered.html.replace(/\{\{unsubscribe\}\}/g, unsub);
  const ok = await sendResendEmail(env, { to, subject: rendered.subject, html });
  return json({ ok }, ok ? 200 : 502, cors);
}
// ── OTP 무차별 대입 가드 (2026-08-12) ──────────────────────────────────────────
//   🔴 배경: OTP 토큰 = `exp.HMAC(OTP_SECRET, "code:email:code:exp")` 를 **응답으로 그대로 돌려준다**.
//   서명이 코드를 덮고 있으므로, 토큰만 손에 넣으면 6자리 100만 가지를 대입해 맞출 수 있었다.
//   서버에 상태가 없어(KV·DO 바인딩 0개) "몇 번 틀렸나"를 적을 곳조차 없었던 것이 근본 원인.
//   피해 형태: 남의 명단 이메일로 토큰 발급 → 대입 성공 → 그 사람 소장 강좌가 공격자 계정으로 이관,
//   원 소유자는 alreadyLinked 로 **영구 차단**. 대량 유입 시기에는 피해자의 유일한 신호(요청 안 한 코드 1통)가
//   정상 트래픽에 묻혀 탐지도 어렵다.
//
//   설계: **토큰 형식을 바꾸지 않는다**(클라 3곳 무수정). 토큰 문자열의 SHA-256 을 KV 키로 삼아
//   시도 횟수를 센다. 검증 성공 시 키를 지워 **1회용**이 된다(같은 코드 재사용 차단).
//   발송도 이메일당 제한 — 토큰을 새로 받아 5회씩 무한히 시도하는 우회를 막는다.
const OTP_MAX_TRIES = 5;          // 토큰 하나당 코드 입력 시도
const OTP_SEND_MAX = 3;           // 이메일당 발송
const OTP_SEND_WINDOW_S = 600;    // 발송 제한 창(초)

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 발송 제한 — 🔴🔴 **아직 작동이 확인되지 않았다(2026-08-12).** 방어로 세지 말 것.
//   ① KV 로는 원리적으로 안 된다: KV 는 "키 없음"을 최대 60초 캐시하므로(negative caching)
//      첫 발송 뒤에도 읽기가 계속 null 을 보고 전부 통과한다(실측 4/4 통과).
//      ↔ 시도 카운터(otpGuardConsume)는 발급 시점에 키가 이미 있어 영향을 안 받는다 — 같은 KV 인데 결과가 갈린 이유.
//   ② 그래서 전용 Rate Limiting 바인딩으로 바꿨으나 **실측 6/6 통과**. 원인 미규명:
//      바인딩이 안 먹는 것인지, 내 호출부가 틀린 것인지 가르려면 워커 로그가 필요한데
//      `wrangler tail` 이 비대화형에서 CLOUDFLARE_API_TOKEN 을 요구해 관측하지 못했다.
//   🔑 **무차별 대입은 시도 카운터만으로 이미 닫힌다** — 토큰당 5회라 100만 코드를 뚫으려면
//      토큰 20만 개, 곧 피해자에게 메일 20만 통이 가야 한다(즉시 발각·Resend 스로틀).
//      이 발송 제한의 남은 값은 **피해자 메일 폭탄 방지**(defense in depth)이지 계정 탈취 방어가 아니다.
//   → 토큰이 생기면 tail 로 위 두 console 로그를 보고 원인을 가른다.
//   fail-open 은 유지하되(제한기 장애가 로그인을 막으면 안 된다) **조용히 지나가지 않게** 로그를 남긴다.
async function otpSendAllowed(env, email) {
  const rl = env.OTP_SEND_LIMIT;
  if (!rl || typeof rl.limit !== "function") {
    console.error(JSON.stringify({ evt: "otp_ratelimit_missing", bound: !!rl, type: typeof rl }));
    return { ok: true };   // 바인딩 부재는 기능을 막지 않되 **조용히 지나가지 않는다**
  }
  try {
    const r = await rl.limit({ key: await sha256Hex(email) });
    console.log(JSON.stringify({ evt: "otp_ratelimit", result: r, ok: r?.success }));
    return { ok: r?.success !== false };
  } catch (e) {
    console.error(JSON.stringify({ evt: "otp_ratelimit_error", msg: String(e && e.message || e) }));
    return { ok: true };
  }
}

// 발급한 토큰에 시도 카운터를 연다. TTL = 토큰 수명(만료되면 카운터도 함께 사라진다).
async function otpGuardIssue(env, token, ttlMs) {
  if (!env.OTP_GUARD) return;
  const ttl = Math.max(60, Math.ceil(ttlMs / 1000));
  await env.OTP_GUARD.put(`otp:${await sha256Hex(token)}`, "0", { expirationTtl: ttl });
}

// 코드 검증 **직전**에 부른다. 한도 초과면 토큰을 폐기한다.
//   반환 null = 통과, 아니면 그대로 응답할 에러 객체.
async function otpGuardConsume(env, token) {
  if (!env.OTP_GUARD) return null;
  const key = `otp:${await sha256Hex(token)}`;
  const cur = await env.OTP_GUARD.get(key);
  // 🔴 키가 없다 != 시간 만료다(2026-08-27). 토큰 자체의 exp 는 이 함수를 부르기 **전에** 이미 검사하므로,
  //   여기까지 왔다는 건 아직 시간이 남았다는 뜻이다. 그런데도 "10분 지나 만료"라고 안내해서
  //   실사용자가 새 코드를 받아 같은 벽에 5번 부딪히고 포기했다(정재연 님 신고).
  //   남은 원인은 "이미 한 번 통과해 소진됨" 뿐이니 그대로 말한다 — 새 코드를 받아도 소용없다는 걸 알려야
  //   사용자가 무한 재발급 루프에 빠지지 않는다.
  if (cur === null) return { error: "already_used", message: "이 인증 코드는 이미 사용됐어요. 새 코드를 받아 주세요." };
  // 한도 초과 표식. 종전엔 키를 **삭제**해서, 그 다음 시도부터는 원인이 "이미 사용됨"으로 둔갑했다
  //   — 사용자는 왜 막혔는지 영영 모른 채 새 코드만 계속 받았다. 표식을 남겨 계속 같은 이유를 말한다.
  if (cur === "X") return { error: "too_many_attempts", message: "코드를 여러 번 틀렸어요. 새 코드를 받아 주세요." };
  const n = Number(cur) + 1;
  if (n > OTP_MAX_TRIES) {
    await env.OTP_GUARD.put(key, "X", { expirationTtl: 900 });
    return { error: "too_many_attempts", message: "코드를 여러 번 틀렸어요. 새 코드를 받아 주세요." };
  }
  await env.OTP_GUARD.put(key, String(n), { expirationTtl: 900 });
  return null;
}

// 검증 성공 시 호출 — 토큰을 1회용으로 만든다.
async function otpGuardBurn(env, token) {
  if (!env.OTP_GUARD) return;
  await env.OTP_GUARD.delete(`otp:${await sha256Hex(token)}`);
}

async function otpSend(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const email = String(b.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ ok: false, error: "bad_email" }, 400, cors);
  // 🔴 발송 제한 — 토큰을 새로 받아 5회씩 무한 반복하는 우회를 막는다(10분에 3통).
  const allowed = await otpSendAllowed(env, email);
  if (!allowed.ok) return json({ ok: false, error: "too_many_requests", message: "인증 코드를 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요." }, 429, cors);
  // 🔴 보내기 전에 "이 주소로 메일이 나갈 수 있나"를 먼저 묻는다(2026-08-18). 못 나가면 거짓 성공 대신 원인을 알린다.
  if (await isEmailSuppressed(env, email, "auth")) {
    // 먼저 스스로 풀어본다 — 7/24 사고분은 대부분 여기서 조용히 해결돼 사용자는 아무것도 눈치채지 못한다.
    const recovered = await tryAutoUnsuppress(env, email, "auth");
    if (!recovered) {
      await notifySuppressedAttempt(env, email);
      return json({
        ok: false,
        error: "suppressed",
        message: "이 이메일 주소로는 저희 메일이 전달되지 않고 있어요. 다른 이메일로 로그인하시거나, 카카오 채널로 알려주시면 저희가 직접 연결해 드려요.",
      }, 422, cors);
    }
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const exp = Date.now() + OTP_TTL_MS;
  const sig = await hmacHex(env.OTP_SECRET, `code:${email}:${code}:${exp}`);
  const issuedAt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
  const sent = await sendResendEmail(env, {
    to: email,
    subject: `[리터스텔라] 이메일 인증 코드 · ${issuedAt}`,
    html: otpEmailHtml(code, issuedAt),
    lane: "auth",          // 마케팅이 무슨 일을 겪든 이 메일은 살아 있어야 한다
  });
  if (!sent) return json({ ok: false, error: "send_failed" }, 502, cors);
  const token = `${exp}.${sig}`;
  await otpGuardIssue(env, token, OTP_TTL_MS);   // 이 토큰의 시도 카운터를 연다
  return json({ ok: true, token, exp }, 200, cors);
}
async function otpVerify(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const email = String(b.email || "").trim().toLowerCase();
  const code = String(b.code || "").trim();
  const [expStr, sig] = String(b.token || "").split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return json({ ok: false, error: "expired" }, 400, cors);
  if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  const guard = await otpGuardConsume(env, b.token);          // 🔴 대입 시도 카운트
  if (guard) return json({ ok: false, ...guard }, 400, cors);
  const expected = await hmacHex(env.OTP_SECRET, `code:${email}:${code}:${exp}`);
  if (!timingSafeEq(expected, sig)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  await otpGuardBurn(env, b.token);                            // 성공 = 1회용 소진
  // 🔴 여기서 명단 대조까지 끝낸다(2026-08-24) — 종전엔 클라가 같은 토큰으로 verifyClassOtp 를
  //    한 번 더 불러 자동 연결하려 했지만, 바로 윗줄에서 토큰을 **이미 소각**해 그 호출은
  //    구조적으로 항상 실패했다(.catch 로 삼켜 아무도 몰랐고, 사용자는 /verify 에서 또 인증해야 했다).
  //    "가입 때 인증하고 연결 때 또 인증한다"는 운영자 지적의 실제 원인이 이것이었다.
  //    토큰 재사용을 없애고 **이메일 소유가 증명된 그 자리에서** 서버가 직접 기록한다.
  //    명단에 없으면 아무 일도 하지 않는다(no-op) — 인증 자체의 성패에는 영향을 주지 않는다.
  let linked = [];
  try {
    // 🔴 findClassEnrollments 는 **객체**를 준다({ ok, records, books }). 종전엔 그걸 배열로 받아
    //   `books.length` 가 항상 undefined -> falsy 라 이 블록이 **한 번도 실행되지 않았다**(2026-08-27 발견).
    //   즉 "가입 때 인증하면 연결까지 끝난다"는 2026-08-24 수정 자체가 죽어 있었고,
    //   운영자가 지적한 "가입 때 인증하고 연결 때 또 인증한다"가 그대로 남아 있었다.
    const { books, records } = await findClassEnrollments(env, email);
    if (books.length) {
      const r = await sbFetch(env, "class_verifications?on_conflict=email,book_code", {
        method: "POST",
        headers: { Prefer: "return=minimal,resolution=ignore-duplicates" },
        body: JSON.stringify(records.map(({ bookCode, enrollmentEmail }) => ({ email, book_code: bookCode, enrollment_email: enrollmentEmail }))),
      });
      if (r.ok) linked = books;
      // 실패해도 인증 자체는 성공이다(no-op). 다만 조용히 지나가지 않게 남긴다 —
      // 23505 면 그 결제 이메일이 다른 계정에 묶인 것이고, 사용자는 /verify 에서 안내를 받는다.
      else console.log(JSON.stringify({ evt: "otp_auto_link_rejected", status: r.status, books: books.length }));
      console.log(JSON.stringify({ evt: "otp_auto_link", books: books.length, ok: r.ok }));
    }
  } catch (e) {
    console.log(JSON.stringify({ evt: "otp_auto_link_fail", detail: String(e).slice(0, 100) }));
  }
  return json({ ok: true, linked }, 200, cors);
}

// ── 강독 클래스 소장회원 인증(6강+ 해금) ──
//   OTP HMAC 검증(otpVerify와 동일 서명식) = 이메일 소유 증명 → class_enrollments(명단) 대조 →
//   진짜 수강생이면 class_verifications(email, book_code) 기록(멱등). 게이트 워커가 이 행만 6강+ 자격으로 인정.
//   ⚠️ 이메일만 알면 signUp으로 JWT 얻어도, 그 이메일 OTP는 못 받으므로 verifications 못 만듦 = 탈취 차단.
async function findClassEnrollments(env, email) {
  const byBook = new Map();
  for (const enrollmentEmail of classEnrollmentEmailCandidates(email)) {
    const response = await sbFetch(env, `class_enrollments?email=eq.${encodeURIComponent(enrollmentEmail)}&select=book_code`);
    if (!response.ok) return { ok: false, records: [], books: [] };
    const rows = (await response.json().catch(() => [])) || [];
    for (const row of rows) {
      const bookCode = String(row?.book_code || "").trim().toLowerCase();
      if (bookCode && !byBook.has(bookCode)) byBook.set(bookCode, enrollmentEmail);
    }
  }
  const records = [...byBook].map(([bookCode, enrollmentEmail]) => ({ bookCode, enrollmentEmail }));
  return { ok: true, records, books: records.map((record) => record.bookCode) };
}

// 이 결제 이메일을 이미 쥐고 있는 **로그인 계정**을 찾아 마스킹해 돌려준다.
//   목적은 색출이 아니라 자가 해결이다 — 실측상 사실상 전부 "본인이 계정을 두 개 만든 것"이었다
//   (2026-08-27: 결제 이메일이 다른 계정에 묶인 128건 중 본인 계정이 따로 있는 경우 23건).
//   마스킹된 주소만 봐도 본인은 어느 계정인지 알아본다.
async function enrollmentHolder(env, records) {
  for (const enrollmentEmail of [...new Set(records.map((r) => r.enrollmentEmail))]) {
    const r = await sbFetch(env, `class_verifications?enrollment_email=eq.${encodeURIComponent(enrollmentEmail)}&select=email&limit=5`);
    if (!r.ok) continue;
    const rows = (await r.json().catch(() => [])) || [];
    if (rows.length && rows[0].email) return maskEmailAddr(rows[0].email);
  }
  return null;
}

async function verifiedBooksForLogin(env, loginEmail) {
  const response = await sbFetch(env, `class_verifications?email=eq.${encodeURIComponent(loginEmail)}&select=book_code`);
  if (!response.ok) return [];
  return [...new Set((((await response.json().catch(() => [])) || []).map((row) => row?.book_code).filter(Boolean)))];
}

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
  const guard = await otpGuardConsume(env, b.token);          // 🔴 대입 시도 카운트
  if (guard) return json({ ok: false, ...guard }, 400, cors);
  const expected = await hmacHex(env.OTP_SECRET, `code:${email}:${code}:${exp}`);
  if (!timingSafeEq(expected, sig)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  // 🔴 여기서 태우지 않는다(2026-08-27). 종전엔 코드가 맞자마자 소각해서, 그 아래 DB 기록이 실패하면
  //   **맞는 코드가 이미 재가 된 채** 사용자에게 실패만 보였다. 다시 넣으면 "만료"라고 나왔다.
  //   소각은 결과가 확정된 자리에서 한다(finishVerify). 시도 횟수는 otpGuardConsume 가 이미 세고 있어
  //   재시도를 열어 둬도 무차별 대입은 5회에서 막힌다.
  const finishVerify = async (payload, status = 200) => {
    await otpGuardBurn(env, b.token);                          // 결과 확정 = 1회용 소진
    return json(payload, status, cors);
  };
  // 이메일 소유 증명됨 → 수강 명단 대조(service_role).
  //   🔴 인증 1회 = 평생소장 전부(운영자 2026-07-20): 요청한 강좌 하나가 아니라 이 이메일이 명단에 있는
  //   모든 book_code에 verifications를 일괄 심는다 — 다른 소장 강좌는 재인증 없이 즉시 열림.
  const enrollment = await findClassEnrollments(env, email);
  // 명단 조회 자체가 실패 = 우리 쪽 장애. 코드는 태우지 않는다 — 같은 코드로 다시 시도할 수 있어야 한다.
  if (!enrollment.ok) return json({ ok: false, error: "roster_lookup_failed" }, 502, cors);
  const { books, records } = enrollment;
  if (!books.length) return finishVerify({ ok: false, notEnrolled: true, message: "이 이메일은 강독 클래스 수강 명단에 없어요. 결제하신 이메일이 맞는지 확인해 주세요." });
  // on_conflict 목표를 **명시**한다(2026-08-28). 안 적으면 같은 계정의 재인증까지 충돌로 올라와
  //   "다른 계정에 묶임"과 구분이 흐려진다. 이걸 붙여도 enrollment_once 위반은 그대로 터지는데,
  //   그게 정확히 우리가 잡고 싶은 "진짜 다른 계정" 신호다.
  const ins = await sbFetch(env, `class_verifications?on_conflict=email,book_code`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(records.map(({ bookCode, enrollmentEmail }) => ({
      email,
      book_code: bookCode,
      enrollment_email: enrollmentEmail,
    }))),
  });
  if (!ins.ok) {
    const detail = await ins.text().catch(() => "");
    // 🔴 enrollment_once 유니크 충돌(23505) — 같은 결제 이메일이 **다른 로그인 계정**에 이미 묶여 있다.
    //   ignore-duplicates 는 PK(email,book_code)만 무시하므로 이 유니크는 그대로 터진다.
    //   종전엔 이게 502 record_failed 로 뭉개져 "인증을 완료하지 못했어요"만 보였고, 재시도하면
    //   토큰이 이미 소각돼 "만료"가 떴다. 실제 원인은 계정이 두 개인 것이라 몇 번을 해도 안 된다.
    //   이제 어느 계정이 쥐고 있는지 가려서 알려 준다 — 실측상 거의 전부 본인의 두 번째 계정이라
    //   이 한 줄이면 스스로 해결한다.
    if (ins.status === 409 || /23505|duplicate/i.test(detail)) {
      const holder = await enrollmentHolder(env, records);
      // 🔴 로그인 이메일을 남긴다(2026-08-28). 정재연 님 건을 조사할 때 실패 로그에 이게 없어서
      //   "어느 계정으로 시도했나"를 소거법으로 좁혀야 했고, 하마터면 반대로 판단할 뻔했다.
      console.error(JSON.stringify({ evt: "class_verify_already_linked", login: maskEmailAddr(email), holder }));
      return finishVerify({
        ok: false,
        alreadyLinked: true,
        holder,
        message: holder
          ? `이 수강 이메일은 이미 ${holder} 계정에 연결돼 있어요. 그 계정으로 로그인하시면 강좌가 그대로 있어요. 그 계정을 쓸 수 없다면 카카오 채널로 알려 주세요 — 지금 계정으로 옮겨 드릴게요.`
          : "이 수강 이메일은 이미 다른 계정에 연결돼 있어요. 카카오 채널로 문의해 주세요.",
      });
    }
    console.error(JSON.stringify({ evt: "class_verify_record_failed", status: ins.status, detail: detail.slice(0, 200) }));
    // 우리 쪽 일시 장애 — 코드는 살려 둔다(태우지 않는다).
    return json({ ok: false, error: "record_failed" }, 502, cors);
  }
  const verifiedBooks = await verifiedBooksForLogin(env, email);
  if (!books.every((ownedBook) => verifiedBooks.includes(ownedBook))) {
    const holder = await enrollmentHolder(env, records);
    return finishVerify({ ok: false, alreadyLinked: true, holder, message: holder
      ? `이 수강 이메일은 이미 ${holder} 계정에 연결돼 있어요. 그 계정으로 로그인해 주세요.`
      : "이 수강 이메일은 이미 다른 계정에 연결돼 있어요. 카카오 채널로 문의해 주세요." });
  }
  if (!classBookRequestSatisfied(book, books)) {
    return finishVerify({ ok: false, notEnrolled: true, granted: books, message: "이 강좌는 수강 명단에 없어요. 대신 소장하신 다른 강좌는 지금 인증으로 함께 열렸어요." });
  }
  return finishVerify({ ok: true, granted: books });
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
  const guard = await otpGuardConsume(env, b.token);          // 🔴 대입 시도 카운트
  if (guard) return json({ ok: false, ...guard }, 400, cors);
  const expected = await hmacHex(env.OTP_SECRET, `code:${enrollEmail}:${code}:${exp}`);
  if (!timingSafeEq(expected, sig)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  // 🔴 여기서 태우지 않는다(2026-08-27) — classVerifyOtp 와 같은 병이었다.
  //   아래 어느 단계든 실패하면 맞는 코드가 이미 재가 돼, 재시도 시 "만료"로 보였다.
  const finishLink = async (payload, status = 200) => {
    await otpGuardBurn(env, b.token);                          // 결과 확정 = 1회용 소진
    return json(payload, status, cors);
  };
  // 결제 이메일 소유 증명됨 → 수강 명단 대조.
  //   🔴 인증 1회 = 평생소장 전부(운영자 2026-07-20): 이 결제 이메일이 명단에 있는 모든 book_code를 로그인 계정에 일괄 귀속.
  const enrollment = await findClassEnrollments(env, enrollEmail);
  if (!enrollment.ok) return json({ ok: false, error: "roster_lookup_failed" }, 502, cors);
  const { books, records } = enrollment;
  if (!books.length) return finishLink({ ok: false, notEnrolled: true, message: "이 이메일은 수강 명단에 없어요. 결제하신 이메일이 맞는지 확인해 주세요." });
  // 1회 귀속 사전 확인(친절 메시지용 — 최종 방어는 unique index): 어느 강좌든 다른 계정에 이미 귀속된 메일이면 전체 차단(공유 루프홀 방지).
  for (const enrollmentEmail of [...new Set(records.map((record) => record.enrollmentEmail))]) {
    const linked = await sbFetch(env, `class_verifications?enrollment_email=eq.${encodeURIComponent(enrollmentEmail)}&select=email&limit=10`);
    if (linked.ok) {
      const rows = (await linked.json()) || [];
      const other = rows.find(r => r.email !== loginEmail);
      if (other) {
        // 어느 계정인지 마스킹해 알려 준다 — 실측상 거의 전부 본인의 두 번째 계정이라 이 한 줄이면 스스로 푼다.
        return finishLink({ ok: false, alreadyLinked: true, holder: maskEmailAddr(other.email),
          message: `이 결제 이메일은 이미 ${maskEmailAddr(other.email)} 계정에 연결돼 있어요. 그 계정으로 로그인하시면 강좌가 그대로 있어요. 그 계정을 쓸 수 없다면 카카오 채널로 알려 주세요 — 지금 계정으로 옮겨 드릴게요.` });
      }
    } else {
      // 조회 실패 = 우리 쪽 장애. 코드는 태우지 않는다 — 같은 코드로 다시 시도할 수 있어야 한다.
      return json({ ok: false, error: "verification_lookup_failed" }, 502, cors);
    }
  }
  const ins = await sbFetch(env, `class_verifications?on_conflict=email,book_code`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(records.map(({ bookCode, enrollmentEmail }) => ({ email: loginEmail, book_code: bookCode, enrollment_email: enrollmentEmail }))),
  });
  if (!ins.ok) {
    const t = await ins.text().catch(() => "");
    // enrollment_email 컬럼 미존재(운영자 SQL 전) → 기능 대기 안내(코드 폴백 유도)
    if (/enrollment_email|42703|PGRST204/i.test(t)) return json({ ok: false, error: "sql_pending", message: "지금은 자동 연결 준비 중이에요. 인증 코드로 연결해 주세요." }, 200, cors);
    // unique index 충돌(동시 연결 레이스) = 다른 계정이 먼저 귀속
    if (ins.status === 409 || /23505|duplicate/i.test(t)) {
      // 로그인 계정 자신의 (email,book) PK 중복이면 멱등 성공
      const verifiedBooks = await verifiedBooksForLogin(env, loginEmail);
      if (books.every((ownedBook) => verifiedBooks.includes(ownedBook))) return finishLink({ ok: true, granted: books });
      const holder = await enrollmentHolder(env, records);
      return finishLink({ ok: false, alreadyLinked: true, holder, message: holder
        ? `이 결제 이메일은 이미 ${holder} 계정에 연결돼 있어요. 그 계정으로 로그인해 주세요.`
        : "이 결제 이메일은 이미 다른 계정에 연결돼 있어요." });
    }
    return json({ ok: false, error: "record_failed" }, 502, cors);
  }
  const verifiedBooks = await verifiedBooksForLogin(env, loginEmail);
  if (!books.every((ownedBook) => verifiedBooks.includes(ownedBook))) {
    const holder = await enrollmentHolder(env, records);
    return finishLink({ ok: false, alreadyLinked: true, holder, message: holder
      ? `이 결제 이메일은 이미 ${holder} 계정에 연결돼 있어요. 그 계정으로 로그인해 주세요.`
      : "이 결제 이메일은 이미 다른 계정에 연결돼 있어요." });
  }
  if (!classBookRequestSatisfied(book, books)) {
    return finishLink({ ok: false, notEnrolled: true, granted: books, message: "이 강좌는 수강 명단에 없어요. 대신 소장하신 다른 강좌는 지금 인증으로 함께 연결됐어요." });
  }
  return finishLink({ ok: true, granted: books });
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
  const { sent, failed } = await sendResendBatch(env, { to: selected.recipients, subject, html, channel: "sentence" });
  return json({ ok: true, mode, segment, totalSegments: selected.totalSegments, sent, failed, segmentRecipients: selected.recipients.length, recipients: emails.length }, 200, cors);
}

// ── 콘텐츠 업데이트 알림 발송 (강독·HP 편지 등 — send-sentence의 범용 복제) ──
//   audience별 구독 테이블 화이트리스트(운영자 확정: 스트림별 '별개 구독' = 별도 테이블).
//   이메일 = 티저+링크만(콘텐츠는 페이지에만 산다 — 한 문장 철칙과 동일).
//   mode: 'dry'(수신자 수만) · 'test'(ADMIN_EMAIL만) · 'send'(active 전체, CONTENT_SEND_ENABLED='true' 필요).
//   콘텐츠 팩토리 publish 런북이 호출(운영자 GO 후) — E:\LiterStella_전사\factory\runbooks\publish.md
// 🔴 코스 수강자 대상 추가(총괄 2026-08-14): 구독자 테이블은 신청자가 0명이라
//   "새 강의 알림"이 아무에게도 안 갔다. 이미 그 코스를 수강 중인 사람은 새 강의의
//   1순위 수신자다 — class_enrollments(book_code)로 뽑는다. 별도 구독 테이블과 달리
//   **수신 거부는 lecture_subscribers.active=false 로 존중**한다(옵트아웃 우선).
const CONTENT_AUDIENCES = { lecture: "lecture_subscribers", hp: "hp_subscribers" };
const COURSE_AUDIENCE_PREFIX = "course:";   // 예: audience="course:gatsby"
async function fetchCourseAudienceEmails(env, bookCode) {
  const emails = new Set();
  const pageSize = 1000;
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const r = await sbFetch(env, `class_enrollments?book_code=eq.${encodeURIComponent(bookCode)}&select=email&order=email.asc&limit=${pageSize}&offset=${offset}`);
    if (!r.ok) throw new Error(`course_audience_${r.status}`);
    const rows = (await r.json().catch(() => [])) || [];
    for (const row of rows) {
      const e = String(row?.email || "").trim().toLowerCase();
      if (EMAIL_RE.test(e)) emails.add(e);
    }
    if (rows.length < pageSize) break;
  }
  // 수신 거부 존중 — lecture_subscribers.active=false 인 사람은 제외한다.
  try {
    const r = await sbFetch(env, "lecture_subscribers?active=eq.false&select=email");
    const off = r.ok ? await r.json().catch(() => []) : [];
    for (const row of (off || [])) emails.delete(String(row?.email || "").trim().toLowerCase());
  } catch { /* 옵트아웃 조회 실패는 발송을 막지 않는다(다음 단계에서 수신자 수로 드러남) */ }
  return [...emails];
}
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
// 🔴 코스 수강자용 "새 강의 + 알림 신청" 템플릿(총괄 2026-08-14).
//   기본 contentEmailHtml 은 CTA 가 하나(보러 가기)라, 알림 구독을 늘리려는 이 메일에는 맞지 않는다.
//   두 번째 CTA(알림 받기)를 **부담 없게** 두 번째 자리에 두고, 강의 한 편의 맛보기를 앞세운다.
function courseUpdateEmailHtml(p) {
  const nBadge = p.lectureNo ? `<div style="display:inline-block;background:#fdf9ee;border:1px solid #ddca97;color:#a8873a;font-size:11px;font-weight:800;letter-spacing:1px;padding:5px 12px;border-radius:999px;margin-bottom:12px;">NEW · ${escHtml(String(p.lectureNo))}강</div>` : "";
  const quote = p.quote
    ? `<div style="margin:0 0 18px;padding:14px 16px;background:#faf7ef;border-left:3px solid #c8a84b;border-radius:0 10px 10px 0;">`
      + `<div style="font-size:14px;font-style:italic;color:#3f3a30;line-height:1.6;">${escHtml(p.quote)}</div>`
      + (p.quoteKo ? `<div style="font-size:12.5px;color:#8a8270;margin-top:6px;">${escHtml(p.quoteKo)}</div>` : "")
      + `</div>` : "";
  const body = `<div style="text-align:center;">${nBadge}</div>`
    + `<div style="font-size:19px;font-weight:800;margin-bottom:6px;line-height:1.45;">${escHtml(p.title || "")}</div>`
    + (p.book ? `<div style="font-size:12.5px;color:#8a8270;margin-bottom:16px;">${escHtml(p.book)}</div>` : "")
    + quote
    + (p.teaser ? `<p style="margin:0 0 22px;color:#5a5446;font-size:14px;line-height:1.75;">${escHtml(p.teaser)}</p>` : "")
    + `<div style="text-align:center;margin:0 0 10px;"><a href="${escHtml(p.link)}" style="display:inline-block;background:#c8a84b;color:#20160a;font-weight:800;text-decoration:none;padding:14px 30px;border-radius:12px;font-size:14.5px;">강의실에서 이어 듣기 →</a></div>`
    + (p.subscribeLink
      ? `<div style="margin:22px 0 0;padding:16px;background:#fbf9f3;border:1px solid #eee7d7;border-radius:14px;text-align:center;">`
        + `<div style="font-size:13.5px;font-weight:800;color:#3f3a30;margin-bottom:4px;">다음 강의도 바로 받아보시겠어요?</div>`
        + `<div style="font-size:12.5px;color:#8a8270;line-height:1.6;margin-bottom:12px;">알림을 켜두시면 새 강의가 올라오는 날 메일로 알려드려요.<br />언제든 한 번에 끌 수 있어요.</div>`
        + `<a href="${escHtml(p.subscribeLink)}" style="display:inline-block;border:1px solid #c8a84b;color:#a8873a;font-weight:800;text-decoration:none;padding:11px 24px;border-radius:999px;font-size:13px;background:#fffdf8;">🔔 새 강의 알림 받기</a>`
        + `</div>` : "")
    + `<p style="margin:18px 0 0;font-size:11.5px;color:#a09884;text-align:center;line-height:1.6;">강의 내용은 강의실에서만 만나실 수 있어요.</p>`;
  return brandEmailHtml(body);
}
async function sendContentUpdate(req, env, cors) {
  const admin = await requireAdmin(req, env);
  if (!admin) return json({ ok: false, error: "unauthorized" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const audience = String(b.audience || "").trim();
  const courseCode = audience.startsWith(COURSE_AUDIENCE_PREFIX) ? audience.slice(COURSE_AUDIENCE_PREFIX.length).trim() : "";
  const table = CONTENT_AUDIENCES[audience];
  if (!table && !courseCode) return json({ ok: false, error: "bad_audience", allowed: [...Object.keys(CONTENT_AUDIENCES), "course:{bookCode}"] }, 400, cors);
  const mode = String(b.mode || "dry"); // dry | test | send
  const segment = parseAudienceSegment(b.segment);
  if (!segment) return json({ ok: false, error: "bad_segment", hint: "segment는 1 이상의 정수" }, 400, cors);
  const title = String(b.title || "").trim().slice(0, 120);
  const link = String(b.link || "").trim();
  if (!title) return json({ ok: false, error: "title_required" }, 400, cors);
  if (!CONTENT_LINK_ORIGINS.some(o => link.startsWith(o + "/") || link.startsWith(o + "?"))) return json({ ok: false, error: "bad_link", allowed: CONTENT_LINK_ORIGINS }, 400, cors);
  const subject = String(b.subject || "").trim().slice(0, 150) || `[리터스텔라] ${title}`;
  const html = (b.template === "course" || courseCode)
    ? courseUpdateEmailHtml({ title, book: b.book, teaser: String(b.teaser || "").slice(0, 400), link,
        lectureNo: b.lectureNo, quote: b.quote, quoteKo: b.quoteKo, subscribeLink: b.subscribeLink })
    : contentEmailHtml({ kicker: b.kicker, title, book: b.book, teaser: String(b.teaser || "").slice(0, 400), link });
  let emails = [];
  if (courseCode) {
    try { emails = await fetchCourseAudienceEmails(env, courseCode); }
    catch (e) { return json({ ok: false, error: "course_audience_failed", detail: String(e && e.message || e) }, 502, cors); }
  } else {
    let subs = [];
    try { const r = await sbFetch(env, `${table}?active=eq.true&select=email&order=email.asc`); subs = r.ok ? await r.json().catch(() => []) : []; } catch { subs = []; }
    emails = [...new Set((Array.isArray(subs) ? subs : []).map(s => String(s.email || "").toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  }
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
  // 채널 = 이 발송의 종류. 수신자가 원클릭으로 끄면 **그 채널만** 꺼진다(전부 끄지 않는다).
  const { sent, failed } = await sendResendBatch(env, { to: selected.recipients, subject, html, channel: audience === "hp" ? "hp" : "lecture" });
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

// ── 수강 연결 신청 (8/1 이후 LiveKlass 신청자 수동 검토 — task-20260817-1650) ──────────
// 원칙: 사용자 주장만으로 자동 grant 금지. 접수는 pending으로만 저장, 승인은 관리자가
// LiveKlass 구매 기록/결제 증빙 확인 후 book_code 선택 승인 시에만 class_verifications 기록.
function maskEmailAddr(e) {
  const s = String(e || "").trim().toLowerCase();
  const at = s.indexOf("@");
  if (at < 1) return "***";
  const local = s.slice(0, at), dom = s.slice(at + 1);
  const dDot = dom.lastIndexOf(".");
  const dName = dDot > 0 ? dom.slice(0, dDot) : dom, dTld = dDot > 0 ? dom.slice(dDot) : "";
  const m = (x) => (x.length <= 1 ? x + "*" : x[0] + "*".repeat(Math.min(4, x.length - 1)));
  return `${m(local)}@${m(dName)}${dTld}`;
}
const normEmail = (e) => String(e || "").trim().replace(/\s+/g, "").toLowerCase();

// 대조 정본: ①명단(정규화 이메일) ②alias 원장(class_verifications 기존 연결) ③비공개 원장 이름+전화 정확 일치.
// 반환: {type:'enrolled',email} | {type:'candidate',masked} | {type:'none'}
async function classLinkMatch(env, { loginEmail, claimedEmail, name, phone }) {
  const emails = [...new Set([normEmail(loginEmail), normEmail(claimedEmail)].filter(Boolean))];
  // ① 명단 직접 일치 — 있으면 일반 인증 경로로 (이 함수 호출 자체가 notEnrolled 후지만 방어)
  for (const em of emails) {
    const r = await sbFetch(env, `class_enrollments?email=eq.${encodeURIComponent(em)}&select=email&limit=1`);
    if (!r.ok) throw new Error("upstream");
    if ((await r.json()).length) return { type: "enrolled", email: em };
  }
  // ② alias: 이 이메일이 이미 다른 명단 이메일로 연결돼 있나 (본인이 과거 연결)
  for (const em of emails) {
    const r = await sbFetch(env, `class_verifications?email=eq.${encodeURIComponent(em)}&enrollment_email=not.is.null&select=enrollment_email&limit=1`);
    if (!r.ok) throw new Error("upstream");
    const rows = await r.json();
    if (rows.length && rows[0].enrollment_email) return { type: "candidate", masked: maskEmailAddr(rows[0].enrollment_email) };
  }
  // ③ 비공개 원장: 이름+전화 정확 일치 → 그 이메일이 명단에 있으면 후보 (전체 이메일 노출 금지)
  const nm = String(name || "").trim(), ph = String(phone || "").replace(/[^0-9]/g, "");
  if (nm && ph.length >= 9) {
    const r = await sbFetch(env, `users?phone=eq.${encodeURIComponent(ph)}&nickname=eq.${encodeURIComponent(nm)}&select=email&limit=5`);
    if (r.ok) {
      for (const row of await r.json()) {
        const em = normEmail(row.email);
        if (!em || emails.includes(em)) continue;
        const er = await sbFetch(env, `class_enrollments?email=eq.${encodeURIComponent(em)}&select=email&limit=1`);
        if (er.ok && (await er.json()).length) return { type: "candidate", masked: maskEmailAddr(em) };
      }
    }
    // ③-b 구 클래스(LiveKlass) 연락처 원장 — 전화 정확 일치 (2026-08-26 운영자 지시).
    //   users.phone 은 20명뿐이라 위 ③이 사실상 죽어 있었다. LiveKlass 수출 명단(7,627행,
    //   전화 커버리지 ~99%)을 class_roster_contacts 로 적재해 "핸드폰으로 옛 수강 찾기"를 살린다.
    //   전화만으로도 후보를 돌려주되(가족 공유 번호 가능성) **마스킹된 이메일만** 노출하고,
    //   연결 자체는 종전대로 OTP 증명 또는 관리자 수동 승인 경유다 — 여기서 grant 하지 않는다.
    const cr = await sbFetch(env, `class_roster_contacts?phone_norm=eq.${encodeURIComponent(ph)}&select=email,book_code,buyer_name&limit=30`);
    if (cr.ok) {
      const rows = await cr.json();
      // 이름이 있으면 이름 일치 행을 우선(가족 공유 번호 구분), 없으면 전화 단독
      const named = rows.filter((x) => nm && String(x.buyer_name || "").trim() === nm);
      const pick = (named.length ? named : rows);
      const byEmail = {};
      for (const x of pick) {
        const em = normEmail(x.email);
        if (!em || emails.includes(em)) continue;
        (byEmail[em] = byEmail[em] || []).push(x.book_code);
      }
      const found = Object.entries(byEmail);
      if (found.length) {
        return {
          type: "candidate",
          masked: maskEmailAddr(found[0][0]),
          rosterMatch: found.map(([em, books]) => ({ masked: maskEmailAddr(em), books: [...new Set(books)], nameMatched: named.length > 0 })),
        };
      }
    }
  }
  return { type: "none" };
}

// POST /api/class/auto-link — 소셜 로그인 사용자의 수강권 자동 연결 (JWT 필수, 2026-08-22 신설)
//   🔴 왜: 이메일/비번 가입은 **가입 OTP 통과 직후** 같은 코드로 명단 대조가 돌아 이미 자동 연결된다
//      (LoginModal "이중 OTP 제거" 배선). 그런데 **소셜 로그인엔 그 경로가 없다** — OTP 코드가
//      아예 없으니 붙일 자리가 없었다. 그래서 구글·카카오 사용자(계정 1,094개 중 635개 = 58%)만
//      게이트에서 인증 코드를 한 번 더 요구받았고, 실제 CS 가 반복됐다
//      (2026-08-22 happyneul@gmail.com — 명단·이메일 완전 일치인데 "진행이 되지 않습니다").
//   안전한 이유: OTP 가 증명하려는 것은 "이 메일함의 주인인가" 하나다. 소셜 로그인은 **구글·카카오가
//      이미 그것을 증명**했고(JWT 는 그 계정으로 실제 로그인한 사람만 가진다), 우리는 그 위에
//      명단 이메일 일치까지 확인한다. 우회가 아니라 **같은 증명을 두 번 요구하던 것을 없애는 것**이다.
//   🔴 이메일/비번 계정은 이 경로를 쓰지 않는다 — Supabase Confirm 이 OFF 라 email_confirmed_at 이
//      가입 즉시 채워질 수 있어 "확인됨"이 소유 증명이 아니다. 그쪽은 기존 OTP 경로를 그대로 둔다.
// ── GET /api/me/overview — 계정 센터 대시보드 "내 리터스텔라" (2026-08-26 P1) ──────────
//   카드 5장을 위해 API 를 5번 부르지 않는다. 이 하나로 4앱 요약을 모아 준다.
//
//   설계 원칙 3가지:
//   ① **새 테이블 0** — 전부 기존 원장 조회의 조합이다.
//   ② **표시 전용** — 포인트 잔액·자리 판정 같은 값은 각 정본(포인트·구독 세션)이 소유한다.
//      여기선 원장을 읽어 보여줄 뿐, 규칙을 새로 만들거나 계산을 흉내 내지 않는다.
//      (화면이 서버 판정을 흉내 내면 "화면은 열리는데 서버가 막는" 어긋남이 난다 — §3-2 규칙 5)
//   ③ **카드 단위 실패** — 한 조각이 죽어도 그 키만 null 이고 나머지는 살아 있다.
//      대시보드 전체가 빈 화면이 되는 것보다, 카드 하나가 조용히 빠지는 편이 낫다(Zero-Error).
//
//   인증: X-User-Token(로그인 세션) 필수 — 남의 요약을 볼 길을 만들지 않는다.
async function meOverview(req, env, cors) {
  if (req.method !== "GET") return json({ ok: false, error: "method" }, 405, cors);
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  const email = normEmail(user.email);
  if (!email) return json({ ok: false, error: "no_email" }, 400, cors);

  const one = async (fn) => { try { return await fn(); } catch (_e) { return null; } };

  // ① 진단 — 레벨·타입·AI 리포트 유무 (users 행)
  const diag = await one(async () => {
    const r = await sbFetch(env, `users?email=eq.${encodeURIComponent(email)}&select=id,nickname,diag_level,diag_type,ai_report,diag_full_result&limit=1`);
    if (!r.ok) return null;
    const u = (await r.json())[0];
    if (!u) return null;
    // 🔴 diag_level 은 '진단을 봤다'는 증거가 아니다(2026-08-26 실측으로 확인).
    //    users.diag_level 은 NOT NULL 이라 워커 upsert 가 `result.level || 'L1'` 로 항상 채운다.
    //    그래서 1,215명 전원에게 값이 있지만, 실제 결과(diag_full_result)를 가진 사람은 72명(5.9%)뿐이고
    //    1,143명은 진단을 본 적 없이 'L1' 만 박혀 있다. 이걸 그대로 카드에 띄우면 **보지도 않은 사람에게
    //    지어낸 영어 레벨을 통보하는 셈**이라, 아무것도 안 보여 주는 것보다 나쁘다.
    //    (email_confirmed_at 이 소유 증명이 아니었던 것과 같은 함정 — 산출물이 있다고 사건이 있었던 게 아니다.)
    //    taken=false 면 화면은 레벨 대신 '진단 하러 가기'를 띄운다 — 퍼널 1순위(가입 94% 무진단)와도 맞는다.
    const taken = !!u.diag_full_result;
    return {
      userId: u.id, nickname: u.nickname || null, taken,
      level: taken ? (u.diag_level || null) : null,
      type: taken ? (u.diag_type || null) : null,
      hasAiReport: !!u.ai_report,
    };
  });

  // ② 챌린지 — 연속 인증일수·이번 시즌 인증 수. userId 가 있어야 조회 가능하다.
  const challenge = diag?.userId ? await one(async () => {
    const r = await sbFetch(env, `check_ins?user_id=eq.${diag.userId}&select=local_date,season_id&order=local_date.desc&limit=400`);
    if (!r.ok) return null;
    const rows = await r.json();
    const days = [...new Set(rows.map((x) => x.local_date).filter(Boolean))].sort().reverse();
    // 연속 = 오늘(또는 어제)부터 하루씩 이어지는 날 수. 어제까지 인정해야 "오늘 아직 안 한 사람"의 streak 이 0으로 안 보인다.
    let streak = 0;
    if (days.length) {
      const d0 = new Date(days[0] + "T00:00:00Z");
      const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
      const gap = Math.round((today - d0) / 86400000);
      if (gap <= 1) {
        streak = 1;
        for (let i = 1; i < days.length; i++) {
          const a = new Date(days[i - 1] + "T00:00:00Z"), b = new Date(days[i] + "T00:00:00Z");
          if (Math.round((a - b) / 86400000) === 1) streak++; else break;
        }
      }
    }
    return { streak, totalDays: days.length };
  }) : null;

  // ③ 포인트 — 원장 합산만. 🔴 가격·소비 규칙은 포인트 세션 정본이고 여기서 흉내 내지 않는다.
  const points = diag?.userId ? await one(async () => {
    const r = await sbFetch(env, `point_transactions?user_id=eq.${diag.userId}&select=amount,created_at`);
    if (!r.ok) return null;
    const rows = await r.json();
    const balance = rows.reduce((a, x) => a + (x.amount || 0), 0);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const recent = rows.filter((x) => x.created_at > since && (x.amount || 0) > 0).reduce((a, x) => a + x.amount, 0);
    return { balance, earned30d: recent };
  }) : null;

  // ④ 강독 — 연결된 수강권(정본 = class_verifications, 로그인 이메일 기준)
  const classes = await one(async () => {
    // 🔴 book_code 를 '원서 몇 권'으로 분류하지 않는다 — 그 목록(스텔라 시그니처 8권)의 정본은
    //    소장·구독 세션이고, 여기 사본을 두면 두 곳이 갈라진다(실제로 초안의 7권 목록이 이미 8권 정본과 어긋났다).
    //    원장 그대로 코드 배열만 넘기고, 의미 부여는 정본을 아는 쪽에서 한다.
    const books = await verifiedBooksForLogin(env, email);
    return { owned: books.length, books };
  });

  // ⑤ 파트너 — 강독 분석 신청 상태·리포트 링크. 🔴 신청 이력이 있는 사람에게만 값이 있다(대다수는 null).
  //    지금까지 이 정보를 볼 화면이 없어, 링크를 잃으면 재신청을 시도해야만 복구됐다.
  const partner = await one(async () => {
    const r = await sbFetch(env, `partner_applications?or=(email_norm.eq."${email}",email.eq."${email}")&select=status,phase,report_token,report_status,report_score&order=submitted_at.desc&limit=1`);
    if (!r.ok) return null;
    const a = (await r.json())[0];
    if (!a) return null;
    return {
      status: a.report_status || a.status || null,
      score: typeof a.report_score === "number" ? a.report_score : null,
      phase: a.phase || null,
      reportUrl: a.report_token ? `https://read.literstella.co.kr/api/partner-report?t=${encodeURIComponent(a.report_token)}` : null,
    };
  });

  return json({ ok: true, email, diag, challenge, points, classes, partner }, 200, cors);
}

// ── 네이버 카페 수강권 이관 (핸드오프 2026-08-26 · UI = 07-class codex/cafe-transfer) ──────
//   비공개 카페(키다리·앤·작은아씨들)의 구 수강생이 카페 별명+네이버 ID 로 신청하면,
//   운영자가 명단(cafe_rosters, 비공개 402명)과 대조해 승인한다. book_code 는 클라이언트를
//   신뢰하지 않는다 — campaign → 부여 강좌 매핑은 여기 상수가 정본이다.
//   🔑 자동 승인(2026-08-27 운영자 지시 "수동 검증 필요 없으면 자동으로"):
//     명단과 **확실히 1:1로 떨어질 때만** 서버가 바로 승인한다. 나머지는 사람이 본다.
//     네이버 전체 ID 명단을 확보할 수 없어, 캠페인 안에서 접두부 후보가 하나뿐인지를 대조한다.
//     🔴 단 접두부 2자는 자동에서 제외한다. 4자 이상 단일 후보만 별명과 무관하게 자동으로 연다.
//     🔴 명단 1행 = 1회 소진(roster_key 유니크). 두 계정이 같은 행으로 승인되면 진짜 수강생이 못 받는다.
const CAFE_CAMPAIGN_GRANTS = {
  anne: ["anne"],
  littlewomen: ["littlewomen1", "littlewomen2"],   // 한 번 승인 = PART 1·2 함께 (운영자 확정)
  kidari: ["kidari"],
};
function maskNaverId(id) {
  const v = String(id || "");
  return v.length <= 3 ? v[0] + "**" : v.slice(0, 3) + "*".repeat(Math.min(v.length - 3, 8));
}
// NFKC + trim + casefold — 명단 적재와 같은 정규화(다르면 대조가 조용히 어긋난다)
function cafeNorm(sv) { return normalizeCafeText(sv); }

async function cafeCampaignAccess(env, loginEmail, campaign) {
  const expected = CAFE_CAMPAIGN_GRANTS[campaign] || [];
  if (!expected.length) return { ok: true, ownedAll: false, books: [] };
  const r = await sbFetch(env, `class_verifications?email=eq.${encodeURIComponent(String(loginEmail || "").trim().toLowerCase())}&select=book_code`);
  if (!r.ok) return { ok: false, ownedAll: false, books: [] };
  const owned = new Set((await r.json()).map((row) => String(row.book_code || "")));
  return { ok: true, ownedAll: expected.every((code) => owned.has(code)), books: expected };
}

async function cafeRosterDecision(env, campaign, cafeNickname, naverId) {
  const rr = await sbFetch(env, `cafe_rosters?campaign=eq.${campaign}&select=nickname_norm,id_prefix&limit=1000`);
  if (!rr.ok) return { rosterMatch: "none", autoOk: false, rosterKey: null };
  return evaluateCafeRoster({ rows: await rr.json(), campaign, cafeNickname, naverId });
}

// 회원 통지 — 정보성 1회. 발송 전 차단목록 3단(7/24 사고 재발 방지), 발송 ID 를 행에 감사.
async function cafeNotifyMember(env, reqRow, kind) {
  const email = reqRow.login_email;
  const T = {
    received: ["[리터스텔라] 카페 수강 연결 신청이 접수됐어요", "<p>카페 수강 명단과 입력해 주신 정보를 확인한 뒤 알려드릴게요.</p><p>확인은 보통 1~2일 안에 끝나요.</p>"],
    approved: ["[리터스텔라] 수강 연결이 완료됐어요", `<p>신청하신 수업이 지금 로그인하시는 계정에 연결됐어요.</p><p><a href="https://class-new.literstella.co.kr/library">내 수업에서 바로 확인하기 →</a></p>`],
    needinfo: ["[리터스텔라] 수강 연결에 추가 확인이 필요해요", `<p>입력해 주신 정보만으로는 명단에서 확인하지 못했어요.</p>${reqRow.admin_note ? `<p>운영자 안내: ${escHtml(reqRow.admin_note)}</p>` : ""}<p>신청 화면에서 내용을 보완해 다시 제출해 주세요.</p>`],
    rejected: ["[리터스텔라] 수강 연결을 확인하지 못했어요", `<p>카페 수강 명단에서 신청 정보를 확인하지 못했어요.</p>${reqRow.admin_note ? `<p>운영자 안내: ${escHtml(reqRow.admin_note)}</p>` : ""}<p>착오가 있다고 생각되시면 카카오 채널로 알려주세요 — 직접 확인해 드려요.</p>`],
  }[kind];
  if (!T) return null;
  if (await isEmailSuppressed(env, email, "auth")) {
    const recovered = await tryAutoUnsuppress(env, email, "auth");
    if (!recovered) { await notifySuppressedAttempt(env, email); return "suppressed"; }
  }
  const sent = await sendResendEmail(env, {
    to: email,
    subject: T[0],   // "수강 연결" 포함 → TX_SUBJECT_RE 에 걸려 반송 즉시 알림 대상
    html: brandEmailHtml(T[1]),
    idempotencyKey: `cafetr:${reqRow.id}:${kind}`,
    lane: "auth",
  });
  return typeof sent === "string" ? sent : (sent ? "sent" : null);
}

// 승인 시 실제로 여는 것 — 자동·수동이 **같은 함수**를 쓴다(두 벌이면 한쪽만 고쳐져 어긋난다).
//   ① class_verifications: enrollment_email 은 NULL — 카페 이관엔 증명된 결제 이메일이 없다.
//      (enrollment_once 유니크를 소비하면 진짜 구매자의 미래 셀프 연결을 영구히 막는다)
//   ② class_enrollments: source 로 출처 감사. 재로그인 자동연결도 이 행이 받친다.
async function cafeGrantBooks(env, row) {
  const codes = CAFE_CAMPAIGN_GRANTS[row.campaign] || [];
  if (!codes.length) return null;
  const ins = await sbFetch(env, `class_verifications?on_conflict=email,book_code`, {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(codes.map((c) => ({ email: row.login_email, book_code: c, enrollment_email: null }))),
  });
  if (!ins.ok) return null;
  const ins2 = await sbFetch(env, `class_enrollments?on_conflict=email,book_code`, {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(codes.map((c) => ({ email: row.login_email, book_code: c, source: `naver-cafe:${row.campaign}:${String(row.id).slice(0, 8)}` }))),
  });
  if (!ins2.ok) console.log(JSON.stringify({ evt: "cafe_transfer_enroll_ledger_failed", id: String(row.id).slice(0, 8) }));
  return codes.join(",");
}

async function cafeEnsureEnrollmentLedger(env, row) {
  const codes = CAFE_CAMPAIGN_GRANTS[row.campaign] || [];
  if (!codes.length) return null;
  const ins = await sbFetch(env, `class_enrollments?on_conflict=email,book_code`, {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(codes.map((code) => ({
      email: row.login_email, book_code: code,
      source: `naver-cafe:${row.campaign}:${String(row.id).slice(0, 8)}`,
    }))),
  });
  return ins.ok ? codes.join(",") : null;
}

// POST /api/class/cafe-transfer/request {campaign, cafeNickname, naverId, consentVersion}
async function cafeTransferRequest(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const campaign = String(b.campaign || "").trim();
  if (!CAFE_CAMPAIGN_GRANTS[campaign]) return json({ ok: false, error: "bad_campaign" }, 400, cors);
  const cafeNickname = String(b.cafeNickname || "").trim().slice(0, 40);
  const naverId = String(b.naverId || "").trim().toLowerCase();
  const consentVersion = String(b.consentVersion || "").trim().slice(0, 20);
  if (!cafeNickname || !/^[a-z0-9._-]{3,40}$/.test(naverId) || !consentVersion) {
    return json({ ok: false, error: "bad_request" }, 400, cors);
  }
  // 활성 신청 멱등 — 부분 유니크(auth_uid, campaign WHERE pending/needinfo)가 DB 에서도 잡는다
  const openR = await sbFetch(env, `cafe_transfer_requests?auth_uid=eq.${user.id}&campaign=eq.${campaign}&status=in.(pending,needinfo)&select=id,status&limit=1`);
  if (!openR.ok) return json({ ok: false, error: "upstream" }, 502, cors);
  const open = (await openR.json())[0];
  // 이미 해당 캠페인 전체 수강권을 가진 회원은 새 대기 건을 만들지 않는다.
  // 과거 대기 건이 있으면 승인 상태로 정리하되, 중복 안내 메일은 보내지 않는다.
  const access = await cafeCampaignAccess(env, user.email, campaign);
  if (access.ok && access.ownedAll) {
    if (open) {
      const books = await cafeEnsureEnrollmentLedger(env, { id: open.id, login_email: user.email, campaign });
      if (!books) return json({ ok: false, error: "grant_failed" }, 502, cors);
      const now = new Date().toISOString();
      const up = await sbFetch(env, `cafe_transfer_requests?id=eq.${open.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "approved", admin_note: null, granted_books: books,
          decided_by: "existing-access", decided_at: now, updated_at: now,
          approved_email_id: "skipped:already-access",
        }),
      });
      if (!up.ok) return json({ ok: false, error: "save_failed" }, 502, cors);
    }
    return json({
      ok: true, already: true, alreadyOwned: true,
      request: { status: "approved", campaign, adminNote: null, grantedBooks: access.books.join(",") },
    }, 200, cors);
  }

  // 네이버 전체 ID 명단은 확보할 수 없으므로 저장된 접두부를 사용한다.
  // 캠페인 안에서 후보가 하나뿐이고 접두부가 4자 이상이면 별명과 무관하게 자동 승인한다.
  // 짧은 접두부·중복 후보·미일치는 반드시 관리자 검토로 남긴다.
  let rosterDecision = { rosterMatch: "none", autoOk: false, rosterKey: null };
  try { rosterDecision = await cafeRosterDecision(env, campaign, cafeNickname, naverId); } catch { /* 수동 검토 */ }
  const { rosterMatch, autoOk, rosterKey } = rosterDecision;
  const payload = {
    login_email: user.email, campaign, cafe_nickname: cafeNickname, naver_id: naverId,
    consent_version: consentVersion, roster_match: rosterMatch, updated_at: new Date().toISOString(),
  };
  let row;
  if (open && open.status === "needinfo") {
    const up = await sbFetch(env, `cafe_transfer_requests?id=eq.${open.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...payload, status: "pending" }) });
    if (!up.ok) return json({ ok: false, error: "save_failed" }, 502, cors);
    row = (await up.json())[0];
  } else if (open) {
    return json({ ok: true, already: true, request: { status: open.status, campaign } }, 200, cors);
  } else {
    const ins = await sbFetch(env, `cafe_transfer_requests`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ auth_uid: user.id, consent_at: new Date().toISOString(), ...payload }) });
    if (ins.status === 409) return json({ ok: true, already: true, request: { status: "pending", campaign } }, 200, cors);
    if (!ins.ok) return json({ ok: false, error: "save_failed" }, 502, cors);
    row = (await ins.json())[0];
  }

  // ── 자동 승인 — 명단과 1:1 로 떨어지고 접두부가 충분히 길 때만 ──────────────
  //   실패하면 조용히 pending 으로 남는다(사람이 본다). 자동이 막히는 것보다 잘못 여는 게 나쁘다.
  if (autoOk && rosterKey) {
    // 명단 행 선점 — 유니크 인덱스(roster_key WHERE approved)가 두 번째 시도를 409 로 막는다.
    const claim = await sbFetch(env, `cafe_transfer_requests?id=eq.${row.id}`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ roster_key: rosterKey, status: "approved", decided_by: "auto", decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    if (claim.ok) {
      const claimed = (await claim.json())[0];
      const books = await cafeGrantBooks(env, claimed);
      if (books) {
        await sbFetch(env, `cafe_transfer_requests?id=eq.${row.id}`, {
          method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ granted_books: books }),
        }).catch(() => {});
        row = { ...claimed, granted_books: books };
        try { const mid = await cafeNotifyMember(env, row, "approved"); if (mid) await sbFetch(env, `cafe_transfer_requests?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ approved_email_id: mid }) }); } catch { /* 비차단 */ }
        console.log(JSON.stringify({ evt: "cafe_transfer_auto_approved", id: String(row.id).slice(0, 8), campaign, books }));
        return json({ ok: true, request: { status: "approved", campaign, adminNote: null, grantedBooks: books } }, 200, cors);
      }
      // 원장 넣기가 실패했으면 승인을 되돌린다 — '승인됐다는데 안 열림'이 가장 나쁜 상태다.
      await sbFetch(env, `cafe_transfer_requests?id=eq.${row.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "pending", roster_key: null, decided_by: null, decided_at: null }),
      }).catch(() => {});
      console.log(JSON.stringify({ evt: "cafe_transfer_auto_rollback", id: String(row.id).slice(0, 8), campaign }));
    } else {
      // 409 = 다른 계정이 이미 그 명단 행으로 승인받음 → 사람이 본다(도용 가능성)
      console.log(JSON.stringify({ evt: "cafe_transfer_auto_claim_conflict", id: String(row.id).slice(0, 8), campaign, status: claim.status }));
    }
  }
  // 통지 2건 — 실패해도 접수는 성립(비차단). 발송 ID 는 행에 감사.
  const audit = {};
  try { const mid = await cafeNotifyMember(env, row, "received"); if (mid) audit.member_email_id = mid; } catch { /* 비차단 */ }
  try {
    if (env.ADMIN_EMAIL) {
      const rid = String(row.id).slice(0, 8);
      const aid = await sendResendEmail(env, {
        to: env.ADMIN_EMAIL,
        subject: `[카페 수강 연결] ${campaign} · ${rid} · ${cafeRosterMatchLabel(rosterMatch)}`,
        html: `<p>네이버 카페 수강 이관 신청이 접수됐어요.</p>
<ul><li>요청: <b>${rid}</b> · 강좌: <b>${campaign}</b></li><li>로그인: ${maskEmailAddr(user.email)}</li><li>카페 별명: <b>${escHtml(cafeNickname)}</b> · 네이버 ID: ${maskNaverId(naverId)}</li><li>명단 자동 대조: <b>${escHtml(cafeRosterMatchLabel(rosterMatch))}</b></li></ul>
<p><a href="https://class-new.literstella.co.kr/admin">관리자 → 카페 이관 탭에서 검토 →</a></p>`,
        idempotencyKey: `cafetr:${row.id}:admin`,
        lane: "auth",
      });
      if (typeof aid === "string") audit.admin_email_id = aid;
    }
  } catch { /* 비차단 */ }
  if (Object.keys(audit).length) {
    try { await sbFetch(env, `cafe_transfer_requests?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(audit) }); } catch { /* 감사 기록 실패는 비차단 */ }
  }
  console.log(JSON.stringify({ evt: "cafe_transfer_request", id: String(row.id).slice(0, 8), campaign, match: rosterMatch }));
  return json({ ok: true, request: { status: row.status, campaign, adminNote: null } }, 200, cors);
}

// GET /api/class/cafe-transfer/mine?campaign=
async function cafeTransferMine(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  const campaign = String(new URL(req.url).searchParams.get("campaign") || "").trim();
  if (!CAFE_CAMPAIGN_GRANTS[campaign]) return json({ ok: false, error: "bad_campaign" }, 400, cors);
  const r = await sbFetch(env, `cafe_transfer_requests?auth_uid=eq.${user.id}&campaign=eq.${campaign}&select=status,admin_note,updated_at&order=created_at.desc&limit=1`);
  if (!r.ok) return json({ ok: false, error: "upstream" }, 502, cors);
  const row = (await r.json())[0];
  if (!row) return json({ ok: true, request: null }, 200, cors);
  // adminNote 는 보완/거절일 때만 회원에게 (형제 구현과 동일 정책 — approved 안내문 오염 방지)
  const showNote = row.status === "needinfo" || row.status === "rejected";
  return json({ ok: true, request: { status: row.status, campaign, adminNote: showNote ? (row.admin_note || null) : null } }, 200, cors);
}

// 밀린 승인 통지 재발송 — 승인은 됐는데 메일이 안 나간 행을 찾아 보낸다.
//   왜 필요한가: 2026-08-27 자동 승인을 켜면서 이미 쌓여 있던 6건을 SQL 로 소급 승인했는데,
//   그 경로는 워커를 안 타서 통지가 빠졌다. 회원은 수업이 열린 줄 모른다.
//   멱등: member_email_id 가 비어 있는 행만 + Resend idempotencyKey 로 이중 발송이 막힌다.
//   🔴 라일라 알림은 여기서 안 만든다 — 클래스 앱 GrantWelcomeModal 이 로그인 시 신규 소유를
//      감지해 addTellaEvent 를 쏜다('이메일=라일라' 규칙의 기존 구현). 서버가 또 만들면 두 번 뜬다.
async function cafeResendMissingNotices(env) {
  // 🔴 member_email_id 로 판별하면 안 된다 — 그건 **접수 안내** 발송 ID 라 신청 시점에 이미 차 있다.
  //   승인 통지 여부는 approved_email_id 로 따로 본다(2026-08-27 교정).
  const r = await sbFetch(env, `cafe_transfer_requests?status=eq.approved&approved_email_id=is.null&select=*&limit=50`);
  if (!r.ok) return { checked: 0, sent: 0 };
  const rows = await r.json();
  let sent = 0;
  for (const row of rows) {
    try {
      const mid = await cafeNotifyMember(env, row, "approved");
      if (mid) {
        sent += 1;
        await sbFetch(env, `cafe_transfer_requests?id=eq.${row.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ approved_email_id: mid }),
        }).catch(() => {});
      }
    } catch { /* 한 건 실패가 나머지를 막지 않는다 */ }
  }
  if (rows.length) console.log(JSON.stringify({ evt: "cafe_resend_missing_notices", checked: rows.length, sent }));
  return { checked: rows.length, sent };
}

// GET /api/admin/cafe-transfer-requests?status=&campaign=
async function adminCafeTransferList(req, env, cors) {
  if (!(await requireAdminUser(req, env))) return json({ ok: false, error: "not_admin" }, 403, cors);
  const url = new URL(req.url);
  const st = String(url.searchParams.get("status") || "").trim();
  const camp = String(url.searchParams.get("campaign") || "").trim();
  const f = [];
  if (["pending", "needinfo", "approved", "rejected"].includes(st)) f.push(`status=eq.${st}`);
  if (CAFE_CAMPAIGN_GRANTS[camp]) f.push(`campaign=eq.${camp}`);
  // 목록을 여는 김에 밀린 승인 통지를 보낸다(멱등). 운영자가 결과를 확인하러 오는 자리다.
  let resent = { checked: 0, sent: 0 };
  try { resent = await cafeResendMissingNotices(env); } catch { /* 비차단 */ }
  const r = await sbFetch(env, `cafe_transfer_requests?select=id,campaign,status,created_at,login_email,cafe_nickname,naver_id,roster_match,admin_note,granted_books${f.length ? "&" + f.join("&") : ""}&order=created_at.desc&limit=100`);
  if (!r.ok) return json({ ok: false, error: "upstream" }, 502, cors);
  const rows = (await r.json()).map((x) => ({
    id: x.id, campaign: x.campaign, status: x.status, created_at: x.created_at,
    login_email: x.login_email, cafe_nickname: x.cafe_nickname,
    naver_id_masked: `${maskNaverId(x.naver_id)} · ${cafeRosterMatchLabel(x.roster_match)}`,
    admin_note: x.admin_note, granted_books: x.granted_books,
  }));
  return json({ ok: true, requests: rows, resentNotices: resent.sent }, 200, cors);
}

// POST /api/admin/cafe-transfer-request/decide {id, action:'approve'|'needinfo'|'reject', adminNote}
async function adminCafeTransferDecide(req, env, cors) {
  const admin = await requireAdminUser(req, env);
  if (!admin) return json({ ok: false, error: "not_admin" }, 403, cors);
  let body; try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim();
  const adminNote = String(body.adminNote || "").trim().slice(0, 500);   // 🔴 형제(class-link)는 'note' — 여기만 adminNote
  if (!id || !["approve", "needinfo", "reject"].includes(action)) return json({ ok: false, error: "bad_request" }, 400, cors);
  const rowR = await sbFetch(env, `cafe_transfer_requests?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (!rowR.ok) return json({ ok: false, error: "upstream" }, 502, cors);
  const row = (await rowR.json())[0];
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);
  const status = action === "approve" ? "approved" : action === "needinfo" ? "needinfo" : "rejected";
  const now = new Date().toISOString();
  let rosterKeyManual = row.roster_match === "exact" ? `${row.campaign}:${cafeNorm(row.cafe_nickname)}` : null;
  let reviewedMatch = row.roster_match || "none";
  let grantedBooks = null;
  let updated;
  if (action === "approve") {
    if (!CAFE_CAMPAIGN_GRANTS[row.campaign]) return json({ ok: false, error: "bad_campaign" }, 400, cors);
    try {
      const decision = await cafeRosterDecision(env, row.campaign, row.cafe_nickname, row.naver_id);
      reviewedMatch = decision.rosterMatch;
      if (decision.rosterKey) rosterKeyManual = decision.rosterKey;
    } catch { /* 기존 판정으로 수동 승인 계속 */ }
    // 명단 행을 먼저 선점한다. 저장 실패 뒤 수강권만 열리는 부분 성공을 막는다.
    const claimPatch = {
      status: "approved", admin_note: adminNote || null, roster_match: reviewedMatch,
      decided_by: admin.email, decided_at: now, updated_at: now,
      ...(rosterKeyManual ? { roster_key: rosterKeyManual } : {}),
    };
    const claim = await sbFetch(env, `cafe_transfer_requests?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(claimPatch),
    });
    if (!claim.ok) return json({ ok: false, error: "save_failed" }, 502, cors);
    updated = (await claim.json())[0];
    // 자동과 **같은 함수**를 쓴다 — 원장 두 벌이면 한쪽만 고쳐져 어긋난다.
    grantedBooks = await cafeGrantBooks(env, updated);
    if (!grantedBooks) {
      await sbFetch(env, `cafe_transfer_requests?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: row.status, admin_note: row.admin_note || null, granted_books: row.granted_books || null,
          roster_key: row.roster_key || null, roster_match: row.roster_match || "none",
          decided_by: row.decided_by || null, decided_at: row.decided_at || null, updated_at: now,
        }),
      }).catch(() => {});
      return json({ ok: false, error: "grant_failed" }, 502, cors);
    }
    const finish = await sbFetch(env, `cafe_transfer_requests?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ granted_books: grantedBooks }),
    });
    if (finish.ok) updated = (await finish.json())[0];
  } else {
    const patch = { status, admin_note: adminNote || null, granted_books: null, roster_match: reviewedMatch, decided_by: admin.email, decided_at: now, updated_at: now };
    const up = await sbFetch(env, `cafe_transfer_requests?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
    if (!up.ok) return json({ ok: false, error: "save_failed" }, 502, cors);
    updated = (await up.json())[0];
  }
  try {
    const mid = await cafeNotifyMember(env, updated, status);
    // 승인 통지는 approved_email_id 에 — 접수 통지(member_email_id)를 덮지 않는다.
    if (mid) await sbFetch(env, `cafe_transfer_requests?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(status === "approved" ? { approved_email_id: mid } : { member_email_id: mid }) });
  } catch { /* 통지 실패 비차단 — 상태는 관리자 화면·mine 조회로 보인다 */ }
  console.log(JSON.stringify({ evt: "cafe_transfer_decide", id: id.slice(0, 8), action, by: admin.email, books: grantedBooks || "-" }));
  return json({ ok: true }, 200, cors);
}

// ── 백업 이메일 (운영자 지시 2026-08-26) — 아이디·이메일 분실 대비 ─────────────────
//   원리: 백업 이메일도 **소유 증명 후에만** 등록된다(OTP 6자리를 그 주소로 보내 확인).
//   증명 없이 등록을 허용하면 남의 계정에 내 백업메일을 심는 탈취 경로가 된다.
//   저장은 account_recovery(service_role 전용, RLS 정책 0) — users 컬럼은 anon INSERT 가
//   상속돼 위조 가능해서 쓰지 않는다(2026-08-26 마이그레이션 주석 참조).
async function backupEmailSendCode(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const backupEmail = String(b.backupEmail || "").trim().toLowerCase();
  if (!EMAIL_RE.test(backupEmail) || backupEmail.length > 254) return json({ ok: false, error: "bad_email" }, 400, cors);
  if (backupEmail === user.email) return json({ ok: false, error: "same_as_login", message: "로그인 이메일과 다른 주소를 백업으로 등록해 주세요." }, 400, cors);
  const allowed = await otpSendAllowed(env, backupEmail);
  if (!allowed.ok) return json({ ok: false, error: "too_many_requests" }, 429, cors);
  if (await isEmailSuppressed(env, backupEmail, "auth")) {
    const recovered = await tryAutoUnsuppress(env, backupEmail, "auth");
    if (!recovered) { await notifySuppressedAttempt(env, backupEmail); return json({ ok: false, error: "suppressed", message: "이 주소로는 메일이 전달되지 않아요. 다른 주소를 써 주세요." }, 422, cors); }
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const exp = Date.now() + OTP_TTL_MS;
  // 🔴 프리픽스 bkmail: — 일반 OTP(code:)와 서명 공간을 분리해 코드 재사용(수강 인증 등) 차단
  const sig = await hmacHex(env.OTP_SECRET, `bkmail:${user.id}:${backupEmail}:${code}:${exp}`);
  // 🔴 이 줄이 없어서 백업 이메일 등록이 **한 번도 성공한 적이 없다**(2026-08-26 기능 출시 이후 내내).
  //   backupEmailConfirm 은 otpGuardConsume 을 부르는데, 발급 때 카운터를 안 열면 키가 없어
  //   "이미 사용됨"으로 즉시 거절된다. 발급과 소비는 **항상 짝으로** 있어야 한다.
  await otpGuardIssue(env, `${exp}.${sig}`, Math.max(60000, exp - Date.now()));
  const sent = await sendResendEmail(env, {
    to: backupEmail,
    subject: "[리터스텔라] 백업 이메일 인증 코드",
    html: brandEmailHtml(`<div style="font-size:17px;font-weight:800;margin-bottom:10px;">백업 이메일 인증 코드</div><p style="margin:0 0 14px;color:#5a5446;">10분 안에 아래 코드를 입력해 주세요. 이 주소는 계정을 잃었을 때 찾는 용도로만 쓰여요.</p><div style="font-size:32px;font-weight:900;letter-spacing:9px;color:#c8a84b;text-align:center;padding:16px;background:#fdf9ee;border:1px dashed #ddca97;border-radius:13px;">${code}</div>`),
    lane: "auth",
  });
  if (!sent) return json({ ok: false, error: "send_failed" }, 502, cors);
  return json({ ok: true, token: `${exp}.${sig}` }, 200, cors);
}

async function backupEmailConfirm(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const backupEmail = String(b.backupEmail || "").trim().toLowerCase();
  const code = String(b.code || "").trim();
  const [expStr, sig] = String(b.token || "").split(".");
  const exp = Number(expStr);
  if (!EMAIL_RE.test(backupEmail) || !/^\d{6}$/.test(code) || !exp || !sig || Date.now() > exp) return json({ ok: false, error: "invalid_code" }, 400, cors);
  const guard = await otpGuardConsume(env, b.token);
  if (guard) return json({ ok: false, ...guard }, 400, cors);
  const expected = await hmacHex(env.OTP_SECRET, `bkmail:${user.id}:${backupEmail}:${code}:${exp}`);
  if (!timingSafeEq(expected, sig)) return json({ ok: false, error: "invalid_code" }, 400, cors);
  // 🔴 여기서 태우지 않는다(2026-08-28) — classVerifyOtp 와 **똑같은 병**이 여기 남아 있었다.
  //   저장이 실패하면 맞는 코드가 이미 재가 되고, 재시도 시 "이미 사용됐어요"가 뜬다.
  //   소각은 저장 성공을 확인한 뒤에 한다.
  const up = await sbFetch(env, `account_recovery?on_conflict=auth_uid`, {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ auth_uid: user.id, primary_email: user.email, backup_email: backupEmail, verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }]),
  });
  // 우리 쪽 저장 실패 — 코드는 살려 둔다. 같은 코드로 다시 시도할 수 있어야 한다.
  if (!up.ok) return json({ ok: false, error: "save_failed" }, 502, cors);
  await otpGuardBurn(env, b.token);                            // 결과 확정 = 1회용 소진
  console.log(JSON.stringify({ evt: "backup_email_set", uid: String(user.id).slice(0, 8) }));
  return json({ ok: true, backupEmailMasked: maskEmailAddr(backupEmail) }, 200, cors);
}

// GET /api/me/backup-email — 설정 화면 표시용(마스킹)
async function backupEmailGet(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  const r = await sbFetch(env, `account_recovery?auth_uid=eq.${user.id}&select=backup_email,verified_at&limit=1`);
  if (!r.ok) return json({ ok: false, error: "upstream" }, 502, cors);
  const row = (await r.json())[0];
  return json({ ok: true, backupEmailMasked: row ? maskEmailAddr(row.backup_email) : null, verifiedAt: row?.verified_at || null }, 200, cors);
}

// POST /api/auth/find-by-backup {backupEmail} — 아이디(로그인 이메일) 찾기. 무인증 공개 라우트.
//   응답은 마스킹만: 지식 기반(주소를 안다) 단독으론 원문을 안 준다. 열거 방지로 항상 ok.
async function findByBackupEmail(req, env, cors) {
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const backupEmail = String(b.backupEmail || "").trim().toLowerCase();
  if (!EMAIL_RE.test(backupEmail)) return json({ ok: false, error: "bad_email" }, 400, cors);
  const allowed = await otpSendAllowed(env, `findbk:${backupEmail}`);   // 열거 속도 제한(같은 레이트리밋 재사용)
  if (!allowed.ok) return json({ ok: false, error: "too_many_requests" }, 429, cors);
  const r = await sbFetch(env, `account_recovery?backup_email=eq.${encodeURIComponent(backupEmail)}&select=primary_email&limit=5`);
  const rows = r.ok ? await r.json() : [];
  return json({ ok: true, found: rows.map((x) => maskEmailAddr(x.primary_email)) }, 200, cors);
}

async function classAutoLink(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  const social = user.providers.some((p) => p === "google" || p === "kakao" || p === "naver");
  if (!social) return json({ ok: true, linked: [], reason: "not_social" }, 200, cors);
  const email = normEmail(user.email);
  if (!email) return json({ ok: true, linked: [], reason: "no_email" }, 200, cors);
  try {
    const r = await sbFetch(env, `class_enrollments?email=eq.${encodeURIComponent(email)}&select=book_code`);
    if (!r.ok) return json({ ok: false, error: "upstream" }, 502, cors);
    const books = [...new Set((await r.json()).map((x) => x.book_code).filter(Boolean))];
    if (!books.length) return json({ ok: true, linked: [], reason: "not_enrolled" }, 200, cors);
    // 이미 있으면 무시 — 중복 호출(로그인마다)해도 한 벌만 남는다.
    const ins = await sbFetch(env, "class_verifications?on_conflict=email,book_code", {
      method: "POST",
      headers: { Prefer: "return=minimal,resolution=ignore-duplicates" },
      body: JSON.stringify(books.map((b) => ({ email, book_code: b, enrollment_email: email }))),
    });
    if (!ins.ok) return json({ ok: false, error: "upstream" }, 502, cors);
    console.log(JSON.stringify({ evt: "class_auto_link", uid: user.id, books: books.length, provider: user.providers[0] || "?" }));
    return json({ ok: true, linked: books }, 200, cors);
  } catch { return json({ ok: false, error: "upstream" }, 502, cors); }
}

// POST /api/class/link-precheck — 신청 폼 전 분기 판정 (JWT 필수)
async function classLinkPrecheck(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  let body; try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  try {
    const match = await classLinkMatch(env, { loginEmail: user.email, claimedEmail: body.claimedEmail, name: body.name, phone: body.phone });
    return json({ ok: true, match }, 200, cors);
  } catch { return json({ ok: false, error: "upstream" }, 502, cors); } // API 장애 — 클라는 재시도만
}

// POST /api/class/link-request — 접수 (pending 저장 + 관리자 메일). 자동 grant 절대 없음.
async function classLinkRequestSubmit(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  let body; try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  if (body.mailUnreachable === true) return json({ ok: false, error: 'recovery_required' }, 409, cors);
  const name = String(body.name || "").trim().slice(0, 60);
  const phone = String(body.phone || "").replace(/[^0-9]/g, "").slice(0, 20);
  const courses = String(body.courses || "").trim().slice(0, 300);
  const paidAt = String(body.paidAt || "").trim().slice(0, 60);
  const orderInfo = String(body.orderInfo || "").trim().slice(0, 300);
  const claimedEmail = normEmail(body.claimedEmail) || null;
  if (!name || phone.length < 9 || !courses || !paidAt) return json({ ok: false, error: "missing_fields" }, 400, cors);
  // 서버 대조를 접수 시에도 재실행 — 후보가 있으면 접수 대신 기존 인증 경로 안내
  let match;
  try { match = await classLinkMatch(env, { loginEmail: user.email, claimedEmail, name, phone }); }
  catch { return json({ ok: false, error: "upstream" }, 502, cors); }
  if (match.type === "enrolled") return json({ ok: false, error: "already_enrolled", email: match.email }, 200, cors);
  // 🔴 mailUnreachable(2026-08-26): 옛 수강 이메일이 죽어 OTP 메일을 못 받는 사람은
  //   후보 안내로 돌려보내면 영원히 막힌다(그 이메일로 인증하라는 안내 = 못 하는 일).
  //   그 경우 접수를 허용하고, 서버 대조 결과(roster_match)를 신청에 실어 관리자가 본다.
  const mailUnreachable = body.mailUnreachable === true;
  if (match.type === "candidate" && !mailUnreachable) return json({ ok: false, error: "candidate_found", masked: match.masked }, 200, cors);
  // 열린 신청 1건 원칙(멱등) — needinfo면 보완 재제출로 갱신
  const openR = await sbFetch(env, `class_link_requests?auth_uid=eq.${user.id}&status=in.(pending,needinfo)&select=id,status,roster_match&limit=1`);
  if (!openR.ok) return json({ ok: false, error: "upstream" }, 502, cors);
  const open = (await openR.json())[0];
  if (open?.roster_match?.kind === RECOVERY_KIND) return json({ ok: false, error: 'recovery_required' }, 409, cors);
  const payload = { login_email: user.email, claimed_email: claimedEmail, name, phone, courses, paid_at: paidAt, order_info: orderInfo, updated_at: new Date().toISOString(),
    roster_match: match.rosterMatch ? { via: "liveklass-phone", unreachable: mailUnreachable, hits: match.rosterMatch } : null };
  let reqId = open?.id || null;
  if (open && open.status === "pending") return json({ ok: true, already: true, id: open.id, status: "pending" }, 200, cors);
  if (open && open.status === "needinfo") {
    const up = await sbFetch(env, `class_link_requests?id=eq.${open.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...payload, status: "pending" }) });
    if (!up.ok) return json({ ok: false, error: "save_failed" }, 502, cors);
  } else {
    const ins = await sbFetch(env, `class_link_requests`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ auth_uid: user.id, ...payload }) });
    if (ins.status === 409) return json({ ok: true, already: true, status: "pending" }, 200, cors); // 경합 — 부분 유니크가 잡음
    if (!ins.ok) return json({ ok: false, error: "save_failed" }, 502, cors);
    reqId = ((await ins.json())[0] || {}).id || null;
  }
  // 관리자 알림 — 요청 ID·마스킹 정보·관리자 링크만 (실패 비차단)
  try {
    if (env.ADMIN_EMAIL) {
      const rid = String(reqId || "").slice(0, 8);
      await sendResendEmail(env, {
        to: env.ADMIN_EMAIL,
        subject: `[수강 연결 신청] ${rid} · ${maskEmailAddr(user.email)}`,
        html: `<p>새 수강 연결 신청(8/1 이후 신청자 수동 검토)이 접수됐어요.</p>
<ul><li>요청 ID: <b>${rid}</b></li><li>로그인: ${maskEmailAddr(user.email)}</li><li>기존 수강 이메일(주장): ${claimedEmail ? maskEmailAddr(claimedEmail) : "-"}</li><li>이름: ${name ? name[0] + "**" : "-"} · 강의 ${courses.split(",").length}건 주장</li></ul>
<p><a href="https://class-new.literstella.co.kr/admin">관리자 페이지에서 검토하기 →</a></p>
<p style="font-size:12px;color:#888">LiveKlass 구매 기록/결제 증빙 확인 전에는 승인하지 마세요.</p>`,
        idempotencyKey: `linkreq:${reqId}`,
        lane: "auth",
      });
    }
  } catch { /* 비차단 */ }
  return json({ ok: true, id: reqId, status: "pending" }, 200, cors);
}

// GET /api/class/link-request/mine — 내 신청 상태 (JWT)
async function classLinkRequestMine(req, env, cors) {
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "login_required" }, 401, cors);
  const r = await sbFetch(env, `class_link_requests?auth_uid=eq.${user.id}&select=id,status,admin_note,granted_books,created_at,updated_at&order=created_at.desc&limit=1`);
  if (!r.ok) return json({ ok: false, error: "upstream" }, 502, cors);
  const row = (await r.json())[0] || null;
  return json({ ok: true, request: row && { id: row.id, status: row.status, adminNote: row.status === "needinfo" || row.status === "rejected" ? row.admin_note : null, grantedBooks: row.granted_books, createdAt: row.created_at, updatedAt: row.updated_at } }, 200, cors);
}

// 관리자 판정 — requireUser + ADMIN_EMAIL (AdminCodesPage 기존 방식과 동일한 서버 판정)
async function requireAdminUser(req, env) {
  const user = await requireUser(req, env);
  const admin = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  return user && admin && user.email === admin ? user : null;
}

// GET /api/admin/class-link-requests?status=
async function adminClassLinkList(req, env, cors) {
  if (!(await requireAdminUser(req, env))) return json({ ok: false, error: "not_admin" }, 403, cors);
  const url = new URL(req.url);
  const st = String(url.searchParams.get("status") || "").trim();
  const filter = ["pending", "needinfo", "approved", "rejected"].includes(st) ? `&status=eq.${st}` : "";
  const r = await sbFetch(env, `class_link_requests?select=*${filter}&order=created_at.desc&limit=100`);
  if (!r.ok) return json({ ok: false, error: "upstream" }, 502, cors);
  return json({ ok: true, requests: await r.json() }, 200, cors);
}

// POST /api/admin/class-link-request/decide {id, action:'approve'|'needinfo'|'reject', bookCodes?[], note?}
async function adminClassLinkDecide(req, env, cors) {
  const admin = await requireAdminUser(req, env);
  if (!admin) return json({ ok: false, error: "not_admin" }, 403, cors);
  let body; try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim();
  const note = String(body.note || "").trim().slice(0, 500);
  if (!id || !["approve", "needinfo", "reject"].includes(action)) return json({ ok: false, error: "bad_request" }, 400, cors);
  const rowR = await sbFetch(env, `class_link_requests?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (!rowR.ok) return json({ ok: false, error: "upstream" }, 502, cors);
  const row = (await rowR.json())[0];
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);
  if (row.roster_match?.kind === RECOVERY_KIND) {
    const result = await sbFetch(env, 'rpc/class_email_recovery_decide_v1', {
      method: 'POST', body: JSON.stringify({ p_id: id, p_action: action,
        p_books: Array.isArray(body.bookCodes) ? body.bookCodes : [], p_note: note,
        p_identity_confirmed: body.identityConfirmed === true, p_admin: admin.id }),
    });
    if (!result.ok) return json({ ok: false, error: 'save_failed' }, 502, cors);
    const decision = await result.json();
    return json(decision, decision.ok ? 200 : 409, cors);
  }
  let grantedBooks = null;
  if (action === "approve") {
    const codes = Array.isArray(body.bookCodes) ? body.bookCodes.map((c) => String(c).trim()).filter(Boolean).slice(0, 12) : [];
    if (!codes.length) return json({ ok: false, error: "book_codes_required" }, 400, cors);
    // 승인 = 기존 service_role 경로로 연결 (멱등: PK email,book_code / 유니크 enrollment_email,book_code)
    const enrollmentEmail = row.claimed_email || row.login_email;
    const ins = await sbFetch(env, `class_verifications?on_conflict=email,book_code`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(codes.map((c) => ({ email: row.login_email, book_code: c, enrollment_email: enrollmentEmail }))),
    });
    if (!ins.ok) return json({ ok: false, error: "grant_failed" }, 502, cors);
    grantedBooks = codes.join(",");
  }
  const patch = { status: action === "approve" ? "approved" : action === "needinfo" ? "needinfo" : "rejected", admin_note: note || null, granted_books: grantedBooks, updated_at: new Date().toISOString() };
  const up = await sbFetch(env, `class_link_requests?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
  if (!up.ok) return json({ ok: false, error: "save_failed" }, 502, cors);
  console.log(JSON.stringify({ evt: "class_link_decide", id: id.slice(0, 8), action, by: admin.email, books: grantedBooks || "-" }));
  return json({ ok: true, request: (await up.json())[0] }, 200, cors);
}

// ── 라우터 ────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/api/class/email-recovery/send' || path === '/api/class/email-recovery/submit') {
      return classEmailRecoveryRoute(req, env, cors, {
        json, requireUser, sbFetch, hmacHex, timingSafeEq, sha256Hex,
        otpSendAllowed, otpGuardIssue, otpGuardConsume, otpGuardBurn,
        isEmailSuppressed, sendResendEmail, otpEmailHtml, findClassEnrollments,
      });
    }

    // health
    if (path === "/api/health") return json({
      ok: true,
      admin: env.ADMIN_API_ENABLED === "true",
      payment: env.PAYMENT_ENABLED === "true",
      contentPoints: env.CONTENT_POINTS_ENABLED === "true",
      authMailerBound: Boolean(env.AUTH_EMAIL_SERVICE),
    }, 200, cors);

    // 셀프 회원 탈퇴 — 로그인 JWT 필수 + confirm:"DELETE" 명시 신호.
    if (path === "/api/account/delete") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return accountDelete(req, env, cors);
    }

    // Resend 반송·스팸신고 웹훅 — Resend 서버가 직접 호출(브라우저 아님). Svix 서명으로만 인증.
    if (path === "/api/hooks/resend") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return resendWebhook(req, env, cors);
    }

    // 이메일 인증 OTP (회원가입) — 플래그 없이 항상 열림. AUTH_EMAIL_SERVICE·OTP_SECRET 필요.
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

    // 8/1 이후 LiveKlass 신청자 수강 연결 신청 (수동 검토 — task-20260817-1650)
    // 소셜 로그인 자동 연결 — 로그인 직후 1회 호출(멱등). 실패해도 기존 OTP 경로가 그대로 폴백.
    if (path === "/api/me/overview") {
      return meOverview(req, env, cors);
    }
    if (path === "/api/class/auto-link") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return classAutoLink(req, env, cors);
    }

    if (path === "/api/class/link-precheck") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return classLinkPrecheck(req, env, cors);
    }
    if (path === "/api/class/link-request") {
      if (req.method === "POST") return classLinkRequestSubmit(req, env, cors);
      return json({ ok: false, error: "method" }, 405, cors);
    }
    if (path === "/api/class/link-request/mine") {
      return classLinkRequestMine(req, env, cors);
    }
    if (path === "/api/admin/class-link-requests") {
      return adminClassLinkList(req, env, cors);
    }
    if (path === "/api/admin/class-link-request/decide") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return adminClassLinkDecide(req, env, cors);
    }

    // ── 카페 수강권 이관 (2026-08-26) — 관리자 GET 이 있어 /api/admin/ prefix 블록(POST 강제) 위에 둔다
    if (path === "/api/class/cafe-transfer/request") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return cafeTransferRequest(req, env, cors);
    }
    if (path === "/api/class/cafe-transfer/mine") {
      return cafeTransferMine(req, env, cors);
    }
    if (path === "/api/admin/cafe-transfer-requests") {
      return adminCafeTransferList(req, env, cors);
    }
    if (path === "/api/admin/cafe-transfer-request/decide") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return adminCafeTransferDecide(req, env, cors);
    }
    // ── 백업 이메일 (2026-08-26) ──
    if (path === "/api/me/backup-email") {
      if (req.method === "GET") return backupEmailGet(req, env, cors);
      return json({ ok: false, error: "method" }, 405, cors);
    }
    if (path === "/api/me/backup-email/send-code") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return backupEmailSendCode(req, env, cors);
    }
    if (path === "/api/me/backup-email/confirm") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return backupEmailConfirm(req, env, cors);
    }
    if (path === "/api/auth/find-by-backup") {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return findByBackupEmail(req, env, cors);
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
    // 수신거부 원클릭(RFC 8058) — 인증 없이 토큰만으로 동작해야 한다(메일 클라이언트가 부른다).
    if (path === "/api/unsub") {
      if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
      return unsubRoute(req, env, cors);
    }

    // 내 수신 설정 — 계정 센터가 네 갈래를 한 화면에서 읽고 쓴다.
    if (path === "/api/me/email-prefs") {
      return myEmailPrefs(req, env, cors);
    }

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
        {
          json,
          requireUser,
          sbFetch,
          sendEmail: (emailEnv, message) => sendResendEmail(emailEnv, { ...message, lane: "auth" }),
          brandEmailHtml,
          isEmailSuppressed: (emailEnv, email) => isEmailSuppressed(emailEnv, email, "auth"),
        },
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
      if (path === "/api/admin/send-active-challenge-notice") return sendActiveChallengeNotice(req, env, cors);
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
