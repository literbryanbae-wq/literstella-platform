// Server-only provider adapter, deliberately NOT mounted as a public route.
// The owning authenticated API must enforce membership, consent and atomic
// 10/member/day + <=1000/provider/day reservations and the fixed 100-member pilot.
// HTTPS remains the default. The separately approved, operator-controlled pilot
// may use the exact HTTP endpoint; its service must require plaintext consent.
import { normalizePronunciationResponse } from '../../src/lib/pronunciationAssessment.mjs';
import { PRONUNCIATION_RUNTIME, validPronunciationActivation } from '../../src/lib/pronunciationContract.mjs';

export function validateEtriInput({ script, pcm } = {}) {
  if (typeof script !== 'string' || !script.trim() || script.length > 500 || !/[a-z]/i.test(script) || /[\u0000-\u001f]/.test(script)) throw new Error('assessment_script_invalid');
  if (pcm?.format !== 'pcm_s16le' || pcm?.sampleRate !== 16000 || pcm?.channels !== 1 || typeof pcm.audio !== 'string' || pcm.audio.length > 2560000 || pcm.audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(pcm.audio)) throw new Error('assessment_audio_invalid');
  const bytes = pcm.audio.length / 4 * 3 - (pcm.audio.endsWith('==') ? 2 : pcm.audio.endsWith('=') ? 1 : 0);
  if (bytes < 32000 || bytes > 1920000 || bytes % 2 !== 0) throw new Error('assessment_audio_duration');
  // Never trust browser duration metadata for provider limits.
  return { script: script.trim(), audio: pcm.audio, durationMs: bytes / 32 };
}

async function boundedJson(response, signal) {
  if (!response.body) throw new Error('assessment_provider_failed');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted) { cancel(); throw new Error('assessment_provider_failed'); }
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 32768) { cancel(); throw new Error('assessment_provider_failed'); }
      chunks.push(value);
    }
    if (signal?.aborted) throw new Error('assessment_provider_failed');
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('assessment_provider_failed'); }
}

export function createEtriPronunciationProvider({ apiKey = '', endpoint = '', serviceUseApproved = false, secureEndpointVerified = false,
  httpPilotApproved = false, operatorControlled = false, pilotActivatedAt = '', pilotExpiresAt,
  now = Date.now, fetchImpl = globalThis.fetch } = {}) {
  let url;
  try { url = new URL(endpoint); } catch { /* Disabled configuration is expected. */ }
  const httpPilot = httpPilotApproved === true && endpoint === 'http://epretx.etri.re.kr:8000/api/WiseASR_Pronunciation'
    && operatorControlled === true && pilotExpiresAt === null && validPronunciationActivation(pilotActivatedAt, now());
  const secure = secureEndpointVerified === true && url?.protocol === 'https:';
  const configured = serviceUseApproved === true && typeof apiKey === 'string' && Boolean(apiKey.trim()) &&
    (secure || httpPilot) && url?.hostname === 'epretx.etri.re.kr' && url.pathname === '/api/WiseASR_Pronunciation' && !url.username && !url.password && !url.search && !url.hash;
  const isReady = () => Boolean(configured && (!httpPilot || validPronunciationActivation(pilotActivatedAt, now())));
  return Object.freeze({
    get ready() { return isReady(); },
    transport: httpPilot ? 'http-test' : 'https',
    runtime: httpPilot ? PRONUNCIATION_RUNTIME : null,
    operatorControlled: httpPilot,
    pilotActivatedAt: httpPilot ? pilotActivatedAt : null,
    pilotExpiresAt: null,
    async assess(input, { signal } = {}) {
      if (!isReady()) throw new Error('assessment_not_ready');
      const { script, audio } = validateEtriInput(input);
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(abort, 90000);
      try {
        const response = await fetchImpl(url.href, {
          // The deployed Workers runtime rejects redirect:'error'. Manual still
          // prevents forwarding Authorization/audio to a redirect destination;
          // the !response.ok guard below rejects every 3xx without another fetch.
          method: 'POST', redirect: 'manual', signal: controller.signal,
          headers: { Authorization: apiKey, 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ argument: { language_code: 'english', script, audio } }),
        });
        if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('assessment_provider_failed'); }
        return normalizePronunciationResponse(await boundedJson(response, controller.signal));
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    },
  });
}
