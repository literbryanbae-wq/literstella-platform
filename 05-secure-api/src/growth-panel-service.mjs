// Dedicated quality-panel intake. No gift-account, payment, mail or entitlement writes.
// Authentication and service-role transport are injected from the existing Worker.
// Owner decision 2026-09-05: existing SSO + all EIGHT explicitly owned courses.
// No seven-course mode, derived theory, temporary pass or administrator exception.
export const GROWTH_PANEL_CAMPAIGN_ID = 'growth-quality-panel-v1';
export const GROWTH_PANEL_REQUIRED_BOOKS = Object.freeze(['kidari', 'anne', 'littlewomen1', 'littlewomen2', 'pride', 'gatsby', 'sherlock', 'theory']);
export const GROWTH_PANEL_OWNERSHIP_POLICY = 'classic7-plus-theory-explicit';
export const GROWTH_PANEL_INTERESTS = Object.freeze(['daily', 'travel', 'business', 'classics', 'hobby', 'university', 'career']);
export const GROWTH_PANEL_SKILLS = Object.freeze(['reading', 'listening', 'writing', 'speaking']);
export const GROWTH_PANEL_DEVICES = Object.freeze(['mobile', 'tablet', 'desktop', 'multiple']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const ERROR_STATUS = Object.freeze({
  unauthorized: 401, email_unverified: 403, invalid_body: 400, invalid_fields: 400,
  email_mismatch: 400, consent_required: 400, policy_changed: 409,
  campaign_closed: 409, ineligible: 403, application_not_found: 404,
  upstream_timeout: 504, service_unavailable: 503, invalid_response: 502,
  method_not_allowed: 405, not_found: 404, payload_too_large: 413,
});
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = value => typeof value === 'string' ? value.trim().normalize('NFC') : '';
const emailOf = value => clean(value).toLowerCase();
const fail = code => Object.assign(new Error(code), { code });

export function normalizeGrowthPanelApplication(input, authenticatedEmail) {
  if (!isObject(input)) throw fail('invalid_body');
  const nickname = clean(input.nickname).replace(/\s+/g, ' ');
  const situation = clean(input.situation);
  const email = emailOf(authenticatedEmail);
  if (input.email !== undefined && emailOf(input.email) !== email) throw fail('email_mismatch');
  const list = (value, allowed) => Array.isArray(value) && value.length > 0 && value.length <= allowed.length
    && value.every(item => typeof item === 'string' && allowed.includes(item))
    ? [...new Set(value)] : null;
  const interests = list(input.interests, GROWTH_PANEL_INTERESTS);
  const skills = list(input.skills, GROWTH_PANEL_SKILLS);
  if (!nickname || [...nickname].length > 40 || /[\u0000-\u001f\u007f]/.test(nickname)
    || [...situation].length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(situation)
    || !interests || !skills || !GROWTH_PANEL_DEVICES.includes(input.device)
    || typeof input.clientSubmissionId !== 'string' || !UUID.test(input.clientSubmissionId)) throw fail('invalid_fields');
  if (input.privacyConsent !== true || input.feedbackConsent !== true) throw fail('consent_required');
  if (!['privacyVersion', 'feedbackVersion', 'retentionVersion'].every(key => typeof input[key] === 'string' && VERSION.test(input[key]))) throw fail('invalid_fields');
  // Email/ownership/auth UID supplied by the browser are never forwarded as authority.
  return { nickname, interests, skills, device: input.device, situation,
    privacyConsent: true, feedbackConsent: true,
    privacyVersion: input.privacyVersion, feedbackVersion: input.feedbackVersion,
    retentionVersion: input.retentionVersion, clientSubmissionId: input.clientSubmissionId };
}

async function boundedJson(message, maxBytes, errorCode, signal) {
  const reader = message.body?.getReader();
  if (!reader) throw fail(errorCode);
  // Cancel releases pending read requests even if the underlying source's own
  // cancel promise never settles. Do not await that promise before unlocking.
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  let length = 0;
  const chunks = [];
  try {
    if (signal?.aborted) { cancel(); throw fail('upstream_timeout'); }
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw fail('upstream_timeout');
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { cancel(); throw fail(errorCode); }
      chunks.push(value);
    }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw fail(errorCode); }
}

async function deadline(operation, ms, controller) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => { controller?.abort(); reject(fail('upstream_timeout')); }, ms);
    })]);
  } finally { clearTimeout(timer); }
}

function validReceipt(value) {
  return isObject(value) && UUID.test(value.id || '')
    && ['submitted', 'pending', 'selected', 'not_selected', 'withdrawn'].includes(value.status)
    && Number.isFinite(Date.parse(value.createdAt))
    && (value.withdrawnAt === null || Number.isFinite(Date.parse(value.withdrawnAt)))
    && isObject(value.consents)
    && ['privacyVersion', 'feedbackVersion', 'retentionVersion'].every(key => VERSION.test(value.consents[key] || ''))
    && (value.status === 'withdrawn' ? value.submitted === null : isObject(value.submitted));
}

