import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const base = dirname(fileURLToPath(import.meta.url));
const targets = JSON.parse(readFileSync(resolve(base, 'targets.json'), 'utf8'));
const check = process.argv.includes('--check');
const selected = process.argv.find(arg => arg.startsWith('--target='))?.slice(9)?.split(',');
const explicitRoot = process.argv.find(arg => arg.startsWith('--root='))?.slice(7);
if (explicitRoot && selected) throw new Error('Choose --root or --target');
const existingOnly = process.argv.includes('--existing');
if (selected?.some(name => !targets[name])) throw new Error('Unknown service discovery target');
const generated = new Map();
for (const name of readdirSync(resolve(base, 'src'))) {
  const source = readFileSync(resolve(base, 'src', name), 'utf8').replace(/\r\n/g, '\n');
  generated.set(`src/core/service-discovery/${name}`, Buffer.from(`/* GENERATED from packages/service-discovery. DO NOT EDIT. */\n${source}`));
}
for (const name of readdirSync(resolve(base, 'assets'))) generated.set(`public/themes/ttaki-gnyang/scenes/${name}`, readFileSync(resolve(base, 'assets', name)));
generated.set('scripts/verify-service-discovery.mjs', Buffer.from(readFileSync(resolve(base, 'verify.mjs'), 'utf8').replace(/\r\n/g, '\n')));
const hashes = Object.fromEntries([...generated].map(([path, data]) => [path, createHash('sha256').update(data).digest('hex')]));
generated.set('src/core/service-discovery/manifest.json', Buffer.from(JSON.stringify({ version: 1, files: hashes }, null, 2) + '\n'));
let failures = 0;
for (const [name, relative] of Object.entries(explicitRoot ? { release: explicitRoot } : targets)) {
  if (selected && !selected.includes(name)) continue;
  const root = resolve(base, relative);
  if (!existsSync(resolve(root, 'package.json'))) throw new Error(`Missing target: ${root}`);
  const manifestPath = 'src/core/service-discovery/manifest.json';
  const prior = existingOnly ? JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8')) : null;
  if (prior) for (const path of Object.keys(prior.files)) if (!generated.has(path)) throw new Error(`Unknown canonical entry: ${path}`);
  const files = prior ? new Map([...generated].filter(([path]) => Object.hasOwn(prior.files, path))) : new Map(generated);
  if (prior) files.set(manifestPath, Buffer.from(JSON.stringify({version: 1, files: Object.fromEntries([...files].map(([path,data]) => [path,createHash('sha256').update(data).digest('hex')]))}, null, 2) + '\n'));
  for (const [path, data] of files) {
    const output = resolve(root, path);
    if (check) {
      if (!existsSync(output) || !readFileSync(output).equals(data)) { console.error(`${name}: stale ${path}`); failures++; }
    } else { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, data); }
  }
  console.log(`${name}: ${check ? 'checked' : 'synced'} ${files.size} files`);
}
if (failures) process.exitCode = 1;
