// One-time mechanical adapter migration; never run against a different layout without review.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = dirname(fileURLToPath(import.meta.url));
const targets = JSON.parse(readFileSync(resolve(base, 'targets.json'), 'utf8'));
for (const [name, relative] of Object.entries(targets)) {
  const selected = process.argv.find(arg => arg.startsWith('--target='))?.slice(9);
  if (selected && name !== selected) continue;
  const root = resolve(base, relative);
  if (name !== 'diagnosis') {
    writeFileSync(resolve(root, 'src/components/ServiceDiscoveryDashboard.jsx'), `import SharedCards from '../core/service-discovery/ServiceDiscoveryDashboard';\nimport { supabase } from '../lib/supabase';\nexport default function ServiceDiscoveryDashboard() {\n  return <SharedCards client={supabase} onTimer={() => window.dispatchEvent(new CustomEvent('open-reading-timer'))} />;\n}\n`);
    writeFileSync(resolve(root, 'src/components/ServiceDiscoveryDashboard.css'), '/* Styles are owned by packages/service-discovery; see src/core/service-discovery. */\n');
  } else {
    const file = resolve(root, 'app.js');
    let source = readFileSync(file, 'utf8');
    const start = source.indexOf('const SERVICE_DISCOVERY_ITEMS = [');
    const end = source.indexOf('function openSatisfactionAll(', start);
    if (start < 0 || end < 0) throw new Error('Diagnosis migration boundaries missing');
    source = `import { mountServiceCards } from './src/serviceCardsMount.jsx';\n` + source.slice(0, start) + `function initServiceDiscovery() {\n  const host = document.getElementById('serviceDiscovery');\n  if (host) mountServiceCards(host, supabase);\n}\n\n` + source.slice(end);
    writeFileSync(file, source);
    writeFileSync(resolve(root, 'src/serviceCardsMount.jsx'), `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport SharedCards from './core/service-discovery/ServiceDiscoveryDashboard';\nconst roots = new WeakMap();\nexport function mountServiceCards(host, client) {\n  host.className = '';\n  host.removeAttribute('aria-labelledby');\n  let root = roots.get(host);\n  if (!root) { root = createRoot(host); roots.set(host, root); }\n  root.render(<SharedCards client={client} />);\n}\n`);
  }
  const file = resolve(root, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const guard = 'node scripts/verify-service-discovery.mjs';
  if (!(pkg.scripts.prebuild || '').includes(guard)) pkg.scripts.prebuild = guard + (pkg.scripts.prebuild ? ` && ${pkg.scripts.prebuild}` : '');
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
