// Integration-ready request service; NOT mounted in any deployed Worker.
// Reuse the owning API's requireUser(req, env), not a second JWT implementation.
// store must be durable + atomic. There is deliberately no in-memory/KV fallback.
import { validateEtriInput } from './etriPronunciationProvider.mjs';
import { PRONUNCIATION_PILOT, PRONUNCIATION_HTTP_CONSENT, PRONUNCIATION_RUNTIME, PRONUNCIATION_RETENTION_DAYS, validPronunciationHttpPolicy, PRONUNCIATION_RECORD_VERSION, PRONUNCIATION_UUID, pronunciationRecord, pronunciationReceipt } from '../../src/lib/pronunciationContract.mjs';

const PREFIX = '/api/english/pronunciation/';
const STATUS = Object.freeze({ assessment_signin_required: 401, assessment_membership_required: 403,
  assessment_pilot_required: 403, assessment_pilot_limit: 503,
  assessment_origin_rejected: 403, assessment_not_ready: 503, assessment_invalid_body: 400,
  assessment_consent_required: 400, assessment_audio_invalid: 400, assessment_audio_duration: 400,
  assessment_script_invalid: 400, assessment_request_conflict: 409, assessment_pending: 409,
  assessment_uncertain: 409, assessment_daily_limit: 429, assessment_service_limit: 429,
  assessment_not_found: 404, assessment_provider_failed: 502, assessment_unavailable: 503 });
const fail = code => { throw new Error(code); };
const validUid = value => typeof value === 'string' && PRONUNCIATION_UUID.test(value);

async function boundedBody(req, maxBytes, signal) {
  const reader = req.body?.getReader();
  if (!reader) return fail('assessment_invalid_body');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const chunks = []; let size = 0;
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) return fail('assessment_unavailable');
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { cancel(); return fail('assessment_invalid_body'); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return fail('assessment_invalid_body'); }
}

async function deadline(run, parentSignal, ms = 10000) {
  const controller = new AbortController(); let timer; let abort;
  try {
    return await Promise.race([
      new Promise((_, reject) => {
        abort = () => { controller.abort(); reject(new Error('assessment_unavailable')); };
        parentSignal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(abort, ms);
        if (parentSignal?.aborted) abort();
      }),
      Promise.resolve().then(() => { if (controller.signal.aborted) return fail('assessment_unavailable'); return run(controller.signal); }),
    ]);
  } finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', abort); }
}

