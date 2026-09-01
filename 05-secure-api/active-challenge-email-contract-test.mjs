import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./src/index.js", import.meta.url), "utf8");

assert.match(source, /ACTIVE_CHALLENGE_NOTICE_CAMPAIGN = "active-challenge-continue-20260901-v1"/);
assert.match(source, /enrollments\?season_id=eq\.\$\{ACTIVE_CHALLENGE_NOTICE_SEASON\}&is_yanawan=eq\.true&status=eq\.active/);
assert.match(source, /check_ins\?season_id=eq\.\$\{ACTIVE_CHALLENGE_NOTICE_SEASON\}/);
assert.match(source, /email_prefs\?lifecycle=eq\.false/);
assert.match(source, /email_unsub_log\?channel=in\.\(lifecycle,all\)/);
assert.match(source, /event\.eq\.suppressed,bounce_type\.eq\.Permanent/);
assert.match(source, /"Idempotency-Key": `\$\{campaignKey\}-batch-/);
assert.match(source, /\["dry", "test", "send"\]\.includes\(mode\)/);
assert.match(source, /channel: "lifecycle", campaignKey: ACTIVE_CHALLENGE_NOTICE_CAMPAIGN/);
assert.match(source, /path === "\/api\/admin\/send-active-challenge-notice"/);
assert.doesNotMatch(source, /sendActiveChallengeNotice[\s\S]{0,500}b\.to/);

console.log("active challenge email contract: PASS");
