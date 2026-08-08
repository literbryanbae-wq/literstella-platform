import assert from "node:assert/strict";
import worker from "./src/index.js";
import {
  classBookRequestSatisfied,
  classEnrollmentEmailCandidates,
} from "./src/class-enrollment-access.mjs";

const encoder = new TextEncoder();
const secret = "class-link-test-secret";
const env = {
  ALLOWED_ORIGINS: "https://class-new.literstella.co.kr",
  OTP_SECRET: secret,
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
};

assert.deepEqual(classEnrollmentEmailCandidates(" Reader@Hanmail.net "), [
  "reader@hanmail.net",
  "reader@daum.net",
]);
assert.deepEqual(classEnrollmentEmailCandidates("reader@naver.com"), ["reader@naver.com"]);
assert.equal(classBookRequestSatisfied("all", ["anne"]), true);
assert.equal(classBookRequestSatisfied("kidari", ["anne"]), false);

async function signedToken(email, code) {
  const exp = Date.now() + 60_000;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`code:${email}:${code}:${exp}`));
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${exp}.${hex}`;
}

function mockSupabase({ enrollments, loginEmail = "" }) {
  const verificationRows = [];
  const calls = [];
  const fetchMock = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push({ url: url.toString(), method: init.method || "GET", body: init.body || "" });

    if (url.pathname === "/auth/v1/user") {
      return Response.json(loginEmail ? { id: "user-1", email: loginEmail, user_metadata: {} } : {}, { status: loginEmail ? 200 : 401 });
    }
    if (url.pathname === "/rest/v1/class_enrollments") {
      const email = String(url.searchParams.get("email") || "").replace(/^eq\./, "");
      return Response.json((enrollments[email] || []).map((book_code) => ({ book_code })));
    }
    if (url.pathname === "/rest/v1/class_verifications" && init.method === "POST") {
      const rows = JSON.parse(init.body || "[]");
      for (const row of rows) {
        if (!verificationRows.some((current) => current.email === row.email && current.book_code === row.book_code)) {
          verificationRows.push(row);
        }
      }
      return Response.json(rows, { status: 201 });
    }
    if (url.pathname === "/rest/v1/class_verifications") {
      const emailFilter = String(url.searchParams.get("email") || "").replace(/^eq\./, "");
      const enrollmentFilter = String(url.searchParams.get("enrollment_email") || "").replace(/^eq\./, "");
      const rows = verificationRows.filter((row) => (
        (!emailFilter || row.email === emailFilter)
        && (!enrollmentFilter || row.enrollment_email === enrollmentFilter)
      ));
      return Response.json(rows);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return { fetchMock, verificationRows, calls };
}

async function callRoute(path, body, fetchMock, accessToken = "") {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const response = await worker.fetch(new Request(`https://api.test${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://class-new.literstella.co.kr",
        ...(accessToken ? { "X-User-Token": accessToken } : {}),
      },
      body: JSON.stringify(body),
    }), env);
    return { status: response.status, body: await response.json() };
  } finally {
    globalThis.fetch = previousFetch;
  }
}

{
  const email = "anne-reader@example.com";
  const code = "123456";
  const api = mockSupabase({ enrollments: { [email]: ["anne"] } });
  const result = await callRoute("/api/class/verify-otp", {
    email,
    code,
    token: await signedToken(email, code),
    book: "all",
  }, api.fetchMock);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, granted: ["anne"] });
}

{
  const email = "anne-reader@example.com";
  const code = "123456";
  const api = mockSupabase({ enrollments: { [email]: ["anne"] } });
  const result = await callRoute("/api/class/verify-otp", {
    email,
    code,
    token: await signedToken(email, code),
    book: "kidari",
  }, api.fetchMock);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.notEnrolled, true);
  assert.deepEqual(result.body.granted, ["anne"]);
}

{
  const email = "legacy-reader@hanmail.net";
  const sourceEmail = "legacy-reader@daum.net";
  const code = "654321";
  const api = mockSupabase({ enrollments: { [sourceEmail]: ["kidari"] } });
  const result = await callRoute("/api/class/verify-otp", {
    email,
    code,
    token: await signedToken(email, code),
    book: "all",
  }, api.fetchMock);
  assert.equal(result.body.ok, true);
  assert.equal(api.verificationRows[0].enrollment_email, sourceEmail);
  assert.equal(api.calls.some((call) => call.url.includes("legacy-reader%40daum.net")), true);
}

{
  const loginEmail = "new-login@example.com";
  const inputEmail = "legacy-owner@hanmail.net";
  const sourceEmail = "legacy-owner@daum.net";
  const code = "112233";
  const api = mockSupabase({ enrollments: { [sourceEmail]: ["pride"] }, loginEmail });
  const result = await callRoute("/api/class/link-enrollment", {
    email: inputEmail,
    code,
    token: await signedToken(inputEmail, code),
    book: "all",
  }, api.fetchMock, "valid-test-jwt");
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.granted, ["pride"]);
  assert.deepEqual(api.verificationRows[0], {
    email: loginEmail,
    book_code: "pride",
    enrollment_email: sourceEmail,
  });
}

console.log("secure-api class-enrollment-access-test: all assertions passed");
