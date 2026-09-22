import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(process.argv[2] || process.cwd());
const manifest = JSON.parse(readFileSync(resolve(root, 'src/core/navigation-events/manifest.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest)) {
  const bytes = readFileSync(resolve(root, name));
  const content = /\.(webp|png)$/.test(name) ? bytes : bytes.toString().replace(/\r\n/g, '\n');
  if (createHash('sha256').update(content).digest('hex') !== expected) throw Error(`Generated navigation file changed: ${name}. Edit packages/navigation-events and sync.`);
}
console.log(`Navigation/events: ${Object.keys(manifest).length} generated files verified`);
