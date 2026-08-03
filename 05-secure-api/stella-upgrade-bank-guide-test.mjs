// 계좌이체 입금 안내 메일 경로 테스트.
//   ① 신청자에게 안내 메일이 나가고 입금자명이 신청 행에 남는가
//   ② 같은 신청에 두 번 호출해도 다시 보내지 않는가(멱등)
//   ③ 🔴 마이그레이션 전(신규 컬럼 없음)에도 관리자 알림이 죽지 않는가
//      — 워커를 SQL보다 먼저 배포해도 안전해야 한다(배포 순서 함정 제거).
import assert from "node:assert/strict";
import { stellaUpgradeEmailRoute } from "./src/stella-upgrade-email-service.mjs";

const requestId = "44444444-4444-4444-8444-444444444444";
const member = { id: "55555555-5555-4555-8555-555555555555", email: "buyer@class-new.test" };
const env = { ADMIN_EMAIL: "owner@example.com" };

const baseRow = {
  id: requestId,
  user_id: member.id,
  email: member.email,
  liveklass_id: "buyer@liveklass.test",
  owned_books: ["kidari", "anne", "pride", "littlewomen1", "littlewomen2", "theory", "sherlock"],
  missing_books: ["gatsby"],
  owned_count: 7,
  base_amount: 398000,
  coupon_amount: 350000,
  payable_amount: 45600,
  payment_method: "bank_transfer",
  cash_receipt_number: "01012345678",
  status: "pending",
  coupon_code: null,
  admin_notified_at: null,
  coupon_emailed_at: null,
  coupon_email_recipient_count: null,
  depositor_name: null,
  bank_guide_emailed_at: null,
};

function response(value, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// depositColumnsExist=false → 신규 컬럼을 요청하면 PostgREST가 내는 400을 흉내낸다.
function makeHarness({ depositColumnsExist }) {
  let row = { ...baseRow };
  if (!depositColumnsExist) { delete row.depositor_name; delete row.bank_guide_emailed_at; }
  const sentEmails = [];
  const patches = [];

  const sbFetch = async (_env, path, init = {}) => {
    if (path.startsWith("stella_upgrade_requests?") && !init.method) {
      if (!depositColumnsExist && path.includes("depositor_name")) {
        return response({ message: 'column "depositor_name" does not exist' }, 400);
      }
      return response([row]);
    }
    if (path.startsWith("stella_upgrade_requests?") && init.method === "PATCH") {
      const patch = JSON.parse(init.body);
      patches.push(patch);
      row = { ...row, ...patch };
      return response(null, 204);
    }
    return response({ error: `unhandled ${path}` }, 500);
  };

  const deps = {
    json: (value, status, cors) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...(cors || {}) } }),
    requireUser: async () => member,
    sbFetch,
    sendEmail: async (_env, payload) => { sentEmails.push(payload); return true; },
    brandEmailHtml: (body) => `<html>${body}</html>`,
  };

  const call = async (body) => {
    const request = new Request("https://api.example.test/api/stella-upgrade/request-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Token": "t" },
      body: JSON.stringify(body),
    });
    const result = await stellaUpgradeEmailRoute(request, env, {}, "request-notify", deps);
    return { status: result.status, body: await result.json() };
  };

  return { call, sentEmails, patches, current: () => row };
}

// ── ① 정상 경로 ────────────────────────────────────────────────
{
  const h = makeHarness({ depositColumnsExist: true });
  const res = await h.call({ requestId, depositorName: "홍길동" });
  assert.equal(res.status, 200, "신청 알림 200");

  const guide = h.sentEmails.find((mail) => mail.idempotencyKey === `stella-bank-guide/${requestId}`);
  assert.ok(guide, "입금 안내 메일이 발송돼야 한다");
  assert.equal(guide.to, member.email, "수신자 = 신청한 class-new 계정");
  assert.ok(guide.subject.includes("45,600원"), `제목에 입금 금액: ${guide.subject}`);
  assert.ok(guide.html.includes("45,600원"), "본문에 입금 금액");
  assert.ok(guide.html.includes("홍길동"), "본문에 입금자명");
  assert.ok(guide.html.includes("302-2142-9005-61"), "본문에 계좌번호");
  assert.ok(!guide.html.includes("undefined"), "본문에 undefined 없음");
  assert.equal(h.current().depositor_name, "홍길동", "입금자명이 신청 행에 기록");
  assert.ok(h.current().bank_guide_emailed_at, "발송 시각 기록");

  const adminMail = h.sentEmails.find((mail) => mail.to === env.ADMIN_EMAIL);
  assert.ok(adminMail, "관리자 알림도 함께 발송");

  // ── ② 멱등 ──
  const before = h.sentEmails.length;
  const again = await h.call({ requestId, depositorName: "홍길동" });
  assert.equal(again.body.alreadySent, true, "두 번째 호출은 이미 보냄");
  assert.equal(h.sentEmails.length, before, "안내 메일이 다시 나가면 안 된다");
  console.log("① 안내 메일 발송·기록 · ② 멱등 — 통과");
}

// ── ③ 마이그레이션 전에도 관리자 알림은 살아 있어야 한다 ──────────
{
  const h = makeHarness({ depositColumnsExist: false });
  const res = await h.call({ requestId, depositorName: "홍길동" });
  assert.equal(res.status, 200, "컬럼이 없어도 관리자 알림은 200이어야 한다(503 아님)");
  assert.ok(h.sentEmails.some((mail) => mail.to === env.ADMIN_EMAIL), "관리자 알림 발송");
  assert.ok(!h.sentEmails.some((mail) => mail.idempotencyKey?.startsWith("stella-bank-guide/")), "컬럼 없으면 안내 메일은 보류");
  assert.ok(!h.patches.some((patch) => "depositor_name" in patch), "없는 컬럼에 PATCH 시도 안 함");
  console.log("③ 마이그레이션 전 배포 안전 — 통과");
}

console.log("stella-upgrade bank guide: all assertions passed");
