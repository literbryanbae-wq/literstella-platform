// 구독 요금·전환 차감 계산 시험 — node class-subscription-pricing-test.mjs
import assert from 'node:assert/strict';
import { subscriptionQuote, nextPeriodEnd, allInOneCompletionPrice, conversionQuote } from './src/class-subscription-pricing.mjs';

let n = 0;
const check = (name, fn) => { fn(); n++; };

check('정가', () => {
  assert.equal(subscriptionQuote({ plan: 'solo', cycle: 'month' }).amount, 9900);
  assert.equal(subscriptionQuote({ plan: 'together', cycle: 'month' }).amount, 14900);
  assert.equal(subscriptionQuote({ plan: 'solo', cycle: 'year' }).amount, 99000);
  assert.equal(subscriptionQuote({ plan: 'together', cycle: 'year' }).amount, 149000);
  assert.equal(subscriptionQuote({ plan: 'x', cycle: 'year' }).ok, false);
  assert.equal(subscriptionQuote({ plan: 'solo', cycle: 'week' }).ok, false);
});

check('소장 겹침 할인 — 11-09 운영자 결정 숫자 그대로(연간만)', () => {
  assert.deepEqual([1, 2, 3].map((o) => subscriptionQuote({ plan: 'solo', cycle: 'year', ownedCount: o }).amount), [88000, 77000, 66000]);
  assert.deepEqual([1, 2, 3].map((o) => subscriptionQuote({ plan: 'together', cycle: 'year', ownedCount: o }).amount), [143500, 138000, 132400]);
  assert.equal(subscriptionQuote({ plan: 'solo', cycle: 'month', ownedCount: 3 }).amount, 9900, '월 구독은 정가');
});

check('4권 이상은 올인원 소장을 권한다 — 구독 금액은 정가', () => {
  const q = subscriptionQuote({ plan: 'solo', cycle: 'year', ownedCount: 4 });
  assert.equal(q.suggestOwnership, true);
  assert.equal(q.amount, 99000);
  assert.equal(subscriptionQuote({ plan: 'solo', cycle: 'year', ownedCount: 3 }).suggestOwnership, false);
});

check('포인트는 결제액의 30%까지', () => {
  assert.equal(subscriptionQuote({ plan: 'solo', cycle: 'year' }).pointsMax, 2970);
  assert.equal(subscriptionQuote({ plan: 'together', cycle: 'year' }).pointsMax, 4470);
});

check('다음 결제일 — 말일 보정', () => {
  assert.equal(nextPeriodEnd('2026-12-15T03:00:00.000Z', 'month'), '2027-01-15T03:00:00.000Z');
  assert.equal(nextPeriodEnd('2027-01-31T03:00:00.000Z', 'month'), '2027-02-28T03:00:00.000Z');
  assert.equal(nextPeriodEnd('2028-02-29T03:00:00.000Z', 'year'), '2029-02-28T03:00:00.000Z');
  assert.equal(nextPeriodEnd('nope', 'year'), null);
});

check('올인원 완성가', () => {
  assert.deepEqual([0, 1, 4, 7, 8].map(allInOneCompletionPrice), [398000, 348000, 198000, 48000, 0]);
});

check('구독 → 올인원 전환: 12월 31일까지 낸 금액만큼 차감', () => {
  const now = new Date('2026-12-20T03:00:00Z');
  const q = conversionQuote({ ownedCount: 0, now, payments: [{ amount: 99000, paidAt: '2026-12-01T05:00:00Z' }] });
  assert.equal(q.amount, 299000);
  assert.equal(q.credit, 99000);
  assert.equal(q.steps.reduce((a, s) => a + s.amount, 0), q.amount, '단계 합 = 전환가');
  // 소장 2권 + 월 구독 2번
  const q2 = conversionQuote({ ownedCount: 2, now, payments: [{ amount: 9900, paidAt: '2026-11-20T00:00:00Z' }, { amount: 9900, paidAt: '2026-12-20T00:00:00Z' }] });
  assert.equal(q2.amount, 298000 - 19800);
});

check('전환: 환불된 금액·기한 뒤 결제는 차감하지 않는다 · 0원 밑으로 안 내려간다', () => {
  const now = new Date('2026-12-31T14:00:00Z'); // KST 12-31 23:00
  assert.equal(conversionQuote({ now, payments: [{ amount: 99000, paidAt: '2026-12-01T00:00:00Z', canceledAmount: 99000 }] }).credit, 0);
  assert.equal(conversionQuote({ now, payments: [{ amount: 99000, paidAt: '2026-12-31T15:30:00Z' }] }).credit, 0, 'KST 1월 1일 결제');
  const big = conversionQuote({ ownedCount: 7, now, payments: [{ amount: 149000, paidAt: '2026-12-10T00:00:00Z' }] });
  assert.equal(big.amount, 0);
  assert.equal(big.credit, 48000);
});

check('전환: 기한이 지나면 닫힌다(차감 0)', () => {
  const q = conversionQuote({ now: new Date('2026-12-31T15:00:01Z'), payments: [{ amount: 99000, paidAt: '2026-12-01T00:00:00Z' }] });
  assert.equal(q.open, false);
  assert.equal(q.amount, 398000);
});

{
  // 첫 결제 포인트: 30% 한도 · 가진 만큼 · 정수만 · 0 이면 전액 카드
  const { pointsPlan } = await import('./src/class-subscription-pricing.mjs');
  const q = subscriptionQuote({ plan: 'solo', cycle: 'year' });
  assert.equal(q.pointsMax, 2970);
  assert.deepEqual(pointsPlan(q, 0, 5000), { ok: true, usePoints: 0, cardAmount: 99000 });
  assert.deepEqual(pointsPlan(q, undefined, 0), { ok: true, usePoints: 0, cardAmount: 99000 });
  assert.deepEqual(pointsPlan(q, 2970, 5000), { ok: true, usePoints: 2970, cardAmount: 69300 });
  assert.equal(pointsPlan(q, 2971, 5000).error, 'bad_points');
  assert.equal(pointsPlan(q, 10.5, 5000).error, 'bad_points');
  assert.equal(pointsPlan(q, '10', 5000).error, 'bad_points');
  assert.equal(pointsPlan(q, 100, 99).error, 'points_short');
  assert.equal(pointsPlan({ ok: false }, 10, 99).error, 'bad_plan');
  n++;
}
console.log(`class-subscription-pricing-test: ${n} checks passed`);
