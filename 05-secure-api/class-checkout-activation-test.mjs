import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./src/class-member-checkout-entry.mjs', import.meta.url), 'utf8');
const stub = `const live = { fetch: async () => new Response('legacy'), scheduled: () => 'preserved' };
const classMemberCheckoutRoute = async (req, env) => { globalThis.checkoutBindings = env; return null; };`;
const body = source.replace(/^import .*;\r?\n/gm, '').replace(/^export \* .*;\r?\n/gm, '');
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(stub + body).toString('base64'));
const request = new Request('https://api.test/api/class-checkout/quote');
assert.equal(await (await worker.fetch(request, { OTHER_BINDING: 'kept' }, {})).text(), 'legacy');
assert.equal(globalThis.checkoutBindings.CLASS_MEMBER_CHECKOUT_ENABLED, 'true');
assert.equal(globalThis.checkoutBindings.CLASS_COURSE_CHECKOUT_ENABLED, 'true');
assert.equal(globalThis.checkoutBindings.OTHER_BINDING, 'kept');
assert.equal(globalThis.checkoutBindings.CLASS_MEMBER_CHECKOUT_PILOT, undefined);
assert.equal(worker.scheduled(), 'preserved');
for (const name of ['CLASS_MEMBER_CHECKOUT_ENABLED', 'CLASS_COURSE_CHECKOUT_ENABLED']) {
  await worker.fetch(request, { [name]: 'false' }, {});
  assert.equal(globalThis.checkoutBindings[name], 'false');
}
console.log('Checkout activation: approved defaults, emergency shutoffs, bindings and legacy handler PASS');
