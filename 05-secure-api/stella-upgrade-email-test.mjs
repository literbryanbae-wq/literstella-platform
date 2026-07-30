import assert from "node:assert/strict";
import { stellaUpgradeEmailRoute } from "./src/stella-upgrade-email-service.mjs";

const requestId = "11111111-1111-4111-8111-111111111111";
const member = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "member@class-new.test",
};
const admin = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "owner@example.com",
};
const env = { ADMIN_EMAIL: admin.email };

let activeUser = member;
let row = {
  id: requestId,
  user_id: member.id,
  email: member.email,
  liveklass_id: "member@liveklass.test",
  owned_books: ["kidari"],
  missing_books: ["anne", "gatsby"],
  owned_count: 1,
  base_amount: 398000,
  coupon_amount: 50000,
  payable_amount: 348000,
  payment_method: "liveklass_card",
  cash_receipt_number: null,
  status: "pending",
  coupon_code: null,
  admin_notified_at: null,
  coupon_emailed_at: null,
  coupon_email_recipient_count: null,
};

const sentEmails = [];
const patches = [];
let failedRecipient = null;

function response(value, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sbFetch(_env, path, init = {}) {
  if (path.startsWith("stella_upgrade_requests?") && !init.method) {
    return response([row]);
  }
  if (path.startsWith("stella_upgrade_requests?") && init.method === "PATCH") {
    const patch = JSON.parse(init.body);
    patches.push(patch);
    row = { ...row, ...patch };
    return response(null, 204);
  }
  return response({ error: `unhandled ${path}` }, 500);
}

const deps = {
  json: (value, status, cors) => new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...(cors || {}) },
  }),
  requireUser: async () => activeUser,
  sbFetch,
  sendEmail: async (_env, payload) => {
    sentEmails.push(payload);
    return payload.to !== failedRecipient;
  },
  brandEmailHtml: (body) => `<html>${body}</html>`,
};

async function call(sub, body) {
  const request = new Request(`https://api.example.test/api/stella-upgrade/${sub}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Token": "test-token",
    },
    body: JSON.stringify(body),
  });
  const result = await stellaUpgradeEmailRoute(request, env, {}, sub, deps);
  return { status: result.status, body: await result.json() };
}

const adminNotice = await call("request-notify", { requestId });
assert.equal(adminNotice.status, 200);
assert.equal(adminNotice.body.ok, true);
assert.equal(sentEmails.length, 1);
assert.equal(sentEmails[0].to, admin.email);
assert.equal(sentEmails[0].idempotencyKey, `stella-request/${requestId}`);
assert.ok(row.admin_notified_at);

const duplicateNotice = await call("request-notify", { requestId });
assert.equal(duplicateNotice.body.alreadySent, true);
assert.equal(sentEmails.length, 1);

activeUser = member;
const forbidden = await call("coupon", { requestId, couponCode: "STELLA-50000" });
assert.equal(forbidden.status, 403);
assert.equal(forbidden.body.error, "not_admin");

activeUser = admin;
const invalidCoupon = await call("coupon", { requestId, couponCode: "x" });
assert.equal(invalidCoupon.status, 400);
assert.equal(invalidCoupon.body.error, "bad_coupon_code");

failedRecipient = row.liveklass_id;
const partialCoupon = await call("coupon", { requestId, couponCode: "stella-50000" });
assert.equal(partialCoupon.status, 502);
assert.equal(partialCoupon.body.error, "email_send_failed");
assert.equal(row.coupon_code, "STELLA-50000");
assert.equal(row.status, "pending");
assert.equal(row.coupon_emailed_at, null);

const changedCoupon = await call("coupon", { requestId, couponCode: "stella-51000" });
assert.equal(changedCoupon.status, 409);
assert.equal(changedCoupon.body.error, "coupon_code_locked");
assert.equal(changedCoupon.body.couponCode, "STELLA-50000");

failedRecipient = null;
const coupon = await call("coupon", { requestId, couponCode: "stella-50000" });
assert.equal(coupon.status, 200);
assert.equal(coupon.body.recipientCount, 2);
assert.equal(sentEmails.length, 5);
assert.deepEqual(
  sentEmails.slice(3).map((email) => email.to).sort(),
  [member.email, row.liveklass_id].sort(),
);
assert.equal(new Set(sentEmails.slice(3).map((email) => email.idempotencyKey)).size, 2);
assert.equal(row.status, "coupon_issued");
assert.equal(row.coupon_code, "STELLA-50000");
assert.ok(row.coupon_emailed_at);
assert.equal(row.coupon_email_recipient_count, 2);

const duplicateCoupon = await call("coupon", { requestId, couponCode: "STELLA-50000" });
assert.equal(duplicateCoupon.body.alreadySent, true);
assert.equal(sentEmails.length, 5);
assert.equal(patches.length, 3);

console.log("stella-upgrade email service: all assertions passed");
