import assert from 'node:assert/strict';
import { classMemberTierAdminRoute } from './src/class-member-tier-admin.mjs';

const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const env = { ADMIN_EMAIL: 'owner@example.com' };
const deps = {
  json: (data, status) => response(data, status),
  requireUser: async () => ({ id: 'admin', email: 'owner@example.com' }),
  sbFetch: async (_env, path) => {
    if (path.startsWith('class_enrollments?')) return response([{ book_code: 'anne' }, { book_code: 'pride' }]);
    if (path.startsWith('class_verifications?')) return response([{ book_code: 'anne' }, { book_code: 'theory' }]);
    if (path.startsWith('class_redemptions?')) return response([{ book_code: 'pride' }]);
    if (path.startsWith('legacy_progress?')) return response([{ book_code: 'anne', pct: 100, done: [], lectures_total: 148 }]);
    if (path.startsWith('users?')) return response([{ id: 'member-1' }]);
    if (path.startsWith('user_badges?')) return response([{ badge_id: 'finish_B013' }]);
    return response([], 404);
  },
};

const req = new Request('https://example.com/api/class/admin-member-tier', {
  method: 'POST',
  body: JSON.stringify({ email: 'Reader@Example.com' }),
});
const result = await classMemberTierAdminRoute(req, env, {}, deps);
assert.equal(result.status, 200);
const body = await result.json();
assert.equal(body.member.classicOwnedCount, 2);
assert.equal(body.member.classicCompletedCount, 2);
assert.equal(body.member.bundleOwnedCount, 3);
assert.equal(body.member.completionKnown, true);
assert.deepEqual(body.member.rosterBooks, ['anne', 'pride']);

const forbidden = await classMemberTierAdminRoute(
  new Request('https://example.com', { method: 'POST', body: '{}' }),
  env,
  {},
  { ...deps, requireUser: async () => ({ email: 'reader@example.com' }) },
);
assert.equal(forbidden.status, 403);

console.log('secure-api class-member-tier-admin-test: all assertions passed');

// 운영 라우터가 이 경로를 실제로 연결한다(2026-10-19 — 화면만 있고 서버가 빠져 늘 404 였던 사고 재발 방지).
import { readFileSync } from 'node:fs';
const indexSrc = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
assert.match(indexSrc, /import \{ classMemberTierAdminRoute \} from "\.\/class-member-tier-admin\.mjs";/);
assert.match(indexSrc, /if \(path === "\/api\/class\/admin-member-tier"\) \{\s*\n\s*return classMemberTierAdminRoute\(req, env, cors, \{ json, requireUser, sbFetch \}\);/);
console.log('secure-api class-member-tier-admin route: wired');
