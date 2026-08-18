// Server mirror of packages/core/data/lyra-policy.mjs.
// Keep LYRA_POLICY_VERSION aligned with the shared policy.

export const LYRA_POLICY_VERSION = '2026-07-31-v1';

export const LYRA_POINT_LEVELS = Object.freeze([
  Object.freeze({ key: 'helper', label: 'Helper', minPoints: 0, nextPoints: 500 }),
  Object.freeze({ key: 'mate', label: 'Mate', minPoints: 500, nextPoints: 1500 }),
  Object.freeze({ key: 'tutor', label: 'Tutor', minPoints: 1500, nextPoints: 2000 }),
  Object.freeze({ key: 'soul', label: 'Soul', minPoints: 2000, nextPoints: null }),
]);

export const REALIZATION_LEVELS = Object.freeze([
  Object.freeze({ key: 'entry', label: '강독 입문', minCompleted: 0, maxCompleted: 0 }),
  Object.freeze({ key: 'reader', label: '원서 독자', minCompleted: 1, maxCompleted: 2 }),
  Object.freeze({ key: 'deep_reader', label: '탐독가', minCompleted: 3, maxCompleted: 4 }),
  Object.freeze({ key: 'interpreter', label: '클래식 해설가', minCompleted: 5, maxCompleted: 6 }),
  Object.freeze({ key: 'stella', label: '스텔라', minCompleted: 7, maxCompleted: 7 }),
]);

export const LYRA_ELIGIBLE_REASONS = Object.freeze([
  'welcome',
  'profile',
  'channel',
  'join',
  'declaration',
  'checkin',
  'diary',
  'fidelity',
  'record_bonus',
  'review',
  'feedback',
  'badge',
]);

const ELIGIBLE_REASON_SET = new Set(LYRA_ELIGIBLE_REASONS);

export function clampClassicCompleted(value) {
  const count = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0;
  return Math.max(0, Math.min(7, count));
}

export function normalizePointAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
}

export function lyraPointLevelFor(value) {
  const points = Math.max(0, normalizePointAmount(value));
  const level = [...LYRA_POINT_LEVELS]
    .reverse()
    .find((candidate) => points >= candidate.minPoints)
    || LYRA_POINT_LEVELS[0];
  return {
    ...level,
    points,
    pointsToNext: level.nextPoints == null
      ? 0
      : Math.max(0, level.nextPoints - points),
  };
}

export function realizationLevelFor(value, completionKnown = true) {
  const completedCount = clampClassicCompleted(value);
  if (!completionKnown) {
    return {
      key: 'unknown',
      label: '진도 확인 중',
      completedCount,
      completionKnown: false,
      stellaUnlocked: false,
    };
  }
  const level = REALIZATION_LEVELS.find((candidate) =>
    completedCount >= candidate.minCompleted
    && completedCount <= candidate.maxCompleted) || REALIZATION_LEVELS[0];
  return {
    ...level,
    completedCount,
    completionKnown: true,
    stellaUnlocked: completedCount === 7,
  };
}

export function resolveLyraProgress({
  cumulativeEarnedPoints = 0,
  classicCompletedCount = 0,
  completionKnown = true,
} = {}) {
  const pointLevel = lyraPointLevelFor(cumulativeEarnedPoints);
  const realization = realizationLevelFor(classicCompletedCount, completionKnown);
  const effectiveMode = realization.stellaUnlocked ? 'stella' : pointLevel.key;
  return {
    policyVersion: LYRA_POLICY_VERSION,
    cumulativeEarnedPoints: pointLevel.points,
    pointMode: pointLevel.key,
    effectiveMode,
    nextThreshold: realization.stellaUnlocked ? null : pointLevel.nextPoints,
    pointsToNext: realization.stellaUnlocked ? 0 : pointLevel.pointsToNext,
    realization,
    stellaUnlocked: realization.stellaUnlocked,
  };
}

export function pointProgressFromTransactions(rows = []) {
  let availablePoints = 0;
  let cumulativeEarnedPoints = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const amount = normalizePointAmount(row?.amount);
    availablePoints += amount;
    if (amount > 0 && ELIGIBLE_REASON_SET.has(String(row?.reason || ''))) {
      cumulativeEarnedPoints += amount;
    }
  }
  return {
    availablePoints,
    cumulativeEarnedPoints,
  };
}
