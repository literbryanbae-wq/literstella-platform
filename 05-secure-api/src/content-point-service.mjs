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

const CLASSIC_BOOKS_BY_BADGE = Object.freeze({
  finish_B001: ['kidari'],
  finish_B018: ['gatsby'],
  finish_B005: ['anne'],
  finish_B013: ['pride'],
  finish_B009: ['littlewomen1', 'littlewomen2'],
  finish_B017: ['sherlock'],
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
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const [rows, legacyRows] = await Promise.all([
    fetchRows(
      env,
      sbFetch,
      `user_badges?user_id=eq.${escapeFilterValue(userId)}&select=badge_id`,
    ),
    fetchRows(
      env,
      sbFetch,
      `legacy_progress?email=eq.${escapeFilterValue(normalizedEmail)}&select=book_code,pct,done,lectures_total`,
    ),
  ]);
  const badgeIds = new Set(
    rows
      .map((row) => String(row?.badge_id || ''))
      .filter((badgeId) => badgeId in CLASSIC_BADGE_CREDITS),
  );
  const completedBooks = new Set(
    [...badgeIds].flatMap((badgeId) => CLASSIC_BOOKS_BY_BADGE[badgeId] || []),
  );
  for (const row of legacyRows) {
    const bookCode = String(row?.book_code || '').trim().toLowerCase();
    if (!CLASSIC_BOOK_CODES.has(bookCode)) continue;
    const doneCount = Array.isArray(row?.done) ? row.done.length : 0;
    const lecturesTotal = Number(row?.lectures_total) || 0;
    const completed = Number(row?.pct) >= 100
      || (lecturesTotal > 0 && doneCount >= lecturesTotal);
    if (completed) completedBooks.add(bookCode);
  }
  return {
    known: badgeIds.size > 0 || legacyRows.length > 0,
    completedCount: Math.min(7, completedBooks.size),
    completedBadgeIds: [...badgeIds].sort(),
    completedBooks: [...completedBooks].sort(),
  };
}

function completionWithOwnershipKnowledge(completion, ownership) {
  return {
    ...completion,
    known: completion.known || ownership.level.count === 0,
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
  return {
    pointUser,
    ownership,
    entitlements,
    balance,
    completion: completionWithOwnershipKnowledge(completion, ownership),
  };
}

async function buildMemberProgress(env, sbFetch, authUser) {
  const pointUser = await resolvePointUser(env, sbFetch, authUser);
  if (!pointUser) return { error: 'profile_missing' };
  const [points, ownership, completion] = await Promise.all([
    fetchPointProgress(env, sbFetch, pointUser.id),
    fetchOwnership(env, sbFetch, authUser.email),
    fetchClassicCompletion(env, sbFetch, pointUser.id, authUser.email),
  ]);
  const resolvedCompletion = completionWithOwnershipKnowledge(completion, ownership);
  return {
    ...points,
    ...resolveLyraProgress({
      cumulativeEarnedPoints: points.cumulativeEarnedPoints,
      classicCompletedCount: resolvedCompletion.completedCount,
      completionKnown: resolvedCompletion.known,
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

// ── 스텔라 초대권 (6개월) — 운영자 확정 2026-08-06 ──────────────────────────
//   정책 명세: access-tiers 메모리 "스텔라 초대권" 절. 마케팅 카피는 이 값을 따른다.
//   ⚠️ 마감·만료 판정은 반드시 서버 시각으로(클라 시각 신뢰 금지).
//   ⚠️ 자격 = fetchOwnership 기준(class_verifications/redemptions) — 명단(class_enrollments)만으론
//      부족하고 본인 인증을 거친 소장만 인정한다. 위조 방지 경계를 여기서도 유지.
export const STELLA_INVITE = Object.freeze({
  optInDeadline: '2026-08-31T23:59:59+09:00', // 이 시각까지 '도전 시작하기' 클릭
  expiresAt: '2027-02-28T23:59:59+09:00',     // 전원 동일 만료(운영·발송 단순화)
  minOwnedBooks: 1,                            // 🔧 자격 다이얼: 클래식 소장 N권 이상(운영자 결정 시 이 값만 변경)
});

async function fetchStellaInvite(env, sbFetch, userId) {
  const rows = await fetchRows(
    env,
    sbFetch,
    `stella_invites?user_id=eq.${escapeFilterValue(userId)}&select=activated_at,expires_at,owned_count`,
  );
  const row = rows[0];
  if (!row) return { activated: false, active: false };
  const expiresMs = Date.parse(row.expires_at);
  return {
    activated: true,
    active: Number.isFinite(expiresMs) && Date.now() < expiresMs,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    ownedCountAtActivation: row.owned_count ?? null,
  };
}

// 활성화 — 멱등(user_id PK + 기존 조회 선행). 두 번 눌러도 최초 1회만 기록된다.
async function activateStellaInvite(env, sbFetch, authUser) {
  const pointUser = await resolvePointUser(env, sbFetch, authUser);
  if (!pointUser) return { error: 'profile_missing' };

  const existing = await fetchStellaInvite(env, sbFetch, pointUser.id);
  if (existing.activated) return { ok: true, invite: existing, alreadyActivated: true };

  if (Date.now() > Date.parse(STELLA_INVITE.optInDeadline)) {
    return { error: 'invite_closed' };
  }

  const ownership = await fetchOwnership(env, sbFetch, pointUser.email);
  if (ownership.books.length < STELLA_INVITE.minOwnedBooks) {
    return { error: 'not_eligible', ownedCount: ownership.books.length };
  }

  const response = await sbFetch(env, 'stella_invites?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify([{
      user_id: pointUser.id,
      email: String(pointUser.email || '').trim().toLowerCase() || null,
      expires_at: STELLA_INVITE.expiresAt,
      owned_count: ownership.books.length,
      source: 'optin',
      policy_version: LYRA_POLICY_VERSION,
    }]),
  });
  if (!response.ok) {
    // 테이블 미생성(운영자 SQL 전)이면 친화 코드로 — 앱은 '준비 중' 안내
    return { error: response.status === 404 ? 'sql_pending' : 'invite_write_failed' };
  }
  const invite = await fetchStellaInvite(env, sbFetch, pointUser.id);
  return { ok: true, invite, ownedCount: ownership.books.length };
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

    // 스텔라 초대권: mode='status'(조회) / 기본(활성화). 활성화는 서버가 마감·자격·멱등 전부 판정.
    if (sub === 'invite') {
      const pointUser = await resolvePointUser(env, sbFetch, authUser);
      if (!pointUser) return json({ ok: false, error: 'profile_missing' }, 409, cors);

      if (body?.mode === 'status') {
        const [invite, ownership] = await Promise.all([
          fetchStellaInvite(env, sbFetch, pointUser.id),
          fetchOwnership(env, sbFetch, pointUser.email),
        ]);
        return json({
          ok: true,
          invite,
          eligible: ownership.books.length >= STELLA_INVITE.minOwnedBooks,
          ownedCount: ownership.books.length,
          optInOpen: Date.now() <= Date.parse(STELLA_INVITE.optInDeadline),
          optInDeadline: STELLA_INVITE.optInDeadline,
          expiresAt: STELLA_INVITE.expiresAt,
        }, 200, cors);
      }

      const result = await activateStellaInvite(env, sbFetch, authUser);
      if (result.error) {
        const status = result.error === 'not_eligible' ? 403
          : result.error === 'invite_closed' ? 410
          : result.error === 'sql_pending' ? 503
          : 409;
        return json({ ok: false, ...result }, status, cors);
      }
      return json({ ok: true, ...result }, 200, cors);
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
