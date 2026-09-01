import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stellaUpgradeEmailRoute } from "./src/stella-upgrade-email-service.mjs";

const requestId = "11111111-1111-4111-8111-111111111111";
const authId = "22222222-2222-4222-8222-222222222222";
const row = {
  id: requestId,
  user_id: authId,
  email: "member@example.com",
  liveklass_id: "liveklass@example.com",
  owned_books: ["anne"],
  missing_books: ["kidari"],
  owned_count: 1,
  base_amount: 398000,
  coupon_amount: 50000,
  payable_amount: 330600,
  payment_method: "bank_transfer",
  cash_receipt_number: "01012345678",
  depositor_name: "입금자",
  bank_guide_emailed_at: "2026-08-30T00:00:00.000Z",
  status: "pending",
  coupon_code: null,
  admin_notified_at: null,
  coupon_emailed_at: null,
  coupon_email_recipient_count: null,
  completion_emailed_at: null,
  created_at: "2026-08-30T00:00:00.000Z",
  processed_at: null,
};

const json = (data, status = 200, cors = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json", ...cors },
});

function response(data, status = 200) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: data === null ? undefined : { "content-type": "application/json" },
  });
}

function makeDeps({ sent = [], suppression = false, requestRow = row, patches = [] } = {}) {
  return {
    json,
    requireUser: async () => ({ id: authId, email: "admin@example.com" }),
    brandEmailHtml: (html) => html,
    isEmailSuppressed: async () => suppression,
    sendEmail: async (_env, message) => { sent.push(message); return "email-id"; },
    sbFetch: async (_env, path, options = {}) => {
      if (path.startsWith("stella_upgrade_requests?") && !options.method) return response([requestRow]);
      if (path.startsWith("stella_coupons?")) return response([]);
      if (path.startsWith("users?auth_uid=")) return response([{ auth_uid: authId, nickname: "별빛회원" }]);
      if (path.startsWith("class_verifications?") && options.method === "POST") return response(null, 204);
      if (path.startsWith("stella_upgrade_requests?") && options.method === "PATCH") {
        patches.push(JSON.parse(options.body));
        return response(null, 204);
      }
      throw new Error(`unexpected path: ${path}`);
    },
  };
}

{
  const deps = makeDeps();
  const res = await stellaUpgradeEmailRoute(
    new Request("https://example.com/admin-overview", { method: "POST" }),
    { ADMIN_EMAIL: "admin@example.com" }, {}, "admin-overview", deps,
  );
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.requests[0].member_nickname, "별빛회원");
}

{
  const sent = [];
  const deps = makeDeps({ sent });
  const res = await stellaUpgradeEmailRoute(
    new Request("https://example.com/request-notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId }),
    }),
    { ADMIN_EMAIL: "admin@example.com" }, {}, "request-notify", deps,
  );
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /별빛회원/);
  assert.match(sent[0].html, /입금자/);
  assert.match(sent[0].html, /class-new\.literstella\.co\.kr\/admin/);
}

{
  const sent = [];
  const deps = makeDeps({ sent, suppression: true });
  const res = await stellaUpgradeEmailRoute(
    new Request("https://example.com/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId }),
    }),
    { ADMIN_EMAIL: "admin@example.com" }, {}, "complete", deps,
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.error, "email_suppressed");
  assert.equal(body.grantDone, true);
  assert.match(body.message, /8권 연결은 끝났습니다/);
  assert.equal(sent.length, 0);
}

const emailedCardRow = {
  ...row,
  email: "member@example.com",
  liveklass_id: "legacy@example.com",
  payment_method: "liveklass_card",
  status: "pending",
  coupon_code: "STELLA50000",
  coupon_emailed_at: "2026-08-28T01:24:36.401Z",
  coupon_email_recipient_count: 2,
};

{
  const sent = [];
  const patches = [];
  const deps = makeDeps({ sent, patches, requestRow: emailedCardRow });
  const res = await stellaUpgradeEmailRoute(
    new Request("https://example.com/coupon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, couponCode: emailedCardRow.coupon_code }),
    }),
    { ADMIN_EMAIL: "admin@example.com" }, {}, "coupon", deps,
  );
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.alreadySent, true);
  assert.equal(sent.length, 0);
  assert.equal(patches.length, 0);
}

{
  const sent = [];
  const patches = [];
  const deps = makeDeps({ sent, patches, requestRow: emailedCardRow });
  const res = await stellaUpgradeEmailRoute(
    new Request("https://example.com/coupon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, couponCode: emailedCardRow.coupon_code, resend: true }),
    }),
    { ADMIN_EMAIL: "admin@example.com" }, {}, "coupon", deps,
  );
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.resent, true);
  assert.equal(sent.length, 2);
  assert.equal(new Set(sent.map((message) => message.idempotencyKey)).size, 2);
  assert.ok(sent.every((message) => message.idempotencyKey.startsWith(`stella-coupon-resend/${requestId}/`)));
  assert.equal(patches.at(-1).status, "coupon_issued");
  assert.match(patches.at(-1).admin_note, /재발송/);
}

console.log("stella-upgrade-admin-contract-test: ok");

const depositorSql = readFileSync(
  new URL("./stella-upgrade-require-depositor.sql", import.meta.url),
  "utf8",
);
assert.match(depositorSql, /lower\(trim\(p_payment_method\)\) = 'bank_transfer'/);
assert.match(depositorSql, /nullif\(trim\(coalesce\(p_depositor_name, ''\)\), ''\) is null/);
assert.match(depositorSql, /depositor_name_required/);

console.log("stella-upgrade depositor requirement: ok");
