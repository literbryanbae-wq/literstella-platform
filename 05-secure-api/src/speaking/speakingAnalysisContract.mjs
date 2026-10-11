export const SPEAKING_TRIAL_POLICY=Object.freeze({memberDailyLimit:2,resultRetentionDays:30,minSeconds:5,maxSeconds:60,privacyVersion:'speaking-scores-only-20261009'});
export const SPEAKING_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only numeric observations and the explicit accent configuration survive storage.
export function speakingStoredResult(result){
  const metrics=(Array.isArray(result?.metrics)?result.metrics:[]).filter(row=>['overall','pronunciation','fluency','rhythm'].includes(row?.id)&&Number.isFinite(row.score)&&row.score>=0&&row.score<=100).map(({id,score})=>({id,score}));
  if(!metrics.length||new Set(metrics.map(row=>row.id)).size!==metrics.length||!['asr.eval','para.eval'].includes(result?.coreType))throw new Error('speaking_result_invalid');
  const source=result.additional||{},additional={};
  for(const key of ['integrity','speed','pauseCount'])if(Number.isFinite(source[key])&&source[key]>=0&&(key!=='integrity'||source[key]<=100))additional[key]=source[key];
  if(['rise','fall'].includes(source.rearTone))additional.rearTone=source.rearTone;
  if(['us','uk'].includes(source.accent))additional.accent=source.accent;
  if(Number.isInteger(source.emphasis?.detected)&&Number.isInteger(source.emphasis?.total)&&source.emphasis.detected>=0&&source.emphasis.total>=source.emphasis.detected)additional.emphasis={detected:source.emphasis.detected,total:source.emphasis.total};
  return {example:false,coreType:result.coreType,metrics,additional};
}
