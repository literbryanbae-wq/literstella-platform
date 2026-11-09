// Server copy of the point-content pricing policy.
//
// Keep CONTENT_POINT_POLICY_VERSION aligned with:
// 02-challenge/literstella-challenge/src/lib/contentPointPricing.js

export const CONTENT_POINT_POLICY_VERSION = '2026-08-14-v3';

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
// 운영자 확정 2026-08-14: 쇼케이스(오즈·작별) 전편 무료는 **소장 축** — 클래식 7종 전부
// 소장(=올인원 동급)일 때 열린다. 완독·포인트는 라일라 등급만 바꾼다(물질 혜택 없음).
// isStella(완독 7종)는 이제 가격에 영향이 없는 정보 필드다.
const SHOWCASE_OWNED_MIN = 7;
// 강의와 스토리를 따로 결제하는 책. 지금은 없다.
//   어린 왕자는 2026-10-17 부터 따로 결제였다가 2026-11-10 운영자 결정("오즈처럼 — 강의를 열면 그 장 스토리도 함께")으로
//   아래 LECTURE_STORY_MAP 표로 옮겼다. 다시 따로 받으려면 여기에 넣고 표를 빼면 된다.
const LECTURE_ONLY_BOOKS = new Set();
// 강 번호와 편(장) 번호가 어긋나는 책의 '강 → 함께 열리는 스토리 편' 표(운영자 2026-11-02 "강독 우선 —
// 관련 스토리는 함께 열린다 · 스토리를 먼저 산 분의 차액 할인은 스토리마다 한 번").
//   오즈 v3.2.2 강독은 한 장을 여러 강으로 나눈다(1장 3강 · 2장 5강 · 3장 5강 · 4장 4강 · 5장 5강 · 6장 4강 = 26강).
//   값 = 엔진 final.json·클래스 public/stella/oz.json 의 chapter 칸(팩토리 확인 2026-11-02). 스토리 oz-N = N장.
//   🔴 표에 없는 강은 스토리를 열지 않는다(fail-closed) — 27강부터(7장~)는 표를 늘린 뒤에 판다.
//   표에 없는 책은 예전처럼 강 N = 편 N(행복한 왕자·작별).
const LECTURE_STORY_MAP = Object.freeze({
  oz: Object.freeze([
    null,
    1, 1, 1,
    2, 2, 2, 2, 2,
    3, 3, 3, 3, 3,
    4, 4, 4, 4,
    5, 5, 5, 5, 5,
    6, 6, 6, 6, // 23~26강 = 6장(운영자 11-02 "그래" — 팩토리 엔진 계획표 lecture-plan-from-ch6.json)
  ]),
  // 어린 왕자 91강 → 스토리 26편(운영자 2026-11-10 "오즈처럼 강의를 열면 그 장 스토리도 함께").
  //   값 = 클래스 앱 src/lib/stellaLectures.js 90005 storyMap 그대로(강의실이 '이 강의 스토리'로 여는 편).
  //   🔴 두 표는 같아야 한다 — content-point-pricing-test 가 클래스 표 사본과 대조한다.
  littleprince: Object.freeze([
    null,
    1, 1, 1, 1, // 1~4강 = 1편
    2, 2, 2, 2, // 5~8강 = 2편
    3, 3, // 9~10강 = 3편
    4, 4, 4, 4, // 11~14강 = 4편
    5, 5, 5, // 15~17강 = 5편
    6, 6, // 18~19강 = 6편
    7, 7, 7, 7, // 20~23강 = 7편
    8, 8, 8, 8, 8, // 24~28강 = 8편
    9, 9, // 29~30강 = 9편
    10, 10, 10, 10, 10, 10, 10, // 31~37강 = 10편
    11, 11, 11, // 38~40강 = 11편
    12, 12, 12, 12, 12, // 41~45강 = 12편
    13, 13, 13, 13, // 46~49강 = 13편
    14, 14, 14, 14, 14, // 50~54강 = 14편
    15, // 55~55강 = 15편
    16, 16, 16, // 56~58강 = 16편
    17, 17, // 59~60강 = 17편
    18, // 61~61강 = 18편
    19, 19, 19, 19, 19, // 62~66강 = 19편
    20, 20, // 67~68강 = 20편
    21, 21, 21, // 69~71강 = 21편
    22, 22, 22, 22, // 72~75강 = 22편
    23, 23, 23, 23, // 76~79강 = 23편
    24, 24, 24, // 80~82강 = 24편
    25, 25, 25, 25, 25, 25, 25, // 83~89강 = 25편
    26, 26, // 90~91강 = 26편
  ]),
});

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

