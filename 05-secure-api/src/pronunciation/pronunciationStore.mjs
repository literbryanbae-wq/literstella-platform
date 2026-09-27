// Server-only adapter. Inject the owner's service-role RPC transport and the
// shared pronunciationRecord normalizer. Never import this in a browser bundle.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PILOT = 'english-pronunciation-pilot-20260923';
const HTTP_CONSENT = 'etri-member-http-pilot-20260928-v2';
const invalid = () => { throw new Error('assessment_unavailable'); };
const uid = value => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : invalid();
const identity = value => ({ p_auth_uid: uid(value?.authUid), p_request_id: uid(value?.requestId) });
function receipt(value, requestId) {
  if (value?.requestId !== requestId || value.status !== 'saved' || typeof value.savedAt !== 'string'
    || !Number.isFinite(Date.parse(value.savedAt))) return invalid();
  return { requestId, status: 'saved', savedAt: value.savedAt };
}

export function createPronunciationStore({ rpc, normalizeResult } = {}) {
  if (typeof rpc !== 'function' || typeof normalizeResult !== 'function') return invalid();
  async function call(name, params, { signal } = {}) {
    if (signal?.aborted) return invalid();
    let response;
    try { response = await rpc(name, params, { signal }); } catch { return invalid(); }
    if (signal?.aborted) return invalid();
    if (!response || response.error) {
      if (response?.error?.code === 'P0001'
        && ['assessment_not_ready', 'assessment_consent_required'].includes(response.error.message))
        throw new Error(response.error.message);
      return invalid();
    }
    if (!Object.hasOwn(response, 'data')) return invalid();
    return response.data;
  }
  function view(value, owner, requestId) {
    if (value?.authUid !== owner) return invalid();
    if (value.state === 'completed') return {
      authUid: owner, state: 'completed', result: normalizeResult(value.result, { requestId }),
      receipt: receipt(value.receipt, requestId),
    };
    if (!['pending', 'uncertain'].includes(value.state)) return invalid();
    return { authUid: owner, state: value.state };
  }
  return Object.freeze({
    atomic: true,
    async getPolicy(value, options) {
      const owner = uid(value?.authUid);
      if (value?.pilotId !== PILOT) return invalid();
      const data = await call('pronunciation_policy_v1', { p_auth_uid: owner, p_pilot_id: PILOT }, options);
      if (data?.authUid !== owner || data.pilotId !== PILOT || typeof data.enabled !== 'boolean'
        || data.privacyVersion !== HTTP_CONSENT || data.audience !== 'members' || data.transport !== 'http-test') return invalid();
      const start = Date.parse(data.activatedAt);
      if (data.runtime !== 'operator-controlled' || data.resultRetentionDays !== 30
        || data.expiresAt !== null) return invalid();
      if (data.enabled && !Number.isFinite(start)) return invalid();
      if (data.activatedAt !== null && (typeof data.activatedAt !== 'string' || !Number.isFinite(start))) return invalid();
      return { authUid: owner, pilotId: PILOT, enabled: data.enabled, privacyVersion: data.privacyVersion,
        activatedAt: data.activatedAt, expiresAt: null, audience: data.audience, transport: data.transport,
        runtime: data.runtime, resultRetentionDays: data.resultRetentionDays };
    },
    async getPilotMembership(value, options) {
      const owner = uid(value?.authUid);
      if (value?.pilotId !== PILOT) return invalid();
      const data = await call('pronunciation_pilot_v1', { p_auth_uid: owner, p_pilot_id: PILOT }, options);
      if (data?.authUid !== owner || data.pilotId !== PILOT || !['enrolled', 'not_enrolled', 'revoked'].includes(data.state)
        || !Number.isInteger(data.enrolledCount) || data.enrolledCount < 0 || data.enrolledCount > 100) return invalid();
      return { authUid: owner, pilotId: PILOT, state: data.state, enrolledCount: data.enrolledCount };
    },
    async reserve(value, options) {
      const params = identity(value);
      if (value.consent !== true || value.enrollOnConsent !== true || value.consentVersion !== HTTP_CONSENT)
        throw new Error('assessment_consent_required');
      if (value.pilotId !== PILOT || value.memberDailyLimit !== 10 || value.serviceDailyLimit !== 1000
        || value.participantLimit !== 100 || typeof value.inputHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.inputHash)
        || typeof value.consentVersion !== 'string' || !value.consentVersion || value.consentVersion.length > 100) return invalid();
      // Caller date and limits never reach SQL. DB owns day boundaries and caps.
      const data = await call('pronunciation_reserve_v1', { ...params, p_input_hash: value.inputHash,
        p_pilot_id: PILOT, p_consent_version: value.consentVersion,
        p_consent: value.consent, p_enroll_on_consent: value.enrollOnConsent }, options);
      if (data?.authUid !== params.p_auth_uid) return invalid();
      if (data.state === 'reserved') return { authUid: data.authUid, state: 'reserved', leaseId: uid(data.leaseId) };
      if (['daily_limit', 'service_limit', 'pilot_required', 'pilot_limit', 'conflict'].includes(data.state))
        return { authUid: data.authUid, state: data.state };
      return view(data, params.p_auth_uid, params.p_request_id);
    },
    async complete(value, options) {
      const params = identity(value);
      const result = normalizeResult(value.result, { requestId: params.p_request_id });
      const data = await call('pronunciation_complete_v1', { ...params,
        p_lease_id: uid(value.leaseId), p_result: result }, options);
      return receipt(data, params.p_request_id);
    },
    async markUncertain(value, options) {
      const params = identity(value);
      return view(await call('pronunciation_uncertain_v1', { ...params, p_lease_id: uid(value.leaseId) }, options),
        params.p_auth_uid, params.p_request_id);
    },
    async get(value, options) {
      const params = identity(value);
      const data = await call('pronunciation_get_v1', params, options);
      return data === null ? null : view(data, params.p_auth_uid, params.p_request_id);
    },
  });
}
