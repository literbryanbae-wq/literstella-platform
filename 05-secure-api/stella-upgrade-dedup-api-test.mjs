import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stellaUpgradeEmailRoute } from './src/stella-upgrade-email-service.mjs';

const id='11111111-1111-4111-8111-111111111111';
const uid='22222222-2222-4222-8222-222222222222';
const response=(data,status=200)=>new Response(data===null?null:JSON.stringify(data),{status});
function fixture(overrides={}) {
  const row={id,user_id:uid,email:'fixture@example.test',liveklass_id:'fixture@example.test',
    payment_method:'bank_transfer',depositor_name:'Original',payable_amount:45600,
    bank_guide_emailed_at:'2026-08-28T00:00:00Z',admin_notified_at:'2026-08-28T00:00:00Z',
    status:'pending',created_at:'2026-08-28T00:00:00Z',...overrides};
  const patches=[], sent=[], grants=[];
  const deps={json:response, requireUser:async()=>({id:uid,email:'admin@example.test'}),
    brandEmailHtml:html=>html,isEmailSuppressed:async()=>false,
    sendEmail:async(_env,m)=>{sent.push(m);return true;},
    sbFetch:async(_env,path,opt={})=>{
      if(path.startsWith('users?'))return response([]);
      if(path.startsWith('class_verifications?')){grants.push(JSON.parse(opt.body));return response(null,204);}
      if(path.startsWith('stella_upgrade_requests?')){
        if(opt.method==='PATCH'){const patch=JSON.parse(opt.body);patches.push(patch);Object.assign(row,patch);return response(null,204);}
        return response([row]);
      }
      throw Error(`Unexpected ${path}`);
    }};
  const run=(sub='request-notify')=>stellaUpgradeEmailRoute(new Request('https://example.test/'+sub,{method:'POST',
    body:JSON.stringify({requestId:id,depositorName:'Overwrite attempt'})}),{ADMIN_EMAIL:'admin@example.test'},{},sub,deps);
  return {row,patches,sent,grants,run,deps};
}

await test('repeat notification cannot replace depositor or send another receipt',async()=>{
  const f=fixture(); const before=structuredClone(f.row); assert.equal((await f.run()).status,200);
  assert.deepEqual(f.row,before);assert.equal(f.sent.length,0);assert.equal(f.patches.length,0);
});
for(const status of ['completed','rejected','cancelled']) await test(`${status} cannot send new application mail`,async()=>{
  const f=fixture({status,admin_notified_at:null,bank_guide_emailed_at:null}); const before=structuredClone(f.row);
  assert.equal((await (await f.run()).json()).alreadyHandled,true);assert.equal(f.sent.length,0);assert.deepEqual(f.row,before);
});
await test('new bank notification still uses saved name and amount',async()=>{
  const f=fixture({admin_notified_at:null,bank_guide_emailed_at:null});await f.run();
  assert.equal(f.sent.length,2);assert.match(f.sent[0].html,/Original/);assert.match(f.sent[0].html,/45,600/);
  assert.ok(f.sent.every(m=>!m.html.includes('Overwrite attempt')));assert.equal(f.row.depositor_name,'Original');
});
await test('completion grants missing courses and uses only completion template',async()=>{
  const f=fixture({payment_method:'liveklass_card'});const a=await (await f.run('complete')).json();
  assert.equal(a.ok,true);assert.equal(f.grants[0].length,8);assert.equal(f.sent.length,1);
  assert.match(f.sent[0].subject,/평생소장 연결 완료/);assert.equal(f.sent[0].idempotencyKey,`stella-complete/${id}`);
  assert.equal(f.row.status,'completed');assert.ok(f.row.completion_emailed_at);
  assert.equal((await (await f.run('complete')).json()).alreadyDone,true);assert.equal(f.sent.length,1);
});
await test('grant failure never reports success or sends email',async()=>{
  const f=fixture();const original=f.deps.sbFetch;
  f.deps.sbFetch=async(env,path,opt)=>path.startsWith('class_verifications?')?response({error:'fixture'},403):original(env,path,opt);
  assert.equal((await (await f.run('complete')).json()).error,'grant_failed');assert.equal(f.sent.length,0);assert.equal(f.row.status,'pending');
});
