// 챌린지 도전 카드 결제(클래스 결제 상점 위젯) — 준비·승인·서버 등록·멱등·위조 방어(운영자 2026-11-09).
import assert from "node:assert/strict";
import worker from "./src/index.js";
import { challengeIntent, intentFits, kstToday, CHALLENGE_CARD_PRICES } from "./src/challenge-card-checkout.mjs";

const env = {
  ALLOWED_ORIGINS: "https://challenge.literstella.co.kr",
  PAYMENT_ENABLED: "true",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  TOSS_CLASS_SECRET_KEY: "live_gsk_example",
  // 다이렉트 키(TOSS_SECRET_KEY)는 일부러 없다 — 챌린지 카드 결제가 그 키에 기대지 않는지 본다.
};
const AUTH = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const SEASON = "yanawan-2607";
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1; };

const state = { payments: new Map(), enrollment: null, confirmCalls: 0, failEnrollOnce: false, tossAuth: [] };
const fetchMock = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = init.method || "GET";
  if (url.hostname === "test.supabase.co" && url.pathname === "/auth/v1/user") {
    const tok = (init.headers?.Authorization || "").replace("Bearer ", "");
    if (tok === "member-token") return Response.json({ id: AUTH, email: "reader@example.com", app_metadata: {}, email_confirmed_at: "x" });
    return new Response("{}", { status: 401 });
  }
  if (url.hostname === "test.supabase.co" && url.pathname === "/rest/v1/users") {
    return Response.json(url.searchParams.get("auth_uid") === `eq.${AUTH}` ? [{ id: MEMBER }] : []);
  }
  if (url.hostname === "test.supabase.co" && url.pathname === "/rest/v1/enrollments") {
    if (method === "GET") return Response.json(state.enrollment ? [state.enrollment] : []);
    if (state.failEnrollOnce) { state.failEnrollOnce = false; return new Response("{}", { status: 500 }); }
    const body = JSON.parse(init.body);
    if (method === "POST") {
      if (state.enrollment) return Response.json([], { status: 201 });
      state.enrollment = { goal_days: body.goal_days, status: body.status, start_date: body.start_date, user_id: body.user_id };
      return Response.json([state.enrollment], { status: 201 });
    }
    if (method === "PATCH") {
      const lt = url.searchParams.get("goal_days");
      if (!state.enrollment || (lt && !(state.enrollment.goal_days < Number(lt.replace("lt.", ""))))) return Response.json([]);
      Object.assign(state.enrollment, body);
      return Response.json([state.enrollment]);
    }
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
    state.confirmCalls += 1;
    state.tossAuth.push(init.headers.Authorization);
    const body = JSON.parse(init.body);
    return Response.json({ status: "DONE", totalAmount: body.amount, orderId: body.orderId });
  }
  throw new Error(`Unexpected fetch: ${method} ${url}`);
};

async function call(path, body, token) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const headers = { "Content-Type": "application/json", Origin: "https://challenge.literstella.co.kr" };
    if (token) headers["X-User-Token"] = token;
    const response = await worker.fetch(new Request(`https://api.test${path}`, { method: "POST", headers, body: JSON.stringify(body) }), env);
    return { status: response.status, body: await response.json() };
  } finally { globalThis.fetch = originalFetch; }
}

// ── 순수 검사
const today = kstToday();
ok(challengeIntent({ goalDays: 66, season: SEASON, mode: "new", startDate: today }).ok, "첫 신청");
ok(!challengeIntent({ goalDays: 50, season: SEASON, mode: "new", startDate: today }).ok, "없는 일수 거절");
ok(!challengeIntent({ goalDays: 66, season: "2607", mode: "new", startDate: today }).ok, "시즌 모양 검사");
ok(!challengeIntent({ goalDays: 66, season: SEASON, mode: "restart", startDate: "2020-01-01" }).ok, "새 도전 시작일은 오늘 ±1일만");
ok(challengeIntent({ goalDays: 66, season: SEASON, mode: "restart", startDate: today }).intent.ref === `enroll_pay:${SEASON}:66:${today}`, "새 도전 꼬리 = 포인트 결제와 같은 모양");
ok(intentFits({ mode: "new" }, { goal_days: 30 }) === "enrollment_exists", "이미 도전 중이면 첫 신청 아님");
ok(intentFits({ mode: "extend", goalDays: 30 }, { goal_days: 66 }) === "cannot_extend", "줄이는 연장은 결제 전에 막는다(10-11 사고)");
ok(intentFits({ mode: "restart", goalDays: 66 }, null) === "enrollment_missing");
ok(CHALLENGE_CARD_PRICES[30] === 3000 && CHALLENGE_CARD_PRICES[66] === 5800 && CHALLENGE_CARD_PRICES[100] === 9800, "가격 = 챌린지 화면 가격표");

