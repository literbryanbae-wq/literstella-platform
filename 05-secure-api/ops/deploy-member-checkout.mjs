// Content-only release: preserve every live module, binding and existing handler.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { parse } = await import(pathToFileURL(process.env.TOML_MODULE).href);
const root = pathToFileURL(resolve(process.env.CHECKOUT_RELEASE_DIR) + '/');
const config = parse(await readFile(process.env.CF_AUTH_CONFIG, 'utf8'));
const auth = config.oauth_token || config.api_token;
if (!auth) throw new Error('Cloudflare login unavailable');
const base = 'https://api.cloudflare.com/client/v4/accounts/7c0f1a62c610e750e5c523d0620a9f6c/workers/scripts/literstella-api';
const cf = (path, init = {}) => fetch(base + path, { signal: AbortSignal.timeout(60000), ...init, headers: { Authorization: `Bearer ${auth}`, ...init.headers } });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function getJson(path) {
  const response = await cf(path);
  const body = await response.text();
  if (!response.ok) throw new Error(`Cloudflare ${path}: HTTP ${response.status}`);
  try { return JSON.parse(body); }
  catch { throw new Error(`Cloudflare ${path}: invalid JSON (${body.length} bytes); no upload attempted`); }
}
async function state() {
  const s = await getJson('/settings');
  const d = await getJson('/deployments');
  if (!s.success || !d.success) throw new Error('Cloudflare state unavailable');
  const c = await cf('/content/v2');
  if (!c.ok) throw new Error(`Content unavailable: ${c.status}`);
  const main = c.headers.get('cf-entrypoint') || c.headers.get('cf-worker-main-module-part') || s.result.main_module;
  const modules = [];
  if (c.headers.get('content-type')?.includes('multipart/form-data')) {
    for (const [name, file] of await c.formData()) {
      if (typeof file === 'string' || !/^[\w./-]+$/.test(name) || name.includes('..')) throw new Error('Unsafe module');
      modules.push({ name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    }
  } else modules.push({ name: main || 'index.js', type: 'application/javascript+module', bytes: Buffer.from(await c.arrayBuffer()) });
  if (!main) throw new Error('Cannot identify live entry module; do not guess');
  return { settings: s.result, deployment: d.result.deployments[0], main, modules };
}
const manifest = s => ({ settingsHash: hash(JSON.stringify(s.settings)), deployment: s.deployment, main: s.main,
  modules: s.modules.map(m => ({ name: m.name, type: m.type, hash: hash(m.bytes) })).sort((a,b) => a.name.localeCompare(b.name)) });
const current = await state();
const entry = 'class-member-checkout-entry.mjs';
if (!process.argv.includes('--deploy') && !process.argv.includes('--deploy-pilot')) {
  await mkdir(root, { recursive: true });
  for (const m of current.modules) {
    const target = new URL('snapshot/' + m.name, root);
    await mkdir(new URL('./', target), { recursive: true });
    await writeFile(target, m.bytes);
  }
  await writeFile(new URL('manifest.json', root), JSON.stringify(manifest(current), null, 2));
  console.log(JSON.stringify({ ...manifest(current), bindings: current.settings.bindings.map(b => ({ name: b.name, type: b.type })) }));
} else if (process.argv.includes('--deploy-pilot')) {
  const saved = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  if (JSON.stringify(manifest(current)) !== JSON.stringify(saved)) throw new Error('Live changed; review a fresh snapshot');
  if (current.main !== entry || current.modules.length !== 6) throw new Error('Unexpected live entry/modules');
  if (current.settings.bindings.some(b => b.name === 'CLASS_MEMBER_CHECKOUT_ENABLED' && b.text === 'true')) throw new Error('Public sales unexpectedly open');
  const pilot = { userId: process.env.CHECKOUT_PILOT_USER_ID, amount: Number(process.env.CHECKOUT_PILOT_AMOUNT), expiresAt: process.env.CHECKOUT_PILOT_EXPIRES_AT };
  const remaining = Date.parse(pilot.expiresAt) - Date.now();
  if (!/^[a-f0-9-]{36}$/.test(pilot.userId || '') || pilot.amount !== 348000 || !(remaining > 0 && remaining <= 7200000)) throw new Error('Invalid approved pilot scope');
  const priorEntry = current.modules.find(m => m.name === entry).bytes.toString('utf8');
  const anchor = 'const checkoutEnv = { ...env,';
  if (!priorEntry.includes(anchor) || priorEntry.includes('CLASS_MEMBER_CHECKOUT_PILOT')) throw new Error('Unexpected entry contents');
  const replacements = new Map([
    [entry, Buffer.from(priorEntry.replace(anchor, `${anchor}\n    CLASS_MEMBER_CHECKOUT_PILOT: ${JSON.stringify(pilot)},`))],
    ['class-member-checkout.mjs', await readFile(new URL('../src/class-member-checkout.mjs', import.meta.url))],
  ]);
  const expected = current.modules.map(m => ({ ...m, bytes: replacements.get(m.name) || m.bytes }));
  const form = new FormData();
  form.set('metadata', JSON.stringify({ main_module: current.main }));
  for (const m of expected) form.set(m.name, new Blob([m.bytes], { type: m.type }), m.name);
  const response = await cf('/content', { method: 'PUT', body: form });
  const body = await response.text();
  let result;
  try { result = JSON.parse(body); } catch { throw new Error(`Pilot upload outcome unknown (HTTP ${response.status}); inspect live, do not retry`); }
  if (!response.ok || !result.success) throw new Error(`Pilot upload HTTP ${response.status}; inspect live before retry`);
  const after = await state();
  for (const m of expected) if (hash(after.modules.find(n => n.name === m.name)?.bytes || '') !== hash(m.bytes)) throw new Error('Module differs');
  if (JSON.stringify(after.settings.bindings) !== JSON.stringify(current.settings.bindings) || after.settings.compatibility_date !== current.settings.compatibility_date) throw new Error('Runtime/bindings changed');
  await writeFile(new URL('deployed.json', root), JSON.stringify(manifest(after), null, 2));
  await writeFile(new URL('pilot-scope.json', root), JSON.stringify(pilot, null, 2));
  console.log(JSON.stringify({ deployment: after.deployment, preservedModules: 4, bindingsUnchanged: true, publicSales: false, pilotExpiresAt: pilot.expiresAt }));
} else {
  const saved = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  if (JSON.stringify(manifest(current)) !== JSON.stringify(saved)) throw new Error('Live changed; take a new reviewed snapshot');
  if (current.main === entry) throw new Error('Already deployed; use a reviewed follow-up release');
  const entryCode = `import live from './${current.main}';
import { classMemberCheckoutRoute } from './class-member-checkout-route.mjs';
export * from './${current.main}';
export default { ...live, async fetch(req,env,ctx) {
  const checkoutEnv = { ...env,
    CLASS_MEMBER_CHECKOUT_ENABLED: env.CLASS_MEMBER_CHECKOUT_ENABLED ?? 'false',
    CLASS_MEMBER_CHECKOUT_TERMS_URL: env.CLASS_MEMBER_CHECKOUT_TERMS_URL ?? 'https://challenge.literstella.co.kr/course-terms#article-5',
    CLASS_MEMBER_CHECKOUT_TERMS_VERSION: env.CLASS_MEMBER_CHECKOUT_TERMS_VERSION ?? 'course-terms-2026-10-01' };
  return (await classMemberCheckoutRoute(req,checkoutEnv)) ?? live.fetch(req,env,ctx);
}};\n`;
  const additions = [{ name: entry, bytes: Buffer.from(entryCode), type: 'application/javascript+module' }];
  for (const name of ['class-member-checkout.mjs','class-member-checkout-route.mjs']) {
    if (current.modules.some(m => m.name === name)) throw new Error('Existing module collision');
    additions.push({ name, bytes: await readFile(new URL('../src/' + name, import.meta.url)), type: 'application/javascript+module' });
  }
  const form = new FormData();
  form.set('metadata', JSON.stringify({ main_module: entry }));
  for (const m of [...current.modules, ...additions]) form.set(m.name, new Blob([m.bytes], { type: m.type }), m.name);
  const r = await cf('/content', { method: 'PUT', body: form });
  const responseBody = await r.text();
  let result;
  try { result = JSON.parse(responseBody); }
  catch { throw new Error(`Upload outcome unknown (HTTP ${r.status}); inspect live before retrying`); }
  if (!r.ok || !result.success) throw new Error(`Upload failed: ${r.status}`);
  const after = await state();
  for (const m of [...current.modules, ...additions]) {
    if (hash(after.modules.find(n => n.name === m.name)?.bytes || '') !== hash(m.bytes)) throw new Error('Module differs');
  }
  if (JSON.stringify(after.settings.bindings) !== JSON.stringify(current.settings.bindings) ||
      after.settings.compatibility_date !== current.settings.compatibility_date) throw new Error('Runtime/bindings changed');
  await writeFile(new URL('deployed.json', root), JSON.stringify(manifest(after), null, 2));
  await writeFile(new URL(entry, root), entryCode);
  console.log(JSON.stringify({ deployed: after.deployment, oldModulesUnchanged: true, bindingsUnchanged: true, defaultNewOrdersEnabled: false }));
}
