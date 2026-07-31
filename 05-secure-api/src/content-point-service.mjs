import {
  CONTENT_POINT_POLICY_VERSION,
  CONTENT_SURFACE,
  entitlementKeysFor,
  nextOwnershipLevel,
  normalizeBookCode,
  normalizeEpisodeNo,
  ownershipLevelForCount,
  quoteContentItem,
  quoteRemainingBundle,
} from './content-point-pricing.mjs';
import {
  LYRA_POLICY_VERSION,
  pointProgressFromTransactions,
  resolveLyraProgress,
} from './lyra-policy.mjs';

const CLASSIC_BOOK_CODES = new Set([
  'kidari',
  'gatsby',
  'anne',
  'pride',
  'littlewomen1',
  'littlewomen2',
  'sherlock',
]);

const CLASSIC_BADGE_CREDITS = Object.freeze({
  finish_B001: 1,
  finish_B018: 1,
  finish_B005: 1,
  finish_B013: 1,
  finish_B009: 2,
  finish_B017: 1,
});

const POINT_SURFACES = new Set([
  CONTENT_SURFACE.STORY,
  CONTENT_SURFACE.AI_LECTURE,
]);

const escapeFilterValue = (value) => encodeURIComponent(String(value || ''));

async function readJson(response, fallback = null) {
  try {
    return await response.json();
  } catch {
    return fallback;
  }
}

async function fetchRows(env, sbFetch, path) {
  const response = await sbFetch(env, path);
  const data = await readJson(response, []);
  if (!response.ok || !Array.isArray(data)) {
    const error = new Error(`supabase_read_${response.status}`);
    error.status = response.status;
    error.detail = data;
    throw error;
  }
  return data;
}

async function resolvePointUser(env, sbFetch, authUser) {
  const byAuth = await fetchRows(
    env,
    sbFetch,
    `users?auth_uid=eq.${escapeFilterValue(authUser.id)}&select=id,email,auth_uid&limit=2`,
  );
  if (byAuth.length === 1) return byAuth[0];
  if (byAuth.length > 1) throw new Error('duplicate_auth_uid');

  if (!authUser.email) return null;
  const byEmail = await fetchRows(
    env,
    sbFetch,
    `users?email=eq.${escapeFilterValue(authUser.email)}&select=id,email,auth_uid&limit=2`,
  );
  if (byEmail.length === 1) {
    const linkedAuthUid = String(byEmail[0]?.auth_uid || '');
    if (linkedAuthUid && linkedAuthUid !== authUser.id) {
      throw new Error('profile_auth_mismatch');
    }
    return byEmail[0];
  }
  if (byEmail.length > 1) throw new Error('duplicate_user_email');
  return null;
}

function elevatedStellaEmails(env) {
  return new Set([
    String(env.ADMIN_EMAIL || '').trim().toLowerCase(),
    ...String(env.POINT_STELLA_TEST_EMAILS || 'test-kidari@literstella.co.kr')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ].filter(Boolean));
}

async function fetchOwnership(env, sbFetch, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (elevatedStellaEmails(env).has(normalizedEmail)) {
    const level = ownershipLevelForCount(7);
    return { books: [...CLASSIC_BOOK_CODES], level };
  }

  const [verified, redeemed] = await Promise.all([
    fetchRows(
      env,
      sbFetch,
      `class_verifications?email=eq.${escapeFilterValue(normalizedEmail)}&select=book_code`,
    ),
    fetchRows(
      env,
      sbFetch,
      `class_redemptions?redeemed_by=eq.${escapeFilterValue(normalizedEmail)}&select=book_code`,
    ),
  ]);
  const books = new Set(
    [...verified, ...redeemed]
      .map((row) => String(row?.book_code || '').trim().toLowerCase())
      .filter((book) => CLASSIC_BOOK_CODES.has(book)),
  );
  return { books: [...books].sort(), level: ownershipLevelForCount(books.size) };
}

async function fetchBalance(env, sbFetch, userId) {
  const rows = await fetchRows(
    env,
    sbFetch,
    `point_transactions?user_id=eq.${escapeFilterValue(userId)}&select=amount`,
  );
  return rows.reduce((sum, row) => sum + (Number(row?.amount) || 0), 0);
}

async function fetchPointProgress(env, sbFetch, userId) {
  const rows = await fetchRows(
    env,
    sbFetch,
    `point_transactions?user_id=eq.${escapeFilterValue(userId)}&select=amount,reason`,
  );
  return pointProgressFromTransactions(rows);
}

