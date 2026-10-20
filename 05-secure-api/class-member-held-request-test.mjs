import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
let checks = 0;
const check = (value) => { assert.ok(value); checks++; };
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table class_verifications(email text,book_code text,enrollment_email text,
      verified_at timestamptz not null default clock_timestamp(),primary key(email,book_code));
    create table class_redemptions(book_code text,redeemed_by text);
    create table stella_upgrade_requests(user_id uuid,status text);
    grant usage on schema public,auth to service_role;
    grant select on class_redemptions,stella_upgrade_requests to service_role;
    grant select,insert,update,delete on class_verifications to service_role;`);
  await db.exec((await readFile(new URL('./supabase/migrations/20261012100801_class_member_checkout.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n'));
  const books = ['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock','theory'];
  const rpc = async (name, args) => (await db.query(`select class_checkout_${name}(${args.map((_, i) => '$' + (i + 1))}) as q`, args)).rows[0].q;
  const member = async (n, count, status = 'rejected') => {
    const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
    await db.query('insert into auth.users values($1,$2,now())', [id, `held${n}@example.test`]);
    await db.query('insert into stella_upgrade_requests values($1,$2)', [id, status]);
    for (const book of books.slice(0, count)) await db.query('insert into class_verifications(email,book_code) values($1,$2)', [`held${n}@example.test`, book]);
    return id;
  };
  const held = await member(1, 7);
  check((await rpc('quote', [held])).existingRequest);
  const migration = await readFile(new URL('./supabase/migrations/20261020090000_class_checkout_held_request.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  const quote = await rpc('quote', [held]);
  check(quote.eligible && !quote.existingRequest && quote.amount === 48000 && quote.ownedCount === 7);
  check(JSON.stringify(quote.missingBooks) === '["theory"]');
  for (const count of [0, 1, 8]) {
    const id = await member(count + 10, count);
    const q = await rpc('quote', [id]);
    check(q.eligible === (count === 1));
    check(q.amount === Math.max(398000 - count * 50000, 0));
  }
  for (const [i, status] of ['pending', 'coupon_issued', 'completed'].entries()) {
    const id = await member(30 + i, 7, status);
    check(!(await rpc('quote', [id])).eligible);
    check((await rpc('prepare', [id, 48000, 'terms-v1', 'https://class-new.literstella.co.kr/refund'])).error === 'existing_request');
  }
  check((await rpc('quote', ['00000000-0000-0000-0000-999999999999'])).error === 'login_required');
  check((await rpc('prepare', [held, 1, 'terms-v1', 'https://class-new.literstella.co.kr/refund'])).error === 'quote_changed');
  const order = await rpc('prepare', [held, 48000, 'terms-v1', 'https://class-new.literstella.co.kr/refund']);
  check(order.ok && order.amount === 48000);
  check((await rpc('prepare', [held, 48000, 'terms-v1', 'https://class-new.literstella.co.kr/refund'])).orderId === order.orderId);
  check((await rpc('claim', [held, order.orderId, 'mock-payment', 48000])).ok);
  check((await rpc('prepare', [held, 48000, 'terms-v1', 'https://class-new.literstella.co.kr/refund'])).error === 'payment_pending');
  await assert.rejects(db.query("update stella_upgrade_requests set status='pending' where user_id=$1", [held]), /class_checkout_pending/); checks++;
  check((await rpc('settle', [order.orderId, 'mock-payment', 48000, 'DONE'])).granted);
  check((await rpc('quote', [held])).complete);
  check((await rpc('settle', [order.orderId, 'mock-payment', 48000, 'CANCELED'])).status === 'canceled');
  check((await rpc('quote', [held])).ownedCount === 7);
  check((await db.query('select status from stella_upgrade_requests where user_id=$1', [held])).rows[0].status === 'rejected');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(rpc('quote', [held]), /permission denied/); checks++;
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  check((await rpc('quote', [held])).eligible);
  await db.exec('reset role');
  await assert.rejects(db.exec(migration), /changed: review/); checks++;
  console.log(`held-request checkout: ${checks} checks passed; local PostgreSQL only`);
} finally { await db.close(); }
