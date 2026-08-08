import assert from "node:assert/strict";
import worker from "./src/index.js";

const env = {
  ALLOWED_ORIGINS: "https://class-new.literstella.co.kr",
  PAYMENT_ENABLED: "true",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  TOSS_SECRET_KEY: "test_sk_example",
};

const state = {
  payments: new Map(),
  passes: [],
  enrollmentWrites: 0,
  failNextConfirm: false,
  tossStatus: 'DONE',
};

const fetchMock = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = init.method || "GET";

  if (url.hostname === "test.supabase.co" && url.pathname === "/rest/v1/class_access_passes") {
    if (method === "POST") {
      const row = JSON.parse(init.body);
      const existing = state.passes.find((item) => item.payment_id === row.payment_id);
      if (existing) return Response.json([], { status: 201 });
      state.passes.push(row);
      return Response.json([row], { status: 201 });
    }
    if (method === "PATCH") {
      const paymentId = String(url.searchParams.get("payment_id") || "").replace(/^eq\./, "");
      const patch = JSON.parse(init.body);
      const row = state.passes.find((item) => item.payment_id === paymentId && item.status === "active");
      if (row) Object.assign(row, patch);
      return new Response(null, { status: 204 });
    }
    return Response.json(state.passes.filter((row) => row.status === "active" && row.expires_at > new Date().toISOString()));
  }

  if (url.hostname === "test.supabase.co" && url.pathname === "/rest/v1/class_enrollments") {
    if (method === "POST") state.enrollmentWrites += 1;
    return Response.json([]);
  }

  if (url.hostname === "test.supabase.co" && url.pathname === "/rest/v1/payments") {
    if (method === "POST") {
      const row = JSON.parse(init.body);
      state.payments.set(row.id, { ...(state.payments.get(row.id) || {}), ...row });
      return new Response(null, { status: 201 });
    }
    const id = String(url.searchParams.get("id") || "").replace(/^eq\./, "");
    return Response.json(state.payments.has(id) ? [state.payments.get(id)] : []);
  }

  if (url.hostname === "api.tosspayments.com" && url.pathname === "/v1/payments/confirm") {
    const body = JSON.parse(init.body);
    assert.equal(body.amount, 198000);
    if (state.failNextConfirm) {
      state.failNextConfirm = false;
      return Response.json({ code: "PROVIDER_TEMPORARY_ERROR" }, { status: 500 });
    }
    return Response.json({ status: "DONE", totalAmount: 198000, orderId: body.orderId });
  }

  if (url.hostname === "api.tosspayments.com" && method === "GET" && url.pathname.startsWith("/v1/payments/")) {
    return Response.json({
      paymentKey: url.pathname.split('/').pop(),
      orderId: [...state.payments.keys()][0],
      totalAmount: 198000,
      status: state.tossStatus,
    });
  }

  throw new Error(`Unexpected fetch: ${method} ${url}`);
};

async function call(path, body) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const response = await worker.fetch(new Request(`https://api.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://class-new.literstella.co.kr" },
      body: JSON.stringify(body),
    }), env);
    return { status: response.status, body: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const prepared = await call("/api/payment/toss-prepare", {
  product: "class-classics-annual-8",
  email: "reader@example.com",
});
assert.equal(prepared.status, 200);
assert.equal(prepared.body.amount, 198000);
assert.equal(prepared.body.orderName, "리터스텔라 클래식 8개 강의 · 12개월 이용권");
assert.match(prepared.body.orderId, /^pay[a-f0-9]{32}$/);

state.failNextConfirm = true;
const failedOnce = await call("/api/payment/toss-confirm", {
  paymentKey: "payment-key-test",
  orderId: prepared.body.orderId,
  amount: 198000,
});
assert.equal(failedOnce.status, 402);
assert.equal(state.payments.get(prepared.body.orderId).amount, 198000);

const confirmed = await call("/api/payment/toss-confirm", {
  paymentKey: "payment-key-test",
  orderId: prepared.body.orderId,
  amount: 198000,
});
assert.equal(confirmed.status, 200);
assert.equal(confirmed.body.ok, true);
assert.equal(confirmed.body.granted, true);
assert.equal(confirmed.body.email, "reader@example.com");
assert.equal(state.passes.length, 1);
assert.equal(state.passes[0].product_code, "class-classics-annual-8");
assert.deepEqual(state.passes[0].book_codes, ["kidari", "anne", "littlewomen1", "littlewomen2", "pride", "gatsby", "sherlock", "theory"]);
assert.equal(state.enrollmentWrites, 0);

const firstExpiry = state.passes[0].expires_at;
const confirmedAgain = await call("/api/payment/toss-confirm", {
  paymentKey: "payment-key-test",
  orderId: prepared.body.orderId,
  amount: 198000,
});
assert.equal(confirmedAgain.body.granted, true);
assert.equal(state.passes.length, 1);
assert.equal(state.passes[0].expires_at, firstExpiry);

const doneWebhook = await call("/api/payment/toss-webhook", { data: { paymentKey: "payment-key-test" } });
assert.equal(doneWebhook.status, 200);
assert.equal(state.passes[0].expires_at, firstExpiry);

state.tossStatus = 'CANCELED';
const canceledWebhook = await call("/api/payment/toss-webhook", { data: { paymentKey: "payment-key-test" } });
assert.equal(canceledWebhook.status, 200);
assert.equal(state.passes[0].status, 'canceled');
assert.equal(state.payments.get(prepared.body.orderId).status, 'CANCELED');

console.log("secure-api class-pass-payment-test: all assertions passed");