export function createPronunciationService({ requireUser, checkMembership, store, provider,
  enabled = false, operatorControlled = false, rollout = 'all-in-one', privacyVersion = '', allowedOrigins = [], now = () => new Date() } = {}) {
  const memberPilot = rollout === 'member-http-pilot';
  const ready = enabled === true && provider?.ready === true && Boolean(privacyVersion)
    && typeof requireUser === 'function' && (memberPilot ? typeof store?.getPolicy === 'function'
      && operatorControlled === true && provider.operatorControlled === true && provider.runtime === PRONUNCIATION_RUNTIME
      && privacyVersion === PRONUNCIATION_HTTP_CONSENT && provider.transport === 'http-test'
      : typeof checkMembership === 'function' && provider?.transport !== 'http-test')
    && store?.atomic === true && ['getPilotMembership', 'reserve', 'complete', 'markUncertain', 'get'].every(key => typeof store[key] === 'function');
  const origins = new Set(allowedOrigins);
  return Object.freeze({
    ready,
    async handle(req, env) {
      const origin = req.headers.get('Origin');
      const cors = origins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {};
      const reply = (body, status = 200) => Response.json(body, { status, headers: {
        ...cors, 'Cache-Control': 'private, no-store', Pragma: 'no-cache', Vary: 'Origin, X-User-Token',
      } });
      try {
        if (!origin || !origins.has(origin)) return fail('assessment_origin_rejected');
        const url = new URL(req.url); const action = url.pathname.slice(PREFIX.length);
        if (!url.pathname.startsWith(PREFIX) || !['status', 'assess', 'result'].includes(action)) return reply({ ok: false, error: 'not_found' }, 404);
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
          ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-User-Token', Vary: 'Origin', 'Cache-Control': 'no-store',
        } });
        if (req.method !== (action === 'assess' ? 'POST' : 'GET')) return reply({ ok: false, error: 'method_not_allowed' }, 405);
        if (typeof requireUser !== 'function') return fail('assessment_not_ready');
        const user = await deadline(signal => requireUser(req, env, { signal }), req.signal);
        if (!validUid(user?.id) || user.emailConfirmed !== true || user.isAnonymous === true) return fail('assessment_signin_required');
        // Read-only result recovery remains available after disabling new assessments.
        if (action === 'result') {
          const requestId = url.searchParams.get('requestId');
          if (!validUid(requestId)) return fail('assessment_invalid_body');
          if (typeof store?.get !== 'function') return fail('assessment_not_ready');
          const saved = await deadline(signal => store.get({ authUid: user.id, requestId }, { signal }), req.signal);
          if (!saved) return fail('assessment_not_found');
          if (saved.authUid !== user.id) return fail('assessment_unavailable');
          if (saved.state !== 'completed') return fail(saved.state === 'uncertain' ? 'assessment_uncertain' : 'assessment_pending');
          const result = pronunciationRecord(saved.result, { requestId });
          if (memberPilot && now().getTime() >= Date.parse(result.assessedAt) + PRONUNCIATION_RETENTION_DAYS * 86400000) return fail('assessment_not_found');
          const receipt = pronunciationReceipt(saved.receipt, requestId);
          if (!receipt) return fail('assessment_unavailable');
          return reply({ ok: true, result, receipt, storage: 'saved' });
        }
        if (!ready || !provider.ready) return action === 'status'
          ? reply({ ok: true, ready: false, reason: 'assessment_not_ready' }) : fail('assessment_not_ready');
        let policy;
        if (memberPilot) {
          policy = await deadline(signal => store.getPolicy({ authUid: user.id, pilotId: PRONUNCIATION_PILOT.id }, { signal }), req.signal);
          if (policy?.enabled !== true || policy.privacyVersion !== privacyVersion || policy.audience !== 'members'
            || policy.authUid !== user.id || policy.pilotId !== PRONUNCIATION_PILOT.id
            || !validPronunciationHttpPolicy(policy, now().getTime()) || policy.transport !== 'http-test'
            || provider.pilotExpiresAt !== null || Date.parse(policy.activatedAt) !== Date.parse(provider.pilotActivatedAt)) return action === 'status'
              ? reply({ ok: true, ready: false, reason: 'assessment_not_ready' }) : fail('assessment_not_ready');
        }
        // CLASS_GATE owns entitlement (including its annual-pass/theory rules).
        // Never reimplement those rules or trust client/user_metadata claims here.
        if (!memberPilot) {
          const membership = await deadline(signal => checkMembership(user, env, { signal, request: req }), req.signal);
          if (membership?.eligible !== true || membership?.ownershipPolicy !== 'class-gate-premium-status') return fail('assessment_membership_required');
        }
        // Fixed cohort for the entire pilot, not 100 new users each day. Read-only:
        // opening this screen must never enroll someone or claim a pilot seat.
        const pilot = await deadline(signal => store.getPilotMembership({ authUid: user.id, pilotId: PRONUNCIATION_PILOT.id }, { signal }), req.signal);
        if (pilot?.authUid !== user.id || pilot?.pilotId !== PRONUNCIATION_PILOT.id
          || (pilot?.state !== 'enrolled' && !(memberPilot && pilot?.state === 'not_enrolled'))) return fail('assessment_pilot_required');
        if (!Number.isInteger(pilot.enrolledCount) || pilot.enrolledCount < (memberPilot ? 0 : 1)
          || pilot.enrolledCount > PRONUNCIATION_PILOT.participantLimit
          || (pilot.state !== 'enrolled' && pilot.enrolledCount >= PRONUNCIATION_PILOT.participantLimit)) return fail('assessment_pilot_limit');
        if (action === 'status') return reply({ ok: true, ready: true, privacyVersion,
          transport: memberPilot ? 'http-test' : 'https', audience: memberPilot ? 'members' : 'all-in-one',
          ...(memberPilot ? { runtime: PRONUNCIATION_RUNTIME, activatedAt: policy.activatedAt,
            expiresAt: null, resultRetentionDays: PRONUNCIATION_RETENTION_DAYS } : {}),
          memberDailyLimit: PRONUNCIATION_PILOT.memberDailyLimit,
          pilot: { id: PRONUNCIATION_PILOT.id, participantLimit: PRONUNCIATION_PILOT.participantLimit },
          maxRecordingSeconds: 60, scoreScale: { min: 1, max: 5 } });
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type') || '')) return fail('assessment_invalid_body');
        const body = await deadline(signal => boundedBody(req, 2605000, signal), req.signal);
        if (!body || Array.isArray(body) || Object.keys(body).some(key => !['requestId', 'script', 'pcm', 'consent', 'consentVersion', 'plaintextConsent'].includes(key)) || !validUid(body.requestId)) return fail('assessment_invalid_body');
        if (body.consent !== true || body.consentVersion !== privacyVersion) return fail('assessment_consent_required');
        if (memberPilot && body.plaintextConsent !== true) return fail('assessment_consent_required');
        const input = validateEtriInput(body); const requestId = body.requestId;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([input.script, input.audio])));
        const inputHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        const day = new Date(now().getTime() + 9 * 3600000).toISOString().slice(0, 10);
        const reservation = await deadline(signal => store.reserve({ authUid: user.id, requestId, inputHash,
          day, consentVersion: privacyVersion, pilotId: PRONUNCIATION_PILOT.id,
          ...(memberPilot ? { enrollOnConsent: true, consent: true } : {}),
          participantLimit: PRONUNCIATION_PILOT.participantLimit, memberDailyLimit: PRONUNCIATION_PILOT.memberDailyLimit,
          serviceDailyLimit: PRONUNCIATION_PILOT.serviceDailyLimit }, { signal }), req.signal);
        if (reservation?.authUid !== user.id) return fail('assessment_unavailable');
        if (reservation.state === 'completed') {
          const result = pronunciationRecord(reservation.result, { requestId, script: input.script });
          if (memberPilot && now().getTime() >= Date.parse(result.assessedAt) + PRONUNCIATION_RETENTION_DAYS * 86400000) return fail('assessment_not_found');
          const receipt = pronunciationReceipt(reservation.receipt, requestId);
          if (!receipt) return fail('assessment_unavailable');
          return reply({ ok: true, result, receipt, storage: 'saved', reused: true });
        }
        const denied = { daily_limit: 'assessment_daily_limit', service_limit: 'assessment_service_limit',
          pilot_required: 'assessment_pilot_required', pilot_limit: 'assessment_pilot_limit',
          conflict: 'assessment_request_conflict', pending: 'assessment_pending', uncertain: 'assessment_uncertain' };
        if (denied[reservation.state]) return fail(denied[reservation.state]);
        if (reservation.state !== 'reserved' || !validUid(reservation.leaseId)) return fail('assessment_unavailable');
        const identity = { authUid: user.id, requestId, leaseId: reservation.leaseId };
        let result;
        try {
          const output = await deadline(signal => provider.assess({ script: input.script, pcm: body.pcm }, { signal }), req.signal, 95000);
          result = pronunciationRecord({ ...output, requestId, script: input.script, version: PRONUNCIATION_RECORD_VERSION,
            durationMs: Math.round(input.durationMs), assessedAt: now().toISOString() }, { requestId, script: input.script });
        } catch {
          // Unknown provider outcome: do not refund/retry automatically and risk
          // exceeding the actual provider budget. Never persist/log raw audio.
          try { await deadline(signal => store.markUncertain(identity, { signal }), null); } catch { /* Reservation already prevents duplicate dispatch. */ }
          return fail('assessment_uncertain');
        }
        // Provider success and record-save success are different facts.
        // Do not classify a save timeout as a failed provider request or resubmit it.
        let receipt = null;
        try {
          receipt = pronunciationReceipt(await deadline(signal => store.complete({ ...identity, result }, { signal }), null), requestId);
        } catch { /* Client can recover using GET result with this same requestId. */ }
        return reply({ ok: true, result, receipt, storage: receipt ? 'saved' : 'unconfirmed' });
      } catch (error) {
        const code = Object.hasOwn(STATUS, error?.message) ? error.message : 'assessment_unavailable';
        return reply({ ok: false, error: code }, STATUS[code]);
      }
    },
  });
}
