import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrationOfferSendingHours, processMigrationOfferEmails, renderMigrationOffer } from './src/class-migration-offer-email.mjs';
const now = new Date('2026-10-19T10:05:00Z');
const env = { CLASS_MIGRATION_OFFER_ENABLED: 'true', OTP_SECRET: 'offline-fixture' };
function fixture(options = {}) {
  const job = { id: 'offline-job', email: 'member@example.test', lease_token: 'lease-1', status: 'pending', envelope: null };
  const sent = [], writes = [], paths = [];
  const deps = {
    key: 'offline-key', from: 'Fixture <test@example.test>', wrapHtml: s => `<html>${s}</html>`,
    unsubscribeFor: async () => 'https://api.example.test/api/unsub?t=fixture.marketing.signature',
    headersFor: async () => ({ 'List-Unsubscribe': '<https://api.example.test/api/unsub?t=fixture.marketing.signature>' }),
    db: async (path, init = {}) => {
      paths.push(path);
      if (path === 'rpc/class_migration_offer_claim') {
        if (job.status !== 'pending' || job.waiting) return null;
        job.status = 'processing'; return { ...job };
      }
      if (path.startsWith('class_migration_offer_outbox?')) {
        const patch = JSON.parse(init.body); writes.push(patch);
        if (options.leaseLost && patch.envelope) return [];
        Object.assign(job, patch);
        if (patch.next_attempt_at) job.waiting = true;
        return [{ ...job }];
      }
      if (options.dbFail && path.startsWith('users?')) throw Error('offline-db-fail');
      if (path.startsWith('users?')) return [{ marketing_consent: options.consent !== false }];
      if (path.startsWith('email_prefs?')) return [{ lifecycle: options.lifecycle !== false }];
      if (path.startsWith('email_unsub_log?')) return options.unsub ? [{ email: job.email }] : [];
      if (path.startsWith('email_bounces?')) return options.bounce ? [{ email: job.email }] : [];
      if (path.startsWith('class_verifications?')) return (options.books || ['kidari']).map(book_code => ({ book_code }));
      if (path.startsWith('class_redemptions?')) return [];
      throw Error(`unexpected fixture path: ${path}`);
    },
    send: async (envelope, key) => { sent.push({ envelope, key }); return options.response || { ok: true, status: 200, id: 'offline-provider-id' }; },
  };
  return { job, deps, sent, writes, paths };
}
test('daytime only, exact Korean-time boundaries', () => {
  for (const [at, allowed] of [['2026-10-18T22:59:59Z', false], ['2026-10-18T23:00:00Z', true], ['2026-10-19T10:59:59Z', true], ['2026-10-19T11:00:00Z', false]]) {
    assert.equal(migrationOfferSendingHours(new Date(at)), allowed);
  }
});
test('approved copy, accessible links, no legacy coupon checkout', () => {
  const mail = renderMigrationOffer({ unsubscribeUrl: 'https://api.example.test/api/unsub?t=fixture', wrapHtml: x => x });
  assert.match(mail.subject, /^\(광고\)/);
  for (const value of ['398,000', '50,000', '/purchase/member', '/together', '/events/last100', '100일', '새로 시작하는', '준비', '수신거부']) assert.ok(mail.html.includes(value), value);
  assert.doesNotMatch(mail.html, /class\.literstella\.co\.kr|packages\/312328|9월 23|평가단 신청하면/);
  assert.match(mail.text, /https:\/\/class-new\.literstella\.co\.kr\/purchase\/member/);
  assert.throws(() => renderMigrationOffer({ unsubscribeUrl: 'javascript:alert(1)', wrapHtml: x => x }));
});
test('complete owner gets benefits, never an upgrade checkout CTA', () => {
  const mail = renderMigrationOffer({ unsubscribeUrl: 'https://api.example.test/api/unsub?t=fixture', wrapHtml: x => x, complete: true });
  assert.doesNotMatch(mail.html, /purchase\/member/);
  assert.match(mail.html, /내 서재에서 혜택 보기/);
});
test('one send, immutable envelope, persisted result; repeat processing sends nothing', async () => {
  const f = fixture();
  await processMigrationOfferEmails(env, f.deps, now);
  await processMigrationOfferEmails(env, f.deps, now);
  assert.equal(f.sent.length, 1); assert.equal(f.job.status, 'accepted');
  assert.equal(f.sent[0].key, 'class-migration-offer/offline-job');
  assert.deepEqual(f.sent[0].envelope, f.job.envelope);
  assert.ok(f.sent[0].envelope.headers['List-Unsubscribe']);
});
for (const option of ['consent','lifecycle','unsub','bounce']) test(`respects ${option} without sending or clearing suppression`, async () => {
  const f = fixture({ [option]: ['consent','lifecycle'].includes(option) ? false : true });
  await processMigrationOfferEmails(env, f.deps, now);
  assert.equal(f.sent.length, 0); assert.equal(f.job.status, 'skipped');
  assert.ok(f.writes.every(x => !('marketing_consent' in x)));
});
for (const option of ['leaseLost','dbFail']) test(`${option} cannot send`, async () => {
  const f = fixture({ [option]: true }); await processMigrationOfferEmails(env, f.deps, now);
  assert.equal(f.sent.length, 0); assert.notEqual(f.job.status, 'accepted');
});
test('ownership removed or unknown books never produce a sales mail', async () => {
  const f = fixture({ books: ['seat:anne', 'not-a-course'] });
  await processMigrationOfferEmails(env, f.deps, now);
  assert.equal(f.sent.length, 0); assert.equal(f.job.last_error, 'no_current_ownership');
});
test('transient provider failure reuses the same envelope and idempotency key', async () => {
  const f = fixture({ response: { ok: false, status: 503 } });
  await processMigrationOfferEmails(env, f.deps, now);
  assert.equal(f.job.status, 'pending'); assert.ok(f.job.envelope);
  f.job.waiting = false;
  await processMigrationOfferEmails(env, f.deps, new Date(now.getTime() + 300000));
  assert.equal(f.sent.length, 2); assert.deepEqual(f.sent[0], f.sent[1]);
});
test('missing activation or nighttime never even claims the queue', async () => {
  const f = fixture(); await processMigrationOfferEmails({}, f.deps, now);
  await processMigrationOfferEmails(env, f.deps, new Date('2026-10-19T12:00:00Z'));
  assert.equal(f.paths.length, 0);
});
