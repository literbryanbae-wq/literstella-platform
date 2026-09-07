// 라이프사이클 메일 멱등 계약 테스트 (2026-09-08). 실행: node lifecycle-idempotency-test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { lifecycleMailKey, lifecycleClaimDecision, LIFECYCLE_STALE_MS } from "./src/lifecycle-idempotency.js";

// ── 순수 헬퍼
assert.equal(lifecycleMailKey("day30", { nickname: "x" }), "day30");
assert.equal(lifecycleMailKey("finish", { book: "빨강머리 앤" }), "finish:빨강머리-앤");
assert.equal(lifecycleMailKey("finish", { book: "  The Great Gatsby! " }), "finish:the-great-gatsby");
assert.equal(lifecycleMailKey("finish", {}), "finish", "대상 없으면 키만(빈 세그먼트 금지)");
assert.equal(lifecycleMailKey("milestoneReport", { milestone: 66 }), "milestoneReport:66");
assert.equal(lifecycleMailKey("tellaUpgrade", { toStage: "mate" }), "tellaUpgrade:mate");
assert.ok(lifecycleMailKey("finish", { book: "a".repeat(200) }).length <= 7 + 60, "길이 상한");

const now = Date.now();
assert.deepEqual(lifecycleClaimDecision(null, now), { action: "send" });
assert.deepEqual(lifecycleClaimDecision({ status: "sent" }, now), { action: "skip", reason: "sent" });
assert.deepEqual(lifecycleClaimDecision({ status: "sealed" }, now), { action: "skip", reason: "sealed" });
assert.deepEqual(lifecycleClaimDecision({ status: "failed" }, now), { action: "reclaim", from: "failed" });
assert.deepEqual(lifecycleClaimDecision({ status: "suppressed" }, now), { action: "reclaim", from: "suppressed" });
assert.deepEqual(lifecycleClaimDecision({ status: "sending", claimed_at: new Date(now - 1000).toISOString() }, now), { action: "skip", reason: "in_progress" });
assert.deepEqual(lifecycleClaimDecision({ status: "sending", claimed_at: new Date(now - LIFECYCLE_STALE_MS - 1).toISOString() }, now), { action: "reclaim", from: "sending" });
assert.deepEqual(lifecycleClaimDecision({ status: "weird" }, now), { action: "skip", reason: "unknown_status" });

// ── 배선(소스 계약): 옵트아웃은 claim 을 소모하지 않고, claim 뒤에 suppression 조회, Resend Idempotency-Key, 결과 되쓰기
const src = fs.readFileSync(new URL("./src/index.js", import.meta.url), "utf8");
assert.match(src, /import \{ lifecycleMailKey, lifecycleClaimDecision \} from "\.\/lifecycle-idempotency\.js"/);
const fnStart = src.indexOf("async function lifecycleEmail(");
assert.ok(fnStart > 0);
const fnEnd = src.indexOf("\n}\n", fnStart);
const fn = src.slice(fnStart, fnEnd);
const idx = (s) => { const i = fn.indexOf(s); assert.ok(i >= 0, `lifecycleEmail 에 없음: ${s}`); return i; };
assert.ok(idx('skipped: "opted_out"') < idx("lifecycleClaim(env, to, mailKey)"), "옵트아웃 스킵은 claim 보다 먼저(동의 OFF 는 claim 을 소모하지 않는다)");
assert.ok(idx("lifecycleClaim(env, to, mailKey)") < idx("isEmailSuppressed(env, to)"), "claim 뒤 suppression 사전조회");
assert.ok(idx("isEmailSuppressed(env, to)") < idx('idempotencyKey: `lifecycle:${mailKey}:${to}`'), "발송에 Resend Idempotency-Key");
assert.match(fn, /status: "sent"/);
assert.match(fn, /status: "failed"/);
assert.match(fn, /status: "suppressed"/);
assert.match(src, /lifecycle_mail_sends\?on_conflict=email,mail_key/, "원자 claim = insert … on_conflict ignore-duplicates");
assert.match(src, /resolution=ignore-duplicates/);
assert.match(src, /&status=eq\.\$\{encodeURIComponent\(row\.status\)\}/, "재claim 은 status 조건부 PATCH(CAS)");
console.log("lifecycle-idempotency-test: OK");
