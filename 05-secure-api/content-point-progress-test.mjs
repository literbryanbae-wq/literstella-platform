// content-point-progress-test.mjs — /api/points/content/progress 의 라일라 등급 계약 (2026-09-25)
//
// 🔴 왜 있나:
//   ① 올인원 8/8 = 소울로 가는 두 번째 문(운영자 결정 2026-09-25). 정의는 class-gate ownsAllInOne 하나 —
//      이 API 는 CLASS_GATE 바인딩으로 /premium-status 에 묻기만 한다. 실패·지연이면 올리지 않는다.
//   ② 스텔라 초대권(applyInvite, 2026-08-23 배포 9b705f54)은 08-28 배포부터 라이브에서 빠져 있었다
//      (main 에 안 들어간 커밋이라 다음 배포가 덮었다). 복구하면서 만료(2027-02-28)도 본다 — 옛 코드는 activated 만 봤다.
//   화면(챌린지·클래스 라일라 머리·등급 카드)이 이 응답의 effectiveMode 를 그대로 쓴다.
//
// 실행: node content-point-progress-test.mjs
import assert from 'node:assert/strict';
import { contentPointRoute } from './src/content-point-service.mjs';

let pass = 0;
const ok = (n) => { pass++; console.log('  ✓ ' + n); };
console.log('content-point progress — 라일라 등급 계약');

const CLASSIC7 = ['kidari', 'gatsby', 'anne', 'pride', 'littlewomen1', 'littlewomen2', 'sherlock'];
const FINISH7 = ['finish_B001', 'finish_B018', 'finish_B005', 'finish_B013', 'finish_B009', 'finish_B017'];
const ADMIN = 'admin@example.test';

// 회원 표본 — gate: true/false = class-gate eligible · 'down' = 503 · 'slow' = 응답 없음
const MEMBERS = {
  'tok-owner': { email: 'owner@example.test', points: [{ amount: 100, reason: 'checkin' }], books: CLASSIC7, gate: true },
  'tok-richowner': { email: 'rich@example.test', points: [{ amount: 2500, reason: 'checkin' }], books: CLASSIC7, gate: true },
  'tok-mate': { email: 'mate@example.test', points: [{ amount: 600, reason: 'diary' }], books: ['kidari'], gate: false },
  'tok-invitee': { email: 'invitee@example.test', points: [], books: ['anne'], gate: false,
    invite: { activated_at: '2026-08-25T00:00:00Z', expires_at: '2027-02-28T14:59:59Z', owned_count: 1 } },
  'tok-expired': { email: 'expired@example.test', points: [], books: CLASSIC7, gate: true,
    invite: { activated_at: '2026-08-25T00:00:00Z', expires_at: '2020-01-01T00:00:00Z', owned_count: 7 } },
  'tok-finisher': { email: 'finisher@example.test', points: [], books: CLASSIC7, badges: FINISH7, gate: true },
  'tok-admin': { email: ADMIN, points: [], books: [], gate: true },
  'tok-gatedown': { email: 'down@example.test', points: [{ amount: 100, reason: 'checkin' }], books: CLASSIC7, gate: 'down' },
  'tok-gateslow': { email: 'slow@example.test', points: [{ amount: 100, reason: 'checkin' }], books: CLASSIC7, gate: 'slow' },
  'tok-noprofile': { email: 'ghost@example.test', points: [], books: [], gate: true, noProfile: true },
};
const byEmail = Object.fromEntries(Object.entries(MEMBERS).map(([tok, m]) => [m.email, { tok, ...m }]));
const uidOf = (tok) => 'u-' + tok.slice(4);

const gateCalls = [];
const env = {
  ADMIN_EMAIL: ADMIN,
  POINT_STELLA_TEST_EMAILS: 'nobody@example.test',
  CLASS_GATE: {
    fetch(req) {
      const u = new URL(req.url);
      const auth = req.headers.get('authorization') || '';
      gateCalls.push({ path: u.pathname, method: req.method, auth });
      const m = MEMBERS[auth.replace(/^Bearer /, '')];
      if (!m) return Promise.resolve(Response.json({ error: 'unauthorized' }, { status: 401 }));
      if (m.gate === 'slow') return new Promise(() => {});
      if (m.gate === 'down') return Promise.resolve(Response.json({ error: 'ownership_lookup_failed' }, { status: 503 }));
      return Promise.resolve(Response.json({ eligible: m.gate === true, ownedCount: m.gate === true ? 8 : 1, missing: [], claimed: [] }));
    },
  },
};

