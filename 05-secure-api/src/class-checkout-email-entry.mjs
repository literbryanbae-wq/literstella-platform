import live from './class-member-checkout-entry.mjs';
import {processCheckoutEmails,checkoutEmailAdmin} from './class-checkout-email.mjs';
export * from './class-member-checkout-entry.mjs';
export default {
 ...live,
 async fetch(req,env,ctx){
  const path=new URL(req.url).pathname;
  if(path==='/api/class-checkout-emails'){
   try{
    const r=await checkoutEmailAdmin(req,env);
    if(req.method==='POST'&&r.ok)ctx.waitUntil(processCheckoutEmails(env));
    return r;
   }catch{return new Response(JSON.stringify({error:'mail_status_unavailable'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
  }
  const response=await live.fetch(req,env,ctx);
  if(req.method==='POST'&&/^\/api\/(class-checkout|class-course-checkout\/[a-z0-9]+)\/(confirm|status|webhook)$/.test(path)&&response.ok){
   const result=await response.clone().json().catch(()=>null);
   if(result?.status==='paid'&&result.granted===true)ctx.waitUntil(processCheckoutEmails(env,result.orderId||null));
  }
  return response;
 },
 async scheduled(event,env,ctx){
  if(event.cron==='*/5 * * * *'){ctx.waitUntil(processCheckoutEmails(env));return;}
  if(live.scheduled)await live.scheduled(event,env,ctx);
 }
};
