import assert from "node:assert/strict";
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

function makeDeps({ sent = [], suppression = false } = {}) {
  return {
    json,
    requireUser: async () => ({ id: authId, email: "admin@example.com" }),
    brandEmailHtml: (html) => html,
    isEmailSuppressed: async () => suppression,
    sendEmail: async (_env, message) => { sent.push(message); return "email-id"; },
    sbFetch: async (_env, path, options = {}) => {
      if (path.startsWith("stella_upgrade_requests?") && !options.method) return response([row]);
      if (path.startsWith("stella_coupons?")) return response([]);
      if (path.startsWith("users?auth_uid=")) return response([{ auth_uid: authId, nickname: "별빛회원" }]);
      if (path.startsWith("class_verifications?") && options.method === "POST") return response(null, 204);
      if (path.startsWith("stella_upgrade_requests?") && options.method === "PATCH") return response(null, 204);
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

console.log("stella-upgrade-admin-contract-test: ok");
