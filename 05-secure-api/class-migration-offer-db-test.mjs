import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_ENTRY).href);
test('transactional queue, cutoff, duplicates, rollback, service-only claim and lease', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table class_verifications(email text, book_code text, enrollment_email text, verified_at timestamptz not null default now(), primary key(email,book_code));
      insert into class_verifications values ('old@example.test','anne','old@example.test','2026-10-19T10:01:02Z'),('after@example.test','anne','after@example.test','2026-10-19T10:01:03Z');`);
    await db.exec(await readFile(new URL('./ops/class-migration-offer-outbox.sql', import.meta.url), 'utf8'));
    const rows = async () => (await db.query('select * from class_migration_offer_outbox order by email')).rows;
    assert.equal((await rows()).length, 1); assert.equal((await rows())[0].email, 'after@example.test');
    await db.exec(`insert into class_verifications values
      ('after@example.test','pride','after@example.test','2026-10-19T10:02:00Z'),
      ('ancient@example.test','anne','ancient@example.test','2026-10-18T00:00:00Z'),
      ('purchase@example.test','anne',null,'2026-10-19T10:02:00Z'),
      ('unknown@example.test','not-a-course','unknown@example.test','2026-10-19T10:02:00Z');
      insert into class_verifications values ('after@example.test','anne','after@example.test',now()) on conflict do nothing;`);
    assert.equal((await rows()).length, 1);
    await db.exec(`begin; insert into class_verifications values ('rolled@example.test','anne','rolled@example.test',now()); rollback;`);
    assert.equal((await rows()).length, 1);
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from class_migration_offer_outbox'), /permission denied/);
      await assert.rejects(db.query('select class_migration_offer_claim()'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const first = (await db.query('select class_migration_offer_claim() as job')).rows[0].job;
    assert.equal(first.status, 'processing'); assert.equal(first.attempts, 1); assert.ok(first.lease_token);
    assert.equal((await db.query('select class_migration_offer_claim() as job')).rows[0].job, null);
    await db.query(`update class_migration_offer_outbox set lease_until=now()-interval '1 second' where id=$1`, [first.id]);
    const second = (await db.query('select class_migration_offer_claim() as job')).rows[0].job;
    assert.notEqual(second.lease_token, first.lease_token); assert.equal(second.attempts, 2);
    assert.equal((await db.query(`update class_migration_offer_outbox set status='accepted' where id=$1 and lease_token=$2 returning id`, [first.id, first.lease_token])).rows.length, 0);
    await db.exec(`update class_migration_offer_outbox set lease_until=now()-interval '1 second',first_attempt_at=now()-interval '24 hours';`);
    assert.equal((await db.query('select class_migration_offer_claim() as job')).rows[0].job, null);
    assert.equal((await rows())[0].status, 'review');
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as n from class_verifications')).rows[0].n, 6);
  } finally { await db.close(); }
});
