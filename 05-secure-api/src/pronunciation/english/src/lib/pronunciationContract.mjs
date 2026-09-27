// Public DTO only. Provider credentials and raw recordings never enter records.
export const PRONUNCIATION_RECORD_VERSION = 'sentence-pronunciation.v1';
export const PRONUNCIATION_HTTP_CONSENT = 'etri-member-http-pilot-20260928-v2';
export const PRONUNCIATION_RUNTIME = 'operator-controlled';
export const PRONUNCIATION_RETENTION_DAYS = 30;
export function validPronunciationActivation(value, now = Date.now()) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now;
}
export function validPronunciationHttpPolicy(value, now = Date.now()) {
  return value?.privacyVersion === PRONUNCIATION_HTTP_CONSENT && value.runtime === PRONUNCIATION_RUNTIME
    && value.expiresAt === null && value.resultRetentionDays === PRONUNCIATION_RETENTION_DAYS
    && validPronunciationActivation(value.activatedAt, now);
}
// Operator-approved pilot policy; never accept limits or membership from a browser.
export const PRONUNCIATION_PILOT = Object.freeze({
  id: 'english-pronunciation-pilot-20260923',
  memberDailyLimit: 10,
  participantLimit: 100,
  serviceDailyLimit: 1000,
});
export const PRONUNCIATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function pronunciationRecord(value, { requestId, script } = {}) {
  if (!value || value.version !== PRONUNCIATION_RECORD_VERSION || value.sample !== false
    || !PRONUNCIATION_UUID.test(value.requestId || '') || (requestId && value.requestId !== requestId)
    || typeof value.script !== 'string' || !value.script || value.script.length > 500
    || (script !== undefined && value.script !== script)
    || typeof value.recognized !== 'string' || value.recognized.length > 2000
    || !Number.isFinite(value.score) || value.score < 1 || value.score > 5
    || !Number.isInteger(value.durationMs) || value.durationMs < 1000 || value.durationMs > 60000
    || typeof value.assessedAt !== 'string' || !Number.isFinite(Date.parse(value.assessedAt))) {
    throw new Error('assessment_invalid_response');
  }
  return Object.freeze({ version: PRONUNCIATION_RECORD_VERSION, requestId: value.requestId,
    script: value.script, recognized: value.recognized, score: value.score, sample: false,
    scale: Object.freeze({ min: 1, max: 5 }), skill: 'speaking', evidence: 'sentence_pronunciation',
    durationMs: value.durationMs, assessedAt: value.assessedAt });
}

export function pronunciationReceipt(value, requestId) {
  if (!value || value.requestId !== requestId || value.status !== 'saved'
    || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))) return null;
  return Object.freeze({ requestId, status: 'saved', savedAt: value.savedAt });
}
