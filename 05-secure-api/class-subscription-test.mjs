// 구독 정기결제 서버 시험 — 가짜 토스·가짜 DB 로 돈다. node class-subscription-test.mjs
import assert from 'node:assert/strict';
import { classSubscription, chargeDueSubscriptions } from './src/class-subscription.mjs';

const ORDER = 'sub' + 'a'.repeat(32);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const ENV = { CLASS_SUBSCRIPTION_ENABLED: 'true', TOSS_BILLING_SECRET_KEY: 'sk', TOSS_BILLING_CLIENT_KEY: 'ck',
  CLASS_SUBSCRIPTION_TERMS_URL: 'https://class-new.literstella.co.kr/subscribe#terms', CLASS_SUBSCRIPTION_TERMS_VERSION: 'sub-2026-12' };

function world({ owned = 0, ownedTheory = false, payStatus = 'ready', billingKey = null, payments = [], toss = {}, kind = 'first' } = {}) {
  const calls = { rpc: [], toss: [] };
  const sbFetch = async (_env, path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (path.startsWith('rpc/')) {
      const name = path.slice(4); calls.rpc.push([name, body]);
      if (name === 'class_subscription_summary') return json({ subscription: null, payments, ownedOriginals: owned, ownedTheory });
      if (name === 'class_subscription_begin') return json({ ok: true, subscriptionId: 's1', customerKey: 'cus1', orderId: ORDER, amount: body.p_amount });
      if (name === 'class_subscription_settle') return json({ ok: true, kind, orderId: body.p_order_id,
        status: body.p_status === 'DONE' ? 'paid' : body.p_status === 'CANCELED' ? 'canceled' : 'partial_canceled' });
      if (name === 'class_subscription_due') return json([{ orderId: ORDER, subscriptionId: 's1', userId: 'u1', billingKey: 'bk', customerKey: 'cus1', amount: 9900, plan: 'solo', cycle: 'month' }]);
      if (name === 'class_subscription_expire') return json(2);
      if (name === 'class_checkout_quote') return json({ ok: true, ownedCount: owned, complete: false });
      return json({ ok: true });
    }
    if (path.startsWith('class_subscription_payments')) return json([{ id: ORDER, amount: 99000, status: payStatus, payment_key: null, subscription_id: 's1' }]);
    if (path.startsWith('class_subscriptions')) return json([{ id: 's1', plan: 'solo', cycle: 'year', customer_key: 'cus1', billing_key: billingKey }]);
    return json([]);
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.toss.push([u, init.method || 'GET', init.headers || {}]);
    if (u.endsWith('/billing/authorizations/issue')) return json(toss.issue || { billingKey: 'bk' }, toss.issue ? 400 : 200);
    if (u.includes('/billing/')) return toss.charge ? json(toss.charge.body, toss.charge.status) : json({ paymentKey: 'pk1', orderId: ORDER, status: 'DONE' });
    if (u.includes('/payments/')) return json({ paymentKey: 'pk1', orderId: ORDER, totalAmount: toss.total ?? 99000, balanceAmount: toss.balance ?? toss.total ?? 99000, currency: 'KRW', status: toss.status || 'DONE' });
    return json({}, 404);
  };
  const deps = { requireUser: async () => ({ id: 'u1', emailConfirmed: true }), sbFetch, json };
  const call = async (action, body, env = ENV) => {
    const r = await classSubscription(new Request('https://x/api/class-subscription/' + action, { method: 'POST', body: JSON.stringify(body || {}) }), env, {}, action, deps);
    return { status: r.status, body: await r.json() };
  };
  return { calls, call, sbFetch };
}

let n = 0;
const check = async (name, fn) => { await fn(); n++; };

