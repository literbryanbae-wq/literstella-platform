const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUPON_RE = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;
const LIVEKLASS_PACKAGE_URL = "https://class.literstella.co.kr/packages/312328";
const CLASS_ROOM_URL = "https://class-new.literstella.co.kr/room";
const CLASS_ADMIN_URL = "https://class-new.literstella.co.kr/admin";
// 계좌 정보는 클래스 앱 data/stellaUpgrade.js STELLA_BANK와 같은 값이어야 한다(한쪽만 바뀌면 오입금).
const BANK = { bank: "농협", account: "302-2142-9005-61", holder: "배선원(리터스텔라)" };

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

const BASE_COLUMNS = [
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
  "completion_emailed_at",
  "created_at",
  "processed_at",
];
// 확정 시 자동 연결되는 8권 — private.stella_upgrade RPC의 v_all과 같은 목록이어야 한다.
const ALL_BOOKS = ["kidari", "anne", "littlewomen1", "littlewomen2", "pride", "gatsby", "sherlock", "theory"];
// 입금 안내 메일용 신규 컬럼. 마이그레이션 전에는 이 컬럼이 없어 select가 400을 낸다.
// 없으면 기본 컬럼만으로 한 번 더 읽는다 — 배포 순서(SQL 먼저/나중)에 관계없이
// 관리자 알림이 죽지 않게 하려는 것. 컬럼이 생기면 자동으로 안내 메일까지 살아난다.
const DEPOSIT_COLUMNS = ["depositor_name", "bank_guide_emailed_at"];

async function enrichMemberNicknames(env, sbFetch, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const authIds = [...new Set(list.map((row) => String(row?.user_id || "").trim()).filter((id) => UUID_RE.test(id)))];
  if (!authIds.length) return list.map((row) => ({ ...row, member_nickname: null }));
  const response = await sbFetch(
    env,
    `users?auth_uid=in.(${authIds.map(encodeURIComponent).join(",")})&select=auth_uid,nickname`,
  );
  if (!response.ok) return list.map((row) => ({ ...row, member_nickname: null }));
  const profiles = (await readJson(response)) || [];
  const nicknameByAuth = new Map(profiles.map((profile) => [String(profile.auth_uid || ""), String(profile.nickname || "").trim()]));
  return list.map((row) => ({ ...row, member_nickname: nicknameByAuth.get(String(row.user_id || "")) || null }));
}

async function selectRequest(env, sbFetch, requestId, userId, columns) {
  const ownerFilter = userId ? `&user_id=eq.${encodeURIComponent(userId)}` : "";
  return sbFetch(
    env,
    `stella_upgrade_requests?id=eq.${encodeURIComponent(requestId)}${ownerFilter}&select=${columns.join(",")}&limit=1`,
  );
}

async function fetchRequest(env, sbFetch, requestId, userId) {
  let depositReady = true;
  let response = await selectRequest(env, sbFetch, requestId, userId, [...BASE_COLUMNS, ...DEPOSIT_COLUMNS]);
  if (response.status === 400) {
    depositReady = false;
    response = await selectRequest(env, sbFetch, requestId, userId, BASE_COLUMNS);
  }
  if (!response.ok) return { error: response.status === 400 ? "schema_pending" : "db_read_failed" };
  const rows = await readJson(response);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { row: null, depositReady };
  const [enriched] = await enrichMemberNicknames(env, sbFetch, [row]);
  return { row: enriched || row, depositReady };
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
      <tr><td style="padding:5px 0;color:#8a8270;">회원 닉네임</td><td style="padding:5px 0;text-align:right;font-weight:800;">${escapeHtml(row.member_nickname || "확인 필요")}</td></tr>
      <tr><td style="padding:5px 0;color:#8a8270;">class-new 이메일</td><td style="padding:5px 0;text-align:right;">${escapeHtml(row.email)}</td></tr>
      <tr><td style="padding:5px 0;color:#8a8270;">라이브클래스 이메일</td><td style="padding:5px 0;text-align:right;">${escapeHtml(row.liveklass_id)}</td></tr>
      ${row.payment_method === "bank_transfer" ? `<tr><td style="padding:5px 0;color:#8a8270;">입금자명</td><td style="padding:5px 0;text-align:right;font-weight:800;">${escapeHtml(row.depositor_name || "미기재")}</td></tr>` : ""}
      ${row.payment_method === "bank_transfer" ? `<tr><td style="padding:5px 0;color:#8a8270;">현금영수증 번호</td><td style="padding:5px 0;text-align:right;">${escapeHtml(row.cash_receipt_number)}</td></tr>` : ""}
    </table>
    <div style="margin-top:16px;padding:13px;background:#faf7ef;border-radius:10px;">
      <div><strong>소장 ${Number(row.owned_count || 0)}개</strong> · ${escapeHtml(courseNames(row.owned_books) || "없음")}</div>
      <div style="margin-top:8px;"><strong>추가할 수업</strong> · ${escapeHtml(courseNames(row.missing_books) || "없음")}</div>
    </div>
    <div style="margin-top:18px;text-align:center;">
      <a href="${CLASS_ADMIN_URL}" style="display:inline-block;background:#c8a84b;color:#20160a;font-weight:800;text-decoration:none;padding:12px 22px;border-radius:10px;">관리자 화면 열기</a>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#8a8270;">신청 번호: ${escapeHtml(row.id)}</p>`;
  return brandEmailHtml(body);
}

