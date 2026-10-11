import test from 'node:test';
import assert from 'node:assert/strict';
import {speakingRoute} from './src/speaking-route.mjs';
import {validateEtriInput} from './src/pronunciation/english/learning-platform/server/etriPronunciationProvider.mjs';
const user={id:'00000000-0000-4000-8000-000000000001',email:'qa@example.invalid',emailConfirmed:true};
const origin='https://english.literstella.co.kr';
const env={ALLOWED_ORIGINS:origin,SPEAKING_ENABLED:'true',SPEECHSUPER_APP_KEY:'fixture',SPEECHSUPER_SECRET_KEY:'fixture'};
function fixture({member=true,enabled=true}={}){
  const calls=[];
  return {calls,run:async(action='status',body)=>{
    const req=new Request(`https://worker.test/api/english/speaking/${action}`,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const response=await speakingRoute(req,{...env,SPEAKING_ENABLED:String(enabled)},{requireUser:async()=>user,sbFetch:async(_env,path,init)=>{
      const value=JSON.parse(init.body);calls.push({path,value});assert.equal(value.p_auth_uid,user.id);
      if(path==='rpc/growth_panel_request')return Response.json({ok:true,member:{panelPremium:member}});
      assert.equal(path,'rpc/speaking_trial_v1');
      if(value.p_action==='policy')return Response.json({enabled:true,expiresAt:new Date(Date.now()+7*86400000).toISOString(),memberDailyLimit:2,resultRetentionDays:30,serviceDailyLimit:100,maxConcurrent:5,privacyVersion:'speaking-scores-only-20261009'});
      if(value.p_action==='status')return Response.json({remaining:2});
      throw Error('Unexpected mutation');
    }});
    return {status:response.status,value:await response.json()};
  }};
}
test('real route reuses verified account and existing panel membership, status never claims',async()=>{
  const f=fixture(),reply=await f.run();assert.equal(reply.status,200);assert.equal(reply.value.ready,true);assert.equal(reply.value.remaining,2);
  assert.deepEqual(f.calls.map(x=>x.value.p_action),['status','policy','status']);
});
test('disabled and nonpremium routes cannot submit audio or consume quota',async()=>{
  const off=fixture({enabled:false});assert.equal((await off.run()).value.ready,false);assert.equal(off.calls.length,0);
  const member=fixture({member:false});assert.equal((await member.run('assess',{})).status,403);assert.equal(member.calls.length,1);
});
test('deployed ETRI adapter rejects paragraphs and over-20-second byte payload before provider',()=>{
  const pcm={format:'pcm_s16le',sampleRate:16000,channels:1,audio:Buffer.alloc(32000).toString('base64')};
  assert.equal(validateEtriInput({script:'Hello.',pcm}).durationMs,1000);
  assert.throws(()=>validateEtriInput({script:'First sentence. Second sentence.',pcm}),/assessment_script_too_long/);
  assert.throws(()=>validateEtriInput({script:'Hello.',pcm:{...pcm,audio:Buffer.alloc(640002).toString('base64'),durationMs:1000}}),/assessment_audio_duration/);
});
