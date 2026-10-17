import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {parse}=await import(pathToFileURL(process.env.TOML_MODULE).href);
const auth=parse(await readFile(process.env.CF_AUTH_CONFIG,'utf8')).oauth_token;
const dir=pathToFileURL(process.env.CHECKOUT_RELEASE_DIR.replaceAll('\\','/')+'/');
const base='https://api.cloudflare.com/client/v4/accounts/7c0f1a62c610e750e5c523d0620a9f6c/workers/scripts/literstella-api';
const cf=(path,init={})=>fetch(base+path,{signal:AbortSignal.timeout(60000),...init,headers:{Authorization:'Bearer '+auth,...init.headers}});
const hash=b=>createHash('sha256').update(b).digest('hex');
async function json(path){const r=await cf(path);assert.ok(r.ok,`HTTP ${r.status}`);const j=await r.json();assert.ok(j.success);return j.result;}
async function state(){
 const settings=await json('/settings');const d=await json('/deployments');const c=await cf('/content/v2');assert.ok(c.ok);
 const main=c.headers.get('cf-entrypoint')||c.headers.get('cf-worker-main-module-part')||settings.main_module;assert.ok(main);
 const modules=[];for(const[name,file]of await c.formData()){
  assert.ok(typeof file!=='string');modules.push({name,type:file.type,bytes:Buffer.from(await file.arrayBuffer())});
 }
 return{settings,deployment:d.deployments[0],main,modules};
}
const manifest=s=>({settingsHash:hash(JSON.stringify(s.settings)),deployment:s.deployment,main:s.main,modules:s.modules.map(m=>({name:m.name,type:m.type,hash:hash(m.bytes)})).sort((a,b)=>a.name.localeCompare(b.name))});
const current=await state();const schedules=await json('/schedules');
if(!process.argv.includes('--deploy')){
 console.log(JSON.stringify({manifest:manifest(current),schedules}));process.exit(0);
}
const saved=JSON.parse(await readFile(new URL('manifest.json',dir),'utf8'));
assert.deepEqual(manifest(current),saved,'Live changed since reviewed snapshot');
assert.equal(current.main,'class-member-checkout-entry.mjs');assert.equal(current.modules.length,6);
for(const name of ['RESEND_API_KEY','RESEND_FROM','ADMIN_EMAIL','TOSS_CLASS_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'])assert.ok(current.settings.bindings.some(b=>b.name===name),'Missing '+name);
const added=[];for(const name of ['class-checkout-email-entry.mjs','class-checkout-email.mjs']){
 assert.ok(!current.modules.some(m=>m.name===name));
 added.push({name,type:'application/javascript+module',bytes:await readFile(new URL('../src/'+name,import.meta.url))});
}
await writeFile(new URL('schedules-before.json',dir),JSON.stringify(schedules,null,2));
const form=new FormData();form.set('metadata',JSON.stringify({main_module:'class-checkout-email-entry.mjs'}));
for(const m of [...current.modules,...added])form.set(m.name,new Blob([m.bytes],{type:m.type}),m.name);
const upload=await cf('/content',{method:'PUT',body:form});await upload.arrayBuffer();
console.log(JSON.stringify({uploadStatus:upload.status,note:'Do not retry an unknown outcome; inspect live'}));
const after=await state();assert.equal(after.main,'class-checkout-email-entry.mjs');
for(const m of [...current.modules,...added])assert.equal(hash(after.modules.find(x=>x.name===m.name)?.bytes||''),hash(m.bytes));
assert.deepEqual(after.settings.bindings,current.settings.bindings);assert.equal(after.settings.compatibility_date,current.settings.compatibility_date);
await writeFile(new URL('deployed-mail.json',dir),JSON.stringify(manifest(after),null,2));
assert.deepEqual(await json('/schedules'),schedules,'Schedules changed during release');
const crons=[...new Set([...schedules.schedules.map(x=>x.cron),'*/5 * * * *'])].map(cron=>({cron}));
const scheduled=await cf('/schedules',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(crons)});
const result=await scheduled.json();assert.ok(scheduled.ok&&result.success);
const actual=await json('/schedules');assert.deepEqual(actual.schedules.map(x=>x.cron).sort(),crons.map(x=>x.cron).sort());
await writeFile(new URL('schedules-after.json',dir),JSON.stringify(actual,null,2));
console.log(JSON.stringify({deployment:after.deployment,oldModulesPreserved:6,bindingsPreserved:after.settings.bindings.length,crons:crons.map(x=>x.cron)}));