// 계좌이체 신청자에게 나가는 입금 안내 메일.
//   왜 필요한가: 카드 신청자는 쿠폰 메일로 '금액 + 결제 버튼'을 받는데, 계좌이체 신청자는
//   신청 후 아무것도 받지 못했다. 화면을 닫는 순간 계좌도 금액도 사라져 입금이 그대로 샜다.
//   따라서 이 메일은 재촉이 아니라 '신청 확인서'다 — 망설이는 지점(얼마·어디로·누구 이름으로·
//   보내면 어떻게 되나)을 순서대로 답해 주면 입금은 그 다음 동작으로 자연스럽게 이어진다.
function bankGuideEmail(row, brandEmailHtml) {
  const amount = won(row.payable_amount);
  const line = (key, value) => `<tr><td style="padding:6px 0;color:#8a8270;white-space:nowrap;">${escapeHtml(key)}</td><td style="padding:6px 0;text-align:right;font-weight:800;color:#2b2519;">${escapeHtml(value)}</td></tr>`;
  const body = `
    <div style="font-size:18px;font-weight:800;margin-bottom:8px;">신청이 접수됐습니다</div>
    <p style="margin:0 0 16px;color:#5a5446;line-height:1.7;">${row.member_nickname ? `${escapeHtml(row.member_nickname)}님, ` : ""}아래 금액을 입금해 주시면 확인 후 미소장 클래스를 한 번에 열어 드립니다. 이 메일을 그대로 보관하셔도 됩니다.</p>
    <div style="padding:18px;background:#fdf9ee;border:1px dashed #ddca97;border-radius:14px;text-align:center;">
      <div style="font-size:12px;color:#8a8270;">입금하실 금액</div>
      <div style="margin-top:6px;font-size:28px;font-weight:900;color:#8b691c;">${escapeHtml(amount)}</div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;line-height:1.7;">
      ${line("입금 계좌", `${BANK.bank} ${BANK.account}`)}
      ${line("예금주", BANK.holder)}
      ${row.depositor_name ? line("입금자명", row.depositor_name) : ""}
      ${row.cash_receipt_number ? line("현금영수증", row.cash_receipt_number) : ""}
    </table>
    <div style="margin-top:18px;padding:14px;background:#faf7ef;border-radius:10px;font-size:13.5px;line-height:1.75;color:#5a5446;">
      <div style="font-weight:800;color:#2b2519;margin-bottom:6px;">입금하시면 이렇게 진행됩니다</div>
      <div>1. 평일 기준 1일 이내에 입금을 확인합니다.</div>
      <div>2. 아래 수업이 지금 쓰시는 계정에 한 번에 연결됩니다.</div>
      <div>3. 연결이 끝나면 다시 메일로 알려 드립니다.</div>
    </div>
    <div style="margin-top:14px;padding:13px;background:#faf7ef;border-radius:10px;font-size:13.5px;line-height:1.7;">
      <strong>연결될 수업</strong> · ${escapeHtml(courseNames(row.missing_books) || "없음")}
    </div>
    <div style="margin-top:20px;text-align:center;">
      <a href="${CLASS_ROOM_URL}" style="display:inline-block;background:#c8a84b;color:#20160a;font-weight:800;text-decoration:none;padding:13px 24px;border-radius:10px;">신청 내역 확인하기</a>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#8a8270;line-height:1.7;">
      ${row.depositor_name ? `통장에는 <strong>${escapeHtml(row.depositor_name)}</strong> 이름으로 찍히도록 보내주시면 바로 확인됩니다. 다른 이름으로 보내셨다면 이 메일에 답장해 알려 주세요.` : "다른 이름으로 입금하셨다면 이 메일에 답장해 알려 주세요."}
      <br />금액이 맞지 않거나 입금을 취소하고 싶으시면 답장 주시면 됩니다.
    </p>`;
  return brandEmailHtml(body);
}

