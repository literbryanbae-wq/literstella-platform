import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { growthPanelRoute, normalizeGrowthPanelApplication, GROWTH_PANEL_CAMPAIGN_ID, GROWTH_PANEL_REQUIRED_BOOKS, GROWTH_PANEL_OWNERSHIP_POLICY, GROWTH_PANEL_INTERESTS, GROWTH_PANEL_SKILLS, GROWTH_PANEL_DEVICES } from './src/growth-panel-service.mjs';

// Hermetic transport fixtures only. Never import Worker secrets or call a network.
globalThis.fetch = () => { throw new Error('REAL NETWORK FORBIDDEN'); };
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'member@example.invalid', emailConfirmed: true };
const OTHER = { ...USER, id: '22222222-2222-4222-8222-222222222222', email: 'other@example.invalid' };
const INPUT = { nickname: '  영어   친구 ', email: ' MEMBER@example.invalid ', interests: ['daily', 'university'], skills: ['reading', 'speaking'], device: 'multiple', situation: '원서를 읽고 이야기하고 싶어요.', privacyConsent: true, feedbackConsent: true, privacyVersion: 'privacy-v1', feedbackVersion: 'feedback-v1', retentionVersion: 'retention-v1', clientSubmissionId: '33333333-3333-4333-8333-333333333333' };
const makeReceipt = (user = USER) => ({ id: '44444444-4444-4444-8444-444444444444', status: 'submitted', createdAt: '2026-09-05T00:00:00.000Z', withdrawnAt: null,
  submitted: { nickname: '영어 친구', email: user.email, interests: INPUT.interests, skills: INPUT.skills, device: INPUT.device, situation: INPUT.situation },
  consents: { privacyVersion: INPUT.privacyVersion, feedbackVersion: INPUT.feedbackVersion, retentionVersion: INPUT.retentionVersion } });
const campaign = { id: GROWTH_PANEL_CAMPAIGN_ID, open: false, selectionCapacity: 100 };
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

function harness({ user = USER, handler, timeoutMs = 1000 } = {}) {
  const calls = [];
  const deps = { timeoutMs,
    json: (body, status, headers) => new Response(JSON.stringify(body), { status, headers }),
    requireUser: async () => user,
    sbFetch: async (_env, path, init) => {
      const body = JSON.parse(init.body);
      calls.push({ path, body, signal: init.signal });
      assert.equal(path, 'rpc/growth_panel_request');
      assert.equal(body.p_auth_uid, user.id);
      assert.equal(body.p_auth_email, user.email.toLowerCase());
      assert.equal(body.p_campaign_id, GROWTH_PANEL_CAMPAIGN_ID);
      return handler ? handler(body, init, calls.length) : response({ ok: true, application: null });
    },
  };
  return { calls, deps, async run(sub = 'application', method = 'POST', input = INPUT, headers = { 'Content-Type': 'application/json' }) {
    const req = new Request(`https://worker.test/api/growth-panel/${sub}`, { method, headers,
      ...(method === 'POST' ? { body: typeof input === 'string' ? input : JSON.stringify(input) } : {}) });
    const res = await growthPanelRoute(req, {}, { 'Access-Control-Allow-Origin': 'https://client.test' }, sub, deps);
    return { status: res.status, body: await res.json(), headers: res.headers };
  } };
}

