import test from 'node:test';
import assert from 'node:assert/strict';
import { englishPremiumStatus } from './src/growth-panel-service.mjs';
const request = () => new Request('https://api.test/api/growth-panel/status', { headers: { 'X-User-Token': 'fixture' } });
const result = panelPremium => ({ member: { eligible: true, panelPremium } });
test('confirmed panel grant opens access without touching ownership or enrollment', async () => {
  assert.deepEqual(await englishPremiumStatus(request(), { CLASS_GATE: { fetch() { throw Error('must not call'); } } }, result(true)),
    { policy: 'english-premium-v1', eligible: true, source: 'panel' });
});
test('one-book eligibility and submitted status alone never grant access', async () => {
  const env = { CLASS_GATE: { fetch: async req => {
    assert.equal(req.headers.get('Authorization'), 'Bearer fixture');
    assert.equal(req.method, 'POST'); assert.equal(await req.text(), '{}');
    return Response.json({ eligible: false });
  } } };
  assert.deepEqual(await englishPremiumStatus(request(), env, { ...result(false), application: { status: 'submitted' } }),
    { policy: 'english-premium-v1', eligible: false, source: null });
});
test('existing ownership survives panel withdrawal and a closed campaign', async () => {
  const env = { CLASS_GATE: { fetch: async () => Response.json({ eligible: true }) } };
  assert.deepEqual(await englishPremiumStatus(request(), env, { ...result(false), campaign: { open: false }, application: { status: 'withdrawn' } }),
    { policy: 'english-premium-v1', eligible: true, source: 'ownership' });
});
test('provider failures, oversized replies, absent binding/token stay unknown', async () => {
  for (const fetch of [async () => { throw Error('offline'); }, async () => Response.json({ eligible: 'true' }),
    async () => Response.json({ eligible: true }, { status: 403 }), async () => Response.json({ padding: 'x'.repeat(20000), eligible: true })]) {
    assert.equal((await englishPremiumStatus(request(), { CLASS_GATE: { fetch } }, result(false))).eligible, null);
  }
  assert.equal((await englishPremiumStatus(request(), {}, result(false))).eligible, null);
  assert.equal((await englishPremiumStatus(new Request('https://api.test'), {}, result(false))).eligible, null);
});
test('hung ownership request is bounded', async () => {
  assert.equal((await englishPremiumStatus(request(), { CLASS_GATE: { fetch: () => new Promise(() => {}) } }, result(false), 10)).eligible, null);
});
