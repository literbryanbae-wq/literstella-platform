import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = dirname(fileURLToPath(import.meta.url));
for (const name of ['ServiceDiscoveryDashboard.jsx', 'ServiceDiscoveryDashboard.css']) {
  const path = resolve(base, 'src', name);
  const source = readFileSync(path, 'utf8');
  if (source.includes('ls-service-discovery')) throw new Error('Already namespaced');
  let next = source.replaceAll('service-discovery', 'ls-service-discovery');
  if (name.endsWith('.jsx')) next = next.replace("'#ls-service-discovery'", "'#service-discovery'").replace("getElementById('ls-service-discovery')", "getElementById('service-discovery')").replace('id="ls-service-discovery"', 'id="service-discovery"');
  writeFileSync(path, next);
}
