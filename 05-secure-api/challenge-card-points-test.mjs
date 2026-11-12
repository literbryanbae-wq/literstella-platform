// 챌린지 결제: 포인트 먼저 + 남은 금액 카드 — 실제 Postgres(PGlite) 위 DB 함수 + 가짜 토스로 서버 흐름.
//   PGLITE_ENTRY=<…/@electric-sql/pglite/dist/index.js> node challenge-card-points-test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { prepareChallengeOrder, confirmChallengeOrder, cardPoints, maxCardPoints, kstToday } from './src/challenge-card-checkout.mjs';

let n = 0;
const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

await check('쓸 수 있는 포인트: 10P 단위 · 카드로 1,000원 이상 남긴다', () => {
  assert.equal(maxCardPoints(3000), 200);
  assert.deepEqual([0, undefined, 10, 120, 200].map((v) => cardPoints(v, 3000)), [0, 0, 10, 120, 200]);
  assert.deepEqual([5, 15, 210, 300, -10, '12a', 1.5].map((v) => cardPoints(v, 3000)), [null, null, null, null, null, null, null]);
});

if (!process.env.PGLITE_ENTRY) { console.log(`challenge-card-points-test: ${n} checks passed (PGLITE_ENTRY 가 없어 DB 시험은 건너뜀)`); process.exit(0); }
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_ENTRY).href);
const db = new PGlite();
const AUTH = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const SEASON = 'yanawan-2607';
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.users(id uuid primary key, auth_uid uuid);
  create table public.seasons(id text primary key);
  create table public.payments(id text primary key, status text);
  create table public.point_transactions(id bigserial primary key, user_id uuid, season_id text, amount integer not null check (amount <> 0),
    reason text, ref_id text, memo text, unique (user_id, reason, ref_id));
  insert into public.users values ('${MEMBER}', '${AUTH}');
  insert into public.seasons values ('${SEASON}');
  insert into public.point_transactions(user_id, season_id, amount, reason, ref_id) values ('${MEMBER}', '${SEASON}', 150, 'checkin', 'seed');
`);
await db.exec(await readFile(new URL('./supabase/migrations/20261112120000_challenge_card_points.sql', import.meta.url), 'utf8'));
const lit = (v) => (v == null ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const rpc = async (name, args) => (await db.query(`select public.${name}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ')}) as v`)).rows[0].v;
const balance = async () => (await db.query(`select coalesce(sum(amount),0)::int as b from public.point_transactions where user_id = '${MEMBER}'`)).rows[0].b;
const REF = `enroll_pay:${SEASON}:30`;

await check('DB: 부족하면 잡지 않는다 · 잡으면 한 번만 · 다른 주문이 같은 도전을 또 잡지 못한다', async () => {
  assert.equal((await rpc('challenge_card_points_reserve', { p_user_id: MEMBER, p_season: SEASON, p_points: 200, p_ref: REF, p_order_id: 'o1' })).error, 'points_short');
  assert.equal(await balance(), 150);
  assert.equal((await rpc('challenge_card_points_reserve', { p_user_id: MEMBER, p_season: SEASON, p_points: 120, p_ref: REF, p_order_id: 'o1' })).ok, true);
  assert.equal(await balance(), 30);
  assert.equal((await rpc('challenge_card_points_reserve', { p_user_id: MEMBER, p_season: SEASON, p_points: 120, p_ref: REF, p_order_id: 'o1' })).again, true);
  assert.equal(await balance(), 30);
  assert.equal((await rpc('challenge_card_points_reserve', { p_user_id: MEMBER, p_season: SEASON, p_points: 20, p_ref: REF, p_order_id: 'o2' })).error, 'already_paid_points');
  for (const bad of [5, 15, 890]) assert.equal((await rpc('challenge_card_points_reserve', { p_user_id: MEMBER, p_season: SEASON, p_points: bad, p_ref: REF, p_order_id: 'o3' })).error, 'bad_points');
  assert.equal((await rpc('challenge_card_points_reserve', { p_user_id: MEMBER, p_season: SEASON, p_points: 20, p_ref: 'enroll_pay:x:30', p_order_id: 'o3' })).error, 'bad_points');
});

await check('DB: 놓기는 그 주문의 줄만 지운다 · 결제가 끝난 주문은 돌려놓지 않는다 · 회원은 직접 못 부른다', async () => {
  assert.equal((await rpc('challenge_card_points_release', { p_user_id: MEMBER, p_ref: REF, p_order_id: 'other' })).released, 0);
  await db.exec(`insert into public.payments values ('o1', 'DONE')`);
  assert.equal((await rpc('challenge_card_points_release', { p_user_id: MEMBER, p_ref: REF, p_order_id: 'o1' })).error, 'order_paid');
  await db.exec(`update public.payments set status = 'READY' where id = 'o1'`);
  assert.equal((await rpc('challenge_card_points_release', { p_user_id: MEMBER, p_ref: REF, p_order_id: 'o1' })).released, 1);
  assert.equal(await balance(), 150);
  await db.exec('set role authenticated;');
  await assert.rejects(db.query(`select public.challenge_card_points_reserve('${MEMBER}', '${SEASON}', 10, '${REF}', 'x')`), /permission denied/);
  await db.exec('reset role; delete from public.payments;');
});

