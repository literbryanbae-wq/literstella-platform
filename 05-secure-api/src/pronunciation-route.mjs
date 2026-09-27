// Server-only operator-controlled member HTTP pilot. Missing configuration leaves it off.
import { createPronunciationStore } from './pronunciation/pronunciationStore.mjs';
import { createPronunciationService } from './pronunciation/english/learning-platform/server/pronunciationService.mjs';
import { createEtriPronunciationProvider } from './pronunciation/english/learning-platform/server/etriPronunciationProvider.mjs';
import { pronunciationRecord, PRONUNCIATION_HTTP_CONSENT } from './pronunciation/english/src/lib/pronunciationContract.mjs';

const RPCS = new Set(['pronunciation_policy_v1', 'pronunciation_pilot_v1', 'pronunciation_reserve_v1',
  'pronunciation_complete_v1', 'pronunciation_uncertain_v1', 'pronunciation_get_v1']);

async function boundedJson(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('assessment_unavailable');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks = []; let size = 0;
  try {
    while (true) {
      if (signal?.aborted) { cancel(); throw new Error('assessment_unavailable'); }
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { cancel(); throw new Error('assessment_unavailable'); }
      chunks.push(value);
    }
    if (signal?.aborted) throw new Error('assessment_unavailable');
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function pronunciationRoute(req, env, { requireUser, sbFetch }) {
  const store = createPronunciationStore({
    normalizeResult: pronunciationRecord,
    rpc: async (name, params, { signal }) => {
      if (!RPCS.has(name)) throw new Error('assessment_unavailable');
      const response = await sbFetch(env, `rpc/${name}`, {
        method: 'POST', body: JSON.stringify(params), signal,
      });
      const data = await boundedJson(response, signal);
      return response.ok ? { data } : { error: data };
    },
  });
  const provider = createEtriPronunciationProvider({
    apiKey: env.ETRI_API_KEY,
    endpoint: 'http://epretx.etri.re.kr:8000/api/WiseASR_Pronunciation',
    serviceUseApproved: env.ETRI_SERVICE_USE_APPROVED === 'true',
    httpPilotApproved: env.ETRI_HTTP_PILOT_APPROVED === 'true',
    operatorControlled: env.PRONUNCIATION_OPERATOR_CONTROLLED === 'true',
    pilotActivatedAt: env.PRONUNCIATION_PILOT_ACTIVATED_AT,
    pilotExpiresAt: null,
  });
  return createPronunciationService({
    requireUser, store, provider,
    enabled: env.PRONUNCIATION_ENABLED === 'true',
    operatorControlled: env.PRONUNCIATION_OPERATOR_CONTROLLED === 'true',
    rollout: 'member-http-pilot', privacyVersion: PRONUNCIATION_HTTP_CONSENT,
    allowedOrigins: String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
  }).handle(req, env);
}
