const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUPON_RE = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;
const LIVEKLASS_PACKAGE_URL = "https://class.literstella.co.kr/packages/312328";

const COURSE_NAMES = {
  kidari: "키다리 아저씨",
  anne: "빨강머리 앤",
  littlewomen1: "작은 아씨들 파트1",
  littlewomen2: "작은 아씨들 파트2",
  pride: "오만과 편견",
  gatsby: "위대한 개츠비",
  sherlock: "셜록 홈즈",
  theory: "원서 읽기 핵심 이론",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[<>&"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
  }[char]));
}

function won(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function courseNames(books) {
  return (Array.isArray(books) ? books : [])
    .map((book) => COURSE_NAMES[book] || String(book))
    .join(", ");
}

function recipientEmails(row) {
  return [...new Set([row?.email, row?.liveklass_id]
    .map((email) => String(email || "").trim().toLowerCase())
    .filter((email) => EMAIL_RE.test(email) && email.length <= 254))]
    .sort();
}

function stableToken(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function readJson(response) {
  return response.json().catch(() => null);
}

async function readRequest(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

function requestSelect() {
  return [
    "id",
    "user_id",
    "email",
    "liveklass_id",
    "owned_books",
    "missing_books",
    "owned_count",
    "base_amount",
    "coupon_amount",
    "payable_amount",
    "payment_method",
    "cash_receipt_number",
    "status",
    "coupon_code",
    "admin_notified_at",
    "coupon_emailed_at",
    "coupon_email_recipient_count",
  ].join(",");
}

async function fetchRequest(env, sbFetch, requestId, userId) {
  const ownerFilter = userId ? `&user_id=eq.${encodeURIComponent(userId)}` : "";
  const response = await sbFetch(
    env,
    `stella_upgrade_requests?id=eq.${encodeURIComponent(requestId)}${ownerFilter}&select=${requestSelect()}&limit=1`,
  );
  if (!response.ok) return { error: response.status === 400 ? "schema_pending" : "db_read_failed" };
  const rows = await readJson(response);
  return { row: Array.isArray(rows) ? rows[0] : null };
}

async function patchRequest(env, sbFetch, requestId, patch) {
  const response = await sbFetch(
    env,
    `stella_upgrade_requests?id=eq.${encodeURIComponent(requestId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    },
  );
  return response.ok;
}

function adminRequestEmail(row, brandEmailHtml) {
  const method = row.payment_method === "bank_transfer"
    ? "농협 계좌이체 · 5% 할인"
    : "라이브클래스 카드결제";
  const body = `
    <div style="font-size:18px;font-weight:800;margin-bottom:12px;">스텔라 등급 전환 신청</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.7;">
      <tr><td style="padding:5px 0;color:#8a8270;">결제 방법</td><td style="padding:5px 0;text-align:right;font-weight:800;">${escapeHtml(method)}</td></tr>
      <tr><td style="padding:5px 0;color:#8a8270;">실결제 금액</td><td style="padding:5px 0;text-align:right;font-weight:800;">${escapeHtml(won(row.payable_amount))}</td></tr>
      <tr><td style="padding:5px 0;color:#8a8270;">할인 쿠폰 금액</td><td style="padding:5px 0;text-align:right;">${escapeHtml(won(row.coupon_amount))}</td></tr>
      <tr><td style="padding:5px 0;color:#8a8270;">class-new 이메일</td><td style="padding:5px 0;text-align:right;">${escapeHtml(row.email)}</td></tr>
      <tr><td style="padding:5px 0;color:#8a8270;">라이브클래스 이메일</td><td style="padding:5px 0;text-align:right;">${escapeHtml(row.liveklass_id)}</td></tr>
      ${row.payment_method === "bank_transfer" ? `<tr><td style="padding:5px 0;color:#8a8270;">현금영수증 번호</td><td style="padding:5px 0;text-align:right;">${escapeHtml(row.cash_receipt_number)}</td></tr>` : ""}
    </table>
    <div style="margin-top:16px;padding:13px;background:#faf7ef;border-radius:10px;">
      <div><strong>소장 ${Number(row.owned_count || 0)}개</strong> · ${escapeHtml(courseNames(row.owned_books) || "없음")}</div>
      <div style="margin-top:8px;"><strong>추가할 수업</strong> · ${escapeHtml(courseNames(row.missing_books) || "없음")}</div>
    </div>
    <div style="margin-top:18px;text-align:center;">
      <a href="https://challenge.literstella.co.kr" style="display:inline-block;background:#c8a84b;color:#20160a;font-weight:800;text-decoration:none;padding:12px 22px;border-radius:10px;">관리자 화면 열기</a>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#8a8270;">신청 번호: ${escapeHtml(row.id)}</p>`;
  return brandEmailHtml(body);
}

function couponEmail(row, couponCode, brandEmailHtml) {
  const body = `
    <div style="font-size:18px;font-weight:800;margin-bottom:8px;">스텔라 등급 할인 쿠폰이 도착했습니다</div>
    <p style="margin:0 0 14px;color:#5a5446;">현재 소장 클래스를 반영한 라이브클래스 카드 할인 쿠폰입니다.</p>
    <div style="padding:18px;background:#fdf9ee;border:1px dashed #ddca97;border-radius:14px;text-align:center;">
      <div style="font-size:12px;color:#8a8270;">쿠폰 번호</div>
      <div style="margin-top:6px;font-size:24px;font-weight:900;letter-spacing:1px;color:#8b691c;">${escapeHtml(couponCode)}</div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;font-size:14px;line-height:1.7;">
      <tr><td style="padding:5px 0;color:#8a8270;">할인 금액</td><td style="padding:5px 0;text-align:right;font-weight:800;">${escapeHtml(won(row.coupon_amount))}</td></tr>
      <tr><td style="padding:5px 0;color:#8a8270;">카드 실결제 금액</td><td style="padding:5px 0;text-align:right;font-weight:800;">${escapeHtml(won(row.payable_amount))}</td></tr>
    </table>
    <div style="margin-top:18px;text-align:center;">
      <a href="${LIVEKLASS_PACKAGE_URL}" style="display:inline-block;background:#c8a84b;color:#20160a;font-weight:800;text-decoration:none;padding:13px 24px;border-radius:10px;">라이브클래스에서 결제하기</a>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#8a8270;">결제 화면에서 위 쿠폰 번호를 적용하면 안내된 금액으로 결제할 수 있습니다.</p>`;
  return brandEmailHtml(body);
}

async function notifyAdmin(req, env, cors, deps) {
  const { json, requireUser, sbFetch, sendEmail, brandEmailHtml } = deps;
  const user = await requireUser(req, env);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401, cors);
  if (!env.ADMIN_EMAIL || !EMAIL_RE.test(String(env.ADMIN_EMAIL))) {
    return json({ ok: false, error: "admin_email_missing" }, 503, cors);
  }

  const body = await readRequest(req);
  const requestId = String(body?.requestId || "").trim();
  if (!UUID_RE.test(requestId)) return json({ ok: false, error: "bad_request_id" }, 400, cors);

  const found = await fetchRequest(env, sbFetch, requestId, user.id);
  if (found.error) return json({ ok: false, error: found.error }, 503, cors);
  if (!found.row) return json({ ok: false, error: "not_found" }, 404, cors);
  if (found.row.admin_notified_at) return json({ ok: true, alreadySent: true }, 200, cors);

  const subject = `[리터스텔라] 스텔라 등급 신청 · ${won(found.row.payable_amount)}`;
  const sent = await sendEmail(env, {
    to: String(env.ADMIN_EMAIL).trim().toLowerCase(),
    subject,
    html: adminRequestEmail(found.row, brandEmailHtml),
    idempotencyKey: `stella-request/${requestId}`,
  });
  if (!sent) return json({ ok: false, error: "email_send_failed" }, 502, cors);

  const saved = await patchRequest(env, sbFetch, requestId, {
    admin_notified_at: new Date().toISOString(),
  });
  if (!saved) return json({ ok: false, error: "notification_audit_failed" }, 502, cors);
  return json({ ok: true, sent: true }, 200, cors);
}

async function issueCoupon(req, env, cors, deps) {
  const { json, requireUser, sbFetch, sendEmail, brandEmailHtml } = deps;
  const admin = await requireUser(req, env);
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!admin || !adminEmail || admin.email !== adminEmail) {
    return json({ ok: false, error: "not_admin" }, 403, cors);
  }

  const body = await readRequest(req);
  const requestId = String(body?.requestId || "").trim();
  const couponCode = String(body?.couponCode || "").trim().toUpperCase();
  if (!UUID_RE.test(requestId)) return json({ ok: false, error: "bad_request_id" }, 400, cors);
  if (!COUPON_RE.test(couponCode)) return json({ ok: false, error: "bad_coupon_code" }, 400, cors);

  const found = await fetchRequest(env, sbFetch, requestId);
  if (found.error) return json({ ok: false, error: found.error }, 503, cors);
  const row = found.row;
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);
  if (row.payment_method !== "liveklass_card") {
    return json({ ok: false, error: "card_request_required" }, 409, cors);
  }
  if (!["pending", "coupon_issued"].includes(row.status)) {
    return json({ ok: false, error: "request_not_actionable" }, 409, cors);
  }
  if (row.coupon_code && row.coupon_code !== couponCode) {
    return json({
      ok: false,
      error: "coupon_code_locked",
      couponCode: row.coupon_code,
    }, 409, cors);
  }

  const recipients = recipientEmails(row);
  if (!recipients.length) return json({ ok: false, error: "recipient_missing" }, 409, cors);
  if (row.coupon_code === couponCode && row.coupon_emailed_at) {
    return json({ ok: true, alreadySent: true, recipientCount: recipients.length }, 200, cors);
  }
  if (!row.coupon_code) {
    const locked = await patchRequest(env, sbFetch, requestId, {
      coupon_code: couponCode,
      updated_at: new Date().toISOString(),
    });
    if (!locked) return json({ ok: false, error: "coupon_lock_failed" }, 502, cors);
  }

  let sentCount = 0;
  for (const recipient of recipients) {
    const sent = await sendEmail(env, {
      to: recipient,
      subject: "[리터스텔라] 스텔라 등급 카드 할인 쿠폰",
      html: couponEmail(row, couponCode, brandEmailHtml),
      idempotencyKey: `stella-coupon/${requestId}/${stableToken(`${couponCode}:${recipient}`)}`,
    });
    if (sent) sentCount += 1;
  }
  if (sentCount !== recipients.length) {
    return json({
      ok: false,
      error: "email_send_failed",
      sentCount,
      recipientCount: recipients.length,
    }, 502, cors);
  }

  const saved = await patchRequest(env, sbFetch, requestId, {
    coupon_code: couponCode,
    coupon_emailed_at: new Date().toISOString(),
    coupon_email_recipient_count: recipients.length,
    status: "coupon_issued",
    admin_note: `쿠폰 ${couponCode} · 이메일 ${recipients.length}개 발송`,
    updated_at: new Date().toISOString(),
  });
  if (!saved) return json({ ok: false, error: "coupon_audit_failed" }, 502, cors);

  return json({
    ok: true,
    couponCode,
    recipientCount: recipients.length,
  }, 200, cors);
}

export async function stellaUpgradeEmailRoute(req, env, cors, sub, deps) {
  if (req.method !== "POST") return deps.json({ ok: false, error: "method" }, 405, cors);
  if (sub === "request-notify") return notifyAdmin(req, env, cors, deps);
  if (sub === "coupon") return issueCoupon(req, env, cors, deps);
  return deps.json({ ok: false, error: "not_found" }, 404, cors);
}
