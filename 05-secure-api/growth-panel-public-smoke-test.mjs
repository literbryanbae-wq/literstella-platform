// Read-only public deployment contract. Sends GET/OPTIONS only: no credentials,
// application POST, member reads, environment secrets, or automatic retries.
// Usage: node growth-panel-public-smoke-test.mjs [https://api-origin.example]
// Local harness: node growth-panel-public-smoke-test.mjs --self-test
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const DEFAULT_API_ORIGIN = 'https://literstella-api.literbryanbae.workers.dev';
const ENGLISH_ORIGIN = 'https://english.literstella.co.kr';
const INVALID_ORIGIN = 'https://growth-panel-origin-check.invalid';
const MAX_BODY_BYTES = 4096;

function apiOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('API origin must be an absolute URL.'); }
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !loopback) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API origin must use HTTPS (or HTTP loopback), with no credentials, path, query, or fragment.');
  }
  return url.origin;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function safeJson(response) {
  requireCondition(/\bapplication\/json\b/i.test(response.headers.get('Content-Type') || ''), 'Expected JSON, not an HTML fallback.');
  const reader = response.body?.getReader();
  requireCondition(reader, 'Expected a JSON response body.');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      requireCondition(bytes <= MAX_BODY_BYTES, 'Public response exceeded the safe size limit.');
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(joined)); }
  catch { throw new Error('Expected a valid JSON response.'); }
  requireCondition(data && typeof data === 'object' && !Array.isArray(data), 'Expected a JSON object.');
  return data;
}

function headerValues(response, name) {
  return (response.headers.get(name) || '').toLowerCase().split(',').map(value => value.trim());
}

export async function runGrowthPanelPublicSmoke({ baseUrl = DEFAULT_API_ORIGIN, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const origin = apiOrigin(baseUrl);
  requireCondition(typeof fetchImpl === 'function', 'A Fetch implementation is required.');
  const timeout = Math.max(1, Math.min(30000, Number(timeoutMs) || 12000));
  const probes = [];
  const add = (name, path, method, originHeader, validate, preflightMethod = 'GET') => probes.push(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(`${origin}${path}`, {
        method, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', Origin: originHeader,
          ...(method === 'OPTIONS' ? { 'Access-Control-Request-Method': preflightMethod, 'Access-Control-Request-Headers': 'x-user-token, content-type' } : {}) },
      });
      await validate(response);
      return { name, ok: true, status: response.status };
    } catch (error) {
      // Do not log response bodies, request headers, tokens, or raw network errors.
      const detail = controller.signal.aborted ? 'Request deadline exceeded.'
        : error?.name === 'TypeError' ? 'Public network request failed.'
          : error?.message || 'Public contract failed.';
      return { name, ok: false, detail };
    } finally { clearTimeout(timer); }
  });
  const denied = async (response, allowed) => {
    requireCondition(response.status === 401, `Expected authentication boundary HTTP 401; received ${response.status}. A 404 usually means the deployed route is missing.`);
    requireCondition(response.headers.get('Access-Control-Allow-Origin') === (allowed ? ENGLISH_ORIGIN : null), allowed ? 'English Origin is not allowed exactly.' : 'Untrusted Origin must not receive Access-Control-Allow-Origin.');
    const cache = headerValues(response, 'Cache-Control');
    requireCondition(cache.includes('private') && cache.includes('no-store'), 'Authentication response must be private, no-store.');
    const data = await safeJson(response);
    requireCondition(data.ok === false && data.error === 'unauthorized', 'Expected the non-member unauthorized response.');
    requireCondition(Object.keys(data).every(key => ['ok', 'error'].includes(key)), 'Unauthenticated response must not include member or campaign details.');
  };
  const preflight = (response, allowed, requestedMethod) => {
    requireCondition(response.status === 204, `Expected preflight HTTP 204; received ${response.status}.`);
    requireCondition(response.headers.get('Access-Control-Allow-Origin') === (allowed ? ENGLISH_ORIGIN : null), allowed ? 'English preflight Origin is not allowed exactly.' : 'Untrusted preflight Origin must not receive Access-Control-Allow-Origin.');
    if (allowed) {
      requireCondition(headerValues(response, 'Access-Control-Allow-Headers').includes('x-user-token'), 'English preflight must allow x-user-token.');
      requireCondition(headerValues(response, 'Access-Control-Allow-Methods').includes(requestedMethod.toLowerCase()), `English preflight must allow ${requestedMethod}.`);
    }
  };
  add('status route / anonymous', '/api/growth-panel/status', 'GET', ENGLISH_ORIGIN, response => denied(response, true));
  add('application route / anonymous', '/api/growth-panel/application', 'GET', ENGLISH_ORIGIN, response => denied(response, true));
  add('untrusted Origin / anonymous', '/api/growth-panel/status', 'GET', INVALID_ORIGIN, response => denied(response, false));
  add('English status preflight', '/api/growth-panel/status', 'OPTIONS', ENGLISH_ORIGIN, response => preflight(response, true, 'GET'));
  add('English application preflight', '/api/growth-panel/application', 'OPTIONS', ENGLISH_ORIGIN, response => preflight(response, true, 'POST'), 'POST');
  add('untrusted Origin preflight', '/api/growth-panel/application', 'OPTIONS', INVALID_ORIGIN, response => preflight(response, false, 'POST'), 'POST');
  add('existing auth mailer binding', '/api/health', 'GET', ENGLISH_ORIGIN, async response => {
    requireCondition(response.status === 200, `Expected health HTTP 200; received ${response.status}.`);
    const data = await safeJson(response);
    requireCondition(data.ok === true && data.authMailerBound === true, 'Existing authMailerBound must remain true.');
  });
  const results = await Promise.all(probes.map(probe => probe()));
  return { ok: results.every(result => result.ok), results };
}

