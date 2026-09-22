import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(process.argv[2]);
const require = createRequire(resolve(root, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const server = await createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { ServiceMenuCards, menuServices } = await server.ssrLoadModule('/src/core/service-discovery/ServiceDiscoveryDashboard.jsx');
  const own = {read:'diagnosis',class:'lecture',challenge:'challenge',diary:'diary',english:'english-learning'};
  for (const [app, key] of Object.entries(own)) {
    const cards = menuServices(app);
    assert.equal(cards.length, 12, app);
    assert.equal(new Set(cards.map(card => card.key)).size, 12);
    assert.ok(!cards.some(card => card.key === key || card.key === 'goods'));
    assert.equal(cards.at(-1).key, 'global');
    const html = renderToStaticMarkup(React.createElement(ServiceMenuCards, {app}));
    assert.equal((html.match(/data-service=/g) || []).length, 12);
    assert.equal((html.match(/<svg /g) || []).length, 12);
    assert.equal((html.match(/stroke-width="1.75"/g) || []).length, 12);
    assert.equal((html.match(/class="ls-service-menu__label"/g) || []).length, 12);
    assert.ok(!html.includes('<img') && !html.includes('.webp') && !html.includes('--ttg-scene'));
    assert.ok(!html.includes('ls-service-discovery__card'));
    assert.ok(!html.includes('평가 불러오는 중'));
    assert.ok(html.includes('타이머 선택'));
    assert.ok(html.includes('https://global.literstella.com/'));
  }
  assert.throws(() => menuServices('invalid'));
  const {openMenu,openServiceMenu,openEvents,NavigationButtons} = await server.ssrLoadModule('/src/core/navigation-events/NavigationHub.jsx');
  const buttons = renderToStaticMarkup(React.createElement(NavigationButtons));
  const eventOnly = renderToStaticMarkup(React.createElement(NavigationButtons,{compact:true,eventsOnly:true}));
  assert.equal((buttons.match(/<button /g)||[]).length,2);
  assert.equal((eventOnly.match(/<button /g)||[]).length,1);
  for(const html of [buttons,eventOnly]) {
    assert.equal((html.match(/aria-label="이벤트 전체보기"/g)||[]).length,1);
    assert.match(html,/lucide-gift/); assert.match(html,/<span>이벤트<\/span>/);
    assert.match(html,/<i aria-hidden="true"/);
  }
  assert.ok(!eventOnly.includes('앱 메뉴 열기'));
  const prior = globalThis.window;
  const received = [];
  globalThis.window = {dispatchEvent: event => received.push(event.type)};
  try { openMenu(); openServiceMenu(); openEvents(); } finally { globalThis.window = prior; }
  assert.deepEqual(received, ['ls:menu','ls:services','ls:events']);
  const source = readFileSync(resolve(root,'src/core/navigation-events/NavigationHub.jsx'),'utf8');
  assert.ok(!source.includes('NETWORK.map'));
  assert.ok(source.includes("services:'전체 메뉴'"));
  assert.ok(source.includes('modal === \'services\' ? <ServiceMenuCards app={app}'));
  assert.ok(source.includes('onClick={openMenu} aria-label="앱 메뉴 열기"'));
  const dashboard = readFileSync(resolve(root,'src/core/service-discovery/ServiceDiscoveryDashboard.jsx'),'utf8');
  assert.ok(dashboard.includes('cards.map(card => <ServiceCard'));
  const menu = dashboard.slice(dashboard.indexOf('export function ServiceMenuCards'),dashboard.indexOf('function normalizeStats'));
  assert.ok(menu.includes('<ServiceCard'));
  assert.ok(!menu.includes('client.rpc') && !menu.includes('useEffect'));
  const css = readFileSync(resolve(root,'src/core/service-discovery/ServiceDiscoveryDashboard.css'),'utf8');
  assert.ok(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'));
  assert.ok(css.includes('.ls-service-menu__icon svg { width: 26px; height: 26px; stroke-width: 1.75; }'));
  console.log('PASS: 5 hosts x 12 SVG/text items, unified icons, no menu images, current host/goods excluded, global last, separate triggers');
} finally { await server.close(); }