await check('normalization + canonical IDs + authority fields excluded', () => {
  const value = normalizeGrowthPanelApplication({ ...INPUT, interests: ['daily', 'daily'], authUid: OTHER.id, ownedCount: 8, eligible: true }, USER.email);
  assert.equal(value.nickname, '영어 친구');
  assert.deepEqual(value.interests, ['daily']);
  for (const key of ['email', 'authUid', 'ownedCount', 'eligible']) assert.equal(Object.hasOwn(value, key), false);
  assert.equal(GROWTH_PANEL_INTERESTS.length, 7); assert.equal(GROWTH_PANEL_SKILLS.length, 4);
  assert.deepEqual(GROWTH_PANEL_DEVICES, ['mobile', 'tablet', 'desktop', 'multiple']);
});
await check('invalid values, forged email, consent and versions rejected', () => {
  const cases = [[null, 'invalid_body'], [{ ...INPUT, email: OTHER.email }, 'email_mismatch'],
    [{ ...INPUT, interests: [] }, 'invalid_fields'], [{ ...INPUT, skills: ['admin'] }, 'invalid_fields'],
    [{ ...INPUT, device: 'fridge' }, 'invalid_fields'], [{ ...INPUT, situation: '가'.repeat(301) }, 'invalid_fields'],
    [{ ...INPUT, nickname: 'a'.repeat(41) }, 'invalid_fields'], [{ ...INPUT, nickname: 'x\u0000' }, 'invalid_fields'],
    [{ ...INPUT, privacyConsent: 'true' }, 'consent_required'], [{ ...INPUT, feedbackConsent: false }, 'consent_required'],
    [{ ...INPUT, privacyVersion: ['privacy-v1'] }, 'invalid_fields'], [{ ...INPUT, clientSubmissionId: [INPUT.clientSubmissionId] }, 'invalid_fields']];
  for (const [input, code] of cases) assert.throws(() => normalizeGrowthPanelApplication(input, USER.email), error => error.code === code);
});
await check('unauthenticated never touches DB', async () => {
  const h = harness({ user: null }); const result = await h.run('status', 'GET');
  assert.equal(result.status, 401); assert.equal(h.calls.length, 0);
});
await check('method/path closed without side effects', async () => {
  const h = harness();
  assert.equal((await h.run('status', 'POST')).status, 405);
  assert.equal((await h.run('other', 'GET')).status, 404);
  assert.equal(h.calls.length, 0);
});
await check('closed status exposes unknown eligibility and no-store', async () => {
  const h = harness({ handler: () => response({ ok: true, campaign, member: { email: USER.email, eligible: null }, application: null }) });
  const result = await h.run('status', 'GET');
  assert.equal(result.status, 200); assert.equal(result.body.campaign.open, false);
  assert.equal(result.body.member.eligible, null); assert.match(result.headers.get('Cache-Control'), /no-store/);
  assert.match(result.headers.get('Vary'), /X-User-Token/);
});
await check('closed campaign cannot create receipt', async () => {
  const h = harness({ handler: body => response(body.p_action === 'get' ? { ok: true, application: null } : { ok: false, error: 'campaign_closed' }) });
  assert.equal((await h.run()).status, 409); assert.equal(h.calls.length, 2);
});
await check('existing receipt wins over invalid input/unconfirmed email/policy change', async () => {
  const receipt = makeReceipt(); receipt.status = 'selected';
  const h = harness({ user: { ...USER, emailConfirmed: false }, handler: () => response({ ok: true, application: receipt }) });
  const result = await h.run('application', 'POST', 'not-json');
  assert.equal(result.status, 200); assert.equal(result.body.existing, true);
  assert.deepEqual(result.body.application, receipt); assert.equal(h.calls.length, 1);
});
await check('new submission requires confirmed email after duplicate lookup', async () => {
  const h = harness({ user: { ...USER, emailConfirmed: false } });
  assert.equal((await h.run()).body.error, 'email_unverified'); assert.equal(h.calls.length, 1);
});
await check('new submission accepts only durable valid receipt', async () => {
  const h = harness({ handler: body => response(body.p_action === 'get' ? { ok: true, application: null } : { ok: true, application: makeReceipt(), existing: false }) });
  const result = await h.run(); assert.equal(result.status, 200); assert.equal(result.body.existing, false);
  assert.equal(h.calls[1].body.p_payload.nickname, '영어 친구'); assert.equal(h.calls[1].body.p_payload.email, undefined);
});
await check('concurrent retry contract returns same receipt without browser overwrite', async () => {
  let saved;
  const h = harness({ handler: async body => {
    if (body.p_action === 'get') return response({ ok: true, application: saved || null });
    const existing = Boolean(saved); saved ||= makeReceipt();
    return response({ ok: true, application: saved, existing });
  } });
  const results = await Promise.all([h.run(), h.run('application', 'POST', { ...INPUT, nickname: 'later' })]);
  assert.deepEqual(results[0].body.application, results[1].body.application);
  assert.equal(results[1].body.application.submitted.nickname, '영어 친구');
  // Mock validates adapter behavior, NOT PostgreSQL locking/concurrency execution.
});
await check('authenticated UID scopes read and submit across accounts', async () => {
  const h = harness({ user: OTHER });
  await h.run('application', 'GET'); assert.equal(h.calls[0].body.p_auth_uid, OTHER.id);
  assert.equal((await h.run()).body.error, 'email_mismatch'); assert.equal(h.calls.length, 2);
});
await check('policy change/ineligible propagated; unknown DB detail never exposed', async () => {
  for (const [error, status] of [['policy_changed', 409], ['ineligible', 403]]) {
    const h = harness({ handler: body => response(body.p_action === 'get' ? { ok: true, application: null } : { ok: false, error }) });
    assert.equal((await h.run()).status, status);
  }
  const h = harness({ handler: () => response({ ok: false, error: 'private table member@example.invalid', detail: 'secret' }) });
  assert.deepEqual((await h.run('application', 'GET')).body, { ok: false, error: 'invalid_response' });
});
await check('withdraw requires explicit confirmation; closed campaign still supports it', async () => {
  const receipt = { ...makeReceipt(), status: 'withdrawn', submitted: null, withdrawnAt: '2026-09-06T00:00:00Z' };
  const h = harness({ handler: () => response({ ok: true, application: receipt, existing: true }) });
  assert.equal((await h.run('application/withdraw', 'POST', { confirm: false })).status, 400); assert.equal(h.calls.length, 0);
  const result = await h.run('application/withdraw', 'POST', { confirm: 'WITHDRAW' });
  assert.equal(result.status, 200); assert.equal(result.body.application.submitted, null);
});
await check('withdraw rejects a submitted receipt, missing date or retained answers', async () => {
  for (const receipt of [makeReceipt(),
    { ...makeReceipt(), status: 'withdrawn', submitted: null },
    { ...makeReceipt(), status: 'withdrawn', submitted: null, withdrawnAt: 'not-a-date' },
    { ...makeReceipt(), status: 'withdrawn', withdrawnAt: '2026-09-06T00:00:00Z' }]) {
    const h = harness({ handler: () => response({ ok: true, application: receipt, existing: true }) });
    const result = await h.run('application/withdraw', 'POST', { confirm: 'WITHDRAW' });
    assert.equal(result.status, 502); assert.equal(result.body.error, 'invalid_response');
  }
});
await check('HTTP error, broken JSON and empty success are not receipts', async () => {
  for (const upstream of [new Response('private', { status: 503 }), new Response('not-json'), response({ ok: true }), response({ ok: true, application: { id: 'fake' } })]) {
    const h = harness({ handler: () => upstream });
    const result = await h.run('application', 'GET');
    assert.ok([502, 503].includes(result.status)); assert.equal(result.body.ok, false);
  }
});
await check('bounded body prevents unbounded JSON and non-JSON submission', async () => {
  const h = harness();
  assert.equal((await h.run('application', 'POST', 'x'.repeat(9000))).status, 400);
  assert.equal((await h.run('application', 'POST', INPUT, { 'Content-Type': 'text/plain' })).status, 400);
  assert.ok(h.calls.every(call => call.body.p_action === 'get'));
});
await check('upstream timeout aborts transport and returns retryable uncertainty', async () => {
  const h = harness({ timeoutMs: 5, handler: () => new Promise(() => {}) });
  const result = await h.run('application', 'GET');
  assert.equal(result.status, 504); assert.equal(result.body.error, 'upstream_timeout');
  assert.equal(h.calls[0].signal.aborted, true);
});
await check('request body timeout cancels and unlocks stalled submit and withdraw streams', async () => {
  for (const sub of ['application', 'application/withdraw']) {
    let cancelled = 0;
    const stream = new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } });
    const req = new Request(`https://worker.test/api/growth-panel/${sub}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
    });
    const h = harness({ timeoutMs: 5 });
    const result = await growthPanelRoute(req, {}, {}, sub, h.deps);
    assert.equal(result.status, 504); assert.equal((await result.json()).error, 'upstream_timeout');
    assert.equal(cancelled, 1); assert.equal(req.body.locked, false);
    assert.ok(h.calls.every(call => call.body.p_action === 'get'));
  }
});
await check('upstream response body timeout also cancels and unlocks', async () => {
  let cancelled = 0;
  const stream = new ReadableStream({ cancel() { cancelled++; } });
  const upstream = new Response(stream);
  const h = harness({ timeoutMs: 5, handler: () => upstream });
  const result = await h.run('application', 'GET');
  assert.equal(result.status, 504); assert.equal(cancelled, 1); assert.equal(upstream.body.locked, false);
});
await check('open status requires approved notice/version fields', async () => {
  const h = harness({ handler: () => response({ ok: true, campaign: { ...campaign, open: true }, member: { email: USER.email, eligible: true }, application: null }) });
  assert.equal((await h.run('status', 'GET')).status, 502);
});
await check('open status accepts exactly the eight canonical courses, never seven or access substitutes', async () => {
  assert.deepEqual(GROWTH_PANEL_REQUIRED_BOOKS, ['kidari', 'anne', 'littlewomen1', 'littlewomen2', 'pride', 'gatsby', 'sherlock', 'theory']);
  const approved = { ...campaign, open: true, requiredBooks: [...GROWTH_PANEL_REQUIRED_BOOKS], ownershipPolicy: GROWTH_PANEL_OWNERSHIP_POLICY,
    privacyVersion: INPUT.privacyVersion, feedbackVersion: INPUT.feedbackVersion, retentionVersion: INPUT.retentionVersion,
    privacyNotice: '개인정보 안내', feedbackNotice: '의견 참여 안내', retentionNotice: '보관 안내' };
  for (const [change, expected] of [[{}, 200],
    [{ requiredBooks: GROWTH_PANEL_REQUIRED_BOOKS.slice(0, 7) }, 502],
    [{ requiredBooks: [...GROWTH_PANEL_REQUIRED_BOOKS.slice(0, 7), 'annual-pass'] }, 502],
    [{ requiredBooks: [...GROWTH_PANEL_REQUIRED_BOOKS.slice(0, 7), 'kidari'] }, 502],
    [{ ownershipPolicy: 'classic7-explicit' }, 502],
    [{ ownershipPolicy: null }, 502]]) {
    const h = harness({ handler: () => response({ ok: true, campaign: { ...approved, ...change }, member: { email: USER.email, eligible: true }, application: null }) });
    assert.equal((await h.run('status', 'GET')).status, expected);
  }
});
await check('SQL static boundaries (not executed database verification)', () => {
  const sql = readFileSync(new URL('./docs/growth-panel/schema.draft.sql', import.meta.url), 'utf8');
  assert.match(sql, /No campaign row is seeded/); assert.doesNotMatch(sql, /security\s+definer/i);
  assert.equal((sql.match(/security invoker/g) || []).length, 3);
  assert.equal((sql.match(/enable row level security/g) || []).length, 2);
  assert.match(sql, /unique \(campaign_id, auth_uid\)/);
  assert.match(sql, /pg_advisory_xact_lock/); assert.match(sql, /on conflict \(campaign_id, auth_uid\) do nothing/);
  assert.match(sql, /references auth\.users\(id\) on delete cascade/);
  assert.match(sql, /create index growth_panel_auth_uid_idx on public\.growth_panel_applications\(auth_uid\)/);
  assert.match(sql, /revoke all on function public\.growth_panel_request[^;]+from public, anon, authenticated/s);
  assert.match(sql, /grant execute on function public\.growth_panel_request[^;]+to service_role/s);
  assert.doesNotMatch(sql, /cardinality\(campaign.required_books\) = 7|classic7-explicit/);
  assert.match(sql, /cardinality\(campaign.required_books\) = 8/);
  assert.match(sql, /check \(cardinality\(required_books\) = 8/);
  assert.match(sql, /ownership_policy text not null default 'classic7-plus-theory-explicit' check \(ownership_policy = 'classic7-plus-theory-explicit'\)/);
  assert.match(sql, /eligible := owned @> all_books;/);
  const fixedBooks = sql.match(/all_books constant text\[\] := array\[([^\]]+)\]/)?.[1].match(/'[^']+'/g)?.map(value => value.slice(1, -1));
  assert.deepEqual(fixedBooks, GROWTH_PANEL_REQUIRED_BOOKS);
  assert.doesNotMatch(sql, /class_access_passes|owned\s*:=\s*array_append|owned\s*:=\s*owned\s*\|\|/);
  assert.match(sql, /campaign\.approved_at is not null/);
  assert.match(sql, /campaign\.ends_at is null or campaign\.ends_at > now\(\)/);
  assert.match(sql, /retention_days integer not null default 90 check \(retention_days between 1 and 365\)/);
  assert.match(sql, /coalesce\(campaign\.retain_until, clock_timestamp\(\) \+ pg_catalog\.make_interval\(days => campaign\.retention_days\)\)/);
  assert.doesNotMatch(sql, /from\s+auth\.users/i, 'service_role has no production SELECT on auth.users; existing requireUser is the identity boundary');
  assert.doesNotMatch(sql, /insert into public\.growth_panel_campaigns/i);
  assert.doesNotMatch(sql, /seat_beta|STELLA_INVITE|ADMIN_EMAIL|POINT_STELLA_TEST/);
  assert.doesNotMatch(sql, /count\(\*\)/i); assert.doesNotMatch(sql, /created_at\s*=\s*(?:now|clock_timestamp)/i);
  const duplicate = sql.indexOf("if p_action = 'submit' and has_application");
  assert.ok(duplicate < sql.indexOf('if not is_open'));
  assert.match(sql, /nickname = null, email = null, answers = '\{\}'::jsonb/);
});
await check('SQL expiry cleanup is member-scoped and before every receipt branch (static)', () => {
  const sql = readFileSync(new URL('./docs/growth-panel/schema.draft.sql', import.meta.url), 'utf8');
  const lock = sql.indexOf('perform pg_catalog.pg_advisory_xact_lock');
  const cleanup = sql.indexOf('delete from public.growth_panel_applications', lock);
  const query = sql.indexOf('select * into application', lock);
  assert.ok(lock >= 0 && cleanup > lock && query > cleanup);
  const scope = sql.slice(cleanup, query);
  assert.match(scope, /campaign_id = p_campaign_id and auth_uid = p_auth_uid and retain_until <= clock_timestamp\(\)/);
  for (const branch of ["if p_action = 'get'", "if p_action = 'submit'", "if p_action = 'withdraw'", "if p_action = 'status'"]) assert.ok(sql.indexOf(branch) > query);
  assert.match(sql, /create function public\.growth_panel_purge_expired/);
  assert.doesNotMatch(sql, /cron\.schedule|pg_cron/);
});
await check('SQL saves original notices atomically and preserves them on withdrawal (static)', () => {
  const sql = readFileSync(new URL('./docs/growth-panel/schema.draft.sql', import.meta.url), 'utf8');
  assert.match(sql, /notice_snapshot jsonb not null/);
  assert.match(sql, /notice_snapshot \?& array\['privacyNotice', 'feedbackNotice', 'retentionNotice'\]/);
  const insert = sql.slice(sql.indexOf('insert into public.growth_panel_applications'), sql.indexOf('on conflict (campaign_id, auth_uid)'));
  assert.match(insert, /ownership_snapshot, notice_snapshot, policy_version/);
  for (const [key, field] of [['privacyNotice', 'privacy_notice'], ['feedbackNotice', 'feedback_notice'], ['retentionNotice', 'retention_notice']]) {
    assert.ok(insert.includes(`'${key}', campaign.${field}`));
  }
  assert.doesNotMatch(insert, /p_payload->'?(?:privacyNotice|feedbackNotice|retentionNotice)/);
  const withdraw = sql.slice(sql.indexOf("if p_action = 'withdraw'"), sql.indexOf('select * into campaign'));
  assert.doesNotMatch(withdraw, /notice_snapshot\s*=|privacy_version\s*=|feedback_version\s*=|retention_version\s*=/);
});
console.log(`growth-panel-service: ${passed} groups PASS; mocked transport, SQL static only; no operational calls.`);
