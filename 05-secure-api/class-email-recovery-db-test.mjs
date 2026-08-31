import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_ENTRY).href);
const db = new PGlite();
const uid = '00000000-0000-4000-8000-000000000001';
const admin = '00000000-0000-4000-8000-000000000002';
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table auth.users(id uuid primary key, email text, encrypted_password text);
  create table public.class_enrollments(id uuid default gen_random_uuid() primary key, email text, book_code text, unique(email,book_code));
  create table public.class_verifications(email text, book_code text, enrollment_email text, primary key(email,book_code));
  create unique index enrollment_once on public.class_verifications(enrollment_email,book_code) where enrollment_email is not null;
  create table public.class_roster_contacts(email text, book_code text, phone_norm text, buyer_name text);
  create table public.class_link_requests(id uuid primary key default gen_random_uuid(), auth_uid uuid not null,
    login_email text not null, claimed_email text, name text, phone text, courses text, paid_at text, order_info text,
    status text not null default 'pending' check(status in ('pending','needinfo','approved','rejected')),
    admin_note text, granted_books text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), roster_match jsonb);
  create unique index open_once on public.class_link_requests(auth_uid) where status in ('pending','needinfo');
`);
await db.exec(await readFile(new URL('../supabase/migrations/20260831063913_class_email_recovery.sql', import.meta.url), 'utf8'));
const payload = { claimed_email: 'old@example.test', name: 'Fixture', phone: '01012345678', courses: 'Anne, Pride', proofHash: 'a'.repeat(64), records: [{ bookCode: 'anne', enrollmentEmail: 'old@example.test' }, { bookCode: 'pride', enrollmentEmail: 'old@example.test' }] };
async function reset() {
  await db.exec(`reset role; truncate auth.users, class_link_requests, class_verifications, class_enrollments, class_roster_contacts;
    insert into auth.users values ('${uid}', 'new@example.test','test-hash'), ('${admin}', 'admin@example.test','test-hash');
    insert into class_enrollments(email,book_code) values ('old@example.test','anne'),('old@example.test','pride');
    insert into class_roster_contacts values ('old@example.test','anne','01012345678','Fixture');`);
}
const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
const submit = (overrides = {}, email = 'new@example.test') => value('select public.class_email_recovery_submit_v1($1,$2,$3) as result', [uid, email, { ...payload, ...overrides }]);
const decide = (id, action = 'approve', books = ['anne'], confirmed = true, note = 'Reviewed purchase and source contact') => value('select public.class_email_recovery_decide_v1($1,$2,$3,$4,$5,$6) as result', [id, action, books, note, confirmed, admin]);
const count = () => value('select count(*)::int as result from class_verifications');

await test('local PostgreSQL recovery contracts', async (t) => {
  await t.test('own password state; no hashes or other users exposed', async () => {
    await reset(); await db.exec(`set role authenticated; set test.uid='${uid}';`);
    assert.deepEqual(await value('select account_login_methods_v1() as result'), { email: 'new@example.test', hasPassword: true });
    await db.exec('reset role');
  });
  await t.test('anonymous status and authenticated mutations denied', async () => {
    await reset(); await db.exec('set role anon'); await assert.rejects(() => value('select account_login_methods_v1() as result'), /permission denied/);
    await db.exec('reset role; set role authenticated'); await assert.rejects(() => submit(), /permission denied/); await db.exec('reset role');
  });
  await t.test('no password or changed account blocks submission', async () => {
    await reset(); assert.equal((await submit({}, 'victim@example.test')).error, 'login_required');
    await db.exec(`update auth.users set encrypted_password='' where id='${uid}'`);
    assert.equal((await submit()).error, 'password_required'); assert.equal(await count(), 0);
  });
  await t.test('service role can submit and decide without direct Auth table access', async () => {
    await reset(); await db.exec('set role service_role');
    try { const a = await submit(); assert.equal(a.ok, true); assert.equal((await decide(a.id)).ok, true); }
    finally { await db.exec('reset role'); }
  });
  await t.test('source enrollment is required', async () => {
    await reset(); assert.equal((await submit({ records: [{ bookCode: 'sherlock', enrollmentEmail: 'old@example.test' }] })).error, 'legacy_record_not_found');
  });
  await t.test('same request is idempotent, submission never grants', async () => {
    await reset(); const a = await submit(); const b = await submit();
    assert.equal(a.ok, true); assert.equal(b.id, a.id); assert.equal(b.already, true); assert.equal(await count(), 0);
  });
  await t.test('email proof and name/phone match do not replace manual identity review', async () => {
    await reset(); const a = await submit();
    assert.equal((await decide(a.id, 'approve', ['anne'], false)).error, 'identity_review_required');
    assert.equal((await decide(a.id, 'approve', ['anne'], true, '')).error, 'review_note_required'); assert.equal(await count(), 0);
  });
  await t.test('out-of-roster course and empty choice cannot be granted', async () => {
    await reset(); const a = await submit();
    assert.equal((await decide(a.id, 'approve', ['sherlock'])).error, 'book_not_in_roster');
    assert.equal((await decide(a.id, 'approve', [])).error, 'book_not_in_roster'); assert.equal(await count(), 0);
  });
  await t.test('account email change or lost proof invalidates approval', async () => {
    await reset(); const a = await submit(); await db.exec(`update auth.users set email='changed@example.test' where id='${uid}'`);
    assert.equal((await decide(a.id)).error, 'account_changed'); assert.equal(await count(), 0);
    await db.exec(`update auth.users set email='new@example.test' where id='${uid}'; update class_link_requests set roster_match=roster_match-'emailVerifiedAt'`);
    assert.equal((await decide(a.id)).error, 'account_changed');
  });
  await t.test('source linked elsewhere blocks without taking rights away', async () => {
    await reset(); const a = await submit(); await db.exec("insert into class_verifications values('other@example.test','pride','old@example.test')");
    assert.equal((await decide(a.id)).error, 'source_already_linked'); assert.equal(await count(), 1);
    assert.equal(await value("select status as result from class_link_requests"), 'pending');
  });
  await t.test('approve is atomic and repeat approve does not add more books', async () => {
    await reset(); const a = await submit(); const r = await decide(a.id);
    assert.equal(r.ok, true); assert.equal(r.request.status, 'approved'); assert.equal(r.request.roster_match.reviewedBy, admin); assert.equal(await count(), 1);
    assert.equal((await decide(a.id, 'approve', ['anne', 'pride'])).already, true); assert.equal(await count(), 1);
    assert.equal((await decide(a.id, 'reject')).error, 'request_closed');
  });
  await t.test('needinfo can be resubmitted with a new verified proof', async () => {
    await reset(); const a = await submit(); assert.equal((await decide(a.id, 'needinfo')).ok, true);
    const b = await submit({ proofHash: 'b'.repeat(64) }); assert.equal(b.id, a.id); assert.equal(b.status, 'pending');
  });
  await t.test('failure after grant insertion rolls back grants and request together', async () => {
    await reset(); const a = await submit();
    await db.exec(`create function fail_recovery_decision() returns trigger language plpgsql as $$ begin
      if new.status = 'approved' then raise unique_violation; end if; return new;
      end $$;
      create trigger fail_decision before update on class_link_requests for each row execute function fail_recovery_decision();`);
    try {
      assert.equal((await decide(a.id, 'approve', ['anne', 'pride'])).ok, false);
      assert.equal(await count(), 0);
      assert.equal(await value('select status as result from class_link_requests'), 'pending');
    } finally { await db.exec('drop trigger fail_decision on class_link_requests; drop function fail_recovery_decision();'); }
  });
  await t.test('preexisting ownership stays single, existing non-recovery queue not overwritten', async () => {
    await reset(); await db.exec("insert into class_verifications values('new@example.test','anne','another@example.test')");
    const a = await submit(); assert.equal((await decide(a.id)).ok, true); assert.equal(await count(), 1);
    await reset(); await db.query('insert into class_link_requests(auth_uid,login_email) values($1,$2)', [uid, 'new@example.test']);
    assert.equal((await submit()).error, 'existing_request_pending');
  });
});
await db.close();
