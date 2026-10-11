// Calendar opportunities, not prepaid credits or guaranteed supplier requests.
import {SPEAKING_TRIAL_POLICY as POLICY} from './speakingAnalysisContract.mjs';
export function trialRemainingMaximum({remaining,expiresAt,now=new Date()}){
  const end=Date.parse(expiresAt),time=new Date(now).getTime();
  if(!Number.isInteger(remaining)||remaining<0||remaining>POLICY.memberDailyLimit||!Number.isFinite(end)||!Number.isFinite(time))return null;
  if(end<=time)return 0;
  const day=86400000,offset=9*3600000;
  const futureDays=Math.floor((end-1+offset)/day)-Math.floor((time+offset)/day);
  if(futureDays<0||futureDays>365)return null;
  return futureDays*POLICY.memberDailyLimit+remaining;
}
export function validatedTrialAllowance(status){
  if(!Number.isInteger(status?.remaining)||status.remaining<0||status.remaining>POLICY.memberDailyLimit||
    !Number.isInteger(status.trialRemainingMaximum)||status.trialRemainingMaximum<0||status.trialRemainingMaximum>366*POLICY.memberDailyLimit||
    !Number.isFinite(Date.parse(status.expiresAt))||!Number.isFinite(Date.parse(status.checkedAt))||
    trialRemainingMaximum({remaining:status.remaining,expiresAt:status.expiresAt,now:status.checkedAt})!==status.trialRemainingMaximum)return null;
  return {remaining:status.remaining,trialRemainingMaximum:status.trialRemainingMaximum,expiresAt:status.expiresAt,checkedAt:status.checkedAt};
}
