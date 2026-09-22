import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('src/core/site-footer/manifest.json',root),'utf8'));
for(const [p,hash] of Object.entries(manifest)){
const data=readFileSync(new URL(p,root));
const content=/\.(?:mjs|js|jsx|css|json|webmanifest)$/.test(p)?data.toString().replace(/\r\n/g,'\n'):data;
assert.equal(createHash('sha256').update(content).digest('hex'),hash,`Shared footer drift: ${p}`);
}
const {footerHtml}=await import(new URL('src/core/site-footer/footer.mjs',root));
const {SERVICE_MENU}=await import(new URL('src/core/site-footer/serviceMenu.js',root));
const entries=['index.html','learning-platform-connected/index.html'].filter(p=>existsSync(new URL(p,root))).map(p=>readFileSync(new URL(p,root),'utf8'));
const entryHtml=entries.find(html=>html.includes('href="/brand/shared/favicon.png"'))||'';
assert.ok(entryHtml.includes('href="/brand/shared/favicon.png"'),'Shared favicon link missing');
if(entryHtml.includes('data-footer-app="read"')){
 const actual=entryHtml.match(/<footer class="ls-site-footer"[\s\S]*?<\/footer>/)?.[0];
 const year=actual?.match(/© (\d{4})/)?.[1];
 assert.equal(actual?.replace(/\r\n/g,'\n'),footerHtml({app:'read',actions:['privacy','terms','refund'],year}), 'READ footer was edited outside the shared source');
}
for(const app of ['read','class','challenge','english']){
const html=footerHtml({app,actions:['terms','privacy','refund']});
// 개수를 숫자로 박지 않는다 — 목록이 늘면 이 검사가 낡아 4앱 빌드가 한꺼번에 멈춘다(2026-09-16 실사고).
assert.equal((html.match(/data-footer-service=/g)||[]).length,SERVICE_MENU.length);
assert.ok(html.includes('카카오톡 문의하기'));
assert.ok(html.includes('data-footer-action="refund"'));
assert.ok(html.includes('href="https://www.literstella.co.kr/#trust"'),'AI 수업 차별점 링크 누락');
assert.ok(html.includes('class="ls-site-footer__why"'),'__why 클래스가 없으면 CSS 가 안 먹어 위치가 깨진다');
assert.ok(html.includes('리터스텔라 AI수업은 다릅니다'),'AI 수업 차별점 문구 누락');
}
console.log('Shared footer + favicon hashes and contracts PASS');
