import { chromium } from 'file:///C:/Users/sun%20luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const live = process.env.FOOTER_LIVE === '1';
const out = new URL(`../../../artifacts/shared-footer-20260911/${live?'live/':''}`, import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  const urls=live?{read:'https://read.literstella.co.kr/',class:'https://class-new.literstella.co.kr/classes',challenge:'https://challenge.literstella.co.kr/?mode=diary',english:'https://english.literstella.co.kr/growth-lab?preview=1&page=invitation'}:{read:'http://127.0.0.1:5238/',class:'http://127.0.0.1:5239/classes',challenge:'http://127.0.0.1:5240/?mode=diary',english:'http://127.0.0.1:5241/growth-lab?preview=1&page=invitation'};
  for (const [app, url] of Object.entries(urls)) {
    const page = await browser.newPage();
    await page.addInitScript(()=>sessionStorage.setItem('ls_last100_notice_session','2026-last100-v1'));
    console.log('Checking',app,url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('.ls-site-footer').waitFor({ timeout: 120000 });
    await page.waitForTimeout(3000);
    for (let i=0;i<4;i++) {
      const close=page.getByRole('button',{name:/닫기/}).filter({visible:true}).first();
      if(!await close.count())break;
      await close.click({timeout:3000}).catch(()=>{});
    }
    const icon = await page.locator('link[rel="icon"]').getAttribute('href');
    const response = await page.request.get(new URL(icon, url).href);
    const faviconHash = createHash('sha256').update(await response.body()).digest('hex');
    for (const width of [320,390,768,1440]) for (const mode of ['light','dark']) {
      const close=page.getByRole('button',{name:/닫기/}).filter({visible:true}).first();
      if(await close.count())await close.click({timeout:3000}).catch(()=>{});
      await page.setViewportSize({ width, height: 900 });
      // Exercise the shared footer palette without touching app-specific stored preferences.
      await page.locator('.ls-site-footer').evaluate((el, mode) => { el.parentElement.setAttribute('data-theme', mode); document.documentElement.classList.remove('dark-mode','dark-theme'); document.body.classList.remove('dark-mode','dark-theme'); }, mode);
      const footer = page.locator('.ls-site-footer');
      await footer.scrollIntoViewIfNeeded();
      const stats = await footer.evaluate(el => {
        const box=el.getBoundingClientRect();
        return { width:box.width, overflow:el.scrollWidth>el.clientWidth+1, background:getComputedStyle(el).backgroundColor,
          images:[...el.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0),
          services:el.querySelectorAll('[data-footer-service]').length,
          smallTargets:[...el.querySelectorAll('a,button,summary')].filter(a=>a.getClientRects().length&&a.getBoundingClientRect().height<47).length,
          textOverflow:[...el.querySelectorAll('a,button,strong,span')].filter(a=>a.getClientRects().length&&a.scrollWidth>a.clientWidth+2).map(a=>a.textContent),
        };
      });
      await footer.screenshot({path:fileURLToPath(new URL(`${app}-${width}-${mode}.png`,out)),style:'header { visibility: hidden !important; }'});
      results.push({app,viewport:width,mode,faviconHash,...stats});
      console.log(app,width,mode,JSON.stringify(stats));
    }
    await page.locator('.ls-site-footer details').evaluate(el=>el.open=true);
    if(await page.locator('.ls-site-footer [data-footer-service]').count()!==8) throw Error(`${app}: missing menu`);
    await page.close();
  }
} finally { await browser.close(); writeFileSync(new URL('qa.json',out),JSON.stringify(results,null,2)); }
console.log(JSON.stringify(results,null,2));
if(results.length!==32 || results.some(r=>r.overflow||!r.images||r.smallTargets||r.textOverflow.length)||new Set(results.map(r=>r.faviconHash)).size!==1) process.exitCode=1;
