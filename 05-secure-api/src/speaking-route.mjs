import {createSpeakingAnalysisService} from './speaking/speakingAnalysisService.mjs';
import {createSpeechSuperProvider} from './speaking/speechSuperProvider.mjs';
import {speakingStoredResult} from './speaking/speakingAnalysisContract.mjs';
import {englishPremiumStatus, GROWTH_PANEL_CAMPAIGN_ID} from './growth-panel-service.mjs';

async function boundedJson(response) {
  if (!response.ok || !response.body) throw new Error('speaking_failed');
  const reader=response.body.getReader(),parts=[]; let size=0;
  try { while(true) {const {done,value}=await reader.read(); if(done)break; size+=value.length;
    if(size>65536){await reader.cancel();throw new Error('speaking_failed');} parts.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {reader.releaseLock();}
}
export function speakingRoute(req,env,{requireUser,sbFetch}) {
  let verifiedUser;
  const rpc=async(name,payload)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{return await boundedJson(await sbFetch(env,`rpc/${name}`,{method:'POST',signal:controller.signal,body:JSON.stringify(payload)}));}
    finally{clearTimeout(timer);}
  };
  const call=(action,value={})=>rpc('speaking_trial_v1',{p_action:action,p_auth_uid:verifiedUser.id,p_payload:value});
  const store={atomic:true,
    policy:()=>call('policy'), status:()=>call('status'),
    claim:({requestId,inputHash,consentVersion})=>call('claim',{requestId,inputHash,consentVersion}),
    complete:({requestId,leaseId,result})=>call('complete',{requestId,leaseId,result:speakingStoredResult(result)}),
    uncertain:({requestId,leaseId})=>call('uncertain',{requestId,leaseId}),
    get:({requestId})=>call('get',{requestId}),
  };
  return createSpeakingAnalysisService({
    enabled:env.SPEAKING_ENABLED==='true',store,
    provider:createSpeechSuperProvider({enabled:env.SPEAKING_ENABLED==='true',appKey:env.SPEECHSUPER_APP_KEY,secretKey:env.SPEECHSUPER_SECRET_KEY}),
    allowedOrigins:String(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean),
    requireUser:async(request,bindings)=>{verifiedUser=await requireUser(request,bindings);return verifiedUser;},
    checkMembership:async(user,bindings)=>{
      const result=await rpc('growth_panel_request',{p_action:'status',p_campaign_id:GROWTH_PANEL_CAMPAIGN_ID,p_auth_uid:user.id,p_auth_email:user.email,p_payload:{}});
      if(result?.ok!==true)throw new Error('speaking_membership_required');
      return englishPremiumStatus(req,bindings,result);
    },
  }).handle(req,env);
}