await check('스위치가 꺼져 있으면 견적은 보이고 결제는 닫힌다', async () => {
  const w = world();
  const off = { ...ENV, CLASS_SUBSCRIPTION_ENABLED: undefined };
  const q = await w.call('quote', { plan: 'solo', cycle: 'year' }, off);
  assert.equal(q.body.amount, 99000); assert.equal(q.body.checkoutEnabled, false); assert.equal(q.body.clientKey, null);
  assert.equal((await w.call('prepare', { plan: 'solo', cycle: 'year', expectedAmount: 99000, acceptedTermsVersion: 'sub-2026-12' }, off)).status, 503);
});

await check('금액은 서버가 정한다 — 화면 금액이 다르면 거절', async () => {
  const w = world({ owned: 2 });
  const bad = await w.call('prepare', { plan: 'solo', cycle: 'year', expectedAmount: 99000, acceptedTermsVersion: 'sub-2026-12' });
  assert.equal(bad.status, 409); assert.equal(bad.body.amount, 77000);
  const ok = await w.call('prepare', { plan: 'solo', cycle: 'year', expectedAmount: 77000, acceptedTermsVersion: 'sub-2026-12' });
  assert.equal(ok.body.orderId, ORDER);
  assert.equal(w.calls.rpc.find(([k]) => k === 'class_subscription_begin')[1].p_amount, 77000);
  assert.equal((await w.call('prepare', { plan: 'solo', cycle: 'year', expectedAmount: 77000, acceptedTermsVersion: 'old' })).body.error, 'terms_changed');
});

await check('핵심 이론을 소장으로 센다(DB 판정): 오리지널 2권 + 이론 = 66,000원 · 화면·DB 에는 할인에 센 권수 3', async () => {
  const w = world({ owned: 2, ownedTheory: true });
  const q = await w.call('quote', { plan: 'solo', cycle: 'year' });
  assert.equal(q.body.amount, 66000); assert.equal(q.body.ownedCount, 3);
  assert.equal(q.body.ownedOriginals, 2); assert.equal(q.body.ownedTheory, true);
  const ok = await w.call('prepare', { plan: 'solo', cycle: 'year', expectedAmount: 66000, acceptedTermsVersion: 'sub-2026-12' });
  assert.equal(ok.body.orderId, ORDER);
  const begin = w.calls.rpc.find(([k]) => k === 'class_subscription_begin')[1];
  assert.equal(begin.p_amount, 66000); assert.equal(begin.p_owned_count, 3);
});

await check('웹훅: 전액 취소 = 포인트 전부 반환(release) · 전환 결제 부분 취소 = 비율 반환(refund) · 첫 결제 부분 취소 = 기록만', async () => {
  const hook = async (w) => {
    const deps = { requireUser: async () => null, sbFetch: w.sbFetch, json };
    const r = await classSubscription(new Request('https://x/api/class-subscription/webhook', { method: 'POST', body: JSON.stringify({ data: { paymentKey: 'pk1', orderId: ORDER } }) }), ENV, {}, 'webhook', deps);
    return r.status;
  };
  const full = world({ kind: 'upgrade', toss: { status: 'CANCELED', balance: 0 } });
  assert.equal(await hook(full), 200);
  assert.ok(full.calls.rpc.some(([k]) => k === 'class_subscription_points_release'));
  assert.ok(!full.calls.rpc.some(([k]) => k === 'class_subscription_points_refund'));
  const part = world({ kind: 'upgrade', toss: { status: 'PARTIAL_CANCELED', balance: 40000 } });
  assert.equal(await hook(part), 200);
  assert.equal(part.calls.rpc.find(([k]) => k === 'class_subscription_settle')[1].p_canceled_amount, 59000);
  assert.ok(part.calls.rpc.some(([k]) => k === 'class_subscription_points_refund'));
  assert.ok(!part.calls.rpc.some(([k]) => k === 'class_subscription_points_release'));
  const firstPart = world({ kind: 'first', toss: { status: 'PARTIAL_CANCELED', balance: 40000 } });
  assert.equal(await hook(firstPart), 200);
  assert.ok(!firstPart.calls.rpc.some(([k]) => /points_(refund|release)$/.test(k)));
});

