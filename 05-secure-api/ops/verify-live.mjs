// 라이브 literstella-api 가 이 소스와 같은지 읽기만 해서 대조한다(2026-10-17). 배포·쓰기 없음.
//
//   ① 코드: 라이브 모듈 이름·바이트(content/v2) = dist/live/ (먼저 node ops/build-live.mjs)
//   ② 진입: 응답 헤더 Cf-Entrypoint = wrangler.jsonc main 의 파일 이름 · Cf-Handlers 에 fetch·scheduled
//   ③ 설정: compatibility_date·flags · plain 변수 이름·값 · secret 이름 목록 · 서비스/KV/ratelimit 바인딩 · 크론
//   🔑 바이트 비교만으로는 진입 모듈 차이를 못 잡는다(2026-10-17 사고) — 그래서 ②를 따로 본다.
//   배포 전에 돌려 '라이브가 이 소스보다 앞서 있지 않다'를, 배포 뒤에 돌려 '올린 것이 이것이다'를 확인한다.
//
//   사용: node ops/verify-live.mjs            (토큰 = CLOUDFLARE_API_TOKEN 또는 wrangler 로그인 파일)
//         종료코드 0 = 전부 같음 · 1 = 다름(목록 출력) · 2 = 조회 실패
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from './build-live.mjs';

const ACCOUNT = '7c0f1a62c610e750e5c523d0620a9f6c';
const root = fileURLToPath(new URL('..', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');

// secret 은 값이 아니라 이름만 맞춘다(값은 저장소 밖). wrangler.jsonc 주석 목록과 같이 움직인다.
export const EXPECTED_SECRETS = Object.freeze([
  'ADMIN_SECRET', 'ETRI_API_KEY', 'OTP_SECRET', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET',
  'SPEECHSUPER_APP_KEY', 'SPEECHSUPER_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TOSS_CLASS_SECRET_KEY', 'TOSS_SECRET_KEY',
]);

async function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const paths = [join(homedir(), '.wrangler/config/default.toml'),
    join(process.env.APPDATA || '', 'xdg.config/.wrangler/config/default.toml')];
  for (const p of paths) {
    const text = await readFile(p, 'utf8').catch(() => '');
    const m = text.match(/^oauth_token\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  }
  throw new Error('Cloudflare 토큰 없음 — `npx wrangler login` 또는 CLOUDFLARE_API_TOKEN');
}

async function main() {
  const auth = await token();
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/literstella-api`;
  const cf = (path) => fetch(base + path, { headers: { Authorization: `Bearer ${auth}` }, signal: AbortSignal.timeout(60000) });
  const json = async (path) => {
    const r = await cf(path);
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}${r.status === 401 ? ' (토큰 만료 — `npx wrangler whoami` 로 갱신)' : ''}`);
    const j = await r.json();
    if (!j.success) throw new Error(`${path}: success=false`);
    return j.result;
  };

  const cfg = parseJsonc(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
  const problems = [];
  const same = (label, a, b) => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    console.log(`${ok ? 'same' : 'DIFF'}  ${label}${ok ? '' : `\n      라이브: ${JSON.stringify(a)}\n      소스  : ${JSON.stringify(b)}`}`);
    if (!ok) problems.push(label);
  };

  // ① 코드 ② 진입
  const c = await cf('/content/v2');
  if (!c.ok) throw new Error(`/content/v2: HTTP ${c.status}`);
  const live = new Map();
  for (const [name, file] of await c.formData()) live.set(name, Buffer.from(await file.arrayBuffer()));
  const distDir = join(root, 'dist/live');
  const built = new Map();
  for (const name of await readdir(distDir).catch(() => [])) built.set(name, await readFile(join(distDir, name)));
  if (!built.size) throw new Error('dist/live 가 비었다 — 먼저 node ops/build-live.mjs');
  same('모듈 이름', [...live.keys()].sort(), [...built.keys()].sort());
  for (const name of [...new Set([...live.keys(), ...built.keys()])].sort()) {
    const a = live.get(name), b = built.get(name);
    same(`모듈 ${name}`, a ? sha(a) : null, b ? sha(b) : null);
  }
  same('진입 모듈(Cf-Entrypoint)', c.headers.get('cf-entrypoint'), basename(cfg.main));
  const handlers = (c.headers.get('cf-handlers') || '').split(',').map((s) => s.trim()).filter(Boolean).sort();
  same('핸들러(Cf-Handlers)', handlers, ['fetch', 'scheduled']);

  // ③ 설정
  const s = await json('/settings');
  same('compatibility_date', s.compatibility_date, cfg.compatibility_date);
  same('compatibility_flags', [...(s.compatibility_flags || [])].sort(), [...(cfg.compatibility_flags || [])].sort());
  const b = s.bindings || [];
  const plain = Object.fromEntries(b.filter((x) => x.type === 'plain_text').map((x) => [x.name, x.text]).sort());
  same('plain 변수(이름·값)', plain, Object.fromEntries(Object.entries(cfg.vars || {}).sort()));
  same('secret 이름', b.filter((x) => x.type === 'secret_text').map((x) => x.name).sort(), [...EXPECTED_SECRETS].sort());
  same('서비스 바인딩', b.filter((x) => x.type === 'service').map((x) => ({ binding: x.name, service: x.service, entrypoint: x.entrypoint || null }))
    .sort((x, y) => x.binding.localeCompare(y.binding)),
  (cfg.services || []).map((x) => ({ binding: x.binding, service: x.service, entrypoint: x.entrypoint || null }))
    .sort((x, y) => x.binding.localeCompare(y.binding)));
  same('KV', b.filter((x) => x.type === 'kv_namespace').map((x) => ({ binding: x.name, id: x.namespace_id })),
    (cfg.kv_namespaces || []).map((x) => ({ binding: x.binding, id: x.id })));
  same('ratelimit', b.filter((x) => x.type === 'ratelimit').map((x) => ({ name: x.name, namespace_id: x.namespace_id, simple: x.simple })),
    (cfg.ratelimits || []).map((x) => ({ name: x.name, namespace_id: x.namespace_id, simple: x.simple })));
  const known = new Set(['plain_text', 'secret_text', 'service', 'kv_namespace', 'ratelimit']);
  same('그 밖의 바인딩', b.filter((x) => !known.has(x.type)).map((x) => `${x.type}:${x.name}`), []);
  same('바인딩 수', b.length, Object.keys(cfg.vars || {}).length + EXPECTED_SECRETS.length
    + (cfg.services || []).length + (cfg.kv_namespaces || []).length + (cfg.ratelimits || []).length);
  const sch = await json('/schedules');
  same('크론', sch.schedules.map((x) => x.cron).sort(), [...(cfg.triggers?.crons || [])].sort());

  console.log(problems.length ? `\nDIFF ${problems.length}건: ${problems.join(' · ')}` : '\nALL SAME — 라이브 = 이 소스');
  // process.exit 는 열린 fetch 핸들 위에서 Windows libuv 단언으로 죽었다 — exitCode 로 끝낸다.
  process.exitCode = problems.length ? 1 : 0;
}

main().catch((e) => { console.error(`조회 실패: ${e?.message || e}`); process.exitCode = 2; });
