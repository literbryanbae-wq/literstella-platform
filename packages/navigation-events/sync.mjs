import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { EVENTS } from './src/catalog.mjs';
const base = dirname(fileURLToPath(import.meta.url));
if (!process.argv[2]) throw Error('Expected app root');
const target = resolve(process.argv[2]);
const hashes = {};
mkdirSync(resolve(target,'scripts'),{recursive:true});
copyFileSync(resolve(base,'verify.mjs'),resolve(target,'scripts/navigation-events-verify.mjs'));
for (const name of ['catalog.mjs','NavigationHub.jsx','navigation.css']) {
  const file = `src/core/navigation-events/${name}`;
  mkdirSync(dirname(resolve(target,file)),{recursive:true});
  const bytes = readFileSync(resolve(base,'src',name));
  writeFileSync(resolve(target,file),bytes);
  hashes[file] = createHash('sha256').update(bytes.toString().replace(/\r\n/g,'\n')).digest('hex');
}
for (const event of EVENTS) {
  const file = `public/navigation-events/${event.art}-day.webp`;
  mkdirSync(dirname(resolve(target,file)),{recursive:true});
  copyFileSync(resolve(base,'../service-discovery/assets',`${event.art}-day.webp`),resolve(target,file));
  hashes[file] = createHash('sha256').update(readFileSync(resolve(target,file))).digest('hex');
}
const logo = 'public/navigation-events/logo-literstella-en.png';
copyFileSync(resolve(base,'assets/logo-literstella-en.png'),resolve(target,logo));
hashes[logo] = createHash('sha256').update(readFileSync(resolve(target,logo))).digest('hex');
writeFileSync(resolve(target,'src/core/navigation-events/manifest.json'),JSON.stringify(hashes,null,2)+'\n');
console.log(`Navigation/events synced: ${target}`);
