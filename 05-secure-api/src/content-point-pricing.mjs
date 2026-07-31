// Server copy of the point-content pricing policy.
//
// Keep CONTENT_POINT_POLICY_VERSION aligned with:
// 02-challenge/literstella-challenge/src/lib/contentPointPricing.js

export const CONTENT_POINT_POLICY_VERSION = '2026-07-31-v2';

export const CONTENT_SURFACE = Object.freeze({
  STORY: 'story',
  AI_LECTURE: 'ai_lecture',
  INSTRUCTOR_AUDIO: 'instructor_audio',
  INSTRUCTOR_VIDEO: 'instructor_video',
  WORKBOOK: 'workbook',
  DOWNLOAD: 'download',
  NEWSLETTER: 'newsletter',
});

export const POINT_BASE_PRICE = Object.freeze({
  [CONTENT_SURFACE.STORY]: 5,
  [CONTENT_SURFACE.AI_LECTURE]: 10,
});

export const FREE_EPISODE_MAX = 5;
export const REMAINING_BUNDLE_DISCOUNT_PCT = 25;

export const OWNERSHIP_DISCOUNT_PCT = Object.freeze([
  0, 10, 15, 20, 25, 30, 50, 80,
]);

export const OWNERSHIP_LEVELS = Object.freeze([
  { count: 0, discountPct: 0 },
  { count: 1, discountPct: 10 },
  { count: 2, discountPct: 15 },
  { count: 3, discountPct: 20 },
  { count: 4, discountPct: 25 },
  { count: 5, discountPct: 30 },
  { count: 6, discountPct: 50 },
  { count: 7, discountPct: 80 },
]);

const CASH_ONLY_SURFACES = new Set([
  CONTENT_SURFACE.INSTRUCTOR_AUDIO,
  CONTENT_SURFACE.INSTRUCTOR_VIDEO,
  CONTENT_SURFACE.WORKBOOK,
  CONTENT_SURFACE.DOWNLOAD,
]);

const ALWAYS_FREE_BOOKS = new Set(['happyprince']);
const STELLA_SHOWCASE_BOOKS = new Set(['oz', 'wedonotpart']);

const BOOK_ALIASES = Object.freeze({
  'happy-prince': 'happyprince',
  happy_prince: 'happyprince',
  'we-do-not-part': 'wedonotpart',
  we_do_not_part: 'wedonotpart',
});

const clampOwnedCount = (value) => {
  const count = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0;
  return Math.max(0, Math.min(7, count));
};

export const normalizeBookCode = (book) => {
  const key = String(book || '').trim().toLowerCase();
  return BOOK_ALIASES[key] || key;
};

export const normalizeEpisodeNo = (episodeNo) => {
  const no = Math.floor(Number(episodeNo));
  return Number.isFinite(no) && no > 0 ? no : null;
};

const percentageOff = (base, payable) =>
  base > 0 ? Math.round((1 - payable / base) * 10000) / 100 : 0;

const memberFavorRound = (rawPoints) =>
  rawPoints > 0 ? Math.max(1, Math.floor(rawPoints + 1e-9)) : 0;

export function ownershipLevelForCount(ownedCount) {
  return OWNERSHIP_LEVELS[clampOwnedCount(ownedCount)];
}

export function nextOwnershipLevel(ownedCount) {
  const current = ownershipLevelForCount(ownedCount);
  return current.count < 7 ? OWNERSHIP_LEVELS[current.count + 1] : null;
}

export function entitlementKeysFor(surface, book, episodeNo) {
  const normalizedBook = normalizeBookCode(book);
  const no = normalizeEpisodeNo(episodeNo);
  if (!normalizedBook || !no) return [];
  if (surface === CONTENT_SURFACE.STORY) {
    return [`story:${normalizedBook}:${no}`];
  }
  if (surface === CONTENT_SURFACE.AI_LECTURE) {
    return [
      `lecture:${normalizedBook}:${no}`,
      `story:${normalizedBook}:${no}`,
    ];
  }
  return [];
}