// ── 서버 흐름: DB 함수는 위 PGlite, 주문·도전은 메모리, 토스는 가짜 ──
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const store = { payments: new Map(), enrollment: null, tossConfirms: 0, decline: false };
const sbFetch = async (_env, path, init = {}) => {
  if (path.startsWith('rpc/')) return json(await rpc(path.slice(4), JSON.parse(init.body)));
  if (path.startsWith('users?')) return json([{ id: MEMBER }]);
  if (path.startsWith('enrollments')) {
    if ((init.method || 'GET') === 'GET') return json(store.enrollment ? [store.enrollment] : []);
    const b = JSON.parse(init.body); store.enrollment = { goal_days: b.goal_days, status: 'active', start_date: b.start_date ?? store.enrollment?.start_date ?? null };
    return json([store.enrollment]);
  }
  return json([]);
};
const recordPayment = async (_env, row) => { store.payments.set(row.id, { ...(store.payments.get(row.id) || {}), ...row }); await db.query(`insert into public.payments values (${lit(row.id)}, ${lit(row.status)}) on conflict (id) do update set status = excluded.status`); return true; };
globalThis.fetch = async (url, init = {}) => {
  if (String(url).endsWith('/v1/payments/confirm')) {
    store.tossConfirms++;
    const b = JSON.parse(init.body);
    return store.decline ? json({ code: 'REJECT_CARD_COMPANY' }, 400) : json({ status: 'DONE', totalAmount: b.amount, orderId: b.orderId, paymentKey: b.paymentKey });
  }
  return json({}, 404);
};
const env = { TOSS_CLASS_SECRET_KEY: 'sk' };
const requireUser = async () => ({ id: AUTH, email: 'reader@example.test' });
let seq = 0;
const prepare = async (usePoints) => {
  const r = await prepareChallengeOrder({ req: null, env, cors: {}, json: (d, s) => json(d, s), sbFetch, requireUser, recordPayment, newPaymentId: () => `pay${++seq}`,
    body: { goalDays: 30, season: SEASON, mode: 'new', startDate: kstToday(), usePoints } });
  return { status: r.status, body: await r.json() };
};
const confirm = async (orderId, amount) => {
  const r = await confirmChallengeOrder({ env, cors: {}, json: (d, s) => json(d, s), sbFetch, recordPayment, prepared: store.payments.get(orderId), body: { amount, paymentKey: 'pk' } });
  return { status: r.status, body: await r.json() };
};

await check('주문: 120P 를 쓰면 카드 금액은 1,800원 · 한도를 넘는 포인트는 거절', async () => {
  const p = await prepare(120);
  assert.equal(p.body.amount, 1800); assert.equal(p.body.listAmount, 3000); assert.equal(p.body.usePoints, 120);
  assert.equal((await prepare(250)).body.error, 'bad_points');
  assert.equal((await prepare(0)).body.amount, 3000);
});

await check('카드가 거절되면 잡은 포인트를 돌려놓고 도전은 등록되지 않는다', async () => {
  const p = await prepare(120);
  store.decline = true;
  const c = await confirm(p.body.orderId, 1800);
  store.decline = false;
  assert.equal(c.status, 402);
  assert.equal(await balance(), 150);
  assert.equal(store.enrollment, null);
});

await check('포인트가 모자라면 카드를 승인하지 않는다(돈이 나가지 않는다)', async () => {
  const p = await prepare(200);
  const before = store.tossConfirms;
  const c = await confirm(p.body.orderId, 1000);
  assert.equal(c.status, 409); assert.equal(c.body.error, 'points_short');
  assert.equal(store.tossConfirms, before);
});

await check('성공: 포인트 120P 차감 + 카드 1,800원 → 서버가 도전을 등록 · 다시 불러도 한 번', async () => {
  const p = await prepare(120);
  assert.equal((await confirm(p.body.orderId, 3000)).body.error, 'amount_mismatch', '화면이 다른 금액을 보내면 거절');
  const c = await confirm(p.body.orderId, 1800);
  assert.equal(c.status, 200); assert.equal(c.body.enrolled, true); assert.equal(c.body.usedPoints, 120); assert.equal(c.body.cardAmount, 1800);
  assert.equal(await balance(), 30);
  assert.equal(store.enrollment.goal_days, 30);
  const confirms = store.tossConfirms;
  const again = await confirm(p.body.orderId, 1800);
  assert.equal(again.body.enrolled, true); assert.equal(store.tossConfirms, confirms); assert.equal(await balance(), 30);
  const row = (await db.query(`select amount, reason, ref_id, memo from public.point_transactions where ref_id = '${REF}'`)).rows[0];
  assert.deepEqual(row, { amount: -120, reason: 'spend_extension', ref_id: REF, memo: `card+points:${p.body.orderId}` });
});

console.log(`challenge-card-points-test: ${n} checks passed`);
