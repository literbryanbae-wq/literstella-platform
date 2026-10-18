import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from './src/index.js';

const source = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const config = readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8');
assert.doesNotMatch(source, /portone|inicis|포트원|이니시스/i);
assert.doesNotMatch(config, /portone|inicis|포트원|이니시스/i);
assert.match(source, /async function verifySvixSignature/);
assert.match(source, /async function tossWebhook/);

const env = { PAYMENT_ENABLED: 'true', ALLOWED_ORIGINS: 'https://class-new.literstella.co.kr' };
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async () => { calls++; throw new Error('Retired routes must not call any external service'); };
try {
  for (const path of [
    '/api/identity/verify', '/api/payment/pay', '/api/payment/charge',
    '/api/payment/subscribe', '/api/payment/billing-key/issue',
    '/api/payment/cancel', '/api/payment/webhook',
  ]) {
    const response = await worker.fetch(new Request(`https://api.test${path}`, {
      method: 'POST',
      headers: { Origin: env.ALLOWED_ORIGINS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityVerificationId: 'retired', billingKey: 'retired' }),
    }), env, { waitUntil() { throw new Error('No deferred work allowed'); } });
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).ok, false, path);
  }
  await worker.scheduled({ cron: '0 0 * * *', scheduledTime: Date.now() }, env, {
    waitUntil() { throw new Error('Billing cron must not schedule work'); },
  });
  assert.equal(calls, 0);
} finally {
  globalThis.fetch = originalFetch;
}
console.log('Retired provider: 7 routes disabled, billing cron inert, shared webhook helpers retained.');