// ── 준비: 로그인 필수
const anon = await call("/api/payment/toss-prepare", { product: "challenge", goalDays: 66, season: SEASON, mode: "new", startDate: today });
ok(anon.status === 401 && anon.body.error === "login_required", "로그인 없이는 주문을 만들지 않는다");

const prepared = await call("/api/payment/toss-prepare", { product: "challenge", goalDays: 66, season: SEASON, mode: "new", startDate: today, amount: 1 }, "member-token");
ok(prepared.status === 200 && prepared.body.amount === 5800, "금액은 서버 가격표(보낸 amount 무시)");
ok(/^live_gck_/.test(prepared.body.clientKey) && prepared.body.customerKey === AUTH, "클래스 위젯 키 · 고객 키 = 로그인 계정");
const order = state.payments.get(prepared.body.orderId);
ok(order.status === "READY" && order.source === "toss:challenge-66" && order.raw.memberId === MEMBER, "주문과 등록할 내용을 먼저 저장");

// ── 승인: 금액 위조 · 클래스 키 · 서버 등록
const forged = await call("/api/payment/toss-confirm", { paymentKey: "pk-1", orderId: prepared.body.orderId, amount: 100 });
ok(forged.status === 400 && state.confirmCalls === 0, "금액이 다르면 토스를 부르지 않는다");

state.failEnrollOnce = true;
const first = await call("/api/payment/toss-confirm", { paymentKey: "pk-1", orderId: prepared.body.orderId, amount: 5800 });
ok(first.status === 202 && first.body.enrolled === false && state.confirmCalls === 1, "결제는 됐는데 등록 실패 → 202(확인 중)");
ok(state.tossAuth[0] === `Basic ${btoa("live_gsk_example:")}`, "클래스 상점 키로 승인");
ok(state.payments.get(prepared.body.orderId).status === "DONE", "결제 완료 기록");

const retry = await call("/api/payment/toss-confirm", { paymentKey: "pk-1", orderId: prepared.body.orderId, amount: 5800 });
ok(retry.status === 200 && retry.body.enrolled === true && state.confirmCalls === 1, "다시 부르면 토스는 안 부르고 등록만 다시");
ok(state.enrollment && state.enrollment.goal_days === 66 && state.enrollment.status === "active" && state.enrollment.user_id === MEMBER, "서버가 회원 id 로 도전을 등록");
ok(!!state.payments.get(prepared.body.orderId).raw.enrolledAt, "등록 시각 남김");

const again = await call("/api/payment/toss-confirm", { paymentKey: "pk-1", orderId: prepared.body.orderId, amount: 5800 });
ok(again.status === 200 && again.body.enrolled === true && state.confirmCalls === 1, "세 번째도 같은 결과(멱등)");

// ── 도전 중에 첫 신청·줄이기는 결제 전에 막는다
const dup = await call("/api/payment/toss-prepare", { product: "challenge", goalDays: 30, season: SEASON, mode: "new", startDate: today }, "member-token");
ok(dup.status === 409 && dup.body.error === "enrollment_exists");
const shrink = await call("/api/payment/toss-prepare", { product: "challenge", goalDays: 30, season: SEASON, mode: "extend" }, "member-token");
ok(shrink.status === 409 && shrink.body.error === "cannot_extend");

// ── 새 도전(끝난 뒤) — 시작일·목표를 새로 쓴다
const restart = await call("/api/payment/toss-prepare", { product: "challenge", goalDays: 100, season: SEASON, mode: "restart", startDate: today }, "member-token");
ok(restart.status === 200 && restart.body.amount === 9800);
const restarted = await call("/api/payment/toss-confirm", { paymentKey: "pk-2", orderId: restart.body.orderId, amount: 9800 });
ok(restarted.status === 200 && state.enrollment.goal_days === 100 && state.enrollment.start_date === today, "새 도전 = 오늘부터 100일");
ok(state.payments.get(restart.body.orderId).raw.ref === `enroll_pay:${SEASON}:100:${today}`, "배지 재지급 판정용 꼬리 기록");

// ── 클래스 주문 경로는 그대로(다이렉트 키 없으면 503)
const classOrder = await call("/api/payment/toss-prepare", { product: "class-classics-annual-8", email: "reader@example.com" });
ok(classOrder.status === 503 && classOrder.body.error === "toss_not_configured", "기존 클래스 다이렉트 경로는 손대지 않았다");

console.log(`challenge-card-checkout-test: ${n} passed`);
