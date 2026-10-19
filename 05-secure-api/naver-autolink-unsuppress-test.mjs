// 수강권 자동 연결(네이버) · 차단 자동 해제 · 이전 신청 코드 — 계약 (2026-10-19)
//   운영자 "기존 메일 인증 안될 때 … 메일이 안 오는 것 같은데 점검해" 로 찾은 세 구멍:
//   ① 네이버 로그인 회원은 겉모양이 이메일 가입이라 자동 연결에서 빠졌다(17명·44강좌)
//   ② 차단 자동 해제가 'suppressed' 기록(차단의 결과)을 반송으로 세어 90일 동안 구제하지 않았다(110명)
//   ③ 이전 신청 코드 발송은 자동 해제를 아예 시도하지 않았다
//   실행: node --test naver-autolink-unsuppress-test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { classEmailRecoveryRoute } from './src/class-email-recovery.mjs';

const src = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slice = (startMarker, endMarker) => {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.ok(a >= 0 && b > a, `slice ${startMarker}`);
  return src.slice(a, b);
};

// ── ① 자동 연결 ──────────────────────────────────────────────────────────
const autoLinkSrc = slice('async function classAutoLink(req, env, cors) {', '// POST /api/class/link-precheck');
const makeAutoLink = (deps) => new Function('requireUser', 'json', 'sbFetch', 'normEmail', 'console', `${autoLinkSrc}; return classAutoLink;`)(
  deps.requireUser, (data, status) => ({ data, status }), deps.sbFetch, (e) => String(e || '').trim().toLowerCase(), { log() {} });
function linkFixture(user) {
  const calls = [];
  const sbFetch = async (_env, path, init) => {
    calls.push({ path, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
    if (path.startsWith('class_enrollments')) return { ok: true, json: async () => [{ book_code: 'pride' }, { book_code: 'theory' }] };
    return { ok: true, json: async () => [] };
  };
  return { calls, run: () => makeAutoLink({ requireUser: async () => user, sbFetch })({}, {}, {}) };
}

test('네이버가 확인한 이메일(app_metadata 표식 = 로그인 이메일)이면 카카오·구글처럼 자동 연결', async () => {
  const f = linkFixture({ id: 'u', email: 'by_anise@naver.com', providers: ['email'], naverEmail: 'by_anise@naver.com' });
  const r = await f.run();
  assert.deepEqual(r.data.linked, ['pride', 'theory']);
  const ins = f.calls.find((c) => c.method === 'POST');
  assert.deepEqual(ins.body.map((x) => x.enrollment_email), ['by_anise@naver.com', 'by_anise@naver.com']);
});
test('표식이 없는 이메일 가입 계정은 그대로 자동 연결 안 함(가입 이메일 확인이 증거가 아니다)', async () => {
  const f = linkFixture({ id: 'u', email: 'someone@naver.com', providers: ['email'], naverEmail: '' });
  const r = await f.run();
  assert.equal(r.data.reason, 'not_social');
  assert.equal(f.calls.length, 0);
});
test('표식 이메일이 로그인 이메일과 다르면 연결 안 함', async () => {
  const f = linkFixture({ id: 'u', email: 'victim@naver.com', providers: ['email'], naverEmail: 'attacker@naver.com' });
  assert.equal((await f.run()).data.reason, 'not_social');
});
test('카카오·구글은 예전 그대로', async () => {
  const f = linkFixture({ id: 'u', email: 'a@kakao.com', providers: ['kakao'], naverEmail: '' });
  assert.deepEqual((await f.run()).data.linked, ['pride', 'theory']);
});
test('requireUser 가 표식을 app_metadata 에서만 읽는다(회원이 고칠 수 있는 user_metadata 아님)', () => {
  const ru = slice('async function requireUser(req, env) {', '// ── Supabase REST');
  assert.match(ru, /naverEmail: typeof am\.naver_email === "string" \? am\.naver_email\.toLowerCase\(\) : ""/);
  assert.match(ru, /const am = u\.app_metadata/);
});

// ── ② 차단 자동 해제의 반송 판정 ─────────────────────────────────────────
test("자동 해제는 'suppressed' 기록을 반송으로 세지 않는다(진짜 반송만 막는다)", () => {
  const fn = slice('async function tryAutoUnsuppress(env, email, lane) {', '// 차단 주소가 인증 코드를 시도했다');
  assert.match(fn, /email_bounces\?email=eq\.\$\{encodeURIComponent\(email\)\}&occurred_at=gte\.\$\{encodeURIComponent\(since\)\}&event=neq\.suppressed&select=id&limit=1/);
});

// ── ③ 이전 신청 코드 발송 ────────────────────────────────────────────────
function recoveryFixture({ suppressed = false, unsuppress } = {}) {
  const mailed = [];
  const env = { OTP_SECRET: 's', OTP_GUARD: {}, AUTH_EMAIL_SERVICE: {}, OTP_SEND_LIMIT: { limit: async () => ({ success: true }) } };
  const deps = {
    json: (data, status) => Response.json(data, { status }), requireUser: async () => ({ id: 'u', email: 'by_anise@naver.com' }),
    hmacHex: async () => 'sig', timingSafeEq: (a, b) => a === b, sha256Hex: async (m) => m,
    otpGuardIssue: async () => {}, otpGuardConsume: async () => null, otpGuardBurn: async () => {},
    isEmailSuppressed: async () => suppressed,
    sendResendEmail: async (_e, p) => { mailed.push(p); return true; },
    otpEmailHtml: (c) => c, findClassEnrollments: async () => ({ ok: true, records: [] }), sbFetch: async () => Response.json([]),
  };
  if (unsuppress !== undefined) deps.tryAutoUnsuppress = unsuppress;
  const send = async () => {
    const res = await classEmailRecoveryRoute(new Request('https://api.test/api/class/email-recovery/send', { method: 'POST', body: JSON.stringify({ claimedEmail: 'by_anise@naver.com' }) }), env, {}, deps);
    return { status: res.status, ...(await res.json()) };
  };
  return { mailed, send };
}
test('이전 신청: 차단돼 있어도 자동 해제가 되면 코드를 보낸다', async () => {
  const f = recoveryFixture({ suppressed: true, unsuppress: async () => true });
  const r = await f.send();
  assert.equal(r.ok, true); assert.equal(f.mailed.length, 1); assert.equal(f.mailed[0].to, 'by_anise@naver.com');
});
test('이전 신청: 자동 해제가 안 되면(진짜 반송·이미 한 번 풂) suppressed — 메일 0', async () => {
  const f = recoveryFixture({ suppressed: true, unsuppress: async () => false });
  const r = await f.send();
  assert.equal(r.error, 'suppressed'); assert.equal(f.mailed.length, 0);
});
test('이전 신청: 자동 해제 함수를 못 받으면 예전처럼 suppressed', async () => {
  const f = recoveryFixture({ suppressed: true });
  assert.equal((await f.send()).error, 'suppressed');
});
test('이전 신청: 차단이 아니면 자동 해제를 부르지 않는다', async () => {
  let called = 0;
  const f = recoveryFixture({ suppressed: false, unsuppress: async () => { called += 1; return true; } });
  assert.equal((await f.send()).ok, true); assert.equal(called, 0);
});
test('운영 라우터가 이전 신청 경로에 자동 해제 함수를 넘긴다', () => {
  assert.match(src, /classEmailRecoveryRoute\(req, env, cors, \{[\s\S]{0,400}isEmailSuppressed, tryAutoUnsuppress, sendResendEmail/);
});
