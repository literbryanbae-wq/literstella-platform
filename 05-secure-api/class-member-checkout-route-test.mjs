import assert from 'node:assert/strict';
import { classMemberCheckoutRoute } from './src/class-member-checkout-route.mjs';
const url = 'https://api.example.test/api/class-checkout/quote';
const origin = 'https://class-new.literstella.co.kr';
const env = { ALLOWED_ORIGINS: origin };
assert.equal(await classMemberCheckoutRoute(new Request('https://api.example.test/health'), env), null);
for (const [request, status] of [
  [new Request(url, { method: 'POST' }), 403],
  [new Request(url, { method: 'POST', headers: { Origin: 'https://evil.example' } }), 403],
  [new Request(url, { method: 'POST', headers: { Origin: origin } }), 401],
  [new Request(url, { method: 'GET', headers: { Origin: origin } }), 405],
  [new Request(url, { method: 'OPTIONS', headers: { Origin: origin } }), 204],
]) assert.equal((await classMemberCheckoutRoute(request, env)).status, status);
const preflight = await classMemberCheckoutRoute(new Request(url, { method: 'OPTIONS', headers: { Origin: origin } }), env);
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
assert.equal(preflight.headers.get('Vary'), 'Origin');
console.log('member checkout route: 8 checks passed');
