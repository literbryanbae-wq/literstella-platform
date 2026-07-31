import assert from 'node:assert/strict';
import {
  LYRA_POLICY_VERSION,
  pointProgressFromTransactions,
  resolveLyraProgress,
} from './src/lyra-policy.mjs';

assert.equal(LYRA_POLICY_VERSION, '2026-07-31-v1');

const rows = [
  { amount: 300, reason: 'welcome' },
  { amount: 10, reason: 'diary' },
  { amount: 3000, reason: 'adjust' },
  { amount: -10, reason: 'lecture' },
];
assert.deepEqual(pointProgressFromTransactions(rows), {
  availablePoints: 3300,
  cumulativeEarnedPoints: 310,
});

assert.equal(resolveLyraProgress({ cumulativeEarnedPoints: 499 }).effectiveMode, 'helper');
assert.equal(resolveLyraProgress({ cumulativeEarnedPoints: 500 }).effectiveMode, 'mate');
assert.equal(resolveLyraProgress({ cumulativeEarnedPoints: 1500 }).effectiveMode, 'tutor');
assert.equal(resolveLyraProgress({ cumulativeEarnedPoints: 3000 }).effectiveMode, 'soul');

const stella = resolveLyraProgress({
  cumulativeEarnedPoints: 0,
  classicCompletedCount: 7,
});
assert.equal(stella.effectiveMode, 'stella');
assert.equal(stella.realization.label, '스텔라');
assert.equal(stella.stellaUnlocked, true);

console.log('secure-api lyra-policy-test: all assertions passed');
