import assert from 'node:assert/strict';
import { contentPointRoute } from './src/content-point-service.mjs';

const env = {
  ADMIN_EMAIL: 'owner@example.com',
  POINT_STELLA_TEST_EMAILS: '',
};

const authUser = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'reader@example.com',
};
const pointUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const rpcCalls = [];
let progressScenario = 'badge';

const rows = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

async function sbFetch(_env, path, init = {}) {
  if (path.startsWith('users?auth_uid=')) {
    return rows([{ id: pointUserId, email: authUser.email }]);
  }
  if (path.startsWith('class_verifications?')) {
    return rows([{ book_code: 'kidari' }, { book_code: 'anne' }]);
  }
  if (path.startsWith('class_redemptions?')) {
    return rows([{ book_code: 'gatsby' }]);
  }
  if (path.startsWith('point_transactions?')) {
    return rows([
      { amount: 100, reason: 'checkin' },
      { amount: -10, reason: 'lecture' },
    ]);
  }
  if (path.startsWith('user_badges?')) {
    return rows(progressScenario === 'badge' ? [{ badge_id: 'finish_B001' }] : []);
  }
  if (path.startsWith('legacy_progress?')) {
    return rows(progressScenario === 'legacy' ? [{
      book_code: 'anne',
      pct: 100,
      done: [1, 2, 3],
      lectures_total: 3,
    }] : []);
  }
  if (path.startsWith('content_entitlements?')) {
    return rows([{ surface: 'story', episode_no: 6 }]);
  }
  if (path.includes('point_content_catalog?surface=eq.ai_lecture')
      && path.includes('episode_no=eq.6')) {
    return rows([{ surface: 'ai_lecture', book_code: 'future-ai', episode_no: 6 }]);
  }
  if (path.includes('point_content_catalog?surface=eq.story')
      && path.includes('episode_no=eq.7')) {
    return rows([{ surface: 'story', book_code: 'future-ai', episode_no: 7 }]);
  }
  if (path.startsWith('point_content_catalog?book_code=')) {
    return rows([
      { surface: 'story', book_code: 'future-ai', episode_no: 6 },
      { surface: 'ai_lecture', book_code: 'future-ai', episode_no: 6 },
      { surface: 'ai_lecture', book_code: 'future-ai', episode_no: 7 },
    ]);
  }
  if (path === 'rpc/spend_content_points_atomic') {
    const payload = JSON.parse(init.body);
    rpcCalls.push(payload);
    return rows({
      ok: true,
      balance: 86,
      transaction_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      idempotent: false,
    });
  }
  return rows({ message: `unhandled ${path}` }, 500);
}

const deps = {
  sbFetch,
  requireUser: async () => authUser,
  json: (data, status, cors) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cors || {}) },
  }),
};

async function call(sub, body) {
  const request = new Request(`https://example.com/api/points/content/${sub}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Token': 'test' },
    body: JSON.stringify(body),
  });
  const response = await contentPointRoute(request, env, {}, sub, deps);
  return { status: response.status, body: await response.json() };
}

const quote = await call('quote', {
  mode: 'item',
  surface: 'ai_lecture',
  book: 'future-ai',
  episodeNo: 6,
});
assert.equal(quote.status, 200);
assert.equal(quote.body.quote.ownedCount, 3);
assert.equal(quote.body.quote.discountPct, 20);
assert.equal('lyraMode' in quote.body.quote, false);
assert.equal(quote.body.quote.reason, 'story_to_ai_upgrade');
assert.equal(quote.body.quote.payablePoints, 4);
assert.equal(quote.body.quote.balance, 90);
assert.equal('entitlementKeys' in quote.body.quote, false);

const unlock = await call('unlock', {
  mode: 'item',
  surface: 'ai_lecture',
  book: 'future-ai',
  episodeNo: 6,
});
assert.equal(unlock.status, 200);
assert.equal(unlock.body.balance, 86);
assert.equal(rpcCalls.length, 1);
assert.equal(rpcCalls[0].p_amount, 4);
assert.equal(rpcCalls[0].p_reason, 'lecture');
assert.deepEqual(rpcCalls[0].p_entitlements, [{
  surface: 'ai_lecture',
  book_code: 'future-ai',
  episode_no: 6,
}]);

const storyUnlock = await call('unlock', {
  mode: 'item',
  surface: 'story',
  book: 'future-ai',
  episodeNo: 7,
});
assert.equal(storyUnlock.status, 200);
assert.equal(rpcCalls.length, 2);
assert.equal(rpcCalls[1].p_amount, 4);
assert.equal(rpcCalls[1].p_reason, 'story');
assert.deepEqual(rpcCalls[1].p_entitlements, [{
  surface: 'story',
  book_code: 'future-ai',
  episode_no: 7,
}]);

const bundle = await call('quote', {
  mode: 'bundle',
  book: 'future-ai',
});
assert.equal(bundle.status, 200);
assert.equal(bundle.body.quote.subtotalPoints, 15);
assert.equal(bundle.body.quote.payablePoints, 9);
assert.equal(bundle.body.quote.pointItemCount, 2);

const entitlements = await call('entitlements', { book: 'future-ai' });
assert.equal(entitlements.status, 200);
assert.deepEqual(entitlements.body.lectures, []);
assert.deepEqual(entitlements.body.stories, [6]);
assert.equal(entitlements.body.stellaUnlocked, false);
assert.equal(entitlements.body.realization.label, '원서 독자');

const progress = await call('progress', {});
assert.equal(progress.status, 200);
assert.equal(progress.body.availablePoints, 90);
assert.equal(progress.body.cumulativeEarnedPoints, 100);
assert.equal(progress.body.pointMode, 'helper');
assert.equal(progress.body.effectiveMode, 'helper');
assert.equal(progress.body.pointsToNext, 400);
assert.equal(progress.body.realization.completedCount, 1);
assert.equal(progress.body.realization.label, '원서 독자');
assert.equal(progress.body.stellaUnlocked, false);

progressScenario = 'unknown';
const unknownProgress = await call('progress', {});
assert.equal(unknownProgress.status, 200);
assert.equal(unknownProgress.body.realization.completionKnown, false);
assert.equal(unknownProgress.body.realization.completedCount, 0);

progressScenario = 'legacy';
const legacyProgress = await call('progress', {});
assert.equal(legacyProgress.status, 200);
assert.equal(legacyProgress.body.realization.completionKnown, true);
assert.equal(legacyProgress.body.realization.completedCount, 1);

console.log('secure-api content-point-service-test: all assertions passed');