const rows = (arr) => Response.json(arr);
const param = (path, key) => {
  const m = path.match(new RegExp(`${key}=eq\\.([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
};
async function sbFetch(_env, path) {
  if (path.startsWith('users?auth_uid=eq.')) {
    const id = param(path, 'auth_uid');
    const tok = 'tok-' + id.slice(5);
    const m = MEMBERS[tok];
    return rows(m && !m.noProfile ? [{ id: uidOf(tok), email: m.email, auth_uid: id }] : []);
  }
  if (path.startsWith('users?email=eq.')) {
    const m = byEmail[param(path, 'email')];
    return rows(m && !m.noProfile ? [{ id: uidOf(m.tok), email: m.email, auth_uid: 'auth-' + m.tok.slice(4) }] : []);
  }
  const uid = param(path, 'user_id');
  const tokOfUid = uid ? 'tok-' + uid.slice(2) : null;
  if (path.startsWith('point_transactions?')) return rows((MEMBERS[tokOfUid]?.points) || []);
  if (path.startsWith('user_badges?')) return rows(((MEMBERS[tokOfUid]?.badges) || []).map((badge_id) => ({ badge_id })));
  if (path.startsWith('stella_invites?')) { const inv = MEMBERS[tokOfUid]?.invite; return rows(inv ? [inv] : []); }
  if (path.startsWith('content_entitlements?')) return rows([]);
  if (path.startsWith('class_verifications?')) return rows(((byEmail[param(path, 'email')]?.books) || []).map((book_code) => ({ book_code })));
  if (path.startsWith('class_redemptions?')) return rows([]);
  if (path.startsWith('legacy_progress?')) return rows([]);
  return Response.json({ message: 'unexpected ' + path }, { status: 404 });
}
const json = (body, status = 200, cors = {}) => Response.json(body, { status, headers: cors });
async function requireUser(req) {
  const tok = req.headers.get('X-User-Token') || '';
  const m = MEMBERS[tok];
  return m ? { id: 'auth-' + tok.slice(4), email: m.email } : null;
}
async function call(sub, tok, body = {}) {
  const req = new Request('https://api.test/api/points/content/' + sub, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-User-Token': tok }, body: JSON.stringify(body),
  });
  const res = await contentPointRoute(req, env, {}, sub, { json, requireUser, sbFetch });
  return { status: res.status, body: await res.json() };
}

// ① 올인원 8/8 + 포인트 헬퍼 → 소울(두 번째 문). 포인트 수치는 사실 그대로.
{
  const r = await call('progress', 'tok-owner');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.effectiveMode, 'soul');
  assert.equal(r.body.viaAllInOne, true);
  assert.equal(r.body.pointMode, 'helper', '포인트 등급은 그대로(모드만 올린다)');
  assert.equal(r.body.cumulativeEarnedPoints, 100);
  assert.equal(r.body.nextThreshold, null);
  assert.equal(r.body.pointsToNext, 0);
  assert.equal(r.body.stellaUnlocked, false);
  const g = gateCalls.at(-1);
  assert.equal(g.path, '/premium-status'); assert.equal(g.method, 'POST'); assert.equal(g.auth, 'Bearer tok-owner');
  ok('올인원 8/8 + 100P → soul · viaAllInOne · 포인트 수치 불변 · class-gate 에 회원 토큰으로 물었다');
}

// ② 포인트로 이미 소울이면 출처는 포인트(viaAllInOne 없음)
{
  const r = await call('progress', 'tok-richowner');
  assert.equal(r.body.effectiveMode, 'soul');
  assert.equal(r.body.viaAllInOne, undefined);
  assert.equal(r.body.pointMode, 'soul');
  ok('2,500P 소장 회원 → soul(포인트 출처) · viaAllInOne 없음');
}

// ③ 비소장 → 포인트 등급 그대로
{
  const r = await call('progress', 'tok-mate');
  assert.equal(r.body.effectiveMode, 'mate');
  assert.equal(r.body.viaAllInOne, undefined);
  assert.equal(r.body.viaInvite, undefined);
  ok('비소장 600P → mate 그대로');
}

// ④ 스텔라 초대권(유효) → 스텔라 · 완독 수치는 사실 그대로
{
  const r = await call('progress', 'tok-invitee');
  assert.equal(r.body.effectiveMode, 'stella');
  assert.equal(r.body.viaInvite, true);
  assert.equal(r.body.inviteExpiresAt, '2027-02-28T14:59:59Z');
  assert.equal(r.body.stellaUnlocked, true);
  assert.equal(r.body.realization.completedCount, 0, '초대권이 완독 수치를 바꾸면 안 된다');
  const e = await call('entitlements', 'tok-invitee', { book: 'anne' });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.stellaUnlocked, true);
  ok('유효 초대권 → stella · viaInvite · 만료일 · 완독 0권 그대로 · 소장 정보 응답도 stellaUnlocked');
}

// ⑤ 🔴 만료된 초대권은 열지 않는다(옛 applyInvite 는 activated 만 봐서 만료 뒤에도 열렸다)
{
  const r = await call('progress', 'tok-expired');
  assert.notEqual(r.body.effectiveMode, 'stella', '🔴 만료된 초대권으로 스텔라가 열렸다');
  assert.equal(r.body.viaInvite, undefined);
  assert.equal(r.body.effectiveMode, 'soul', '만료 초대권 + 올인원 → 소울');
  assert.equal(r.body.viaAllInOne, true);
  const e = await call('entitlements', 'tok-expired', { book: 'anne' });
  assert.equal(e.body.stellaUnlocked, false);
  ok('만료 초대권 → 스텔라 아님(올인원이라 soul) · 소장 정보 stellaUnlocked=false');
}

// ⑥ 완독 7종 · 운영자 계정 → 스텔라(올인원보다 위)
{
  const f = await call('progress', 'tok-finisher');
  assert.equal(f.body.effectiveMode, 'stella');
  assert.equal(f.body.stellaUnlocked, true);
  assert.equal(f.body.viaInvite, undefined);
  assert.equal(f.body.viaAllInOne, undefined);
  const a = await call('progress', 'tok-admin');
  assert.equal(a.body.effectiveMode, 'stella');
  ok('완독 7종·운영자 → stella(올인원 표식 없음)');
}

// ⑦ class-gate 장애·지연 → 올리지 않는다(올리는 쪽 fail-open 금지) · 응답은 정상
{
  const d = await call('progress', 'tok-gatedown');
  assert.equal(d.status, 200);
  assert.equal(d.body.effectiveMode, 'helper');
  assert.equal(d.body.viaAllInOne, undefined);
  const t0 = Date.now();
  const s = await call('progress', 'tok-gateslow');
  const took = Date.now() - t0;
  assert.equal(s.status, 200);
  assert.equal(s.body.effectiveMode, 'helper');
  assert.ok(took >= 2000 && took < 6000, `시간 제한이 이상하다: ${took}ms`);
  ok(`class-gate 503·무응답(${took}ms 컷) → helper 그대로 · 진도 응답은 정상`);
}

// ⑧ users 행 없음 → 409 profile_missing (라일라 워커가 '헬퍼 확정'으로 읽는 계약)
{
  const r = await call('progress', 'tok-noprofile');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'profile_missing');
  ok('users 행 없음 → 409 profile_missing');
}

// ⑨ 바인딩이 없으면(설정 누락) 올인원은 '모름' — 진도는 그대로 나간다
{
  const saved = env.CLASS_GATE;
  delete env.CLASS_GATE;
  const r = await call('progress', 'tok-owner');
  env.CLASS_GATE = saved;
  assert.equal(r.status, 200);
  assert.equal(r.body.effectiveMode, 'helper');
  ok('CLASS_GATE 바인딩 없음 → 올리지 않음 · 진도 응답 정상');
}

console.log(`\ncontent-point progress ${pass}/${pass} 통과`);
