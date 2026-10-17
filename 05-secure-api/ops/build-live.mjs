// 라이브 literstella-api 와 같은 모양의 배포물을 만든다(2026-10-17).
//
//   라이브는 모듈 9개다: 진입 class-checkout-email-entry.mjs → class-member-checkout-entry.mjs
//   → class-payment-probe-entry.mjs → index.js(src/index.js 와 그 import 를 묶은 한 파일) + 결제 모듈 5개.
//   10-12·10-13 결제 배포가 라이브 번들 위에 모듈을 '코드만' 얹는 방식으로 나가서 이 모양이 됐다.
//   이 스크립트가 그 모양을 소스에서 다시 만든다 → dist/live/ (wrangler.jsonc 의 build 명령이 부른다).
//
//   단계: ① 두 설정의 compatibility 가 같은지 ② wrangler.bundle.jsonc 로 src/index.js 를 묶어 dist/bundle/index.js
//   ③ dist/live/ 에 묶은 index.js + src 의 결제 모듈 8개(줄바꿈만 LF 로)를 둔다 ④ 모듈별 SHA256 을 dist/build-manifest.json 에.
//   🔴 wrangler 버전을 고정한다 — 묶는 결과(esbuild)가 버전마다 조금씩 다를 수 있다. 4.151.1 로 묶은 결과가
//      라이브 aaa8d594 의 index.js 와 섹션 24개 전부 바이트 같았다(2026-10-17 실측).
//   배포·네트워크 쓰기 없음(dry-run 만). 사용: node ops/build-live.mjs
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

export const WRANGLER_VERSION = '4.151.1';
export const ENTRY = 'class-checkout-email-entry.mjs';
// dist/live 에 src 에서 그대로 복사하는 모듈(묶지 않는다). 라이브 모듈 이름과 같다.
export const PASSTHROUGH_MODULES = Object.freeze([
  'class-checkout-email-entry.mjs',
  'class-checkout-email.mjs',
  'class-member-checkout-entry.mjs',
  'class-member-checkout-route.mjs',
  'class-member-checkout.mjs',
  'class-course-checkout.mjs',
  'class-payment-probe-entry.mjs',
  'class-payment-probe.mjs',
]);

const root = fileURLToPath(new URL('..', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// JSONC → JSON: 문자열 밖의 // · /* */ 주석과 끝 쉼표만 지운다(문자열 안 URL 의 // 는 그대로).
export function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      if (i === 0) throw new Error('unterminated block comment');
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

async function main() {
  const deployCfg = parseJsonc(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
  const bundleCfg = parseJsonc(await readFile(join(root, 'wrangler.bundle.jsonc'), 'utf8'));
  if (deployCfg.compatibility_date !== bundleCfg.compatibility_date
    || JSON.stringify(deployCfg.compatibility_flags) !== JSON.stringify(bundleCfg.compatibility_flags)) {
    throw new Error('wrangler.jsonc 와 wrangler.bundle.jsonc 의 compatibility 가 다르다 — 둘을 같이 고칠 것');
  }

  await rm(join(root, 'dist'), { recursive: true, force: true });
  // npx 를 node 로 직접 띄운다 — Windows 에서 shell(cmd) 경유 spawn 은 출력 없이 0xC0000409 로 죽었다(2026-10-17 실측).
  const npxCli = [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npx-cli.js')].find((p) => existsSync(p));
  if (!npxCli) throw new Error('npx-cli.js 를 찾지 못했다 — node 설치 옆 npm 이 필요하다');
  const run = spawnSync(process.execPath, [npxCli, '-y', `wrangler@${WRANGLER_VERSION}`, 'deploy', '--dry-run',
    '--outdir', 'dist/bundle', '-c', 'wrangler.bundle.jsonc'], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`묶기 실패 (wrangler 종료코드 ${run.status ?? run.error?.message})`);

  await mkdir(join(root, 'dist/live'), { recursive: true });
  const modules = [];
  const bundle = await readFile(join(root, 'dist/bundle/index.js'));
  await writeFile(join(root, 'dist/live/index.js'), bundle);
  modules.push({ name: 'index.js', from: 'dist/bundle/index.js', sha256: sha(bundle), bytes: bundle.length });
  for (const name of PASSTHROUGH_MODULES) {
    // 라이브 바이트는 LF 다. Windows checkout(core.autocrlf)이 CRLF 로 바꿔도 같은 바이트가 나오게 LF 로 맞춘다.
    const src = await readFile(join(root, 'src', name), 'utf8');
    await writeFile(join(root, 'dist/live', name), src.replace(/\r\n/g, '\n'));
    const bytes = await readFile(join(root, 'dist/live', name));
    modules.push({ name, from: `src/${name}`, sha256: sha(bytes), bytes: bytes.length });
  }
  modules.sort((a, b) => a.name.localeCompare(b.name));
  const manifest = { builtAt: new Date().toISOString(), wrangler: WRANGLER_VERSION, entry: ENTRY, modules };
  await writeFile(join(root, 'dist/build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const m of modules) console.log(`${m.name.padEnd(34)} ${m.sha256.slice(0, 12)} ${m.bytes}B  ← ${m.from}`);
  console.log(`진입 ${ENTRY} · 모듈 ${modules.length}개 → dist/live/`);
}

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
}
