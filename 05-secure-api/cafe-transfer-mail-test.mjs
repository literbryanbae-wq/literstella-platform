import assert from "node:assert/strict";
import { cafeDecisionEmailPatch, cafeMailResult } from "./src/cafe-transfer-mail.mjs";

const sent = cafeMailResult({ providerResult: "email-123" });
assert.deepEqual(sent, { ok: true, status: "sent", id: "email-123", error: null });

const suppressed = cafeMailResult({ providerResult: null, suppressed: true });
assert.deepEqual(suppressed, { ok: false, status: "suppressed", id: null, error: "recipient_suppressed" });

const failed = cafeMailResult({ providerResult: false });
assert.deepEqual(failed, { ok: false, status: "failed", id: null, error: "send_failed" });

assert.deepEqual(
  cafeDecisionEmailPatch({ kind: "approved", result: sent, attemptedAt: "2026-09-03T00:00:00Z", previousAttempts: 2 }),
  {
    decision_email_kind: "approved",
    decision_email_status: "sent",
    decision_email_id: "email-123",
    decision_email_error: null,
    decision_email_attempted_at: "2026-09-03T00:00:00Z",
    decision_email_attempts: 3,
    approved_email_id: "email-123",
  },
);

const blockedPatch = cafeDecisionEmailPatch({ kind: "needinfo", result: suppressed, attemptedAt: "2026-09-03T00:00:00Z" });
assert.equal(blockedPatch.decision_email_status, "suppressed");
assert.equal(blockedPatch.decision_email_id, null);
assert.equal("approved_email_id" in blockedPatch, false);

console.log("cafe-transfer-mail-test: ok");
