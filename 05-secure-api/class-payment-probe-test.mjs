import assert from 'node:assert/strict';
import { classPaymentProbe, PROBE } from './src/class-payment-probe.mjs';
const kv = new Map();
const env = { CLASS_PAYMENT_PROBE_ENABLED: 'true', TOSS_CLASS_SECRET_KEY: 'live_gsk_mock', TOSS_SECRET_KEY: 'must-not-use',
  OTP_GUARD: { get: async key => kv.get(key) || null, put: async (key, value) => { kv.set(key, value); } } };
let user = { id: PROBE.userId, email: PROBE.email, emailConfirmed: true };
let payment = null, calls = [], timeoutConfirm = false, failRead = false, cancelFail = false;
const originalFetch = globalThis.fetch;
let checks = 0;
globalThis.fetch = async (url, init) => {
  assert.equal(url.includes('/orders/'), false, 'gsk keys require paymentKey lookup');
  assert.equal(init.headers.Authorization, `Basic ${btoa('live_gsk_mock:')}`);
  calls.push({ url, init });
  if (!init.body) {
    if (failRead) return Response.json({ code: 'UNAUTHORIZED_KEY' }, { status: 401 });
    return payment ? Response.json(payment) : Response.json({ code: 'NOT_FOUND_PAYMENT' }, { status: 404 });
  }
  const body = JSON.parse(init.body);
  if (url.endsWith('/confirm')) {
    assert.deepEqual(body, { orderId: PROBE.orderId, amount: 100, paymentKey: 'payment-probe' });
    assert.equal(init.headers['Idempotency-Key'], `${PROBE.orderId}-confirm`);
    payment = { orderId: PROBE.orderId, amount: 100, totalAmount: 100, currency: 'KRW', method: '카드',
      paymentKey: 'payment-probe', status: 'DONE', balanceAmount: 100, approvedAt: '2026-10-12T20:00:00+09:00' };
    if (timeoutConfirm) throw new Error('timeout');
  } else {
    assert.equal(url.endsWith('/payment-probe/cancel'), true);
    assert.equal(init.headers['Idempotency-Key'], `${PROBE.orderId}-cancel`);
    assert.equal(body.cancelAmount, undefined);
    if (!cancelFail) payment = { ...payment, status: 'CANCELED', balanceAmount: 0,
      cancels: [{ cancelStatus: 'DONE', cancelAmount: 100, canceledAt: '2026-10-12T20:01:00+09:00' }] };
  }
  return Response.json(payment);
};
const call = async (action, body = {}, override = {}, origin = 'http://127.0.0.1:5612') => {
  const r = await classPaymentProbe(new Request(`https://api.example/api/class-payment-probe/${action}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { ...env, ...override }, { requireUser: async () => user, now: () => Date.parse('2026-10-12T20:00:00+09:00') });
  return { status: r.status, ...(await r.json()) };
};
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
try {
  const owner = user;
  for (const invalid of [null, { ...owner, id: 'another' }, { ...owner, email: 'other@example.test' }, { ...owner, emailConfirmed: false }]) {
    user = invalid; eq((await call('prepare')).error, 'operator_only');
  }
  eq(calls.length, 0); user = owner;
  eq((await call('prepare', {}, {}, 'https://evil.example')).error, 'origin_denied');
  eq((await call('prepare', {}, { CLASS_PAYMENT_PROBE_ENABLED: 'false' })).error, 'probe_closed');
  eq((await call('prepare', {}, { TOSS_CLASS_SECRET_KEY: 'test_gsk_mock' })).error, 'live_key_missing');
  failRead = true; eq((await call('prepare')).error, 'verification_pending'); failRead = false;
  const first = await call('prepare'); eq(first.amount, 100); eq(first.orderId, PROBE.orderId);
  eq((await call('prepare')).orderId, first.orderId);
  eq((await call('confirm', { orderId: 'other', amount: 100, paymentKey: 'payment-probe' })).error, 'payment_mismatch');
  eq((await call('confirm', { orderId: PROBE.orderId, amount: 1, paymentKey: 'payment-probe' })).error, 'payment_mismatch');
  timeoutConfirm = true;
  eq((await call('confirm', { orderId: PROBE.orderId, amount: 100, paymentKey: 'payment-probe' })).status, 'DONE');
  eq((await call('prepare')).error, 'order_already_exists');
  eq((await call('confirm', { orderId: PROBE.orderId, amount: 100, paymentKey: 'wrong-key' })).error, 'payment_mismatch');
  eq((await call('confirm', { orderId: PROBE.orderId, amount: 100, paymentKey: 'payment-probe' })).status, 'DONE');
  eq(calls.filter(c => c.url.endsWith('/confirm')).length, 1);
  eq((await call('cancel')).error, 'cancel_confirmation_required');
  cancelFail = true; eq((await call('cancel', { confirm: 'CANCEL_100_KRW' })).error, 'cancel_pending'); cancelFail = false;
  const result = await call('cancel', { confirm: 'CANCEL_100_KRW' }, { CLASS_PAYMENT_PROBE_ENABLED: 'false' });
  eq(result.refunded, true); eq(result.canceledAmount, 100); eq(result.balanceAmount, 0);
  eq((await call('cancel', { confirm: 'CANCEL_100_KRW' })).refunded, true);
  eq(calls.filter(c => c.url.endsWith('/cancel')).length, 2);
  eq((await call('confirm', { orderId: PROBE.orderId, amount: 100, paymentKey: 'payment-probe' })).status, 'CANCELED');
  eq(calls.filter(c => c.url.endsWith('/confirm')).length, 1);
  eq((await call('prepare')).error, 'order_already_exists');
  eq(JSON.stringify(await call('status')).includes('payment-probe'), false);
  payment = { ...payment, totalAmount: 48000 };
  eq((await call('cancel', { confirm: 'CANCEL_100_KRW' })).error, 'verification_pending');
  eq(calls.filter(c => c.url.endsWith('/cancel')).length, 2);
  payment = { ...payment, totalAmount: 100, cancels: [] };
  eq((await call('status')).refunded, false);
  console.log(`class-payment-probe: ${checks} checks passed; mocked provider only`);
} finally { globalThis.fetch = originalFetch; }
