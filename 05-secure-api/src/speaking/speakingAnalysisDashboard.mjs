// Fixed illustrative values, never a fallback for a provider response.
// Score axes and additional observations deliberately keep their own units.
export const SPEAKING_PENDING_METRICS = Object.freeze(['강세', '억양·인토네이션', '악센트']);
export const SPEAKING_DASHBOARD_EXAMPLE = Object.freeze({example:true,coreType:'para.eval',metrics:[{id:'overall',score:78},{id:'pronunciation',score:82},{id:'fluency',score:74},{id:'rhythm',score:79}],additional:{speed:112,pauseCount:3,integrity:92,accent:'us'},meaning:[{label:'일찍 도착한 상황',status:'전달됨'},{label:'짐 보관 요청',status:'전달됨'},{label:'체크인 전까지의 기간',status:'빠진 정보'}]});
export function speakingMetricRows(result) {
  return Object.entries({pronunciation:'발음',fluency:'유창성',rhythm:'리듬'}).map(([id,label])=>{
    const score=result?.metrics?.find(item=>item.id===id)?.score;
    return {id,label,score:Number.isFinite(score)&&score>=0&&score<=100?score:null};
  });
}
export function speakingScoreRows(result) {
  const overall=result?.metrics?.find(item=>item.id==='overall')?.score;
  return [{id:'overall',label:'종합',score:Number.isFinite(overall)&&overall>=0&&overall<=100?overall:null},...speakingMetricRows(result)];
}
export function speakingAdditionalData(raw={},coreType='',accent=null) {
  const number=(value,max=Infinity)=>Number.isFinite(value)&&value>=0&&value<=max?value:null;
  const sourceWords=Array.isArray(raw.words)?raw.words:(Array.isArray(raw.sentences)?raw.sentences.flatMap(s=>Array.isArray(s?.details)?s.details:[]):[]);
  const words=sourceWords.map(w=>({word:w?.word,prominence:w?.scores?.prominence??w?.prominence})).filter(w=>w.prominence===0||w.prominence===1);
  return {
    integrity:coreType==='para.eval'||coreType.startsWith('sent.eval')?number(raw.integrity,100):null,
    speed:number(raw.speed),pauseCount:Number.isInteger(raw.pause_count)?number(raw.pause_count):null,
    emphasis:words.length?{detected:words.filter(w=>w.prominence===1).length,total:words.length,words:words.filter(w=>w.prominence===1).map(w=>String(w.word||'').slice(0,80)).filter(Boolean).slice(0,100)}:null,
    rearTone:coreType==='asr.eval'&&['rise','fall'].includes(raw.rear_tone)?raw.rear_tone:null,
    accent:['us','uk'].includes(accent)?accent:null,
  };
}
export function speakingAdditionalRows(result) {
  const data=result?.additional||{};
  const finite=(value)=>Number.isFinite(value)&&value>=0;
  return [
    {id:'integrity',label:'읽기 완성도',value:finite(data.integrity)&&data.integrity<=100?`${data.integrity}%`:'측정값 없음',note:'제시된 영어를 읽은 정도 · 의미 전달 점수 아님'},
    {id:'speed',label:'말하기 속도',value:finite(data.speed)?`${data.speed} WPM`:'측정값 없음',note:'분당 말한 단어 수'},
    {id:'pause',label:'멈춤',value:Number.isInteger(data.pauseCount)&&data.pauseCount>=0?`${data.pauseCount}회`:'측정값 없음',note:'음성에서 감지된 멈춤 횟수'},
    {id:'stress',label:'단어 강조',value:data.emphasis?`${data.emphasis.detected} / ${data.emphasis.total}개 감지`:'측정값 없음',note:'강조 감지 여부 · 강세 점수 아님',words:data.emphasis?.words||[]},
    {id:'tone',label:'문장 끝 억양',value:({rise:'상승 ↗',fall:'하강 ↘'})[data.rearTone]||'측정값 없음',note:'자유 말하기의 문장 끝 변화 · 종합 억양 점수 아님'},
    {id:'accent',label:'발음 기준',value:({us:'미국 영어',uk:'영국 영어'})[data.accent]||'설정 미확인',note:'평가 요청의 기준 설정 · 악센트 점수 아님'},
  ];
}
