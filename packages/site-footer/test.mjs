import assert from 'node:assert/strict';
import {footerHtml} from './src/footer.mjs';
import {SERVICE_MENU,serviceMenuFor} from './src/serviceMenu.js';
// 맨 위 = 소개 페이지(운영자 2026-09-16). 그 다음이 영어(가장 새 서비스) — 둔 순서를 둘 다 못 박는다.
assert.equal(SERVICE_MENU[0].key,'home');
assert.equal(SERVICE_MENU[1].key,'english');
const hosts=SERVICE_MENU.filter(s=>s.href).map(s=>new URL(s.href).host);
assert.equal(new Set(hosts).size,hosts.length);
for(const app of ['read','class','challenge','english']){
 const html=footerHtml({app,actions:['privacy','terms','refund','payment'],year:2026});
 assert.equal(serviceMenuFor(app).find(s=>s.key===app).href,null);
 assert.equal((html.match(/data-footer-service=/g)||[]).length,SERVICE_MENU.length);
 assert.ok(html.includes('https://pf.kakao.com/_xkxdZxeb/chat'));
 assert.ok(html.includes('href="https://smartstore.naver.com/literstella" target="_blank" rel="noopener noreferrer">해리포터 완독 클럽</a>'));
 assert.ok(!html.includes('>스마트스토어<'));
 for(const action of ['privacy','terms','refund','payment'])assert.ok(html.includes(`data-footer-action="${action}"`));
 for(const text of ['857-35-01071','사업자정보확인','신흥앞동산로','출판사 신고번호','수강 조건'])assert.ok(html.includes(text));
 // 로고 옆(와이드)·밑(모바일) AI 수업 차별점 링크 — 사라지면 조용히 안 보인다(운영자 2026-09-16)
 assert.ok(html.includes('href="https://www.literstella.co.kr/#trust"'));
 assert.ok(html.includes('class="ls-site-footer__why"'),'__why 클래스가 없으면 CSS 가 안 먹어 위치가 깨진다');
 assert.ok(html.includes('리터스텔라 AI수업은 다릅니다'));
 // 주소는 전체 폭이라 3번째여야 모든 줄이 찰다(예전 4번째라 통신판매업 줄 오른쪽이 비었다)
 const keys=[...html.matchAll(/<span><i>([^<]+)<\/i>/g)].map(m=>m[1]);
 assert.equal(keys[2],'주소','주소는 전체 폭(nth-child(3))이라 3번째여야 모든 줄이 차다');
 assert.equal(keys[3],'통신판매업 신고');
 assert.ok(!footerHtml({app}).includes('data-footer-action='));
}
assert.ok(!footerHtml({app:'<script>'}).includes('data-footer-app="<script>'));
console.log(`Shared footer: four apps, ${SERVICE_MENU.length} services, legal callbacks, business details, escaping PASS`);
