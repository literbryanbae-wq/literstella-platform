// sync-core.mjs — 정본(packages/core/{data,tokens,glue})을 각 앱 src/core 로 단방향 복사.
// 🟡 초안. 아직 어느 빌드에도 연결 안 됨(라이브 무영향). 7/1 오픈 후 챌린지 prebuild에 배선 예정.
//
// 모델: 3개 앱이 별도 git 레포 → 빌드 때 루트 폴더 안 보임 → 빌드 직전 각 레포 src/core 로 '복사'가 유일 안전책.
// 복사본 맨 위에 자동생성 헤더를 박아 '여기 고치지 말 것'을 강제. 실패 시 비-0 종료 → 빌드 실패 → 옛 버전 유지(fail-safe).
//
// 사용(배선 후): 각 앱 package.json 에 "prebuild": "node ../../packages/core/scripts/sync-core.mjs <app>" 형태.
// 지금은 수동 테스트만: node packages/core/scripts/sync-core.mjs --dry-run

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = resolve(HERE, '..');                 // packages/core
const DEV_ROOT = resolve(CORE_ROOT, '..', '..');       // LiterStella-DEV

// 복사 대상: 정본 하위 폴더(현재 data 만 실재. tokens/glue 는 생기면 추가).
const SUBDIRS = ['data', 'tokens', 'glue'];

// 앱별 목적지(각 앱 레포 안). 배선은 오픈 후 — 지금은 경로만 정의.
const APPS = {
  diagnosis: join(DEV_ROOT, '01-reading-diagnosis', 'literstella-reading-diagnosis', 'src', 'core'),
  challenge: join(DEV_ROOT, '02-challenge', 'literstella-challenge', 'src', 'core'),
};

const HEADER = (rel) =>
  `/* 🛑 AUTO-GENERATED — DO NOT EDIT.\n` +
  `   원본: packages/core/${rel}\n` +
  `   이 파일은 sync-core.mjs가 빌드 전에 덮어씁니다. 수정은 packages/core 에서만. */\n`;

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; } // 폴더 없으면 스킵(tokens/glue 미생성)
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function syncApp(appKey, dryRun) {
  const dest = APPS[appKey];
  let count = 0;
  for (const sub of SUBDIRS) {
    const srcDir = join(CORE_ROOT, sub);
    for await (const file of walk(srcDir)) {
      const rel = relative(CORE_ROOT, file).split('\\').join('/');
      const target = join(dest, relative(CORE_ROOT, file));
      const raw = await readFile(file, 'utf8');
      const isText = /\.(mjs|js|ts|css|json)$/.test(file);
      const out = isText ? HEADER(rel) + raw : raw;
      if (dryRun) { console.log(`  [dry] ${appKey} <- core/${rel}`); count++; continue; }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, out, 'utf8');
      count++;
    }
  }
  return count;
}

const dryRun = process.argv.includes('--dry-run');
const only = process.argv.find(a => a === 'diagnosis' || a === 'challenge');
const targets = only ? [only] : Object.keys(APPS);

let total = 0;
for (const app of targets) {
  const n = await syncApp(app, dryRun);
  total += n;
  console.log(`sync-core: ${app} ${dryRun ? '(dry)' : 'copied'} ${n} files`);
}
if (total === 0) {
  console.error('sync-core: 복사한 파일 0 — 경로/정본 확인 필요');
  process.exit(1); // 빌드 배선 시 실패로 잡혀 옛 버전 유지(fail-safe)
}
console.log(`sync-core: done (${total} files${dryRun ? ', dry-run' : ''}).`);
