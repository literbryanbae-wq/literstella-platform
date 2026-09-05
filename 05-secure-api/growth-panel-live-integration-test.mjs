import assert from 'node:assert/strict';
import worker from './src/index.js';
import {
  GROWTH_PANEL_CAMPAIGN_ID,
  GROWTH_PANEL_OWNERSHIP_POLICY,
  GROWTH_PANEL_REQUIRED_BOOKS,
} from './src/growth-panel-service.mjs';

const ENGLISH_ORIGIN = 'https://english.literstella.co.kr';
const API_ORIGIN = 'https://literstella-api.literbryanbae.workers.dev';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const originalFetch = globalThis.fetch;
const originalError = console.error;
let calls = [];

const env = {
  ALLOWED_ORIGINS: `${ENGLISH_ORIGIN},https://class.literstella.co.kr`,
  SUPABASE_URL: 'https://example.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  PAYMENT_ENABLED: 'false',
};

const statusPayload = {
  ok: true,
  campaign: {
    id: GROWTH_PANEL_CAMPAIGN_ID,
    open: true,
    selectionCapacity: 100,
    requiredBooks: [...GROWTH_PANEL_REQUIRED_BOOKS],
    ownershipPolicy: GROWTH_PANEL_OWNERSHIP_POLICY,
    privacyVersion: 'privacy-v1',
    feedbackVersion: 'feedback-v1',
    retentionVersion: 'retention-v1',
    privacyNotice: 'privacy notice',
    feedbackNotice: 'feedback notice',
    retentionNotice: 'retention notice',
  },
  member: { email: 'member@example.test', eligible: true },
  application: null,
};

try {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return Response.json({ id: USER_ID, email: 'member@example.test', email_confirmed_at: '2026-09-05T00:00:00Z' });
    }
    if (url.endsWith('/rest/v1/rpc/growth_panel_request')) return Response.json(statusPayload);
    throw new Error(`unexpected test URL: ${url}`);
  };

  const response = await worker.fetch(new Request(`${API_ORIGIN}/api/growth-panel/status`, {
    headers: { Origin: ENGLISH_ORIGIN, 'X-User-Token': 'test-access-token' },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), ENGLISH_ORIGIN);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Origin, X-User-Token');
  const payload = await response.json();
  assert.equal(payload.campaign.id, GROWTH_PANEL_CAMPAIGN_ID);
  const rpcCall = calls.find(call => call.url.endsWith('/rest/v1/rpc/growth_panel_request'));
  assert.ok(rpcCall);
  assert.deepEqual(JSON.parse(rpcCall.init.body), {
    p_action: 'status',
    p_campaign_id: GROWTH_PANEL_CAMPAIGN_ID,
    p_auth_uid: USER_ID,
    p_auth_email: 'member@example.test',
    p_payload: {},
  });

  const preflight = await worker.fetch(new Request(`${API_ORIGIN}/api/growth-panel/application`, {
    method: 'OPTIONS',
    headers: { Origin: ENGLISH_ORIGIN },
  }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ENGLISH_ORIGIN);

  calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return new Response('{}', { status: 200 });
  };
  await worker.scheduled({ cron: '25 18 * * *', scheduledTime: Date.UTC(2026, 8, 5) }, env, { waitUntil() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.supabase.test/rest/v1/rpc/growth_panel_purge_expired');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{}');

  const errors = [];
  console.error = value => errors.push(String(value));
  globalThis.fetch = async () => new Response('private upstream detail', { status: 503 });
  await assert.rejects(
    worker.scheduled({ cron: '25 18 * * *', scheduledTime: Date.UTC(2026, 8, 5) }, env, { waitUntil() {} }),
    /growth_panel_purge_failed/,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /growth_panel_purge_failed/);
  assert.doesNotMatch(errors[0], /private upstream detail|test-only|member@example/);
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalError;
}

console.log('Growth panel live integration: route, exact-origin CORS, service-role RPC and 90-day purge cron PASS');
