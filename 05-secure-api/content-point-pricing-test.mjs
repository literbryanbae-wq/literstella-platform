import assert from 'node:assert/strict';
import {
  CONTENT_POINT_POLICY_VERSION,
  CONTENT_SURFACE,
  OWNERSHIP_DISCOUNT_PCT,
  entitlementKeysFor,
  quoteContentItem,
  quoteRemainingBundle,
} from './src/content-point-pricing.mjs';

assert.equal(CONTENT_POINT_POLICY_VERSION, '2026-07-31-v2');
assert.deepEqual(OWNERSHIP_DISCOUNT_PCT, [0, 10, 15, 20, 25, 30, 50, 80]);

const ai = (ownedCount, extra = {}) => quoteContentItem({
  surface: CONTENT_SURFACE.AI_LECTURE,
  book: 'future-ai',
  episodeNo: 6,
  ownedCount,
  ...extra,
});
const story = (ownedCount) => quoteContentItem({
  surface: CONTENT_SURFACE.STORY,
  book: 'future-ai',
  episodeNo: 6,
  ownedCount,
});

assert.deepEqual(
  Array.from({ length: 8 }, (_, count) => ai(count).payablePoints),
  [10, 9, 8, 8, 7, 7, 5, 2],
);
assert.deepEqual(
  Array.from({ length: 8 }, (_, count) => story(count).payablePoints),
  [5, 4, 4, 4, 3, 3, 2, 1],
);
assert.equal(ai(0, { book: 'oz' }).access, 'points');
assert.equal(ai(7, { book: 'oz' }).access, 'points');
assert.equal(ai(0, { book: 'oz', isStella: true }).reason, 'stella_showcase');
assert.equal(ai(7, { book: 'we-do-not-part', isStella: true }).reason, 'stella_showcase');
assert.equal(ai(0, { book: 'happy-prince', episodeNo: 30 }).reason, 'permanent_sampler');
assert.equal(ai(0, { hasStoryAccess: true }).payablePoints, 5);
assert.deepEqual(
  entitlementKeysFor(CONTENT_SURFACE.AI_LECTURE, 'oz', 6),
  ['lecture:oz:6', 'story:oz:6'],
);

const bundle = quoteRemainingBundle({
  ownedCount: 7,
  items: Array.from({ length: 10 }, (_, index) => ({
    surface: CONTENT_SURFACE.AI_LECTURE,
    book: 'future-ai',
    episodeNo: index + 6,
  })),
});
assert.equal(bundle.subtotalPoints, 100);
assert.equal(bundle.payablePoints, 15);
assert.equal(bundle.effectiveDiscountPct, 85);
assert.equal('lyraMode' in bundle, false);
assert.equal('milestone' in bundle, false);

console.log('secure-api content-point-pricing-test: all assertions passed');