async function fetchClassicCompletion(env, sbFetch, userId, email) {
  if (elevatedStellaEmails(env).has(String(email || '').trim().toLowerCase())) {
    return {
      known: true,
      completedCount: 7,
      completedBadgeIds: Object.keys(CLASSIC_BADGE_CREDITS),
    };
  }
  const rows = await fetchRows(
    env,
    sbFetch,
    `user_badges?user_id=eq.${escapeFilterValue(userId)}&select=badge_id`,
  );
  const badgeIds = new Set(
    rows
      .map((row) => String(row?.badge_id || ''))
      .filter((badgeId) => badgeId in CLASSIC_BADGE_CREDITS),
  );
  const completedCount = Math.min(
    7,
    [...badgeIds].reduce(
      (sum, badgeId) => sum + CLASSIC_BADGE_CREDITS[badgeId],
      0,
    ),
  );
  return {
    known: true,
    completedCount,
    completedBadgeIds: [...badgeIds].sort(),
  };
}

async function fetchEntitlements(env, sbFetch, userId, book) {
  const rows = await fetchRows(
    env,
    sbFetch,
    `content_entitlements?user_id=eq.${escapeFilterValue(userId)}&book_code=eq.${escapeFilterValue(book)}&select=surface,episode_no`,
  );
  const keys = new Set();
  for (const row of rows) {
    const no = normalizeEpisodeNo(row?.episode_no);
    if (!no) continue;
    if (row?.surface === CONTENT_SURFACE.AI_LECTURE) keys.add(`lecture:${book}:${no}`);
    if (row?.surface === CONTENT_SURFACE.STORY) keys.add(`story:${book}:${no}`);
  }
  return keys;
}

async function fetchCatalogItem(env, sbFetch, surface, book, episodeNo) {
  const rows = await fetchRows(
    env,
    sbFetch,
    `point_content_catalog?surface=eq.${escapeFilterValue(surface)}&book_code=eq.${escapeFilterValue(book)}&episode_no=eq.${episodeNo}&active=eq.true&select=surface,book_code,episode_no&limit=1`,
  );
  return rows[0] || null;
}

async function fetchCatalogBook(env, sbFetch, book) {
  return fetchRows(
    env,
    sbFetch,
    `point_content_catalog?book_code=eq.${escapeFilterValue(book)}&active=eq.true&select=surface,book_code,episode_no&order=episode_no.asc,surface.asc`,
  );
}

function flagsFor(entitlements, book, episodeNo) {
  return {
    hasStoryAccess: entitlements.has(`story:${book}:${episodeNo}`),
    hasAiLectureAccess: entitlements.has(`lecture:${book}:${episodeNo}`),
  };
}

function unavailableQuote(quote) {
  return {
    ...quote,
    access: 'unavailable',
    reason: 'not_published',
    payablePoints: 0,
    entitlementKeys: [],
  };
}

async function buildItemQuote({
  env,
  sbFetch,
  pointUser,
  ownership,
  entitlements,
  completion,
  surface,
  book,
  episodeNo,
}) {
  const quote = quoteContentItem({
    surface,
    book,
    episodeNo,
    ownedCount: ownership.level.count,
    isStella: completion.completedCount === 7,
    ...flagsFor(entitlements, book, episodeNo),
  });
  if (quote.access === 'points') {
    const published = await fetchCatalogItem(env, sbFetch, surface, book, episodeNo);
    if (!published) return unavailableQuote(quote);
  }
  return {
    ...quote,
    userId: pointUser.id,
    ownershipBooks: ownership.books,
    nextLevel: nextOwnershipLevel(ownership.level.count),
  };
}

async function buildBundleQuote({
  env,
  sbFetch,
  pointUser,
  ownership,
  entitlements,
  completion,
  book,
}) {
  const catalog = await fetchCatalogBook(env, sbFetch, book);
  const items = catalog
    .filter((row) => POINT_SURFACES.has(row?.surface))
    .map((row) => ({
      surface: row.surface,
      book,
      episodeNo: normalizeEpisodeNo(row.episode_no),
      ...flagsFor(entitlements, book, normalizeEpisodeNo(row.episode_no)),
    }))
    .filter((item) => item.episodeNo);
  return {
    ...quoteRemainingBundle({
      items,
      ownedCount: ownership.level.count,
      isStella: completion.completedCount === 7,
    }),
    book,
    userId: pointUser.id,
    ownershipBooks: ownership.books,
    nextLevel: nextOwnershipLevel(ownership.level.count),
    catalogItemCount: items.length,
  };
}

