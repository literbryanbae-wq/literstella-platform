import assert from 'node:assert/strict';
import {
  CONTENT_POINT_POLICY_VERSION,
  CONTENT_SURFACE,
  OWNERSHIP_DISCOUNT_PCT,
  entitlementKeysFor,
  quoteContentItem,
  quoteRemainingBundle,
  storyEpisodeForLecture,
} from './src/content-point-pricing.mjs';

assert.equal(CONTENT_POINT_POLICY_VERSION, '2026-08-14-v3');
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
assert.equal(ai(7, { book: 'oz' }).access, 'free');
// 운영자 확정 2026-08-14: 쇼케이스 무료 = 소장 축(7종 전부 소장). 완독(isStella)은 가격 무영향.
assert.equal(ai(0, { book: 'oz', isStella: true }).access, 'points');
assert.equal(ai(7, { book: 'oz' }).reason, 'owner_showcase');
assert.equal(ai(7, { book: 'we-do-not-part' }).reason, 'owner_showcase');
assert.equal(ai(0, { book: 'we-do-not-part', isStella: true }).access, 'points');
assert.equal(ai(0, { book: 'happy-prince', episodeNo: 30 }).reason, 'permanent_sampler');
assert.equal(ai(0, { hasStoryAccess: true }).payablePoints, 5);
// 오즈 = 강독 우선, 강의가 그 장(스토리 편)을 함께 연다(운영자 2026-11-02). 6강 = 2장.
assert.deepEqual(
  entitlementKeysFor(CONTENT_SURFACE.AI_LECTURE, 'oz', 6),
  ['lecture:oz:6', 'story:oz:2'],
);
const OZ_CHAPTER = [null, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6];
for (let n = 1; n <= 26; n += 1) {
  assert.equal(storyEpisodeForLecture('oz', n), OZ_CHAPTER[n], `oz ${n}강`);
}
// 표에 없는 강은 스토리를 열지 않는다(27강~ 은 표를 늘린 뒤 판다).
assert.equal(storyEpisodeForLecture('oz', 27), null);
assert.deepEqual(entitlementKeysFor(CONTENT_SURFACE.AI_LECTURE, 'oz', 27), ['lecture:oz:27']);
// 어린 왕자 = 오즈처럼 강의가 그 장 스토리를 함께 연다(운영자 2026-11-10). 6강 = 2편 · 91강 = 26편.
//   LP_CLASS = 클래스 앱 stellaLectures.js 90005 storyMap 사본(강 1~91 순서) — 두 표가 갈리면 여기서 걸린다.
const LP_CLASS = [1,1,1,1,2,2,2,2,3,3,4,4,4,4,5,5,5,6,6,7,7,7,7,8,8,8,8,8,9,9,10,10,10,10,10,10,10,11,11,11,12,12,12,12,12,13,13,13,13,14,14,14,14,14,15,16,16,16,17,17,18,19,19,19,19,19,20,20,21,21,21,22,22,22,22,23,23,23,23,24,24,24,25,25,25,25,25,25,25,26,26];
for (let n = 1; n <= 91; n += 1) {
  assert.equal(storyEpisodeForLecture('littleprince', n), LP_CLASS[n - 1], `littleprince ${n}강`);
}
assert.deepEqual(entitlementKeysFor(CONTENT_SURFACE.AI_LECTURE, 'littleprince', 6), ['lecture:littleprince:6', 'story:littleprince:2']);
assert.deepEqual(entitlementKeysFor(CONTENT_SURFACE.AI_LECTURE, 'littleprince', 91), ['lecture:littleprince:91', 'story:littleprince:26']);
assert.equal(storyEpisodeForLecture('littleprince', 92), null);
assert.equal(new Set(LP_CLASS).size, 26, '스토리 26편이 모두 어느 강에 걸린다');
// 스토리를 먼저 산 분은 그 편의 첫 강만 5P 덜(오즈와 같은 규칙).
const lp = (episodeNo, extra = {}) => quoteContentItem({ surface: CONTENT_SURFACE.AI_LECTURE, book: 'littleprince', episodeNo, ownedCount: 0, ...extra });
assert.equal(lp(6, { hasStoryAccess: true }).reason, 'story_to_ai_upgrade');
assert.equal(lp(7, { hasStoryAccess: true, storyCreditUsed: true }).reason, 'point_unlock');
// 강의를 가진 분은 그 장 스토리를 '이미 가짐'으로 본다(따로 결제 예외가 사라졌다).
assert.equal(quoteContentItem({ surface: CONTENT_SURFACE.STORY, book: 'littleprince', episodeNo: 8, hasAiLectureAccess: true }).access, 'owned');
// 표 없는 책 = 예전처럼 강 N = 편 N.
assert.equal(storyEpisodeForLecture('future-ai', 9), 9);
assert.deepEqual(entitlementKeysFor(CONTENT_SURFACE.AI_LECTURE, 'we-do-not-part', 7), ['lecture:wedonotpart:7', 'story:wedonotpart:7']);

// 스토리 차액 할인은 스토리마다 한 번.
const oz = (episodeNo, extra = {}) => quoteContentItem({
  surface: CONTENT_SURFACE.AI_LECTURE, book: 'oz', episodeNo, ownedCount: 0, ...extra,
});
assert.equal(oz(6, { hasStoryAccess: true }).reason, 'story_to_ai_upgrade');
assert.equal(oz(6, { hasStoryAccess: true }).payablePoints, 5);
assert.equal(oz(7, { hasStoryAccess: true, storyCreditUsed: true }).reason, 'point_unlock');
assert.equal(oz(7, { hasStoryAccess: true, storyCreditUsed: true }).payablePoints, 10);
assert.equal(oz(27, { hasStoryAccess: true }).payablePoints, 10, '표에 없는 강은 차액 할인 없음');
assert.equal(oz(23, { hasStoryAccess: true }).reason, 'story_to_ai_upgrade', '23강 = 6장 — 스토리 6편을 산 분은 차액 할인');
assert.equal(quoteContentItem({
  surface: CONTENT_SURFACE.AI_LECTURE, book: 'littleprince', episodeNo: 6, ownedCount: 0, hasStoryAccess: true,
}).payablePoints, 5, '어린 왕자도 스토리를 먼저 산 분은 그 편 첫 강 5P 덜(11-10 — 예전엔 따로 결제라 10P)');

// 묶음: 강의가 함께 여는 편은 따로 세지 않고, 차액 할인은 편마다 첫 강에만.
const ozBundle = quoteRemainingBundle({
  ownedCount: 0,
  items: [
    ...[9, 10, 11, 12, 13].map((episodeNo) => ({
      surface: CONTENT_SURFACE.AI_LECTURE, book: 'oz', episodeNo, hasStoryAccess: true,
    })),
    { surface: CONTENT_SURFACE.STORY, book: 'oz', episodeNo: 3 },
    { surface: CONTENT_SURFACE.STORY, book: 'oz', episodeNo: 9 },
  ],
});
assert.equal(ozBundle.pointItems.length, 6, '강 5 + 함께 열리지 않는 스토리 9편');
assert.equal(ozBundle.pointItems.filter((q) => q.reason === 'story_to_ai_upgrade').length, 1);
assert.equal(ozBundle.subtotalPoints, 5 + 10 * 4 + 5);
assert.ok(ozBundle.entitlementKeys.includes('story:oz:3'));
assert.ok(ozBundle.entitlementKeys.includes('story:oz:9'));
assert.ok(!ozBundle.entitlementKeys.includes('story:oz:13'), '강 번호로 스토리를 열면 안 된다');

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
