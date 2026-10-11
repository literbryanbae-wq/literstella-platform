// Integration boundary, not mounted. Existing API owns auth and premium grants.
// No process-memory quota fallback. Store must atomically claim daily and concurrent budgets.
import {SPEAKING_ID,SPEAKING_TRIAL_POLICY as POLICY,speakingStoredResult} from './speakingAnalysisContract.mjs';
import {trialRemainingMaximum} from './speakingTrialAllowance.mjs';
const fail=code=>{throw new Error(code);};
const errors={speaking_signin_required:401,speaking_membership_required:403,speaking_origin_rejected:403,speaking_not_ready:503,speaking_input_invalid:400,speaking_consent_required:400,speaking_limit:429,speaking_pending:409,speaking_conflict:409,speaking_uncertain:409,speaking_not_found:404,speaking_failed:502};
async function boundedJson(request,max=2700000){
  const reader=request.body?.getReader();if(!reader)fail('speaking_input_invalid');let size=0;const parts=[];
  let stopped=false;
  const stop=()=>{stopped=true;void reader.cancel().catch(()=>{});};
  request.signal.addEventListener('abort',stop,{once:true});if(request.signal.aborted)stop();
  const timer=setTimeout(stop,10000);
  try {while(true){if(stopped)fail('speaking_input_invalid');const {value,done}=await reader.read();if(stopped)fail('speaking_input_invalid');if(done)break;size+=value.byteLength;if(size>max){stop();fail('speaking_input_invalid');}parts.push(value);}}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',stop);reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('speaking_input_invalid');}
}
export function validateSpeakingInput(body){
  if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['requestId','audio','mode','script','consent','consentVersion'].includes(key))||!SPEAKING_ID.test(body.requestId||''))fail('speaking_input_invalid');
  if(body.consent!==true||body.consentVersion!==POLICY.privacyVersion)fail('speaking_consent_required');
  if(!['own','writing'].includes(body.mode)||typeof body.audio!=='string'||body.audio.length>2560060||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio))fail('speaking_input_invalid');
  let wav;try{wav=Uint8Array.from(atob(body.audio),c=>c.charCodeAt(0));}catch{fail('speaking_input_invalid');}
  if(wav.length<160044||wav.length>1920044)fail('speaking_input_invalid');
  const view=new DataView(wav.buffer),text=(start,end)=>new TextDecoder().decode(wav.slice(start,end));
  if(text(0,4)!=='RIFF'||text(8,12)!=='WAVE'||text(12,16)!=='fmt '||text(36,40)!=='data'||view.getUint32(4,true)!==wav.length-8||view.getUint32(16,true)!==16||view.getUint16(20,true)!==1||view.getUint16(22,true)!==1||view.getUint32(24,true)!==16000||view.getUint32(28,true)!==32000||view.getUint16(32,true)!==2||view.getUint16(34,true)!==16||view.getUint32(40,true)!==wav.length-44||(wav.length-44)%2)fail('speaking_input_invalid');
  const script=body.mode==='writing'&&typeof body.script==='string'?body.script.trim():'';
  if(body.mode==='writing'&&(!script||script.length>2000)||body.mode==='own'&&body.script)fail('speaking_input_invalid');
  return {mode:body.mode,script,audio:body.audio,durationMs:(wav.length-44)/32};
}
const receiptValid=(receipt,id)=>receipt?.requestId===id&&receipt?.status==='saved'&&Number.isFinite(Date.parse(receipt.savedAt));
export function createSpeakingAnalysisService({enabled=false,requireUser,checkMembership,store,provider,allowedOrigins=[],now=()=>new Date()}={}){
  const ready=enabled===true&&typeof requireUser==='function'&&typeof checkMembership==='function'&&provider?.ready===true&&store?.atomic===true&&['policy','status','claim','complete','uncertain','get'].every(key=>typeof store[key]==='function');
  return {ready,async handle(request,env){
    const origin=request.headers.get('Origin'),cors=allowedOrigins.includes(origin)?{'Access-Control-Allow-Origin':origin}:{};
    const reply=(value,status=200)=>Response.json(value,{status,headers:{...cors,'Cache-Control':'private, no-store',Vary:'Origin, X-User-Token'}});
    try{
      if(!allowedOrigins.includes(origin))fail('speaking_origin_rejected');
      const url=new URL(request.url),action=url.pathname.slice('/api/english/speaking/'.length);
      if(!url.pathname.startsWith('/api/english/speaking/')||!['status','assess','result'].includes(action))return reply({ok:false,error:'not_found'},404);
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-User-Token','Cache-Control':'no-store',Vary:'Origin'}});
      if(request.method!==(action==='assess'?'POST':'GET'))return reply({ok:false,error:'method_not_allowed'},405);
      const user=await requireUser?.(request,env);
      if(!SPEAKING_ID.test(user?.id||'')||user.emailConfirmed!==true||user.isAnonymous===true)fail('speaking_signin_required');
      if(action==='result'){
        const id=url.searchParams.get('requestId');if(!SPEAKING_ID.test(id||''))fail('speaking_input_invalid');
        const saved=await store?.get?.({authUid:user.id,requestId:id});
        if(!saved||saved.authUid!==user.id||now().getTime()>=Date.parse(saved.assessedAt)+30*86400000)fail('speaking_not_found');
        if(saved.state!=='completed')fail('speaking_pending');
        if(!Number.isFinite(Date.parse(saved.assessedAt))||!receiptValid(saved.receipt,id))fail('speaking_failed');
        return reply({ok:true,result:{...speakingStoredResult(saved.result),requestId:id,assessedAt:saved.assessedAt},storage:'saved',receipt:saved.receipt});
      }
      if(!ready)return action==='status'?reply({ok:true,ready:false}):fail('speaking_not_ready');
      const membership=await checkMembership(user,env,{request});
      if(membership?.eligible!==true||membership.policy!=='english-premium-v1')fail('speaking_membership_required');
      const policy=await store.policy();
      // All public rollout settings must exist; never infer unlimited trial usage.
      if(policy?.enabled!==true||policy.privacyVersion!==POLICY.privacyVersion||policy.memberDailyLimit!==POLICY.memberDailyLimit||policy.resultRetentionDays!==30||!Number.isInteger(policy.serviceDailyLimit)||policy.serviceDailyLimit<1||!Number.isInteger(policy.maxConcurrent)||policy.maxConcurrent<1||policy.maxConcurrent>5||!Number.isFinite(Date.parse(policy.expiresAt))||now().getTime()>=Date.parse(policy.expiresAt))fail('speaking_not_ready');
      const day=new Date(now().getTime()+9*3600000).toISOString().slice(0,10);
      if(action==='status'){
        const status=await store.status({authUid:user.id,day});
        if(!Number.isInteger(status?.remaining)||status.remaining<0||status.remaining>POLICY.memberDailyLimit)fail('speaking_failed');
        const checkedAt=now().toISOString(),maximum=trialRemainingMaximum({remaining:status.remaining,expiresAt:policy.expiresAt,now:checkedAt});
        if(maximum===null)fail('speaking_not_ready');
        return reply({ok:true,ready:true,...POLICY,expiresAt:policy.expiresAt,checkedAt,remaining:status.remaining,trialRemainingMaximum:maximum});
      }
      if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail('speaking_input_invalid');
      const body=await boundedJson(request),input=validateSpeakingInput(body),id=body.requestId;
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([input.mode,input.script,input.audio]))),inputHash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
      const claim=await store.claim({authUid:user.id,requestId:id,inputHash,day,consentVersion:POLICY.privacyVersion});
      if(claim?.authUid!==user.id)fail('speaking_failed');
      if(['daily_limit','service_limit','busy'].includes(claim.state))fail('speaking_limit');
      if(claim.state==='conflict')fail('speaking_conflict');
      if(claim.state==='uncertain')fail('speaking_uncertain');
      if(claim.state!=='reserved'||!SPEAKING_ID.test(claim.leaseId||''))fail('speaking_pending');
      const identity={authUid:user.id,requestId:id,leaseId:claim.leaseId};let output;
      try{output=await provider.assess(input,{signal:request.signal});speakingStoredResult(output);}
      catch{try{await store.uncertain(identity);}catch{}fail('speaking_uncertain');}
      const assessedAt=now().toISOString(),stored=speakingStoredResult(output);let receipt=null;
      try{receipt=await store.complete({...identity,result:stored,assessedAt,durationMs:input.durationMs});}catch{}
      // Recognition is returned once for browser confirmation, never sent to store.
      return reply({ok:true,result:{...stored,recognized:typeof output.recognized==='string'?output.recognized.slice(0,6000):'',requestId:id,assessedAt},storage:receiptValid(receipt,id)?'saved':'unconfirmed',receipt:receiptValid(receipt,id)?receipt:null});
    }catch(error){const code=Object.hasOwn(errors,error?.message)?error.message:'speaking_failed';return reply({ok:false,error:code},errors[code]);}
  }};
}
