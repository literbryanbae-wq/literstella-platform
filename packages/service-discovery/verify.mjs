import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, 'src/core/service-discovery/manifest.json'), 'utf8'));
for (const [file, expected] of Object.entries(manifest.files)) {
  const bytes = readFileSync(resolve(root, file));
  const canonical = /\.(jsx|css|mjs)$/.test(file) ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes;
  const actual = createHash('sha256').update(canonical).digest('hex');
  if (actual !== expected) throw new Error(`Shared service cards modified: ${file}. Edit packages/service-discovery and run sync.mjs.`);
}
console.log(`Shared service cards verified: ${Object.keys(manifest.files).length} files`);
