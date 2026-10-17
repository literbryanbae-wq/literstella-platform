import { classMemberCheckout } from './class-member-checkout.mjs';

export async function classCourseCheckout(req,env,cors,book,action,deps) {
 const reply=(body,status)=>deps.json(body,status,{'Cache-Control':'no-store',...cors});
 if(!['kidari','anne','pride','littlewomen1','littlewomen2','gatsby','sherlock','theory'].includes(book))return reply({ok:false,error:'product_unavailable'},404);
 if(!['quote','prepare','confirm','status'].includes(action))return reply({ok:false,error:'not_found'},404);
 const product=`class-${book}-lifetime`;
 const preparation = action === 'prepare' ? req.clone() : null;
 // Reuse the same authenticated payment/settlement protocol, never the annual-pass probe.
 const sbFetch=async(bindings,path,init={})=>{
  if(path.startsWith('rpc/class_checkout_')){
   const name=path.slice('rpc/class_checkout_'.length);const args=JSON.parse(init.body);
   if(name==='quote'||name==='prepare'){
    // Parse only after the shared checkout's bounded-body/auth validation.
    const promotion = name === 'prepare' ? (await preparation.json()).acceptedPromotionVersion : undefined;
    return deps.sbFetch(bindings,`rpc/class_course_checkout_${name}`,{...init,body:JSON.stringify({...args,p_book_code:book,...(name==='prepare'?{p_promotion_version:typeof promotion==='string'?promotion:null}:{})})});
   }
   if(name==='claim'){
    const r=await deps.sbFetch(bindings,`class_checkout_orders?id=eq.${encodeURIComponent(args.p_order_id)}&user_id=eq.${encodeURIComponent(args.p_user_id)}&product_code=eq.${product}&select=id&limit=1`);
    if(!r.ok)throw Error('storage_unavailable');
    if(!(await r.json()).length)return Response.json({ok:false,error:'order_not_found'});
   }
  }
  // Pending orders for other products remain visible to block repeat charges.
  return deps.sbFetch(bindings,path,init);
 };
 const courseEnv={...env,CLASS_MEMBER_CHECKOUT_ENABLED:env.CLASS_COURSE_CHECKOUT_ENABLED,
  CLASS_MEMBER_CHECKOUT_PILOT:undefined,CLASS_MEMBER_CHECKOUT_TERMS_URL:env.CLASS_COURSE_CHECKOUT_TERMS_URL,
  CLASS_MEMBER_CHECKOUT_TERMS_VERSION:env.CLASS_COURSE_CHECKOUT_TERMS_VERSION};
 return classMemberCheckout(req,courseEnv,cors,action,{...deps,sbFetch,productCode:product});
}
