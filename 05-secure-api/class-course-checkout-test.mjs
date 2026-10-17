import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {classCourseCheckout} from './src/class-course-checkout.mjs';
import {renderCheckoutEmail} from './src/class-checkout-email.mjs';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();let n=0;const check=x=>{assert.ok(x);n++;};
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table class_verifications(email text,book_code text,verified_at timestamptz default clock_timestamp(),enrollment_email text,primary key(email,book_code));
create table class_redemptions(book_code text,redeemed_by text);create table stella_upgrade_requests(user_id uuid,status text);
grant usage on schema public,auth to service_role;grant select on class_redemptions,stella_upgrade_requests to service_role;
grant select,insert,update,delete on class_verifications to service_role;`);
for(const name of ['20261012100801_class_member_checkout','20261012155826_class_checkout_email_outbox','20261012170322_class_course_checkout'])await db.exec(await readFile(new URL(`./supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
const rpc=async(name,args)=>(await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args)).rows[0].v;
const quote=(id,book)=>rpc('class_course_checkout_quote',[id,book]);
const prepare=(id,book,amount)=>rpc('class_course_checkout_prepare',[id,book,amount,'local-v1','https://challenge.literstella.co.kr/course-terms']);
const claim=(id,o,key)=>rpc('class_checkout_claim',[id,o.orderId,key,o.amount]);
const settle=(o,key,status)=>rpc('class_checkout_settle',[o.orderId,key,o.amount,status]);
let seq=0;
async function user(){const id=`00000000-0000-0000-0000-${String(++seq).padStart(12,'0')}`;const email=`m${seq}@example.test`;await db.query('insert into auth.users values($1,$2,now())',[id,email]);return {id,email,emailConfirmed:true};}
try{
 for(const [book,amount] of Object.entries({kidari:69000,anne:118000,pride:128000,littlewomen1:99000,littlewomen2:99000,gatsby:79000,sherlock:79000,theory:39800})){
  const u=await user();const q=await quote(u.id,book);check(q.eligible&&q.ownedCount===0&&q.amount===amount&&q.creditAmount===0);
  check((await prepare(u.id,book,1)).error==='quote_changed');const o=await prepare(u.id,book,amount);check(o.ok);
  check((await prepare(u.id,book,amount)).orderId===o.orderId);
  check((await claim(u.id,o,book)).ok);check((await settle(o,book,'DONE')).granted);
  check((await db.query('select book_code from class_verifications where email=$1',[u.email])).rows.map(r=>r.book_code).join()===book);
  check((await quote(u.id,book)).complete);check((await prepare(u.id,book,amount)).error==='already_owned');
  check((await settle(o,book,'DONE')).granted);
  check((await db.query('select count(*)::int n from class_checkout_email_outbox where order_id=$1',[o.orderId])).rows[0].n===2);
  check((await settle(o,book,'CANCELED')).status==='canceled');check((await quote(u.id,book)).eligible);
 }
 const a=await user();const b=await user();const o=await prepare(a.id,'sherlock',79000);
 check((await claim(b.id,o,'wrong')).error==='order_not_found');
 const switched=await prepare(a.id,'kidari',69000);check(switched.ok&&switched.orderId!==o.orderId);
 check((await claim(a.id,o,'expired')).error==='order_closed');
 check((await claim(a.id,switched,'kidari2')).ok);check((await prepare(a.id,'anne',118000)).error==='payment_pending');
 await settle(switched,'kidari2','DONE');
 const single=await prepare(a.id,'anne',118000);check(single.ok);
 const upgrade=await rpc('class_checkout_prepare',[a.id,348000,'local-v1','https://challenge.literstella.co.kr/course-terms']);check(upgrade.ok&&upgrade.orderId!==single.orderId&&upgrade.amount===348000);
 check((await claim(a.id,single,'switched')).error==='order_closed');
 await db.query("update class_checkout_orders set status='expired' where id=$1",[upgrade.orderId]);
 // Paying for a single course must not block later member conversion forever.
 await db.query("insert into stella_upgrade_requests values($1,'pending')",[a.id]);check((await quote(a.id,'anne')).eligible===false);
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);await assert.rejects(()=>quote(a.id,'kidari'));n++;await assert.rejects(db.query('select * from class_checkout_products'));n++;await db.exec('reset role');
 }
 await db.exec('set role service_role');check((await quote(b.id,'sherlock')).amount===79000);await db.exec('reset role');
 let auth=b;const env={CLASS_COURSE_CHECKOUT_ENABLED:'true',TOSS_CLASS_SECRET_KEY:'fake',CLASS_COURSE_CHECKOUT_TERMS_VERSION:'local-v1',CLASS_COURSE_CHECKOUT_TERMS_URL:'https://challenge.literstella.co.kr/course-terms'};
 const deps={requireUser:async()=>auth,json:(body,status,headers)=>Response.json(body,{status,headers}),sbFetch:async(_e,path,init)=>{
  if(path.startsWith('rpc/')){const args=JSON.parse(init.body);const name=path.slice(4);const names=name.endsWith('_quote')?['p_user_id','p_book_code']:name==='class_course_checkout_prepare'?['p_user_id','p_book_code','p_expected_amount','p_terms_version','p_terms_url']:Object.keys(args);return Response.json(await rpc(name,names.map(k=>args[k])));}
  const params=new URLSearchParams(path.split('?')[1]);const values=[];const where=[];
  for(const key of ['id','user_id','product_code'])if(params.has(key)){values.push(params.get(key).slice(3));where.push(`${key}=$${values.length}`);}
  if(params.has('status'))where.push("status in ('confirming','partial_refund_review')");
  return Response.json((await db.query(`select * from class_checkout_orders where ${where.join(' and ')} order by created_at desc limit 1`,values)).rows);
 }};
 const api=async(action,body={},book='sherlock',bindings=env)=>{const r=await classCourseCheckout(new Request('https://api.test/',{method:'POST',body:JSON.stringify(body)}),bindings,{},book,action,deps);return {status:r.status,...await r.json()};};
 check((await api('quote')).amount===79000);check((await api('quote')).checkoutEnabled);
 check(!(await api('quote',{},'sherlock',{...env,CLASS_COURSE_CHECKOUT_ENABLED:'false'})).checkoutEnabled);
 check((await api('prepare',{expectedAmount:79000,acceptedTermsVersion:'wrong'})).error==='terms_changed');
 const testOrder=await api('prepare',{expectedAmount:79000,acceptedTermsVersion:'local-v1'});check(testOrder.ok);
 check((await api('confirm',{orderId:testOrder.orderId,paymentKey:'test',amount:79000},'kidari')).error==='order_not_found');
 check((await api('quote',{},'bogus')).status===404);
 auth=null;check((await api('quote')).status===401);
 const mail=renderCheckoutEmail({id:'example',email:'user@example.test',product_code:'class-sherlock-lifetime',amount:79000,missing_books:['sherlock']},{approvedAt:'2026-10-13T00:00:00Z'},'member',{ADMIN_EMAIL:'admin@example.test',RESEND_FROM:'test@example.test'});
 check(mail.html.includes('셜록 홈즈 · 평생소장')&&!mail.html.includes('기존 소장 할인')&&!mail.html.includes('올인원 평생소장'));
 // Existing free-theory grants are not paid line items. Preserve them on refund;
 // an administrator must review the bonus policy before opening general sales.
 await db.exec(`create function private.test_free_theory() returns trigger language plpgsql as $$begin
 if new.book_code<>'theory' and (select count(*) from public.class_verifications where email=new.email and book_code<>'theory')>=2 then
 insert into public.class_verifications(email,book_code,enrollment_email) values(new.email,'theory',new.email) on conflict do nothing;
 end if; return new; end$$;
 create trigger test_free_theory after insert on class_verifications for each row execute function private.test_free_theory();`);
 const bonus=await user();await db.query("insert into class_verifications(email,book_code,enrollment_email) values($1,'kidari',$1)",[bonus.email]);
 const bonusOrder=await prepare(bonus.id,'anne',118000);check(bonusOrder.ok);check((await claim(bonus.id,bonusOrder,'bonus')).ok);
 check((await settle(bonusOrder,'bonus','DONE')).granted);
 check((await quote(bonus.id,'theory')).complete);
 check((await settle(bonusOrder,'bonus','CANCELED')).status==='canceled');
 check((await quote(bonus.id,'anne')).eligible);
 check((await quote(bonus.id,'kidari')).complete);
 check((await quote(bonus.id,'theory')).complete);
 console.log(`individual course checkout: ${n} checks PASS (local PostgreSQL, no live payment)`);
}finally{await db.close();}
