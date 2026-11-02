// 오즈 '강독 우선' 연결표 — 운영자 2026-11-02 "강의를 사면 관련 스토리가 함께 열린다 · 스토리 차액 할인은 스토리마다 한 번".
//   서버 경로(contentPointRoute)를 가짜 Supabase 로 돌려, 강 번호가 아니라 장 번호로 스토리를 여는지 확인한다.
import assert from 'node:assert/strict';
import { contentPointRoute } from './src/content-point-service.mjs';

const pointUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let owned = [];
const rpcCalls = [];
const rows = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function sbFetch(_env, path, init = {}) {
  if (path.startsWith('users?auth_uid=')) return rows([{ id: pointUserId, email: 'reader@example.com' }]);
  if (path.startsWith('class_verifications?') || path.startsWith('class_redemptions?')) return rows([]);
  if (path.startsWith('point_transactions?')) return rows([{ amount: 500, reason: 'signup' }]);
  if (path.startsWith('user_badges?') || path.startsWith('legacy_progress?')) return rows([]);
  if (path.startsWith('content_entitlements?')) return rows(owned);
  if (path.startsWith('point_content_catalog?surface=')) {
    const surface = path.match(/surface=eq\.([a-z_]+)/)[1];
    const no = Number(path.match(/episode_no=eq\.(\d+)/)[1]);
    return rows([{ surface, book_code: 'oz', episode_no: no }]);
  }
  if (path.startsWith('point_content_catalog?book_code=')) {
    return rows([
      ...[6, 7, 8, 9, 10].map((n) => ({ surface: 'ai_lecture', book_code: 'oz', episode_no: n })),
      ...[6, 7].map((n) => ({ surface: 'story', book_code: 'oz', episode_no: n })),
    ]);
  }
  if (path === 'rpc/spend_content_points_atomic') {
    rpcCalls.push(JSON.parse(init.body));
    return rows({ ok: true, balance: 400, transaction_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', idempotent: false });
  }
  return rows({ message: `unhandled ${path}` }, 500);
}

const deps = {
  sbFetch,
  requireUser: async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'reader@example.com' }),
  json: (data, status, cors) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...(cors || {}) },
  }),
};
async function call(sub, body) {
  const request = new Request(`https://example.com/api/points/content/${sub}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Token': 't' }, body: JSON.stringify(body),
  });
  const response = await contentPointRoute(request, { ADMIN_EMAIL: 'owner@example.com' }, {}, sub, deps);
  return { status: response.status, body: await response.json() };
}
let n = 0;
const ok = async (name, fn) => { await fn(); n += 1; console.log(`  ✓ ${name}`); };

// 실제 회원 모양: 스토리 6~24편을 포인트로 산 분(강의는 아직 없음).
await ok('스토리 6편을 산 분이 6강(2장)을 사도 차액 할인 없음 · 6강은 2장을 연다', async () => {
  owned = Array.from({ length: 19 }, (_, i) => ({ surface: 'story', episode_no: i + 6 }));
  const q = await call('quote', { mode: 'item', surface: 'ai_lecture', book: 'oz', episodeNo: 6 });
  assert.equal(q.status, 200);
  assert.equal(q.body.quote.reason, 'point_unlock');
  assert.equal(q.body.quote.payablePoints, 10);
  rpcCalls.length = 0;
  await call('unlock', { mode: 'item', surface: 'ai_lecture', book: 'oz', episodeNo: 6 });
  assert.deepEqual(rpcCalls[0].p_entitlements, [
    { surface: 'ai_lecture', book_code: 'oz', episode_no: 6 },
    { surface: 'story', book_code: 'oz', episode_no: 2 },
  ]);
});

await ok('6강만 산 분에게 스토리 6편은 열려 있지 않다(강 번호 ≠ 편 번호)', async () => {
  owned = [{ surface: 'ai_lecture', episode_no: 6 }, { surface: 'story', episode_no: 2 }];
  const q = await call('quote', { mode: 'item', surface: 'story', book: 'oz', episodeNo: 6 });
  assert.equal(q.body.quote.access, 'points');
  const q2 = await call('quote', { mode: 'item', surface: 'story', book: 'oz', episodeNo: 2 });
  assert.notEqual(q2.body.quote.access, 'points');
});

await ok('스토리 차액 할인은 편마다 한 번 — 같은 장의 다른 강을 가졌으면 정가', async () => {
  // 가정: 3장 스토리를 산 분(지금은 1~5편 무료라 실제로는 없다 — 23강~ 6장부터 생기는 모양을 미리 지킨다).
  owned = [{ surface: 'story', episode_no: 3 }];
  const first = await call('quote', { mode: 'item', surface: 'ai_lecture', book: 'oz', episodeNo: 9 });
  assert.equal(first.body.quote.reason, 'story_to_ai_upgrade');
  assert.equal(first.body.quote.payablePoints, 5);
  owned = [{ surface: 'story', episode_no: 3 }, { surface: 'ai_lecture', episode_no: 9 }];
  const second = await call('quote', { mode: 'item', surface: 'ai_lecture', book: 'oz', episodeNo: 10 });
  assert.equal(second.body.quote.reason, 'point_unlock');
  assert.equal(second.body.quote.payablePoints, 10);
});

await ok('묶음: 강의가 여는 편만 빼고 스토리 6·7편은 따로 센다', async () => {
  owned = [];
  const b = await call('quote', { mode: 'bundle', book: 'oz' });
  assert.equal(b.status, 200);
  assert.equal(b.body.quote.pointItemCount, 7);
  assert.equal(b.body.quote.subtotalPoints, 10 * 5 + 5 * 2);
});

console.log(`content-point-oz-map-test: ${n} passed`);
