import {speakingAdditionalData} from './speakingAnalysisDashboard.mjs';
export function normalizeSpeechSuperResult(value,coreType){
  const raw=value?.result,metrics=['overall','pronunciation','fluency','rhythm'].filter(id=>Number.isFinite(raw?.[id])&&raw[id]>=0&&raw[id]<=100).map(id=>({id,score:raw[id]}));
  if(!metrics.length)throw new Error('speaking_result_invalid');
  return {example:false,coreType,metrics,additional:speakingAdditionalData(raw,coreType),recognized:typeof raw.recognition==='string'?raw.recognition.slice(0,6000):'',meaning:[]};
}
// Keys arrive from Worker secrets only. Never read a local file or expose signatures.
export function createSpeechSuperProvider({appKey='',secretKey='',enabled=false,fetchImpl=globalThis.fetch,now=()=>Date.now()}={}){
  const ready=enabled===true&&Boolean(appKey&&secretKey);
  const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
  return {ready,async assess(input,{signal}={}){
    if(!ready)throw new Error('speaking_not_ready');
    const coreType=input.mode==='own'?'asr.eval':'para.eval',timestamp=String(now()),userId='english-trial',abort=new AbortController();
    const cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)abort.abort();const timer=setTimeout(cancel,60000);
    try{
      const params={connect:{cmd:'connect',param:{sdk:{version:16777472,source:9,protocol:2},app:{applicationId:appKey,sig:await sha(appKey+timestamp+secretKey),timestamp}}},
        start:{cmd:'start',param:{app:{applicationId:appKey,sig:await sha(appKey+timestamp+userId+secretKey),timestamp,userId},audio:{audioType:'wav',sampleRate:16000,channel:1,sampleBytes:2},request:{coreType,tokenId:crypto.randomUUID().replaceAll('-',''),...(input.mode==='writing'?{refText:input.script,paragraph_need_word_score:1}:{})}}}};
      const bytes=Uint8Array.from(atob(input.audio),c=>c.charCodeAt(0)),form=new FormData();form.append('text',JSON.stringify(params));form.append('audio',new Blob([bytes],{type:'audio/wav'}),'recording.wav');
      const response=await fetchImpl(`https://api.speechsuper.com/${coreType}`,{method:'POST',headers:{'Request-Index':'0'},body:form,redirect:'manual',signal:abort.signal});
      if(!response.ok||!response.body)throw new Error('speaking_failed');
      const reader=response.body.getReader(),parts=[];let size=0;const cancelReader=()=>{void reader.cancel().catch(()=>{});};abort.signal.addEventListener('abort',cancelReader,{once:true});
      try {while(true){if(abort.signal.aborted)throw new Error('speaking_failed');const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2000000){cancelReader();throw new Error('speaking_failed');}parts.push(part.value);}const output=new Uint8Array(size);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return normalizeSpeechSuperResult(JSON.parse(new TextDecoder().decode(output)),coreType);}
      finally{abort.signal.removeEventListener('abort',cancelReader);reader.releaseLock();}
    } finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }};
}
