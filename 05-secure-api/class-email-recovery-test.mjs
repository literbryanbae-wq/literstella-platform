import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import { classEmailRecoveryRoute, recoveryMessage } from './src/class-email-recovery.mjs';

function fixture() {
  const state = { user: { id: 'user-a', email: 'new@example.test' }, mailed: [], issued: new Set(), burned: [], calls: [], receipt: [], records: [{ bookCode: 'anne', enrollmentEmail: 'old@example.test' }], save: { ok: true, id: 'request-a', status: 'pending' } };
  const env = { OTP_SECRET: 'test-only-secret', OTP_GUARD: {}, AUTH_EMAIL_SERVICE: {}, OTP_SEND_LIMIT: { limit: async () => ({ success: true }) }, ADMIN_EMAIL: 'admin@example.test' };
  const deps = {
    json: (data, status) => Response.json(data, { status }), requireUser: async () => state.user,
    hmacHex: async (key, msg) => createHmac('sha256', key).update(msg).digest('hex'),
    timingSafeEq: (a, b) => a === b,
    sha256Hex: async (msg) => createHash('sha256').update(msg).digest('hex'),
    otpGuardIssue: async (_, token) => state.issued.add(token),
    otpGuardConsume: async (_, token) => state.issued.has(token) ? null : { error: 'already_used' },
    otpGuardBurn: async (_, token) => { state.issued.delete(token); state.burned.push(token); },
    isEmailSuppressed: async () => false,
    sendResendEmail: async (_, payload) => { state.mailed.push(payload); return true; },
    otpEmailHtml: (code) => code,
    findClassEnrollments: async () => ({ ok: true, records: state.records }),
    sbFetch: async (_, path, init) => { state.calls.push({ path, body: init?.body && JSON.parse(init.body) }); return Response.json(path.startsWith('rpc/') ? state.save : state.receipt); },
  };
  const body = { claimedEmail: 'old@example.test', name: 'Fixture User', phone: '01012345678', courses: 'Anne' };
  const call = async (action, value = body, method = 'POST') => {
    const res = await classEmailRecoveryRoute(new Request(`https://api.test/api/class/email-recovery/${action}`, { method, ...(method === 'POST' ? { body: JSON.stringify(value) } : {}) }), env, {}, deps);
    return { status: res.status, ...await res.json() };
  };
  const issue = async () => { const sent = await call('send'); return { ...body, token: sent.token, code: state.mailed[0]?.html }; };
  return { state, env, deps, body, call, issue };
}