function parseEntitlementKey(key) {
  const match = String(key || '').match(/^(lecture|story):([a-z0-9_-]+):([1-9]\d*)$/);
  if (!match) return null;
  return {
    surface: match[1] === 'lecture'
      ? CONTENT_SURFACE.AI_LECTURE
      : CONTENT_SURFACE.STORY,
    book_code: match[2],
    episode_no: Number(match[3]),
  };
}

async function digest16(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

async function purchaseIdentity(mode, quote) {
  if (mode === 'bundle') {
    const keys = [...(quote.entitlementKeys || [])].sort();
    return {
      reason: 'content_bundle',
      refId: `content:v1:bundle:${quote.book}:${await digest16(keys.join('|'))}`,
      memo: `content bundle ${quote.book}`,
    };
  }
  return {
    reason: quote.surface === CONTENT_SURFACE.STORY ? 'story' : 'lecture',
    refId: `content:v1:${quote.surface}:${quote.book}:${quote.episodeNo}`,
    memo: `content item ${quote.surface} ${quote.book} ${quote.episodeNo}`,
  };
}

async function callAtomicSpend(env, sbFetch, payload) {
  const response = await sbFetch(env, 'rpc/spend_content_points_atomic', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await readJson(response, null);
  if (!response.ok) {
    return {
      ok: false,
      error: response.status === 404 ? 'sql_pending' : 'spend_rpc_failed',
      status: response.status,
      detail: data,
    };
  }
  return data && typeof data === 'object'
    ? data
    : { ok: false, error: 'invalid_rpc_response' };
}

function publicQuote(quote, balance) {
  const {
    userId: _userId,
    entitlementKeys: _entitlementKeys,
    pointItems,
    excludedItems,
    ...safe
  } = quote;
  return {
    ...safe,
    balance,
    pointItemCount: Array.isArray(pointItems) ? pointItems.length : undefined,
    excludedItemCount: Array.isArray(excludedItems) ? excludedItems.length : undefined,
  };
}

async function buildContext(env, sbFetch, authUser, book) {
  const pointUser = await resolvePointUser(env, sbFetch, authUser);
  if (!pointUser) return { error: 'profile_missing' };
  const [ownership, entitlements, balance, completion] = await Promise.all([
    fetchOwnership(env, sbFetch, authUser.email),
    fetchEntitlements(env, sbFetch, pointUser.id, book),
    fetchBalance(env, sbFetch, pointUser.id),
    fetchClassicCompletion(env, sbFetch, pointUser.id, authUser.email),
  ]);
  return { pointUser, ownership, entitlements, balance, completion };
}

async function buildMemberProgress(env, sbFetch, authUser) {
  const pointUser = await resolvePointUser(env, sbFetch, authUser);
  if (!pointUser) return { error: 'profile_missing' };
  const [points, completion] = await Promise.all([
    fetchPointProgress(env, sbFetch, pointUser.id),
    fetchClassicCompletion(env, sbFetch, pointUser.id, authUser.email),
  ]);
  return {
    ...points,
    ...resolveLyraProgress({
      cumulativeEarnedPoints: points.cumulativeEarnedPoints,
      classicCompletedCount: completion.completedCount,
      completionKnown: completion.known,
    }),
  };
}

async function quoteRequest(env, sbFetch, authUser, body) {
  const mode = body?.mode === 'bundle' ? 'bundle' : 'item';
  const book = normalizeBookCode(body?.book);
  if (!book || !/^[a-z0-9_-]{1,64}$/.test(book)) return { error: 'bad_book' };

  const context = await buildContext(env, sbFetch, authUser, book);
  if (context.error) return context;

  if (mode === 'bundle') {
    const quote = await buildBundleQuote({ env, sbFetch, book, ...context });
    return { mode, quote, ...context };
  }

  const surface = String(body?.surface || '');
  const episodeNo = normalizeEpisodeNo(body?.episodeNo);
  if (!POINT_SURFACES.has(surface) || !episodeNo) return { error: 'bad_item' };
  const quote = await buildItemQuote({
    env,
    sbFetch,
    surface,
    book,
    episodeNo,
    ...context,
  });
  return { mode, quote, ...context };
}

async function unlockRequest(env, sbFetch, authUser, body) {
  // Rebuild after a stale quote so overlapping tabs cannot double-charge.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await quoteRequest(env, sbFetch, authUser, body);
    if (result.error) return result;
    const { mode, quote, entitlements, pointUser, balance } = result;

    if (quote.access === 'free' || quote.access === 'owned') {
      return { ok: true, quote, balance, idempotent: quote.access === 'owned' };
    }
    if (quote.access !== 'points' || !quote.payablePoints) {
      return { error: quote.reason || quote.access, quote, balance };
    }

    const missingKeys = (quote.entitlementKeys || [])
      .filter((key) => !entitlements.has(key));
    const entitlementRows = missingKeys
      .map(parseEntitlementKey)
      .filter(Boolean);
    if (!entitlementRows.length) {
      return { ok: true, quote: { ...quote, access: 'owned' }, balance, idempotent: true };
    }

    const identity = await purchaseIdentity(mode, { ...quote, entitlementKeys: missingKeys });
    const spent = await callAtomicSpend(env, sbFetch, {
      p_user_id: pointUser.id,
      p_amount: quote.payablePoints,
      p_reason: identity.reason,
      p_ref_id: identity.refId,
      p_memo: identity.memo,
      p_entitlements: entitlementRows,
      p_policy_version: CONTENT_POINT_POLICY_VERSION,
    });
    if (spent?.ok) {
      return {
        ok: true,
        quote,
        balance: Number.isFinite(Number(spent.balance))
          ? Number(spent.balance)
          : balance - quote.payablePoints,
        transactionId: spent.transaction_id || null,
        idempotent: !!spent.idempotent,
      };
    }
    if (spent?.error !== 'stale_quote') return { ...spent, quote, balance };
  }
  return { error: 'stale_quote' };
}

export async function contentPointRoute(req, env, cors, sub, {
  json,
  requireUser,
  sbFetch,
}) {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method' }, 405, cors);
  }
  const authUser = await requireUser(req, env);
  if (!authUser) return json({ ok: false, error: 'unauthorized' }, 401, cors);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400, cors);
  }

  try {
    if (sub === 'progress') {
      const progress = await buildMemberProgress(env, sbFetch, authUser);
      if (progress.error) {
        return json({ ok: false, error: progress.error }, 409, cors);
      }
      return json({
        ok: true,
        ...progress,
        policyVersion: LYRA_POLICY_VERSION,
      }, 200, cors);
    }

    if (sub === 'entitlements') {
      const book = normalizeBookCode(body?.book);
      if (!book || !/^[a-z0-9_-]{1,64}$/.test(book)) {
        return json({ ok: false, error: 'bad_book' }, 400, cors);
      }
      const context = await buildContext(env, sbFetch, authUser, book);
      if (context.error) return json({ ok: false, error: context.error }, 409, cors);
      const lectures = [];
      const stories = [];
      for (const key of context.entitlements) {
        const parsed = parseEntitlementKey(key);
        if (!parsed) continue;
        if (parsed.surface === CONTENT_SURFACE.AI_LECTURE) lectures.push(parsed.episode_no);
        if (parsed.surface === CONTENT_SURFACE.STORY) stories.push(parsed.episode_no);
      }
      return json({
        ok: true,
        policyVersion: CONTENT_POINT_POLICY_VERSION,
        book,
        lectures: lectures.sort((a, b) => a - b),
        stories: stories.sort((a, b) => a - b),
        balance: context.balance,
        ownedCount: context.ownership.level.count,
        discountPct: context.ownership.level.discountPct,
        realization: resolveLyraProgress({
          classicCompletedCount: context.completion.completedCount,
          completionKnown: context.completion.known,
        }).realization,
        stellaUnlocked: context.completion.completedCount === 7,
      }, 200, cors);
    }

    if (sub === 'quote') {
      const result = await quoteRequest(env, sbFetch, authUser, body);
      if (result.error) return json({ ok: false, error: result.error }, 400, cors);
      return json({ ok: true, mode: result.mode, quote: publicQuote(result.quote, result.balance) }, 200, cors);
    }

    if (sub === 'unlock') {
      const result = await unlockRequest(env, sbFetch, authUser, body);
      if (result.ok) {
        return json({
          ok: true,
          quote: publicQuote(result.quote, result.balance),
          balance: result.balance,
          transactionId: result.transactionId,
          idempotent: result.idempotent,
        }, 200, cors);
      }
      const status = result.error === 'insufficient_points'
        ? 409
        : result.error === 'sql_pending'
          ? 503
          : result.error === 'not_published'
            ? 409
            : 400;
      return json({
        ok: false,
        error: result.error || 'unlock_failed',
        balance: result.balance,
        quote: result.quote ? publicQuote(result.quote, result.balance) : undefined,
      }, status, cors);
    }
  } catch (error) {
    console.error('[content-points]', {
      sub,
      message: error?.message,
      status: error?.status,
    });
    return json({ ok: false, error: 'server_error' }, 502, cors);
  }

  return json({ ok: false, error: 'not_found' }, 404, cors);
}
