import { chromium } from 'file:///C:/Users/sun%20luke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try {
 for(const [app,url] of [['read','http://127.0.0.1:5238/'],['class','http://127.0.0.1:5239/classes'],['challenge','http://127.0.0.1:5240/?mode=diary']]){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>sessionStorage.setItem('ls_last100_notice_session','2026-last100-v1'));
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('.ls-site-footer').waitFor({timeout:120000});
  if(app==='class'){
   await page.locator('[data-footer-action="refund"]').click();
   await page.waitForURL('**/refund');
   results.push({app,refundRoute:true});
  }else{
   for(const action of ['privacy','terms','refund']){
    await page.locator(`[data-footer-action="${action}"]`).click();
    const dialog=app==='read'?page.locator(`#${action}Modal`):page.locator('[role="dialog"]').filter({visible:true}).last();
    await dialog.waitFor({state:'visible'});
    assert.ok(await dialog.innerText());
    results.push({app,action,opened:true});
    if(app==='read')await page.keyboard.press('Escape');
    else {
     const close=dialog.getByRole('button',{name:/닫기|close/i}).first();
     if(await close.count())await close.click();else await page.keyboard.press('Escape');
    }
    await dialog.waitFor({state:'hidden'});
   }
  }
  await page.close();
 }
}finally{await browser.close();writeFileSync(new URL('../../../artifacts/shared-footer-20260911/controls.json',import.meta.url),JSON.stringify(results,null,2));}
console.log('Footer controls PASS',results);