test('non-object JSON is rejected without mail or writes', async () => {
  const f = fixture();
  for (const value of [null, [], 'invalid', 42]) assert.equal((await f.call('send', value)).error, 'bad_json');
  assert.equal(f.state.mailed.length, 0); assert.equal(f.state.calls.length, 0);
});
test('only current signed-in inbox receives a purpose-bound auth email', async () => {
  const f = fixture(); const token = await f.issue();
  assert.equal(f.state.mailed[0].to, f.state.user.email);
  assert.equal(f.state.mailed[0].lane, 'auth');
  assert.equal(token.code.length, 6);
  const exp = Number(token.token.split('.')[0]);
  assert.equal(token.token.split('.')[1], await f.deps.hmacHex(f.env.OTP_SECRET, recoveryMessage(f.state.user, f.body.claimedEmail, token.code, exp)));
});
test('anonymous and missing mail/OTP bindings fail closed', async () => {
  const f = fixture(); f.state.user = null; assert.equal((await f.call('send')).status, 401);
  const g = fixture(); delete g.env.AUTH_EMAIL_SERVICE; assert.equal((await g.call('send')).status, 503);
  assert.equal(g.state.mailed.length, 0);
});
test('throttled, broken rate limiter and suppressed address do not send', async () => {
  const f = fixture(); f.env.OTP_SEND_LIMIT.limit = async () => ({ success: false }); assert.equal((await f.call('send')).status, 429);
  f.env.OTP_SEND_LIMIT.limit = async () => { throw new Error('down'); }; assert.equal((await f.call('send')).status, 502);
  const g = fixture(); g.deps.isEmailSuppressed = async () => true; assert.equal((await g.call('send')).error, 'suppressed');
  assert.equal(f.state.mailed.length + g.state.mailed.length, 0);
});
test('failed email delivery never returns an issued token', async () => {
  const f = fixture(); f.deps.sendResendEmail = async () => false;
  const result = await f.call('send'); assert.equal(result.error, 'send_failed'); assert.equal(result.token, undefined); assert.equal(f.state.issued.size, 0);
});
for (const change of ['uid', 'email', 'legacy', 'code', 'purpose', 'expiry']) test(`reject changed ${change} without saving or granting`, async () => {
  const f = fixture(); const payload = await f.issue();
  if (change === 'uid') f.state.user.id = 'user-b';
  if (change === 'email') f.state.user.email = 'different@example.test';
  if (change === 'legacy') payload.claimedEmail = 'victim@example.test';
  if (change === 'code') payload.code = payload.code === '000000' ? '111111' : '000000';
  if (change === 'purpose') { const exp = Number(payload.token.split('.')[0]); payload.token = `${exp}.${await f.deps.hmacHex(f.env.OTP_SECRET, `code:new@example.test:${payload.code}:${exp}`)}`; f.state.issued.add(payload.token); }
  if (change === 'expiry') payload.token = `1.${payload.token.split('.')[1]}`;
  assert.equal((await f.call('submit', payload)).ok, false);
  assert.equal(f.state.calls.filter((x) => x.path.startsWith('rpc/')).length, 0);
});
test('new-email proof alone cannot invent a legacy enrollment', async () => {
  const f = fixture(); const payload = await f.issue(); f.state.records = [];
  assert.equal((await f.call('submit', payload)).error, 'legacy_record_not_found'); assert.equal(f.state.burned.length, 0);
});
test('password prerequisite is enforced by server and valid token survives retry', async () => {
  const f = fixture(); const payload = await f.issue(); f.state.save = { ok: false, error: 'password_required' };
  assert.equal((await f.call('submit', payload)).error, 'password_required'); assert.equal(f.state.burned.length, 0);
});
test('DB failure preserves proof; successful submission queues review only', async () => {
  const f = fixture(); const payload = await f.issue(); const original = f.deps.sbFetch;
  f.deps.sbFetch = async (_, path, init) => path.startsWith('rpc/') ? new Response('', { status: 503 }) : original(_, path, init);
  assert.equal((await f.call('submit', payload)).error, 'save_failed'); assert.equal(f.state.burned.length, 0);
  f.deps.sbFetch = original; assert.equal((await f.call('submit', payload)).status, 'pending');
  assert.equal(f.state.burned.length, 1);
  assert.equal(f.state.calls.some((x) => x.path.startsWith('class_verifications')), false);
  assert.equal(f.state.calls.find((x) => x.path.startsWith('rpc/')).body.p_user, 'user-a');
});
test('lost response can be retried from receipt without sending twice', async () => {
  const f = fixture(); const payload = await f.issue(); await f.call('submit', payload);
  f.state.receipt = [{ id: 'request-a', status: 'pending', claimed_email: f.body.claimedEmail }];
  assert.equal((await f.call('submit', payload)).already, true); assert.equal(f.state.mailed.length, 2);
});
test('arbitrary body identity and enrollment records are ignored', async () => {
  const f = fixture(); const payload = await f.issue(); await f.call('submit', { ...payload, auth_uid: 'victim', email: 'victim@example.test', records: [{ bookCode: 'pride' }], emailVerifiedAt: 'forged' });
  const saved = f.state.calls.find((x) => x.path.startsWith('rpc/')).body;
  assert.equal(saved.p_email, 'new@example.test'); assert.deepEqual(saved.p_payload.records, f.state.records);
});