// 강의 N 을 사면 함께 열리는 스토리 편 번호 — 없으면 null(강의만 열린다).
export function storyEpisodeForLecture(book, lectureNo) {
  const normalizedBook = normalizeBookCode(book);
  const no = normalizeEpisodeNo(lectureNo);
  if (!normalizedBook || !no || LECTURE_ONLY_BOOKS.has(normalizedBook)) return null;
  const map = LECTURE_STORY_MAP[normalizedBook];
  if (map) return normalizeEpisodeNo(map[no]);
  return no;
}

export function entitlementKeysFor(surface, book, episodeNo) {
  const normalizedBook = normalizeBookCode(book);
  const no = normalizeEpisodeNo(episodeNo);
  if (!normalizedBook || !no) return [];
  if (surface === CONTENT_SURFACE.STORY) {
    return [`story:${normalizedBook}:${no}`];
  }
  if (surface === CONTENT_SURFACE.AI_LECTURE) {
    const storyNo = storyEpisodeForLecture(normalizedBook, no);
    if (!storyNo) return [`lecture:${normalizedBook}:${no}`];
    return [
      `lecture:${normalizedBook}:${no}`,
      `story:${normalizedBook}:${storyNo}`,
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
  storyCreditUsed = false,
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

  if (surface === CONTENT_SURFACE.STORY && (hasStoryAccess || (hasAiLectureAccess && !LECTURE_ONLY_BOOKS.has(normalizedBook)))) {
    return { ...common, access: 'owned', reason: 'existing_entitlement', permanent: true };
  }
  if (surface === CONTENT_SURFACE.AI_LECTURE && hasAiLectureAccess) {
    return { ...common, access: 'owned', reason: 'existing_entitlement', permanent: true };
  }

  const publicPreview = no <= FREE_EPISODE_MAX;
  const permanentSampler = ALWAYS_FREE_BOOKS.has(normalizedBook);
  const ownerShowcase =
    level.count >= SHOWCASE_OWNED_MIN && STELLA_SHOWCASE_BOOKS.has(normalizedBook);

  if (publicPreview || permanentSampler || ownerShowcase) {
    return {
      ...common,
      access: 'free',
      reason: publicPreview
        ? 'public_preview'
        : permanentSampler
          ? 'permanent_sampler'
          : 'owner_showcase',
      permanent: true,
      basePoints: listedBase,
      payablePoints: 0,
      effectiveDiscountPct: 100,
      entitlementKeys: entitlementKeysFor(surface, normalizedBook, no),
    };
  }

  // 스토리 차액 할인은 그 스토리(편)마다 한 번 — 같은 편의 다른 강을 이미 열었으면(storyCreditUsed) 정가.
  //   hasStoryAccess = 이 강이 함께 여는 편을 이미 가졌나(부르는 쪽이 storyEpisodeForLecture 로 맞춰 넘긴다).
  const storyUpgrade =
    surface === CONTENT_SURFACE.AI_LECTURE
    && hasStoryAccess
    && !storyCreditUsed
    && !!storyEpisodeForLecture(normalizedBook, no);
  const basePoints = storyUpgrade
    ? listedBase - POINT_BASE_PRICE[CONTENT_SURFACE.STORY]
    : listedBase;
  const rawPoints = (basePoints * (100 - level.discountPct)) / 100;
  const payablePoints = memberFavorRound(rawPoints);

  return {
    ...common,
    access: 'points',
    reason: storyUpgrade ? 'story_to_ai_upgrade' : 'point_unlock',
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

  // 강의가 함께 여는 스토리 편은 묶음에서 따로 세지 않는다(강의 값에 들어 있다).
  for (const item of [...uniqueItems.values()]) {
    if (item.surface !== CONTENT_SURFACE.AI_LECTURE) continue;
    const storyNo = storyEpisodeForLecture(item.book, item.episodeNo);
    if (storyNo) uniqueItems.delete(`${CONTENT_SURFACE.STORY}:${item.book}:${storyNo}`);
  }

  // 묶음 안에서도 스토리 차액 할인은 편마다 한 번 — 강 번호 순서로 첫 강에만.
  const creditTaken = new Set();
  const ordered = [...uniqueItems.values()].sort((a, b) => (a.episodeNo || 0) - (b.episodeNo || 0));
  const quotes = ordered.map((item) => {
    const storyNo = item.surface === CONTENT_SURFACE.AI_LECTURE
      ? storyEpisodeForLecture(item.book, item.episodeNo)
      : null;
    const creditKey = storyNo ? `${item.book}:${storyNo}` : null;
    const quote = quoteContentItem({
      ...item,
      storyCreditUsed: !!item.storyCreditUsed || (creditKey ? creditTaken.has(creditKey) : false),
      ownedCount: level.count,
      isStella,
    });
    if (creditKey && quote.reason === 'story_to_ai_upgrade') creditTaken.add(creditKey);
    return quote;
  });
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
