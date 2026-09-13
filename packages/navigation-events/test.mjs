import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVENTS, NETWORK, eventEnded, eventRoute, eventPath, safeReturn, dayKey, eventOrigin, savedEventContext } from './src/catalog.mjs';
test('shared controls retain a 48px touch target',()=>{
  const css=readFileSync(new URL('./src/navigation.css',import.meta.url),'utf8');
  for(const selector of ['.lsne-buttons button','.lsne-row','.lsne-brand','.lsne-back','.lsne-filters button','.lsne-help a','.lsne-text-link']){
    const rule=css.slice(css.indexOf(selector+'{')).split('}')[0];
    assert.ok(rule.includes('min-height:48px'),selector);
  }
  assert.match(css,/\.lsne-close\{width:48px;height:48px/);
});
test('exactly four distinct events with conservative public details',()=>{
  assert.equal(EVENTS.length,4); assert.equal(new Set(EVENTS.map(e=>e.id)).size,4);
  EVENTS.forEach(e=>{assert.ok(e.facts.length);assert.ok(e.notice);assert.ok(e.art);assert.ok(e.timer||new URL(e.href).protocol==='https:');});
});
test('Korean text keeps words together in pages, menus and campaign tiles with an overflow fallback',()=>{
  const css = readFileSync(new URL('./src/navigation.css', import.meta.url), 'utf8');
  assert.match(css,/\.lsne-layer,\.lsne-highlights\{word-break:keep-all;overflow-wrap:anywhere\}/);
});
test('Korean day boundary and deadlines',()=>{
  assert.equal(dayKey(new Date('2026-09-23T15:00:00Z')),'2026-09-24');
  assert.equal(eventEnded(EVENTS[0],new Date('2026-09-23T14:59:59Z')),false);
  assert.equal(eventEnded(EVENTS[0],new Date('2026-09-23T15:00:00Z')),true);
  assert.equal(eventEnded(EVENTS[3],new Date('2030-01-01')),false);
});
test('deep link routing rejects malformed and unknown paths gracefully',()=>{
  assert.deepEqual(eventRoute('/events'),{id:''});assert.deepEqual(eventRoute('/events/timer'),{id:'timer'});
  assert.equal(eventRoute('/classes'),null);assert.deepEqual(eventRoute('/events/%'),{id:'__missing'});
  assert.deepEqual(eventRoute('/events/timer/more'),{id:'__missing'});assert.equal(eventPath('a/b'),'/events/a%2Fb');
});
test('return navigation remains in the current app',()=>{
  for(const value of ['//evil.com','/\\evil.com','https://evil.com','/events','/events/timer','/\r\nwrong'])assert.equal(safeReturn(value,'/classes'),'/classes');
  assert.equal(safeReturn('/?mode=diary#diary-room'), '/?mode=diary#diary-room');
});
test('shared services preserve key destinations, exclude held goods',()=>{
  assert.equal(NETWORK.at(-1)[0],'global');assert.ok(NETWORK.some(i=>i[0]==='timer'));assert.ok(!NETWORK.some(i=>i[0]==='goods'));
  NETWORK.filter(i=>i[2]).forEach(i=>assert.equal(new URL(i[2]).protocol,'https:'));
});
test('event return context survives either router history shape without carrying credentials',()=>{
  const path = eventOrigin('/?mode=diary&bridge=secret&access_token=secret#diary-room','diary');
  assert.equal(path,'/?mode=diary#diary-room');
  const state={lsneReturn:path,lsneApp:'diary'};
  assert.deepEqual(savedEventContext(state),{path,app:'diary'});
  assert.deepEqual(savedEventContext({usr:state}),{path,app:'diary'});
  assert.deepEqual(savedEventContext({lsneApp:'admin',lsneReturn:'//outside.test'}),{path:'',app:null});
  assert.equal(eventOrigin('/?mode=diary','challenge'),'/');
});
