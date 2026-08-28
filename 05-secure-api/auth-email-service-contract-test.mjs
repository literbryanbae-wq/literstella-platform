import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [source, config] = await Promise.all([
  readFile(new URL("./src/index.js", import.meta.url), "utf8"),
  readFile(new URL("./wrangler.jsonc", import.meta.url), "utf8"),
]);

assert.match(config, /"binding"\s*:\s*"AUTH_EMAIL_SERVICE"/);
assert.match(config, /"service"\s*:\s*"literstella-reading-diagnosis"/);
assert.match(config, /"entrypoint"\s*:\s*"AuthEmailService"/);

assert.match(source, /env\.AUTH_EMAIL_SERVICE\.sendCriticalEmail\(/);
assert.match(source, /env\.AUTH_EMAIL_SERVICE\.getSuppressionStatus\(/);
assert.match(source, /env\.AUTH_EMAIL_SERVICE\.removeSuppression\(/);
assert.match(source, /authMailerBound:\s*Boolean\(env\.AUTH_EMAIL_SERVICE\)/);

for (const marker of [
  "[리터스텔라] 관리자 인증 코드",
  "[리터스텔라] 이메일 인증 코드",
  "[리터스텔라] 백업 이메일 인증 코드",
  "[수강 연결 신청]",
  "[카페 수강 연결]",
]) {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `missing critical email marker ${marker}`);
  assert.match(source.slice(at, at + 1400), /lane:\s*"auth"/, `${marker} must use auth lane`);
}

assert.match(source, /sendEmail:\s*\(emailEnv, message\)\s*=>\s*sendResendEmail\(emailEnv,\s*\{\s*\.\.\.message, lane: "auth" \}\)/);
assert.match(source, /isEmailSuppressed:\s*\(emailEnv, email\)\s*=>\s*isEmailSuppressed\(emailEnv, email, "auth"\)/);

console.log("auth email service contract: PASS (14 assertions)");
