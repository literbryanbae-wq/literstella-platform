import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Product sources remain shared with the Class checkout; only verified build
// output is copied here. No .env, credentials, source files or paid assets.
const platform = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] && resolve(process.argv[2]);
if (!source || !existsSync(resolve(source, 'scripts/english-learning-platform-build.mjs'))) {
  throw new Error('Usage: node scripts/prepare-release.mjs <reviewed-growth-source-checkout>');
}
execFileSync(process.execPath, ['scripts/english-learning-platform-build.mjs'], { cwd: source, stdio: 'inherit' });
const output = resolve(source, 'dist-english-learning-platform');
const manifest = JSON.parse(readFileSync(resolve(output, 'english-platform-manifest.json'), 'utf8'));
if (manifest.domain !== 'english.literstella.co.kr' || manifest.application !== 'connected-server-authority' || manifest.learningData !== 'synthetic-demo') {
  throw new Error('Unexpected release manifest');
}
cpSync(output, resolve(platform, 'dist-english-learning-platform'), { recursive: true });
console.log('Verified English release assets prepared. Deploy this directory with wrangler.jsonc.');
