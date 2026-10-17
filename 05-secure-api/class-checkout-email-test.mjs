import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {processCheckoutEmails,renderCheckoutEmail,receiptUrl,checkoutEmailAdmin} from './src/class-checkout-email.mjs';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;
create table class_checkout_orders(id text primary key,status text,email text,amount int,missing_books text[],owned_books text[],payment_key text);
create table class_verifications(email text,book_code text);create table class_redemptions(redeemed_by text,book_code text);
insert into class_checkout_orders values('historical','paid','old@example.test',348000,array['kidari'],array['pride'],'old');
grant usage on schema public to service_role;grant select,update on class_checkout_orders to service_role;`);
await db.exec(await readFile(new URL('./supabase/migrations/20261012155826_class_checkout_email_outbox.sql',import.meta.url),'utf8'));
let n=0;const check=x=>{assert.ok(x);n++;};
check((await db.query('select * from class_checkout_email_outbox')).rows.length===0);
for(const role of ['anon','authenticated'])for(const table of ['class_checkout_email_outbox']){
 await db.exec(`set role ${role}`);await assert.rejects(db.query(`select * from ${table}`));n++;
 await assert.rejects(db.query('select class_checkout_email_claim(null)'));n++;await db.exec('reset role');
}
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',RESEND_API_KEY:'test',RESEND_FROM:'LiterStella <mail@example.test>',ADMIN_EMAIL:'admin@example.test',TOSS_CLASS_SECRET_KEY:'test',ALLOWED_ORIGINS:'https://admin.test'};
const payments=new Map();const sent=[];let responseMode=200;
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
 const u=new URL(input);
 if(u.host==='api.tosspayments.com')return response(payments.get(decodeURIComponent(u.pathname.split('/').at(-1))));
 if(u.host==='api.resend.com'){sent.push({key:init.headers['Idempotency-Key'],body:JSON.parse(init.body)});return response({id:'email-'+sent.length},responseMode);}
 if(u.pathname==='/auth/v1/user')return response({email: init.headers.Authorization==='Bearer admin'?'admin@example.test':'other@example.test',email_confirmed_at:'2026-01-01'});
 if(u.pathname.endsWith('/rpc/class_checkout_email_claim')){
  await db.exec('set role service_role');
  try{return response((await db.query('select class_checkout_email_claim($1) as v',[JSON.parse(init.body).p_order_id])).rows[0].v);}
  finally{await db.exec('reset role');}
 }
 if(u.pathname.endsWith('/class_verifications'))return response((await db.query('select book_code from class_verifications where email=$1',[u.searchParams.get('email').slice(3)])).rows);
 if(u.pathname.endsWith('/class_redemptions'))return response([]);
 if(u.pathname.endsWith('/class_checkout_email_outbox')){
  if(init.method!=='PATCH')return response((await db.query('select * from class_checkout_email_outbox')).rows);
  const patch=JSON.parse(init.body);const values=[];const add=v=>{values.push(v);return '$'+values.length;};
  const assignments=Object.entries(patch).map(([k,v])=>{assert.match(k,/^[a-z_]+$/);return `${k}=${add(k==='envelope'?JSON.stringify(v):v)}`;});
  const where=[];
  for(const [k,v]of u.searchParams){if(['id','lease_token','status','first_attempt_at','attempts'].includes(k)){const i=v.indexOf('.');const op={eq:'=',gt:'>',lt:'<'}[v.slice(0,i)];assert.ok(op);where.push(`${k}${op}${add(v.slice(i+1))}`);}}
  return response((await db.query(`update class_checkout_email_outbox set ${assignments} where ${where.join(' and ')} returning *`,values)).rows);
 }
 throw Error('Unexpected request '+u.href);
};
async function order(id){
 const email=id+'@example.test';
 await db.query(`insert into class_checkout_orders values($1,'confirming',$2,348000,array['kidari'],array['pride'],$1)`,[id,email]);
 await db.query('insert into class_verifications values($1,$2)',[email,'kidari']);
 const p={orderId:id,paymentKey:id,totalAmount:348000,currency:'KRW',status:'DONE',approvedAt:'2026-10-12T16:00:00+09:00',method:'카드',easyPay:{provider:'토스페이'},receipt:{url:'https://pgweb.tosspayments.com/receipt'}};
 payments.set(id,p);
 await db.exec('set role service_role');await db.query(`update class_checkout_orders set status='paid' where id=$1`,[id]);await db.exec('reset role');
 return p;
}
try{
 await order('first');check((await db.query('select * from class_checkout_email_outbox')).rows.length===2);
 await db.query("update class_checkout_orders set status='paid' where id='first'");check((await db.query('select * from class_checkout_email_outbox')).rows.length===2);
 await processCheckoutEmails(env,'first');check(sent.length===2);
 await processCheckoutEmails(env,'first');check(sent.length===2);
 check((await db.query("select * from class_checkout_email_outbox where status='accepted'")).rows.length===2);
 check(sent.some(x=>x.body.to[0]==='first@example.test'));check(sent.some(x=>x.body.to[0]===env.ADMIN_EMAIL));
 check(sent[0].body.html.includes('강의실에서 시작하기'));check(sent[0].body.html.includes('카카오톡 문의'));check(sent[0].body.html.includes('logo-literstella-en.png'));
 check(sent[0].body.html.includes('결제 영수증 보기'));check(!sent[0].body.html.includes('class.literstella.co.kr'));
 await order('retry');responseMode=429;await processCheckoutEmails(env,'retry');check(sent.length===4);
 await db.exec("update class_checkout_email_outbox set next_attempt_at=now() where order_id='retry'");responseMode=200;
 await processCheckoutEmails(env,'retry');check(sent.length===6);assert.deepEqual(sent[2],sent[4]);n++;assert.deepEqual(sent[3],sent[5]);n++;
 await order('cancel');await db.exec("update class_checkout_orders set status='canceled' where id='cancel'");await processCheckoutEmails(env,'cancel');check(sent.length===6);
 await order('mismatch');payments.get('mismatch').totalAmount=1;await processCheckoutEmails(env,'mismatch');check(sent.length===6);
 check((await db.query("select * from class_checkout_email_outbox where order_id='mismatch' and status='review'")).rows.length===2);
 await order('late');await db.exec("update class_checkout_email_outbox set first_attempt_at=now()-interval '25 hours' where order_id='late'");await processCheckoutEmails(env,'late');check(sent.length===6);
 await order('lease');const claim=(await db.query("select class_checkout_email_claim('lease') as v")).rows[0].v;
 const claim2=(await db.query("select class_checkout_email_claim('lease') as v")).rows[0].v;check(claim.job.id!==claim2.job.id);
 check((await db.query("select class_checkout_email_claim('lease') as v")).rows[0].v===null);
 await order('missing');await db.exec("delete from class_verifications where email='missing@example.test'");await processCheckoutEmails(env,'missing');check(sent.length===6);
 check(receiptUrl('javascript:alert(1)')===null);check(receiptUrl('https://tosspayments.com.evil.test')===null);
 const bad={id:'html',email:'safe@example.test',amount:348000,missing_books:['<img onerror=x>']};
 const escaped=renderCheckoutEmail(bad,payments.get('first'),'admin',env);check(!escaped.html.includes('<img onerror=x>'));
 for(const [token,status]of [['',401],['other',403],['admin',200]])check((await checkoutEmailAdmin(new Request('https://api.test/api/class-checkout-emails',{headers:{Origin:'https://admin.test','X-User-Token':token}}),env)).status===status);
 check((await checkoutEmailAdmin(new Request('https://api.test/api/class-checkout-emails',{method:'OPTIONS',headers:{Origin:'https://admin.test'}}),env)).status===204);
 for(const audience of ['member','admin'])await writeFile(new URL(`./docs/checkout-${audience}-preview.html`,import.meta.url),renderCheckoutEmail({id:'EXAMPLE-NOT-A-PAYMENT',email:'member@example.test',amount:348000,missing_books:['kidari','anne','theory']},payments.get('first'),audience,env).html);
 console.log(`checkout email: ${n} assertions PASS; mock payments/mail only`);
}finally{globalThis.fetch=realFetch;await db.close();}