function couponEmail(row, couponCode, brandEmailHtml) {
  const body = `
    <div style="font-size:18px;font-weight:800;margin-bottom:8px;">스텔라 등급 할인 쿠폰이 도착했습니다</div>
    <p style="margin:0 0 14px;color:#5a5446;">${row.member_nickname ? `${escapeHtml(row.member_nickname)}님, ` : ""}현재 소장 클래스를 반영한 라이브클래스 카드 할인 쿠폰입니다.</p>
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

  let found = await fetchRequest(env, sbFetch, requestId, user.id);
  if (found.error) return json({ ok: false, error: found.error }, 503, cors);
  if (!found.row) return json({ ok: false, error: "not_found" }, 404, cors);

  // 신청 정보는 RPC가 원자적으로 저장한다. 구 클라이언트의 알림 재호출로 덮어쓰지 않는다.
  if (!["pending", "coupon_issued"].includes(found.row.status)) {
    return json({ ok: true, alreadyHandled: true }, 200, cors);
  }

  // 계좌이체 신청자에게 입금 안내 메일 — 신청당 1회(bank_guide_emailed_at). 관리자 알림과 독립적으로
  // 판단한다: 관리자 메일이 이미 나갔더라도 안내 메일이 안 나갔으면 여기서 보낸다.
  if (found.depositReady && found.row.payment_method === "bank_transfer" && !found.row.bank_guide_emailed_at) {
    // 수신자 = 신청한 class-new 계정 우선(로그인해서 신청한 그 주소). 없으면 라이브클래스 주소.
    const applicant = recipientEmails(found.row);
    const to = [String(found.row.email || "").trim().toLowerCase(), ...applicant].find((mail) => applicant.includes(mail));
    if (to) {
      const guideSent = await sendEmail(env, {
        to,
        subject: `[리터스텔라] 입금 안내 · ${won(found.row.payable_amount)}`,
        html: bankGuideEmail(found.row, brandEmailHtml),
        idempotencyKey: `stella-bank-guide/${requestId}`,
      });
      if (guideSent) {
        await patchRequest(env, sbFetch, requestId, { bank_guide_emailed_at: new Date().toISOString() });
      }
    }
  }

  // 카드 신청 = 쿠폰 즉시 자동 발급(운영자 확정 2026-08-04 — "왜 자동이 아니냐" → 관리자 버튼 대기 제거).
  //   풀에서 할인 금액에 맞는 코드를 원자 배정 → 쿠폰 메일 → 상태 coupon_issued. 실패해도 신청 흐름은 비차단
  //   (관리자 탭 [쿠폰 자동발급·메일] 버튼이 백업 경로로 그대로 남는다 — 풀 소진 등).
  if (found.row.payment_method === "liveklass_card"
    && Number(found.row.coupon_amount) > 0
    && !found.row.coupon_code
    && found.row.status === "pending") {
    const claimed = await claimPoolCoupon(env, sbFetch, requestId, found.row.coupon_amount);
    if (!claimed.error) {
      const issued = await deliverCouponCore(env, deps, found.row, requestId, claimed.code);
      console.log(JSON.stringify({ evt: "stella_coupon_auto_issue", requestId, ok: issued.ok, code: claimed.code, error: issued.error || null }));
      if (issued.ok) found = { ...found, row: { ...found.row, coupon_code: claimed.code, status: "coupon_issued" } };
    } else {
      console.log(JSON.stringify({ evt: "stella_coupon_pool_issue_fail", requestId, reason: claimed.error }));
    }
  }

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

  return deliverCoupon(env, cors, deps, row, requestId, couponCode);
}

// 쿠폰 잠금 → 메일 발송 → 감사 기록 — 수동(coupon)·자동(coupon-auto)·신청 즉시(request-notify) 공용 코어.
async function deliverCouponCore(env, deps, row, requestId, couponCode) {
  const { sbFetch, sendEmail, brandEmailHtml } = deps;
  const recipients = recipientEmails(row);
  if (!recipients.length) return { ok: false, error: "recipient_missing", httpStatus: 409 };
  if (row.coupon_code === couponCode && row.coupon_emailed_at) {
    return { ok: true, alreadySent: true, couponCode, recipientCount: recipients.length };
  }
  if (!row.coupon_code) {
    const locked = await patchRequest(env, sbFetch, requestId, {
      coupon_code: couponCode,
      updated_at: new Date().toISOString(),
    });
    if (!locked) return { ok: false, error: "coupon_lock_failed", httpStatus: 502 };
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
    return { ok: false, error: "email_send_failed", sentCount, recipientCount: recipients.length, httpStatus: 502 };
  }

  const saved = await patchRequest(env, sbFetch, requestId, {
    coupon_code: couponCode,
    coupon_emailed_at: new Date().toISOString(),
    coupon_email_recipient_count: recipients.length,
    status: "coupon_issued",
    admin_note: `쿠폰 ${couponCode} · 이메일 ${recipients.length}개 발송`,
    updated_at: new Date().toISOString(),
  });
  if (!saved) return { ok: false, error: "coupon_audit_failed", httpStatus: 502 };

  return { ok: true, couponCode, recipientCount: recipients.length };
}

async function deliverCoupon(env, cors, deps, row, requestId, couponCode) {
  const { json } = deps;
  const r = await deliverCouponCore(env, deps, row, requestId, couponCode);
  const { httpStatus, ...body } = r;
  return json(body, r.ok ? 200 : (httpStatus || 502), cors);
}

async function requireAdminUser(req, env, deps, cors) {
  const admin = await deps.requireUser(req, env);
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!admin || !adminEmail || admin.email !== adminEmail) return null;
  return admin;
}

// 쿠폰 풀에서 신청 할인 금액에 맞는 미배정 코드를 원자적으로 집는다(운영자 확정 2026-08-03 — 수동 코드 입력 제거).
//   경쟁은 request_id IS NULL 필터가 잡는다: 같은 코드를 두 요청이 집으면 한쪽 PATCH만 행을 반환.
async function claimPoolCoupon(env, sbFetch, requestId, amount) {
  const listed = await sbFetch(env, `stella_coupons?request_id=is.null&amount=eq.${Number(amount)}&select=code&order=code.asc&limit=5`);
  if (!listed.ok) return { error: "pool_read_failed" };
  const candidates = (await readJson(listed)) || [];
  if (!candidates.length) return { error: "pool_empty" };
  for (const cand of candidates) {
    const res = await sbFetch(env, `stella_coupons?code=eq.${encodeURIComponent(cand.code)}&request_id=is.null`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ request_id: requestId, assigned_at: new Date().toISOString() }),
    });
    if (!res.ok) continue;
    const rows = await readJson(res);
    if (Array.isArray(rows) && rows.length === 1) return { code: rows[0].code };
  }
  return { error: "pool_race_lost" };
}

// 자동 발급: 신청의 할인 금액에 맞는 쿠폰을 풀에서 집어 잠그고 메일까지 — 관리자 버튼 1회.
async function issueCouponAuto(req, env, cors, deps) {
  const { json, sbFetch } = deps;
  const admin = await requireAdminUser(req, env, deps, cors);
  if (!admin) return json({ ok: false, error: "not_admin" }, 403, cors);

  const body = await readRequest(req);
  const requestId = String(body?.requestId || "").trim();
  if (!UUID_RE.test(requestId)) return json({ ok: false, error: "bad_request_id" }, 400, cors);

  const found = await fetchRequest(env, sbFetch, requestId);
  if (found.error) return json({ ok: false, error: found.error }, 503, cors);
  const row = found.row;
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);
  if (row.payment_method !== "liveklass_card") return json({ ok: false, error: "card_request_required" }, 409, cors);
  if (!["pending", "coupon_issued"].includes(row.status)) return json({ ok: false, error: "request_not_actionable" }, 409, cors);
  if (!Number(row.coupon_amount)) return json({ ok: false, error: "no_discount_no_coupon" }, 409, cors);

  // 이미 코드가 잠겨 있으면(재발송) 풀을 다시 집지 않고 그 코드로 재발송한다.
  let couponCode = row.coupon_code || null;
  if (!couponCode) {
    const claimed = await claimPoolCoupon(env, sbFetch, requestId, row.coupon_amount);
    if (claimed.error) return json({ ok: false, error: claimed.error }, claimed.error === "pool_empty" ? 409 : 502, cors);
    couponCode = claimed.code;
  }
  return deliverCoupon(env, cors, deps, row, requestId, couponCode);
}

// 평생소장 확정 메일 — 입금/결제 확인 후 8권 연결이 끝났음을 알리는 최종 안내.
function completionEmail(row, brandEmailHtml) {
  const body = `
    <div style="font-size:18px;font-weight:800;margin-bottom:8px;">평생소장 연결이 완료됐습니다 🎉</div>
    <p style="margin:0 0 14px;color:#5a5446;line-height:1.75;">${row.member_nickname ? `${escapeHtml(row.member_nickname)}님, ` : ""}결제 확인이 끝나 스텔라 등급의 모든 수업이 지금 쓰시는 계정에 연결됐습니다. 이제 언제든, 평생 이어서 들으실 수 있어요.</p>
    <div style="padding:16px;background:#fdf9ee;border:1px dashed #ddca97;border-radius:14px;">
      <div style="font-size:12px;color:#8a8270;margin-bottom:6px;">연결된 수업 · 8개 전부</div>
      <div style="font-size:14px;line-height:1.8;color:#2b2519;font-weight:700;">${escapeHtml(courseNames(ALL_BOOKS))}</div>
    </div>
    <div style="margin-top:14px;padding:13px;background:#faf7ef;border-radius:10px;font-size:13.5px;line-height:1.75;color:#5a5446;">
      <div style="font-weight:800;color:#2b2519;margin-bottom:4px;">스텔라 클럽</div>
      강독 7개를 모두 소장하셔서 내 서재에 <strong>스텔라 클럽</strong> 등급이 함께 표시됩니다. 리딩메이트 Lyra도 다음 방문 때 인사드릴 거예요.
    </div>
    <div style="margin-top:20px;text-align:center;">
      <a href="${CLASS_ROOM_URL}" style="display:inline-block;background:#c8a84b;color:#20160a;font-weight:800;text-decoration:none;padding:13px 24px;border-radius:10px;">내 강의실에서 시작하기</a>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#8a8270;">로그인 이메일: ${escapeHtml(row.email)} · 궁금한 점은 이 메일에 답장 주세요.</p>`;
  return brandEmailHtml(body);
}