await check('확정: 빌링키 발급 → 한 번 청구(주문 번호 = Idempotency-Key) → 토스에 다시 물어 반영', async () => {
  const w = world();
  const r = await w.call('confirm', { orderId: ORDER, authKey: 'auth1' });
  assert.equal(r.status, 200); assert.equal(r.body.status, 'paid');
  const charge = w.calls.toss.filter(([u, m]) => m === 'POST' && /\/billing\/bk$/.test(u));
  assert.equal(charge.length, 1);
  assert.equal(charge[0][2]['Idempotency-Key'], ORDER);
  assert.ok(w.calls.rpc.some(([k, b]) => k === 'class_subscription_attach_key' && b.p_billing_key === 'bk'));
  assert.equal(w.calls.rpc.find(([k]) => k === 'class_subscription_settle')[1].p_status, 'DONE');
});

await check('이미 결제된 주문은 다시 청구하지 않는다', async () => {
  const w = world({ payStatus: 'paid' });
  const r = await w.call('confirm', { orderId: ORDER, authKey: 'auth1' });
  assert.equal(r.body.status, 'paid');
  assert.equal(w.calls.toss.length, 0);
});

await check('카드 거절 = 실패로 적는다 · 애매한 오류 = 그대로 두고 다시 묻게 한다', async () => {
  const declined = world({ billingKey: 'bk', toss: { charge: { status: 400, body: { code: 'REJECT_CARD_COMPANY' } } } });
  assert.equal((await declined.call('confirm', { orderId: ORDER, authKey: 'a' })).status, 402);
  assert.ok(declined.calls.rpc.some(([k]) => k === 'class_subscription_fail'));
  const vague = world({ billingKey: 'bk', toss: { charge: { status: 500, body: { code: 'UNKNOWN_PAYMENT_ERROR' } } } });
  assert.equal((await vague.call('confirm', { orderId: ORDER, authKey: 'a' })).status, 202);
  assert.ok(!vague.calls.rpc.some(([k]) => k === 'class_subscription_fail'));
});

await check('토스 금액이 주문과 다르면 반영하지 않는다', async () => {
  const w = world({ billingKey: 'bk', toss: { total: 1000 } });
  const r = await w.call('confirm', { orderId: ORDER, authKey: 'a' });
  assert.equal(r.status, 409);
  assert.ok(!w.calls.rpc.some(([k]) => k === 'class_subscription_settle'));
});

await check('내 서재 상태: 낸 구독료만큼 올인원 전환가에서 뺀다', async () => {
  const w = world({ owned: 1, payments: [{ amount: 99000, paidAt: '2026-12-01T00:00:00Z', canceledAmount: 0 }] });
  const realNow = Date.now; Date.now = () => Date.parse('2026-12-20T00:00:00Z');
  const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.parse('2026-12-20T00:00:00Z')])); } static now() { return RealDate.parse('2026-12-20T00:00:00Z'); } };
  try {
    const r = await w.call('status');
    assert.equal(r.body.conversion.basePrice, 348000);
    assert.equal(r.body.conversion.amount, 249000);
  } finally { globalThis.Date = RealDate; Date.now = realNow; }
});

await check('크론: 청구하고 정리 숫자를 돌려준다 · 스위치가 꺼져 있으면 아무것도 안 한다', async () => {
  const w = world({ toss: { total: 9900 } });
  const out = await chargeDueSubscriptions(ENV, { sbFetch: w.sbFetch });
  assert.deepEqual(out, { due: 1, paid: 1, failed: 0, pending: 0, expired: 2 });
  const w2 = world();
  assert.equal((await chargeDueSubscriptions({ ...ENV, CLASS_SUBSCRIPTION_ENABLED: 'false' }, { sbFetch: w2.sbFetch })).due, 0);
  assert.equal(w2.calls.rpc.length, 0);
});

console.log(`class-subscription-test: ${n} checks passed`);
