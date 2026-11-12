// 구독 진입 연결 시험 — 출처·로그인·웹훅 문지기. node class-subscription-route-test.mjs
import assert from 'node:assert/strict';
import { classSubscriptionRoute } from './src/class-subscription-entry.mjs';
const ENV = { ALLOWED_ORIGINS: 'https://class-new.literstella.co.kr', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'srv' };
globalThis.fetch = async () => new Response('{}', { status: 401 });
const call = (path, { origin, method = 'POST', token } = {}) => classSubscriptionRoute(new Request('https://api.test' + path, {
  method, headers: { ...(origin ? { Origin: origin } : {}), ...(token ? { 'X-User-Token': token } : {}) }, body: method === 'POST' ? '{}' : undefined }), ENV);
let n = 0; const check = async (name, fn) => { await fn(); n++; };
await check('다른 주소는 건드리지 않는다', async () => { assert.equal(await call('/api/class-checkout/quote', { origin: ENV.ALLOWED_ORIGINS }), null); });
await check('허용하지 않은 출처 403 · 출처 없는 요청 403(웹훅 제외)', async () => {
  assert.equal((await call('/api/class-subscription/quote', { origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/api/class-subscription/quote')).status, 403);
  assert.notEqual((await call('/api/class-subscription/webhook')).status, 403);
});
await check('로그인 없이는 401 · 사전 요청은 204', async () => {
  const r = await call('/api/class-subscription/quote', { origin: ENV.ALLOWED_ORIGINS });
  assert.equal(r.status, 401); assert.equal(r.headers.get('Access-Control-Allow-Origin'), ENV.ALLOWED_ORIGINS);
  assert.equal((await call('/api/class-subscription/quote', { origin: ENV.ALLOWED_ORIGINS, method: 'OPTIONS' })).status, 204);
});
await check('웹훅: 결제 키가 없으면 닫힌 채(503) — 스위치·키 없이 아무것도 반영하지 않는다', async () => {
  assert.equal((await call('/api/class-subscription/webhook')).status, 503);
});
console.log(`class-subscription-route-test: ${n} checks passed`);
