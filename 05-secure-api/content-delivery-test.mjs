import assert from "node:assert/strict";
import {
  CONTENT_DELIVERY_DRAFTS,
  contentEmailBodyHtml,
  getContentDeliveryDraft,
  isAllowedContentLink,
} from "./src/content-delivery.mjs";
import worker from "./src/index.js";

const ids = Object.keys(CONTENT_DELIVERY_DRAFTS);
assert.deepEqual(ids, ["hp1-day06", "hp1-day07", "hp1-day08", "hp1-day09", "hp1-day10"]);

for (const id of ids) {
  const draft = getContentDeliveryDraft(id);
  assert.equal(draft.contentId, id);
  assert.equal(draft.audience, "hp");
  assert.equal(draft.releaseStatus, "RELEASE_QA_BLOCKED");
  assert.equal(draft.link, null);
  assert.deepEqual(draft.media, { imageUrl: null, audioUrl: null });
  assert.ok(draft.title);
  assert.ok(draft.teaser);

  const html = contentEmailBodyHtml(draft);
  assert.match(html, /수신 설정 · 구독 해지/);
  assert.match(html, /data-release-preview="blocked"/);
  assert.doesNotMatch(html, /data-content-media=/);
  assert.doesNotMatch(html, /src="null"|href="null"/);
}

assert.equal(getContentDeliveryDraft("hp1-day11"), null);
assert.equal(isAllowedContentLink("https://challenge.literstella.co.kr/?view=hp"), true);
assert.equal(isAllowedContentLink("https://example.com/phishing"), false);

const publishedPreview = contentEmailBodyHtml({
  ...CONTENT_DELIVERY_DRAFTS["hp1-day08"],
  releaseStatus: "RELEASE_APPROVED",
  link: "https://challenge.literstella.co.kr/?view=hp",
  media: { imageUrl: null, audioUrl: null },
});
assert.match(publishedPreview, /지금 보러 가기/);
assert.doesNotMatch(publishedPreview, /data-release-preview="blocked"/);

const env = {
  ADMIN_API_ENABLED: "true",
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_SECRET: "test-admin-secret",
  ALLOWED_ORIGINS: "",
  CONTENT_SEND_ENABLED: "false",
  RESEND_API_KEY: "test-resend-key",
  RESEND_FROM: "LiterStella <test@example.com>",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  SUPABASE_URL: "https://supabase.test",
};

async function adminToken() {
  const exp = Date.now() + 60_000;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`admin:${env.ADMIN_EMAIL}:${exp}`),
  );
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${exp}.${hex}`;
}

const token = await adminToken();
const originalFetch = globalThis.fetch;
const resendBodies = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.startsWith(`${env.SUPABASE_URL}/rest/v1/hp_subscribers`)) {
    return new Response(JSON.stringify([{ email: "reader@example.com" }]), { status: 200 });
  }
  if (url === "https://api.resend.com/emails") {
    resendBodies.push(JSON.parse(String(init.body || "{}")));
    return new Response(JSON.stringify({ id: "mock-email" }), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${url}`);
};

async function call(body) {
  return worker.fetch(new Request("https://worker.test/api/admin/send-content", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);
}

try {
  const dryResponse = await call({ contentId: "hp1-day06", mode: "dry", segment: 1 });
  assert.equal(dryResponse.status, 200);
  const dry = await dryResponse.json();
  assert.equal(dry.contentId, "hp1-day06");
  assert.equal(dry.releaseStatus, "RELEASE_QA_BLOCKED");
  assert.equal(dry.recipients, 1);

  const testResponse = await call({ contentId: "hp1-day10", mode: "test", segment: 1 });
  assert.equal(testResponse.status, 200);
  assert.equal(resendBodies.length, 1);
  assert.match(resendBodies[0].html, /수신 설정 · 구독 해지/);
  assert.doesNotMatch(resendBodies[0].html, /data-content-media=|src="null"|href="null"/);

  const sendResponse = await call({ contentId: "hp1-day06", mode: "send", segment: 1 });
  assert.equal(sendResponse.status, 409);
  assert.equal((await sendResponse.json()).error, "release_blocked");

  const badModeResponse = await call({ contentId: "hp1-day06", mode: "preview", segment: 1 });
  assert.equal(badModeResponse.status, 400);
  assert.equal((await badModeResponse.json()).error, "bad_mode");

  const genericDryResponse = await call({
    audience: "hp",
    mode: "dry",
    segment: 1,
    title: "기존 범용 계약",
    link: "https://challenge.literstella.co.kr/?view=hp",
  });
  assert.equal(genericDryResponse.status, 200);
  assert.equal((await genericDryResponse.json()).contentId, null);
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`content delivery tests passed: ${ids.length} HP drafts + dry/test/send route guards`);

