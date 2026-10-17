import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { classMemberCheckout } from './src/class-member-checkout.mjs';

// Local PostgreSQL WASM only. No production DB/network/keys.
const { PGlite } = await import(process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table public.class_verifications(email text,book_code text,verified_at timestamptz not null default clock_timestamp(),enrollment_email text,primary key(email,book_code));
create table public.class_redemptions(book_code text,redeemed_by text);
create table public.stella_upgrade_requests(user_id uuid,status text);
grant usage on schema public,auth to service_role;
grant select on public.class_redemptions,public.stella_upgrade_requests to service_role;
grant select,insert,update,delete on public.class_verifications to service_role;`);
await db.exec(await readFile(new URL('./supabase/migrations/20261012100801_class_member_checkout.sql',import.meta.url),'utf8'));
if(process.env.CLASS_COURSE_SCHEMA_TEST)await db.exec(await readFile(new URL('./supabase/migrations/20261012170322_class_course_checkout.sql',import.meta.url),'utf8'));
const rpc = async (name,args) => {
  if(name==='prepare' && args.length===2) args=[...args,'test-terms-v1','https://class-new.literstella.co.kr/test-terms'];
  return (await db.query(`select public.class_checkout_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args)).rows[0].data;
};
const books=['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock','theory'];
let checks=0;
const check=(value)=>{assert.ok(value); checks++;};
async function member(count,n=count+1) {
  const uid=`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const email=`member${n}@example.test`;
  await db.query('insert into auth.users values($1,$2,now())',[uid,email]);
  for (const b of books.slice(0,count)) await db.query('insert into class_verifications(email,book_code) values($1,$2)',[email,b]);
  return {id:uid,email,emailConfirmed:true};
}
const members=[];
for(let n=0;n<=8;n++) {
  const user=await member(n); members.push(user);
  const q=await rpc('quote',[user.id]);
  check(q.amount===Math.max(398000-n*50000,0));
  check(q.eligible===(n>0&&n<8));
}
check((await rpc('prepare',[members[0].id,398000])).error==='member_required');
check((await rpc('prepare',[members[8].id,0])).error==='already_owned');
const user=members[1];
check((await rpc('prepare',[user.id,1])).error==='quote_changed');
const order=await rpc('prepare',[user.id,348000]);
check(order.ok);
// Mirror the production AFTER INSERT trigger before testing paid grants.
await db.exec(`create function private.grant_theory_if_two_classics() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.book_code='theory' then return new; end if;
  if (select count(distinct book_code) from public.class_verifications where lower(email)=lower(new.email)
    and book_code in ('kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock'))>=2 then
    insert into public.class_verifications(email,book_code,enrollment_email,verified_at)
      values(lower(new.email),'theory',coalesce(new.enrollment_email,lower(new.email)),now())
      on conflict(email,book_code) do nothing;
  end if;
  return new;
end $$;
create trigger trg_grant_theory_verif after insert on public.class_verifications
  for each row execute function private.grant_theory_if_two_classics();`);
const twoClassics=await member(2,20);
const bonusQuote=await rpc('quote',[twoClassics.id]);
check(bonusQuote.ownedCount===3 && bonusQuote.amount===248000 && bonusQuote.ownedBooks.includes('theory'));
check((await rpc('prepare',[user.id,348000])).orderId===order.orderId);
await assert.rejects(()=>db.query("insert into stella_upgrade_requests values($1,'pending')",[user.id]),/class_checkout_pending/); checks++;
check((await rpc('claim',[members[2].id,order.orderId,'p1',348000])).error==='order_not_found');
check((await rpc('claim',[user.id,order.orderId,'p1',1])).error==='amount_mismatch');
check((await rpc('claim',[user.id,order.orderId,'p1',348000])).ok);
check((await rpc('claim',[user.id,order.orderId,'p2',348000])).error==='payment_key_mismatch');
check((await rpc('prepare',[user.id,348000])).error==='payment_pending');
check((await rpc('settle',[order.orderId,'p1',1,'DONE'])).error==='payment_mismatch');
check((await rpc('settle',[order.orderId,'p1',348000,'DONE'])).granted);
check((await rpc('settle',[order.orderId,'p1',348000,'DONE'])).granted);
check((await db.query('select * from class_checkout_grants where order_id=$1',[order.orderId])).rows.length===7);
check((await rpc('settle',[order.orderId,'p1',348000,'CANCELED'])).status==='canceled');
check((await db.query('select book_code from class_verifications where email=$1',[user.email])).rows.map(r=>r.book_code).join()==='kidari');
check((await rpc('settle',[order.orderId,'p1',348000,'DONE'])).error==='order_closed');
check((await rpc('settle',[order.orderId,'p1',348000,'CANCELED'])).ok);

const expired=await rpc('prepare',[members[2].id,298000]);
await db.query("update class_checkout_orders set expires_at=now()-interval '1 minute' where id=$1",[expired.orderId]);
check((await rpc('claim',[members[2].id,expired.orderId,'expired',298000])).error==='order_expired');
const changed=await rpc('prepare',[members[3].id,248000]);
await db.query('insert into class_verifications(email,book_code) values($1,$2)',[members[3].email,'pride']);
check((await rpc('claim',[members[3].id,changed.orderId,'changed',248000])).error==='quote_changed');
await db.query("insert into stella_upgrade_requests values($1,'coupon_issued')",[members[4].id]);
check((await rpc('prepare',[members[4].id,198000])).error==='existing_request');

await db.exec('set role authenticated');
await assert.rejects(()=>rpc('quote',[user.id]),/permission denied/); checks++;
await assert.rejects(()=>db.query('select * from class_checkout_orders'),/permission denied/); checks++;
await db.exec('reset role; set role service_role');
check((await rpc('quote',[user.id])).ok);
await db.exec('reset role');

const partial=await rpc('prepare',[members[6].id,98000]);
check((await rpc('claim',[members[6].id,partial.orderId,'partial',98000])).ok);
check((await rpc('settle',[partial.orderId,'partial',98000,'DONE'])).granted);
check((await rpc('settle',[partial.orderId,'partial',98000,'PARTIAL_CANCELED'])).status==='partial_refund_review');
check((await rpc('settle',[partial.orderId,'partial',98000,'DONE'])).error==='order_closed');
// A later independent grant must survive this order's refund.
await db.query("update class_verifications set verified_at=verified_at+interval '1 second' where email=$1 and book_code='sherlock'",[members[6].email]);
check((await rpc('settle',[partial.orderId,'partial',98000,'CANCELED'])).status==='canceled');
check((await db.query("select 1 from class_verifications where email=$1 and book_code='sherlock'",[members[6].email])).rows.length===1);

const atomic=await rpc('prepare',[members[7].id,48000]);
check((await rpc('claim',[members[7].id,atomic.orderId,'atomic',48000])).ok);
await db.exec(`create function private.test_grant_failure() returns trigger language plpgsql as $$begin raise exception 'test_atomic'; end$$;
create trigger test_grant_failure before insert on class_checkout_grants for each row execute function private.test_grant_failure();`);
await assert.rejects(()=>rpc('settle',[atomic.orderId,'atomic',48000,'DONE']),/test_atomic/);checks++;
check((await db.query("select status from class_checkout_orders where id=$1",[atomic.orderId])).rows[0].status==='confirming');
check((await db.query("select 1 from class_verifications where email=$1 and book_code='theory'",[members[7].email])).rows.length===0);
await db.exec('drop trigger test_grant_failure on class_checkout_grants; drop function private.test_grant_failure();');
check((await rpc('settle',[atomic.orderId,'atomic',48000,'DONE'])).granted);

// Worker integration uses the real local SQL through a mocked PostgREST transport.
let auth=members[5]; let providerStatus='DONE'; let wrongOrder=false; let providerCalls=0; let providerPosts=0; let unavailable=false;
const env={CLASS_MEMBER_CHECKOUT_ENABLED:'true',TOSS_CLASS_SECRET_KEY:'test_gsk_local',TOSS_CLASS_CLIENT_KEY:'test_gck_local',TOSS_SECRET_KEY:'DO_NOT_USE',CLASS_MEMBER_CHECKOUT_TERMS_VERSION:'test-terms-v1',CLASS_MEMBER_CHECKOUT_TERMS_URL:'https://class-new.literstella.co.kr/test-terms'};
const deps={
  requireUser:async()=>auth,
  json:(body,status,headers)=>new Response(JSON.stringify(body),{status,headers}),
  sbFetch:async(_env,path,init)=>{
    if(path.startsWith('rpc/class_checkout_')) {
      const name=path.split('rpc/class_checkout_')[1];
      const result=await rpc(name,Object.values(JSON.parse(init.body)));
      return Response.json(result);
    }
    const query=new URLSearchParams(path.split('?')[1]);
    const filters=[]; const values=[];
    for (const column of ['id','user_id']) {
      if(query.has(column)){values.push(query.get(column).slice(3));filters.push(`${column}=$${values.length}`);}
    }
    if(query.has('status')) filters.push("status in ('confirming','partial_refund_review')");
    return Response.json((await db.query(`select * from class_checkout_orders where ${filters.join(' and ')} order by created_at desc limit 1`,values)).rows);
  },
};
const call=async(action,body={},config=env)=>{
  const res=await classMemberCheckout(new Request('https://local.test/api/class-checkout/'+action,{method:'POST',body:JSON.stringify(body)}),config,{},action,deps);
  return {status:res.status,body:await res.json()};
};
check((await call('quote',{},{})).body.checkoutEnabled===false);
check((await call('prepare',{expectedAmount:148000},{})).status===503);
check((await call('quote',{}, {...env,CLASS_MEMBER_CHECKOUT_TERMS_URL:''})).body.checkoutEnabled===false);
check((await call('quote',{}, {...env,CLASS_MEMBER_CHECKOUT_TERMS_URL:'javascript:alert(1)'})).body.checkoutEnabled===false);
check((await call('quote',{}, {...env,CLASS_MEMBER_CHECKOUT_TERMS_URL:'https://foreign.example/terms'})).body.checkoutEnabled===false);
check((await call('prepare',{expectedAmount:148000})).body.error==='terms_changed');
auth=null; check((await call('quote')).status===401); auth=members[5];
const prepared=(await call('prepare',{expectedAmount:148000,acceptedTermsVersion:'test-terms-v1',email:'attacker@example.test',userId:members[0].id})).body;
check(prepared.email===auth.email);
const accepted=(await db.query('select terms_version,terms_url,terms_accepted_at from class_checkout_orders where id=$1',[prepared.orderId])).rows[0];
check(accepted.terms_version==='test-terms-v1' && accepted.terms_url===env.CLASS_MEMBER_CHECKOUT_TERMS_URL && !!accepted.terms_accepted_at);
const originalFetch=globalThis.fetch;
let providerOrder=prepared.orderId; let providerAmount=148000; let providerKey='worker-key';
globalThis.fetch=async(url,init)=>{
  providerCalls++;
  if(unavailable) throw new Error('Mock timeout');
  assert.equal(init.headers.Authorization,`Basic ${btoa('test_gsk_local:')}`);
  if(init.method==='POST') {
    providerPosts++;
    const b=JSON.parse(init.body); assert.equal(b.amount,providerAmount); assert.equal(init.headers['Idempotency-Key'],providerOrder);
    if(providerStatus==='IN_PROGRESS') providerStatus='DONE';
  }
  return Response.json({status:providerStatus,paymentKey:providerKey,orderId:wrongOrder?'wrong':providerOrder,totalAmount:providerAmount,currency:'KRW'});
};
try {
  const payload={orderId:prepared.orderId,paymentKey:'worker-key',amount:148000};
  check((await call('confirm',{...payload,amount:1})).status===409);
  check(providerCalls===0);
  auth=members[0];
  check((await call('status',{orderId:prepared.orderId})).status===404);
  check(providerCalls===0);
  auth=members[5];
  wrongOrder=true;
  check((await call('confirm',payload)).body.error==='payment_mismatch');
  wrongOrder=false;
  const pendingQuote=(await call('quote')).body;
  check(pendingQuote.pendingOrder.orderId===prepared.orderId);
  check(!JSON.stringify(pendingQuote).includes('worker-key'));
  unavailable=true;
  check((await call('status',{orderId:prepared.orderId})).status===503);
  unavailable=false;
  check((await call('status',{orderId:prepared.orderId},{...env,CLASS_MEMBER_CHECKOUT_ENABLED:'false'})).body.granted===true);
  check(providerPosts===0);
  check((await call('confirm',payload)).body.granted===true);
  check((await call('confirm',payload,{...env,CLASS_MEMBER_CHECKOUT_ENABLED:'false'})).body.granted===true);
  providerStatus='CANCELED';
  check((await call('webhook',{data:{paymentKey:'worker-key',orderId:prepared.orderId}})).body.status==='canceled');
  check((await call('confirm',payload)).body.error==='order_closed');
  check((await call('status',{orderId:prepared.orderId})).body.status==='canceled');
  check(providerPosts===0);
  const failedUser=await member(1,50);
  const failedOrder=await rpc('prepare',[failedUser.id,348000]);
  await rpc('claim',[failedUser.id,failedOrder.orderId,'failed-key',348000]);
  check((await rpc('settle',[failedOrder.orderId,'failed-key',348000,'ABORTED'])).status==='expired');
  check((await rpc('prepare',[failedUser.id,348000])).orderId!==failedOrder.orderId);
  auth=await member(1,51);
  const fresh=(await call('prepare',{expectedAmount:348000,acceptedTermsVersion:'test-terms-v1'})).body;
  providerOrder=fresh.orderId; providerAmount=348000; providerKey='fresh-key'; providerStatus='IN_PROGRESS';
  const freshPayload={orderId:providerOrder,paymentKey:providerKey,amount:providerAmount};
  check((await call('confirm',freshPayload)).body.granted===true);
  check(providerPosts===1);
  check((await call('confirm',freshPayload)).body.granted===true);
  check(providerPosts===1);
  // A changed policy invalidates only an unapproved order, preserving its consent history.
  const termsUser=await member(1,52);
  const oldTerms=await rpc('prepare',[termsUser.id,348000]);
  const newTerms=await rpc('prepare',[termsUser.id,348000,'test-terms-v2',env.CLASS_MEMBER_CHECKOUT_TERMS_URL]);
  check(newTerms.orderId!==oldTerms.orderId);
  check((await db.query('select status,terms_version from class_checkout_orders where id=$1',[oldTerms.orderId])).rows[0].status==='expired');
  auth=await member(1,60);
  const pilotEnv={...env,CLASS_MEMBER_CHECKOUT_ENABLED:'false',CLASS_MEMBER_CHECKOUT_PILOT:{
    userId:auth.id,amount:348000,expiresAt:new Date(Date.now()+3600000).toISOString()}};
  check((await call('quote',{},pilotEnv)).body.checkoutEnabled===true);
  const purchase={expectedAmount:348000,acceptedTermsVersion:'test-terms-v1'};
  check((await call('prepare',{...purchase,expectedAmount:100},pilotEnv)).body.error==='amount_mismatch');
  for(const pilot of [undefined,{}, {...pilotEnv.CLASS_MEMBER_CHECKOUT_PILOT,userId:members[0].id},
    {...pilotEnv.CLASS_MEMBER_CHECKOUT_PILOT,expiresAt:'invalid'},
    {...pilotEnv.CLASS_MEMBER_CHECKOUT_PILOT,expiresAt:new Date(0).toISOString()},
    {...pilotEnv.CLASS_MEMBER_CHECKOUT_PILOT,amount:'348000'}]) {
    const closed={...pilotEnv,CLASS_MEMBER_CHECKOUT_PILOT:pilot};
    check((await call('quote',{},closed)).body.checkoutEnabled===false);
    check((await call('prepare',{...purchase,userId:auth.id},closed)).body.error==='checkout_closed');
  }
  check((await call('quote',{}, {...pilotEnv,TOSS_CLASS_SECRET_KEY:''})).body.checkoutEnabled===false);
  check((await call('quote',{}, {...pilotEnv,CLASS_MEMBER_CHECKOUT_TERMS_URL:''})).body.checkoutEnabled===false);
  check((await call('quote',{}, {...pilotEnv,CLASS_MEMBER_CHECKOUT_PILOT:{...pilotEnv.CLASS_MEMBER_CHECKOUT_PILOT,amount:100}})).body.checkoutEnabled===false);
  const pilotOrder=(await call('prepare',purchase,pilotEnv)).body;
  check(pilotOrder.ok && pilotOrder.amount===348000);
  check((await call('prepare',purchase,pilotEnv)).body.orderId===pilotOrder.orderId);
  providerOrder=pilotOrder.orderId; providerAmount=348000; providerKey='pilot-key'; providerStatus='IN_PROGRESS';
  const pilotPayload={orderId:providerOrder,paymentKey:providerKey,amount:providerAmount};
  const pilotExpired={...pilotEnv,CLASS_MEMBER_CHECKOUT_PILOT:{...pilotEnv.CLASS_MEMBER_CHECKOUT_PILOT,expiresAt:new Date(0).toISOString()}};
  check((await call('confirm',pilotPayload,pilotExpired)).body.granted===true);
  check((await call('quote',{},pilotEnv)).body.checkoutEnabled===false);
  providerStatus='CANCELED';
  check((await call('webhook',{data:pilotPayload},pilotExpired)).body.status==='canceled');
  check((await call('prepare',purchase,pilotEnv)).body.error==='checkout_closed');
  check((await call('quote',{},pilotEnv)).body.checkoutEnabled===false);
  check((await db.query('select book_code from class_verifications where email=$1',[auth.email])).rows.map(r=>r.book_code).join()==='kidari');
} finally {globalThis.fetch=originalFetch;await db.close();}
console.log(`class-member-checkout: ${checks} checks passed (local PostgreSQL + mocked provider; no live writes)`);