// 확정: 결제/입금 확인 → 8권 수강권 연결 → 완료 메일 — 관리자 버튼 1회(운영자 확정 2026-08-03).
//   Lyra 인앱 알림은 클라가 담당(연결 감지 → GrantWelcomeModal + Lyra 인박스) — '이메일 알림 = 라일라 알림' 규칙.
async function completeRequest(req, env, cors, deps) {
  const { json, sbFetch, sendEmail, brandEmailHtml, isEmailSuppressed } = deps;
  const admin = await requireAdminUser(req, env, deps, cors);
  if (!admin) return json({ ok: false, error: "not_admin" }, 403, cors);

  const body = await readRequest(req);
  const requestId = String(body?.requestId || "").trim();
  if (!UUID_RE.test(requestId)) return json({ ok: false, error: "bad_request_id" }, 400, cors);

  const found = await fetchRequest(env, sbFetch, requestId);
  if (found.error) return json({ ok: false, error: found.error }, 503, cors);
  const row = found.row;
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);
  if (!["pending", "coupon_issued", "completed"].includes(row.status)) {
    return json({ ok: false, error: "request_not_actionable" }, 409, cors);
  }
  if (row.status === "completed" && row.completion_emailed_at) {
    return json({ ok: true, alreadyDone: true }, 200, cors);
  }
  const applicant = String(row.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(applicant)) return json({ ok: false, error: "recipient_missing" }, 409, cors);

  // 1) 8권 수강권 연결 — 이미 있는 책은 중복 삽입 무시(재실행 안전)
  const nowIso = new Date().toISOString();
  const grantRows = ALL_BOOKS.map((book) => ({
    email: applicant,
    book_code: book,
    verified_at: nowIso,
    enrollment_email: String(row.liveklass_id || applicant).trim().toLowerCase(),
  }));
  const granted = await sbFetch(env, `class_verifications?on_conflict=email,book_code`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(grantRows),
  });
  if (!granted.ok) return json({ ok: false, error: "grant_failed" }, 502, cors);

  // 2) 상태 확정 — 메일이 실패해도 연결·상태는 남긴다(재실행 시 메일만 다시 시도)
  const statusSaved = await patchRequest(env, sbFetch, requestId, {
    status: "completed",
    processed_at: row.processed_at || nowIso,
    updated_at: nowIso,
  });
  if (!statusSaved) return json({ ok: false, error: "status_save_failed" }, 502, cors);

  // 3) 완료 메일 — 로그인 계정 주소로 1통(라이브클래스 주소가 달라도 실제 접속 계정이 기준)
  //   🔴 보내기 전에 차단 목록을 본다(2026-08-28). 실제로 이연홍·김수진 님 확정에서 메일만 실패했는데
  //     화면엔 "실패"만 떠서 원인을 알 수 없었고, 이유는 워커 로그에만 남아 아무도 못 봤다.
  //     연결(8권)은 이미 끝났으므로 메일 실패로 되돌리지 않고, **무엇이 문제인지 말해 준다**.
  if (typeof isEmailSuppressed === "function" && await isEmailSuppressed(env, applicant)) {
    return json({
      ok: false,
      error: "email_suppressed",
      grantDone: true,
      message: `8권 연결은 끝났습니다. 다만 ${applicant} 는 반송 이력으로 차단 목록에 있어 메일이 나가지 않습니다. 차단을 푼 뒤 이 버튼을 다시 눌러 주세요.`,
    }, 200, cors);
  }
  const sent = await sendEmail(env, {
    to: applicant,
    subject: "[리터스텔라] 평생소장 연결 완료 — 스텔라 등급",
    html: completionEmail(row, brandEmailHtml),
    idempotencyKey: `stella-complete/${requestId}`,
  });
  if (!sent) {
    console.error(JSON.stringify({ evt: "stella_complete_email_failed", to: applicant, requestId }));
    return json({
      ok: false,
      error: "email_send_failed",
      grantDone: true,
      message: "8권 연결은 끝났습니다. 완료 메일만 실패했어요 — 이 버튼을 다시 누르면 메일만 재시도합니다.",
    }, 502, cors);
  }
  await patchRequest(env, sbFetch, requestId, { completion_emailed_at: new Date().toISOString() });

  return json({ ok: true, granted: ALL_BOOKS.length, emailedTo: applicant }, 200, cors);
}

