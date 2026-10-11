import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/20261011043748_speaking_trial_atomic.sql',import.meta.url),'utf8');
const unlimited=readFileSync(new URL('../supabase/migrations/20261011051629_speaking_unlimited_trial.sql',import.meta.url),'utf8');
const uid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const result={example:false,coreType:'asr.eval',metrics:[{id:'overall',score:82}],additional:{speed:112}};
async function fixture(){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;create schema cron;
    create table auth.users(id uuid primary key);insert into auth.users values('${uid}'),('${other}');
    create table private.pronunciation_member_daily_v1(auth_uid uuid,day date,reserved integer);
    create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';`);
  await db.exec(migration);
  await db.exec(unlimited);
  const call=async(action,owner=uid,payload={})=>(await db.query('select public.speaking_trial_v1($1,$2,$3) value',[action,owner,JSON.stringify(payload)])).rows[0].value;
  const enable=()=>db.exec(`update private.speaking_policy_v1 set enabled=true,expires_at=clock_timestamp()+interval '5 days'`);
  const claim=(n,owner=uid)=>call('claim',owner,{requestId:id(n),inputHash:'a'.repeat(64),consentVersion:'speaking-scores-only-20261009'});
  return {db,call,enable,claim};
}
test('default off; status does not enroll, reserve, or consume quota; API-only permissions',async()=>{
  const f=await fixture();try{
    assert.equal((await f.call('policy')).enabled,false);
    assert.deepEqual(await f.call('status'),{usageMode:'unlimited-trial',usedToday:0});
    assert.equal((await f.call('policy')).memberDailyLimit,null);
    assert.equal((await f.call('policy')).serviceDailyLimit,null);
    await assert.rejects(f.claim(1),/speaking_not_ready/);
    for(const role of ['anon','authenticated']){
      await f.db.exec(`set role ${role}`);
      await assert.rejects(f.call('status'),/permission denied/);
      await f.db.exec('reset role');
    }
    assert.equal((await f.db.query('select count(*)::int n from private.speaking_requests_v1')).rows[0].n,0);
    await f.db.exec('set role service_role');assert.equal((await f.call('status')).usedToday,0);await f.db.exec('reset role');
  }finally{await f.db.close();}
});
test('replay/conflict, receipt, own result and text storage rejection survive unlimited policy',async()=>{
  const f=await fixture();try{
    await f.enable();const first=await f.claim(1);assert.equal(first.state,'reserved');
    assert.equal((await f.claim(1)).state,'pending');assert.equal((await f.call('status')).usedToday,1);
    assert.equal((await f.call('claim',uid,{requestId:id(1),inputHash:'b'.repeat(64),consentVersion:'speaking-scores-only-20261009'})).state,'conflict');
    await assert.rejects(f.call('complete',uid,{requestId:id(1),leaseId:first.leaseId,result:{...result,recognized:'private words'}}),/speaking_result_invalid/);
    const receipt=await f.call('complete',uid,{requestId:id(1),leaseId:first.leaseId,result});assert.equal(receipt.status,'saved');
    assert.equal((await f.call('get',uid,{requestId:id(1)})).state,'completed');
    assert.equal(await f.call('get',other,{requestId:id(1)}),null);
    assert.equal((await f.claim(1)).state,'completed');
    assert.equal((await f.claim(2)).state,'reserved');assert.equal((await f.claim(3)).state,'reserved');
    assert.equal((await f.call('status')).usedToday,3);assert.equal((await f.call('status',other)).usedToday,0);
  }finally{await f.db.close();}
});
test('concurrency and expiry remain guarded; uncertain requests are measured, not charged',async()=>{
  const f=await fixture();try{
    await f.enable();await f.db.exec('update private.speaking_policy_v1 set max_concurrent=1');
    const first=await f.claim(1);assert.equal((await f.claim(2,other)).state,'busy');
    await f.call('uncertain',uid,{requestId:id(1),leaseId:first.leaseId});
    assert.equal((await f.claim(1)).state,'uncertain');assert.equal((await f.call('status')).usedToday,1);
    await assert.rejects(f.db.exec('update private.speaking_policy_v1 set service_daily_limit=100'),/speaking_policy_v1_unlimited_check/);
    assert.equal((await f.claim(2,other)).state,'reserved');
    await f.db.exec("update private.speaking_policy_v1 set expires_at=clock_timestamp()-interval '1 second'");
    await assert.rejects(f.claim(3),/speaking_not_ready/);
  }finally{await f.db.close();}
});
test('same member can complete more than 100 requests in one day without a quota',async()=>{
  const f=await fixture();try{
    await f.enable();
    for(let n=1;n<=105;n++){
      const claim=await f.claim(n);assert.equal(claim.state,'reserved');
      await f.call('complete',uid,{requestId:id(n),leaseId:claim.leaseId,result});
    }
    assert.equal((await f.call('status')).usedToday,105);
    const rows=await f.db.query('select count(*)::int n,count(distinct auth_uid)::int members,count(*) filter(where state=\'completed\')::int completed from private.speaking_requests_v1');
    assert.deepEqual(rows.rows[0],{n:105,members:1,completed:105});
  }finally{await f.db.close();}
});
test('five global active leases are allowed, sixth waits, completion releases capacity',async()=>{
  const f=await fixture();try{
    await f.enable();const first=await f.claim(1);
    for(let n=2;n<=5;n++)assert.equal((await f.claim(n,n%2?uid:other)).state,'reserved');
    assert.equal((await f.claim(6,other)).state,'busy');
    assert.equal((await f.call('status',other)).usedToday,2);
    await f.call('complete',uid,{requestId:id(1),leaseId:first.leaseId,result});
    assert.equal((await f.claim(6,other)).state,'reserved');
  }finally{await f.db.close();}
});
test('30-day retention deletes only expired records and never returns them before cleanup',async()=>{
  const f=await fixture();try{
    await f.enable();await f.claim(1);await f.claim(2);
    await f.db.exec(`update private.speaking_requests_v1 set reserved_at=clock_timestamp()-interval '31 days' where request_id='${id(1)}'`);
    assert.equal(await f.call('get',uid,{requestId:id(1)}),null);
    assert.equal((await f.db.query('select private.purge_speaking_results_v1() n')).rows[0].n,1);
    assert.equal((await f.db.query('select count(*)::int n from private.speaking_requests_v1')).rows[0].n,1);
  }finally{await f.db.close();}
});
