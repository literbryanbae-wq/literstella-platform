const CLASSIC_CODES = new Set(['kidari', 'gatsby', 'anne', 'pride', 'littlewomen1', 'littlewomen2', 'sherlock']);
const BADGE_BOOKS = Object.freeze({
  finish_B001: ['kidari'],
  finish_B018: ['gatsby'],
  finish_B005: ['anne'],
  finish_B013: ['pride'],
  finish_B009: ['littlewomen1', 'littlewomen2'],
  finish_B017: ['sherlock'],
});

const normalizedEmail = (value) => String(value || '').trim().toLowerCase();
const escaped = (value) => encodeURIComponent(String(value || ''));

async function rows(env, sbFetch, path) {
  const response = await sbFetch(env, path);
  const data = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(data)) throw new Error(`supabase_read_${response.status}`);
  return data;
}

export async function classMemberTierAdminRoute(req, env, cors, deps) {
  const { json, requireUser, sbFetch } = deps;
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405, cors);
  const authUser = await requireUser(req, env);
  if (!authUser) return json({ ok: false, error: 'unauthorized' }, 401, cors);
  if (normalizedEmail(authUser.email) !== normalizedEmail(env.ADMIN_EMAIL)) {
    return json({ ok: false, error: 'forbidden' }, 403, cors);
  }
  const body = await req.json().catch(() => ({}));
  const email = normalizedEmail(body?.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: 'bad_email' }, 400, cors);
  }

  try {
    const filter = escaped(email);
    const [enrollments, verified, redeemed, legacy, users] = await Promise.all([
      rows(env, sbFetch, `class_enrollments?email=eq.${filter}&select=book_code,source,granted_at`),
      rows(env, sbFetch, `class_verifications?email=eq.${filter}&select=book_code,verified_at,enrollment_email`),
      rows(env, sbFetch, `class_redemptions?redeemed_by=eq.${filter}&select=book_code,redeemed_at`),
      rows(env, sbFetch, `legacy_progress?email=eq.${filter}&select=book_code,pct,done,lectures_total`),
      rows(env, sbFetch, `users?email=eq.${filter}&select=id&limit=2`),
    ]);
    const badgeRows = users.length === 1
      ? await rows(env, sbFetch, `user_badges?user_id=eq.${escaped(users[0].id)}&select=badge_id`)
      : [];

    const rosterBooks = new Set(enrollments.map((row) => normalizedEmail(row?.book_code)).filter(Boolean));
    const ownedBooks = new Set([...verified, ...redeemed]
      .map((row) => normalizedEmail(row?.book_code))
      .filter((code) => CLASSIC_CODES.has(code)));
    const completedBooks = new Set();
    for (const row of badgeRows) {
      for (const code of BADGE_BOOKS[String(row?.badge_id || '')] || []) completedBooks.add(code);
    }
    for (const row of legacy) {
      const code = normalizedEmail(row?.book_code);
      if (!CLASSIC_CODES.has(code)) continue;
      const done = Array.isArray(row?.done) ? row.done.length : 0;
      const total = Number(row?.lectures_total) || 0;
      if (Number(row?.pct) >= 100 || (total > 0 && done >= total)) completedBooks.add(code);
    }
    const theoryOwned = [...verified, ...redeemed]
      .some((row) => normalizedEmail(row?.book_code) === 'theory');

    return json({
      ok: true,
      member: {
        email,
        rosterBooks: [...rosterBooks].sort(),
        ownedBooks: [...ownedBooks].sort(),
        completedBooks: [...completedBooks].sort(),
        classicOwnedCount: ownedBooks.size,
        classicCompletedCount: Math.min(7, completedBooks.size),
        bundleOwnedCount: Math.min(8, ownedBooks.size + (theoryOwned ? 1 : 0)),
        completionKnown: badgeRows.length > 0 || legacy.length > 0,
        duplicateProfile: users.length > 1,
      },
    }, 200, cors);
  } catch (error) {
    console.error('[class-member-tier-admin]', error?.message);
    return json({ ok: false, error: 'server_error' }, 502, cors);
  }
}