// 관리자 개요: 신청 전건 + 쿠폰 풀 잔량 — 관리자 탭 '스텔라 등급'이 읽는다(통계 합산은 클라 계산).
async function adminOverview(req, env, cors, deps) {
  const { json, sbFetch } = deps;
  const admin = await requireAdminUser(req, env, deps, cors);
  if (!admin) return json({ ok: false, error: "not_admin" }, 403, cors);

  const [reqRes, poolRes] = await Promise.all([
    sbFetch(env, `stella_upgrade_requests?select=${[...BASE_COLUMNS, ...DEPOSIT_COLUMNS].join(",")}&order=created_at.desc&limit=200`),
    sbFetch(env, `stella_coupons?select=amount,request_id`),
  ]);
  if (!reqRes.ok) {
    // depositor 컬럼 미적용 환경 폴백(기존 fetchRequest와 같은 이유)
    const fallback = await sbFetch(env, `stella_upgrade_requests?select=${BASE_COLUMNS.join(",")}&order=created_at.desc&limit=200`);
    if (!fallback.ok) return json({ ok: false, error: "db_read_failed" }, 503, cors);
    const rows = (await readJson(fallback)) || [];
    return json({ ok: true, requests: await enrichMemberNicknames(env, sbFetch, rows), pool: [] }, 200, cors);
  }
  const rows = await enrichMemberNicknames(env, sbFetch, (await readJson(reqRes)) || []);
  const poolRows = poolRes.ok ? ((await readJson(poolRes)) || []) : [];
  const pool = {};
  for (const c of poolRows) {
    const key = String(c.amount);
    if (!pool[key]) pool[key] = { free: 0, used: 0 };
    if (c.request_id) pool[key].used += 1; else pool[key].free += 1;
  }
  return json({ ok: true, requests: rows, pool }, 200, cors);
}

export async function stellaUpgradeEmailRoute(req, env, cors, sub, deps) {
  if (req.method !== "POST") return deps.json({ ok: false, error: "method" }, 405, cors);
  if (sub === "request-notify") return notifyAdmin(req, env, cors, deps);
  if (sub === "coupon") return issueCoupon(req, env, cors, deps);
  if (sub === "coupon-auto") return issueCouponAuto(req, env, cors, deps);
  if (sub === "complete") return completeRequest(req, env, cors, deps);
  if (sub === "admin-overview") return adminOverview(req, env, cors, deps);
  return deps.json({ ok: false, error: "not_found" }, 404, cors);
}