async function selfTest() {
  const calls = [];
  const fixture = async (url, init) => {
    calls.push({ url, init });
    assert.ok(['GET', 'OPTIONS'].includes(init.method));
    assert.equal(init.body, undefined);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).has('X-User-Token'), false);
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.equal(new Headers(init.headers).has('Cookie'), false);
    const allowed = init.headers.Origin === ENGLISH_ORIGIN;
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
      ...(allowed ? { 'Access-Control-Allow-Origin': ENGLISH_ORIGIN } : {}),
      'Access-Control-Allow-Headers': 'Content-Type, X-User-Token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (init.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    return url.endsWith('/api/health')
      ? Response.json({ ok: true, authMailerBound: true }, { headers })
      : Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  };
  const passed = await runGrowthPanelPublicSmoke({ baseUrl: 'http://127.0.0.1:1234', fetchImpl: fixture });
  assert.equal(passed.ok, true);
  assert.equal(calls.length, 7);
  for (const [label, mutate] of [
    ['missing route', () => Response.json({ ok: false, error: 'not_found' }, { status: 404 })],
    ['missing English Origin', async (url, init) => { const response = await fixture(url, init); response.headers.delete('Access-Control-Allow-Origin'); return response; }],
    ['wildcard Origin', async (url, init) => { const response = await fixture(url, init); response.headers.set('Access-Control-Allow-Origin', '*'); return response; }],
    ['missing private cache', async (url, init) => { const response = await fixture(url, init); response.headers.set('Cache-Control', 'no-store'); return response; }],
    ['missing auth binding', async (url, init) => url.endsWith('/api/health') ? Response.json({ ok: true, authMailerBound: false }) : fixture(url, init)],
  ]) {
    const failed = await runGrowthPanelPublicSmoke({ fetchImpl: mutate });
    assert.equal(failed.ok, false, `${label} must fail`);
  }
  for (const value of ['https://user:password@api.test', 'https://api.test/path', 'https://api.test?token=fake', 'http://api.test']) {
    await assert.rejects(runGrowthPanelPublicSmoke({ baseUrl: value, fetchImpl: () => assert.fail('Invalid origin must not make a request') }));
  }
  console.log('Growth panel public smoke self-test PASS: seven read-only probes and five broken-deployment fixtures. No real network.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === '--self-test') await selfTest();
    else {
      requireCondition(process.argv.length <= 3, 'Use only an optional API origin, or --self-test.');
      const report = await runGrowthPanelPublicSmoke({ baseUrl: process.argv[2] || DEFAULT_API_ORIGIN });
      for (const result of report.results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${result.ok ? `HTTP ${result.status}` : result.detail}`);
      console.log(`Growth panel PUBLIC smoke ${report.ok ? 'PASS' : 'FAIL'}: ${report.results.filter(result => result.ok).length}/${report.results.length}. GET/OPTIONS only; no account, application submission, or member data.`);
      if (!report.ok) process.exitCode = 1;
    }
  } catch (error) { console.error(`Growth panel public smoke cannot run: ${error.message}`); process.exitCode = 1; }
}
