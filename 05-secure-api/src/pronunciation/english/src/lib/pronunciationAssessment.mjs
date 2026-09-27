// ETRI API 98 exposes one sentence score (1..5), not phoneme/prosody/fluency sub-scores.
import { PRONUNCIATION_PILOT } from './pronunciationContract.mjs';
export const PRONUNCIATION_SCALE = Object.freeze({ min: 1, max: 5 });
export const PRONUNCIATION_SAMPLE = Object.freeze({
  sample: true, score: 3.6, recognized: "I'd like to check in, please.",
  script: "I'd like to check in, please.",
});

export function normalizePronunciationResponse(value) {
  if (value?.result !== 0) throw new Error('assessment_provider_failed');
  const raw = value?.return_object?.score;
  if (!(typeof raw === 'number' || (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim())))) throw new Error('assessment_invalid_score');
  const score = Number(raw);
  if (!Number.isFinite(score) || score < 1 || score > 5) throw new Error('assessment_invalid_score');
  const recognized = typeof value?.return_object?.recognized === 'string' ? value.return_object.recognized.trim().slice(0, 2000) : '';
  return Object.freeze({ sample: false, score, recognized, scale: PRONUNCIATION_SCALE });
}

export function pronunciationErrorMessage(error) {
  const messages = {
    assessment_not_ready: '발음 평가를 준비하고 있어요. 지금은 녹음하고 내 목소리를 다시 들어보세요.',
    assessment_signin_required: '로그인한 뒤 다시 평가해 주세요.',
    assessment_membership_required: '올인원 소장 회원을 위한 평가예요. 쉐도잉 연습은 계속할 수 있어요.',
    assessment_pilot_required: `시범 운영 참여자 ${PRONUNCIATION_PILOT.participantLimit}명에게 제공하는 평가예요. 듣기와 녹음 연습은 계속할 수 있어요.`,
    assessment_pilot_limit: '시범 운영 참여 정보를 확인하고 있어요. 잠시 후 다시 이용해 주세요.',
    assessment_daily_limit: `오늘의 발음 평가 ${PRONUNCIATION_PILOT.memberDailyLimit}회를 모두 이용했어요. 내일 다시 평가해 주세요. 녹음 연습은 계속할 수 있어요.`,
    assessment_service_limit: '오늘 제공할 수 있는 평가가 모두 끝났어요. 내일 다시 이용해 주세요.',
    assessment_consent_required: '녹음 전송 안내를 확인해 주세요.',
    assessment_audio_invalid: '녹음 파일을 확인하지 못했어요. 다시 녹음해 주세요.',
    assessment_audio_duration: '1초 이상, 60초 이내로 한 문장을 녹음해 주세요.',
    assessment_audio_silent: '목소리가 거의 들리지 않아요. 마이크 가까이에서 다시 녹음해 주세요.',
    assessment_pending: '같은 녹음의 평가가 진행 중이에요. 다시 보내지 않아도 돼요.',
    assessment_uncertain: '평가 요청의 처리 상태를 확인해야 해요. 중복 평가를 막기 위해 다시 보내지 않았어요.',
    assessment_request_conflict: '이 녹음의 요청 정보가 달라졌어요. 새로 녹음한 뒤 평가해 주세요.',
    assessment_not_found: '저장된 결과를 찾을 수 없어요. 평가일로부터 30일이 지나 삭제되었을 수 있어요. 자동으로 다시 평가하지 않았어요.',
  };
  return messages[error?.message] || '평가 결과를 받지 못했어요. 녹음은 이 화면에 남아 있어요. 잠시 후 다시 시도해 주세요.';
}

// No network, synthetic scores, or browser credential storage in the disabled lane.
export const unavailablePronunciationClient = Object.freeze({
  ready: false,
  async assess() { throw new Error('assessment_not_ready'); },
});
