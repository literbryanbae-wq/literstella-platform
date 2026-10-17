const CLASS = 'https://class-new.literstella.co.kr';
const KAKAO = 'https://pf.kakao.com/_xkxdZxeb/chat';
const NAMES = {kidari:'키다리 아저씨',anne:'빨강머리 앤',littlewomen1:'작은 아씨들 파트1',littlewomen2:'작은 아씨들 파트2',pride:'오만과 편견',gatsby:'위대한 개츠비',sherlock:'셜록 홈즈',theory:'원서 읽기 핵심 이론'};
const escape = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validEmail = x => typeof x==='string' && x.length<=254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x);
const won = n => Number(n).toLocaleString('ko-KR')+'원';
export function receiptUrl(value) {
 try { const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&
 (u.hostname==='tosspayments.com'||u.hostname.endsWith('.tosspayments.com'))?u.href:null; } catch{return null;}
}
export function renderCheckoutEmail(order,payment,audience,env) {
 const admin=audience==='admin';const to=admin?env.ADMIN_EMAIL:order.email;
 if(!validEmail(to)||!env.RESEND_FROM||/[\r\n]/.test(env.RESEND_FROM))throw Error('mail_configuration');
 const receipt=receiptUrl(payment.receipt?.url);
 const date=new Date(payment.approvedAt);if(!Number.isFinite(date.getTime()))throw Error('invalid_payment_date');
 const at=date.toLocaleString('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
 const method=payment.easyPay?.provider||payment.method||'결제';
 const courses=order.missing_books.map(x=>NAMES[x]||x).join(', ');
 const subject=admin?`[리터스텔라] 결제 완료 · ${won(order.amount)}`:'[리터스텔라] 결제 완료 · 수강을 시작해 주세요';
 const book=order.product_code?.match(/^class-(\w+)-lifetime$/)?.[1];
 if(book&&!NAMES[book])throw Error('mail_configuration');
 const rows=[['상품',book?`${NAMES[book]} · 평생소장`:'올인원 평생소장 · 회원 전환'],['결제 금액',won(order.amount)],...(!book?[['기존 소장 할인',won(398000-order.amount)]]:[]),['결제수단',method],['결제일시',at+' (한국시간)'],['주문번호',order.id],['수강 계정',order.email]];
 if(admin)rows.push(['연결 결과','수강권 연결 완료'],['추가 연결 강의',courses]);
 const button=(url,label)=>`<a href="${escape(url)}" style="display:inline-block;background:#c8a84b;color:#161b25;padding:13px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">${label}</a>`;
 const body=`<h1 style="font-size:22px;line-height:1.4;margin:0 0 16px;word-break:keep-all;">${admin?'결제·수강 연결 완료':'수강권이 열렸어요'}</h1>`+
 `<table role="presentation" style="width:100%;font-size:14px;border-collapse:collapse;">${rows.map(([k,v])=>`<tr><td style="padding:6px 8px 6px 0;vertical-align:top;white-space:nowrap;color:#666;">${escape(k)}</td><td style="padding:6px 0;word-break:break-word;">${escape(v)}</td></tr>`).join('')}</table>`+
 (admin?`<p>주문번호로 결제·수강권 처리 내역을 확인해 주세요.</p>`:`<p>결제한 계정으로 로그인한 뒤, 강의실에서 원하는 강의를 선택하세요. 기존 소장 강의도 그대로 이용할 수 있어요.</p><p>${button(CLASS+'/room','강의실에서 시작하기')}</p>`)+
 `<p>${receipt?`<a href="${escape(receipt)}">결제 영수증 보기</a>`:'영수증 확인이 필요하시면 카카오 채널로 문의해 주세요.'}</p>`+
 `<p style="font-size:13px;"><a href="${CLASS}/library">내 서재</a> · <a href="${CLASS}/refund">구매·환불 안내</a> · <a href="${KAKAO}">카카오톡 문의</a></p>`;
 // Match the existing transactional brand shell, with current class links and no promotion.
 const html=`<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f4f1ea;font-family:Arial,'Apple SD Gothic Neo',sans-serif;color:#1d2433;line-height:1.7;"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" style="max-width:480px;background:#fffdf8;border:1px solid #e8e2d4;"><tr><td style="padding:24px;text-align:center;"><img src="https://challenge.literstella.co.kr/logo-symbol.png" alt="" width="46" height="46"><br><img src="https://challenge.literstella.co.kr/logo-literstella-en.png" alt="LiterStella" height="22"></td></tr><tr><td style="padding:0 24px 24px;">${body}</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #e8e2d4;font-size:12px;color:#666;">리터스텔라 · 결제 및 수강 안내<br>이 메일은 주문 처리에 관한 안내입니다.</td></tr></table></td></tr></table></body></html>`;
 return {from:env.RESEND_FROM,to:[to],subject,html,text:[subject,...rows.map(([k,v])=>`${k}: ${v}`),admin?'수강권 연결 완료':`결제한 계정으로 로그인 → 강의실에서 강의 선택\n${CLASS}/room`,receipt?`영수증: ${receipt}`:'영수증: 카카오 채널 문의',`구매·환불 안내: ${CLASS}/refund`,`카카오 문의: ${KAKAO}`].join('\n'),tags:[{name:'category',value:'class_checkout_transactional'},{name:'audience',value:audience}]};
}
async function db(env,path,init={}){
 const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{...init,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error('mail_storage_unavailable');return r.status===204?null:r.json();
}
async function update(env,j,patch){
 const result=await db(env,`class_checkout_email_outbox?id=eq.${j.id}&lease_token=eq.${j.lease_token}&status=eq.processing`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...patch,updated_at:new Date().toISOString()})});
 if(!result?.length)throw Error('mail_lease_lost');
}
async function runOne(env,orderId){
 const claimed=await db(env,'rpc/class_checkout_email_claim',{method:'POST',body:JSON.stringify({p_order_id:orderId||null})});
 if(!claimed)return false;
 const {job:j,order:o}=claimed;
 const done=patch=>update(env,j,{...patch,lease_token:null,lease_until:null});
 try{
  const r=await fetch('https://api.tosspayments.com/v1/payments/'+encodeURIComponent(o.payment_key),{headers:{Authorization:'Basic '+btoa(env.TOSS_CLASS_SECRET_KEY+':')},signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw Error('provider_unavailable');const p=await r.json();
  if(p.orderId!==o.id||p.paymentKey!==o.payment_key||p.totalAmount!==o.amount||p.currency!=='KRW'){
   await done({status:'review',last_error:'payment_mismatch'});return true;
  }
  if(p.status!=='DONE'){await done({status:['CANCELED','PARTIAL_CANCELED','ABORTED','EXPIRED'].includes(p.status)?'canceled':'pending',last_error:'payment_not_done',next_attempt_at:new Date(Date.now()+300000).toISOString()});return true;}
  const grants=await db(env,`class_verifications?email=eq.${encodeURIComponent(o.email)}&select=book_code`);
  const redemptions=await db(env,`class_redemptions?redeemed_by=eq.${encodeURIComponent(o.email)}&select=book_code`);
  const owned=new Set([...grants,...redemptions].map(x=>x.book_code));
  if(!o.missing_books.every(b=>owned.has(b)))throw Error('grant_pending');
  const envelope=j.envelope||renderCheckoutEmail(o,p,j.audience,env);
  if(!j.envelope)await update(env,j,{envelope});
  // Refresh the lease/status immediately before the external side effect.
  await update(env,j,{lease_until:new Date(Date.now()+180000).toISOString()});
  const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':`class-checkout/${j.id}`},body:JSON.stringify(envelope),signal:AbortSignal.timeout(5000)});
  const result=await sent.json().catch(()=>null);
  if(sent.ok&&typeof result?.id==='string')await done({status:'accepted',provider_email_id:result.id,last_error:null});
  else if(sent.status===429||sent.status>=500||sent.ok)throw Error('mail_provider_retry');
  else await done({status:'failed',last_error:`resend_http_${sent.status}`});
 }catch(e){
  const safe=['provider_unavailable','grant_pending','mail_configuration','invalid_payment_date','mail_storage_unavailable','mail_provider_retry'].includes(e.message)?e.message:'mail_attempt_uncertain';
  await done({status:'pending',last_error:safe,next_attempt_at:new Date(Date.now()+300000).toISOString()}).catch(()=>{});
 }
 return true;
}
export async function processCheckoutEmails(env,orderId=null){
 if(!env.RESEND_API_KEY||!env.RESEND_FROM||!env.ADMIN_EMAIL||!env.TOSS_CLASS_SECRET_KEY)return;
 try{for(let i=0;i<2;i++)if(!await runOne(env,orderId))break;}
 catch{console.log(JSON.stringify({evt:'class_checkout_email_queue_error'}));}
}

export async function checkoutEmailAdmin(req,env){
 const origin=req.headers.get('Origin');
 const cors={'Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-User-Token'};
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(!origin||!(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).includes(origin))return reply({error:'forbidden'},403);
 cors['Access-Control-Allow-Origin']=origin;
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const token=req.headers.get('X-User-Token');if(!token)return reply({error:'login_required'},401);
 const userResponse=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
 const user=await userResponse.json().catch(()=>null);
 if(!userResponse.ok||!user?.email_confirmed_at||!env.ADMIN_EMAIL||user.email?.toLowerCase()!==env.ADMIN_EMAIL.toLowerCase())return reply({error:'forbidden'},403);
 if(req.method==='GET'){
  const rows=await db(env,'class_checkout_email_outbox?select=id,order_id,audience,status,attempts,provider_email_id,last_error,created_at,updated_at&order=created_at.desc&limit=100');
  return reply({ok:true,rows});
 }
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 const body=await req.json().catch(()=>null);if(!/^[0-9a-f-]{36}$/.test(body?.id||''))return reply({error:'bad_request'},400);
 // Retry uses the same immutable envelope and idempotency key, never a new mail.
 const cutoff=new Date(Date.now()-23*3600000).toISOString();
 const rows=await db(env,`class_checkout_email_outbox?id=eq.${body.id}&status=eq.failed&first_attempt_at=gt.${encodeURIComponent(cutoff)}&attempts=lt.10`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'pending',next_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
 return reply({ok:rows?.length===1},rows?.length===1?200:409);
}