function validResult(result, action) {
  if (!isObject(result) || result.ok !== true) return false;
  if (result.application !== null && !validReceipt(result.application)) return false;
  if (action === 'withdraw') return validReceipt(result.application) && typeof result.existing === 'boolean'
    && result.application.status === 'withdrawn' && result.application.submitted === null
    && typeof result.application.withdrawnAt === 'string' && Number.isFinite(Date.parse(result.application.withdrawnAt));
  if (action === 'submit') return validReceipt(result.application) && typeof result.existing === 'boolean';
  if (action === 'get') return true;
  const campaign = result.campaign;
  const exactEight = Array.isArray(campaign?.requiredBooks) && campaign.requiredBooks.length === 8
    && new Set(campaign.requiredBooks).size === 8
    && GROWTH_PANEL_REQUIRED_BOOKS.every(book => campaign.requiredBooks.includes(book))
    && campaign.ownershipPolicy === GROWTH_PANEL_OWNERSHIP_POLICY;
  return isObject(campaign) && campaign.id === GROWTH_PANEL_CAMPAIGN_ID
    && typeof campaign.open === 'boolean' && campaign.selectionCapacity === 100
    && isObject(result.member) && typeof result.member.email === 'string'
    && [true, false, null].includes(result.member.eligible)
    && (!campaign.open || (exactEight && ['privacyVersion', 'feedbackVersion', 'retentionVersion', 'privacyNotice', 'feedbackNotice', 'retentionNotice']
      .every(key => typeof campaign[key] === 'string' && campaign[key].trim())));
}

export async function growthPanelRoute(req, env, cors, sub, deps) {
  const reply = (data, status = 200) => deps.json(data, status, { ...cors,
    'Cache-Control': 'private, no-store', Pragma: 'no-cache', Vary: 'Origin, X-User-Token' });
  const action = sub === 'status' && req.method === 'GET' ? 'status'
    : sub === 'application' && req.method === 'GET' ? 'get'
      : sub === 'application' && req.method === 'POST' ? 'submit'
        : sub === 'application/withdraw' && req.method === 'POST' ? 'withdraw' : null;
  if (!action) return reply({ ok: false, error: ['status', 'application', 'application/withdraw'].includes(sub) ? 'method_not_allowed' : 'not_found' }, ['status', 'application', 'application/withdraw'].includes(sub) ? 405 : 404);
  try {
    // Existing verifier is reused, not a second JWT implementation. It currently
    // maps invalid tokens AND auth-provider failures to null: see release notes.
    const user = await deadline(() => deps.requireUser(req, env), deps.timeoutMs ?? 8000);
    if (!user || !UUID.test(user.id || '')) throw fail('unauthorized');
    const email = emailOf(user.email);
    if (!email || !email.includes('@')) throw fail('unauthorized');
    const readBody = maxBytes => {
      const controller = new AbortController();
      return deadline(() => boundedJson(req, maxBytes, 'invalid_body', controller.signal), deps.timeoutMs ?? 8000, controller);
    };
    const rpc = async (rpcAction, payload = {}) => {
      const controller = new AbortController();
      return deadline(async () => {
        let response;
        try {
          response = await deps.sbFetch(env, 'rpc/growth_panel_request', {
            method: 'POST', signal: controller.signal,
            body: JSON.stringify({ p_action: rpcAction, p_campaign_id: GROWTH_PANEL_CAMPAIGN_ID,
              p_auth_uid: user.id, p_auth_email: email, p_payload: payload }),
          });
        } catch (error) { if (controller.signal.aborted) throw fail('upstream_timeout'); throw fail('service_unavailable'); }
        if (!response?.ok) throw fail('service_unavailable');
        const result = await boundedJson(response, 32768, 'invalid_response', controller.signal);
        if (result?.ok === false && Object.hasOwn(ERROR_STATUS, result.error)) throw fail(result.error);
        if (!validResult(result, rpcAction)) throw fail('invalid_response');
        return result;
      }, deps.timeoutMs ?? 8000, controller);
    };
    // Receipt/retry recovery must precede new-input, consent and open-date checks.
    // Even after closing, policy changes or an uncertain response, return the
    // original application untouched. The RPC repeats this check atomically.
    if (action === 'submit') {
      const previous = await rpc('get');
      if (previous.application) return reply({ ok: true, application: previous.application, existing: true });
      if (user.emailConfirmed !== true) throw fail('email_unverified');
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type') || '')) throw fail('invalid_body');
      const body = await readBody(8192);
      return reply(await rpc('submit', normalizeGrowthPanelApplication(body, email)));
    }
    if (action === 'withdraw') {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type') || '')) throw fail('invalid_body');
      const body = await readBody(1024);
      if (!isObject(body) || body.confirm !== 'WITHDRAW') throw fail('invalid_fields');
    }
    return reply(await rpc(action));
  } catch (error) {
    const code = Object.hasOwn(ERROR_STATUS, error?.code) ? error.code : 'service_unavailable';
    // Never return or log upstream bodies, auth tokens, email, free text or secrets.
    return reply({ ok: false, error: code }, ERROR_STATUS[code]);
  }
}
