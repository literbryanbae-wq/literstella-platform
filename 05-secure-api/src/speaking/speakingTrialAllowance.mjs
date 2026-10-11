// Unlimited is an explicit trial policy, never inferred from missing counters.
import {SPEAKING_TRIAL_POLICY as POLICY} from './speakingAnalysisContract.mjs';
export function validatedTrialAllowance(status){
  if(status?.usageMode!==POLICY.usageMode||status.memberDailyLimit!==null||status.serviceDailyLimit!==null||
    !Number.isFinite(Date.parse(status.expiresAt))||!Number.isFinite(Date.parse(status.checkedAt))||
    Date.parse(status.expiresAt)<=Date.parse(status.checkedAt))return null;
  return {usageMode:POLICY.usageMode,expiresAt:status.expiresAt,checkedAt:status.checkedAt};
}