export function quoteContentItem({
  surface,
  book,
  episodeNo,
  ownedCount = 0,
  isStella = false,
  hasStoryAccess = false,
  hasAiLectureAccess = false,
  hasNewsletterSubscription = false,
} = {}) {
  const normalizedBook = normalizeBookCode(book);
  const no = normalizeEpisodeNo(episodeNo);
  const level = ownershipLevelForCount(ownedCount);
  const common = {
    policyVersion: CONTENT_POINT_POLICY_VERSION,
    surface,
    book: normalizedBook,
    episodeNo: no,
    ownedCount: level.count,
    discountPct: level.discountPct,
    isStella: !!isStella,
    permanent: false,
    entitlementKeys: [],
  };

  if (CASH_ONLY_SURFACES.has(surface)) {
    return { ...common, access: 'cash_only', reason: 'instructor_or_owned_asset' };
  }

  if (surface === CONTENT_SURFACE.NEWSLETTER) {
    return {
      ...common,
      access: hasNewsletterSubscription ? 'free' : 'email_subscription',
      reason: hasNewsletterSubscription ? 'subscribed' : 'lead_gate',
    };
  }

  const listedBase = POINT_BASE_PRICE[surface];
  if (!listedBase || !normalizedBook || !no) {
    return { ...common, access: 'unsupported', reason: 'invalid_or_unpriced' };
  }

  if (surface === CONTENT_SURFACE.STORY && (hasStoryAccess || hasAiLectureAccess)) {
    return { ...common, access: 'owned', reason: 'existing_entitlement', permanent: true };
  }
  if (surface === CONTENT_SURFACE.AI_LECTURE && hasAiLectureAccess) {
    return { ...common, access: 'owned', reason: 'existing_entitlement', permanent: true };
  }

  const publicPreview = no <= FREE_EPISODE_MAX;
  const permanentSampler = ALWAYS_FREE_BOOKS.has(normalizedBook);
  const stellaShowcase =
    !!isStella && STELLA_SHOWCASE_BOOKS.has(normalizedBook);

  if (publicPreview || permanentSampler || stellaShowcase) {
    return {
      ...common,
      access: 'free',
      reason: publicPreview
        ? 'public_preview'
        : permanentSampler
          ? 'permanent_sampler'
          : 'stella_showcase',
      permanent: true,
      basePoints: listedBase,
      payablePoints: 0,
      effectiveDiscountPct: 100,
      entitlementKeys: entitlementKeysFor(surface, normalizedBook, no),
    };
  }

  const basePoints =
    surface === CONTENT_SURFACE.AI_LECTURE && hasStoryAccess
      ? listedBase - POINT_BASE_PRICE[CONTENT_SURFACE.STORY]
      : listedBase;
  const rawPoints = (basePoints * (100 - level.discountPct)) / 100;
  const payablePoints = memberFavorRound(rawPoints);

  return {
    ...common,
    access: 'points',
    reason: hasStoryAccess ? 'story_to_ai_upgrade' : 'point_unlock',
    permanent: true,
    listedBasePoints: listedBase,
    basePoints,
    rawPoints,
    payablePoints,
    effectiveDiscountPct: percentageOff(basePoints, payablePoints),
    rounding: 'member_favor_floor',
    entitlementKeys: entitlementKeysFor(surface, normalizedBook, no),
  };
}

export function quoteRemainingBundle({
  items = [],
  ownedCount = 0,
  isStella = false,
} = {}) {
  const level = ownershipLevelForCount(ownedCount);
  const uniqueItems = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const book = normalizeBookCode(item?.book);
    const no = normalizeEpisodeNo(item?.episodeNo);
    const key = `${item?.surface}:${book}:${no || ''}`;
    if (!uniqueItems.has(key)) uniqueItems.set(key, { ...item, book, episodeNo: no });
  }

  for (const item of uniqueItems.values()) {
    if (item.surface !== CONTENT_SURFACE.AI_LECTURE) continue;
    uniqueItems.delete(`${CONTENT_SURFACE.STORY}:${item.book}:${item.episodeNo || ''}`);
  }

  const quotes = [...uniqueItems.values()].map((item) =>
    quoteContentItem({ ...item, ownedCount: level.count, isStella }),
  );
  const pointItems = quotes.filter((quote) => quote.access === 'points');
  const excludedItems = quotes.filter((quote) => quote.access !== 'points');
  const subtotalPoints = pointItems.reduce(
    (sum, quote) => sum + (quote.basePoints || 0),
    0,
  );

  if (!subtotalPoints) {
    return {
      policyVersion: CONTENT_POINT_POLICY_VERSION,
      access: 'free',
      reason: 'nothing_payable',
      ownedCount: level.count,
      discountPct: level.discountPct,
      bundleDiscountPct: REMAINING_BUNDLE_DISCOUNT_PCT,
      isStella: !!isStella,
      subtotalPoints: 0,
      payablePoints: 0,
      effectiveDiscountPct: 0,
      pointItems,
      excludedItems,
      entitlementKeys: [],
    };
  }

  const rawPoints = (
    subtotalPoints
    * (100 - level.discountPct)
    * (100 - REMAINING_BUNDLE_DISCOUNT_PCT)
  ) / 10000;
  const payablePoints = memberFavorRound(rawPoints);

  return {
    policyVersion: CONTENT_POINT_POLICY_VERSION,
    access: 'points',
    reason: 'remaining_bundle',
    permanent: true,
    ownedCount: level.count,
    discountPct: level.discountPct,
    bundleDiscountPct: REMAINING_BUNDLE_DISCOUNT_PCT,
    isStella: !!isStella,
    subtotalPoints,
    rawPoints,
    payablePoints,
    effectiveDiscountPct: percentageOff(subtotalPoints, payablePoints),
    rounding: 'member_favor_floor',
    pointItems,
    excludedItems,
    entitlementKeys: [
      ...new Set(pointItems.flatMap((quote) => quote.entitlementKeys || [])),
    ],
  };
}
