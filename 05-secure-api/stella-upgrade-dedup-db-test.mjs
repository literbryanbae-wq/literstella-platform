import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_ENTRY).href);
const db = new PGlite();
const uid = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema private;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table auth.users(id uuid primary key, email text);
  create table class_verifications(email text, book_code text, enrollment_email text, verified_at timestamptz);
  create table class_redemptions(redeemed_by text, book_code text);
  create table stella_upgrade_requests (
    id uuid primary key default gen_random_uuid(), user_id uuid, email text, class_new_id uuid,
    liveklass_id text, owned_books text[], missing_books text[], owned_count integer,
    base_amount integer, credit_amount integer, coupon_amount integer, payable_amount integer,
    payment_method text, cash_receipt_number text, depositor_name text, status text,
    admin_note text, coupon_code text, coupon_emailed_at timestamptz, processed_at timestamptz,
    completion_emailed_at timestamptz, admin_notified_at timestamptz,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create unique index request_once on stella_upgrade_requests(user_id)
    where status in ('pending','coupon_issued','rejected');
  create function private.stella_upgrade_set_payable() returns trigger language plpgsql as $$
  begin new.payable_amount := (new.base_amount-new.coupon_amount) - case when new.payment_method='bank_transfer'
    then floor((new.base_amount-new.coupon_amount)*5::numeric/100)::integer else 0 end; return new; end $$;
  create trigger quote_price before insert or update of base_amount,coupon_amount,payment_method
    on stella_upgrade_requests for each row execute function private.stella_upgrade_set_payable();
`);
await db.exec(await readFile(new URL('../supabase/migrations/20260831095553_stella_upgrade_preserve_original_request.sql', import.meta.url), 'utf8'));
await db.exec(`revoke all on function public.stella_upgrade(text,text,text) from public;
  grant usage on schema private,auth to authenticated;
  grant execute on function public.stella_upgrade(text,text,text),private.stella_upgrade(text,text,text) to authenticated;`);
const result = async (sql, args=[]) => (await db.query(sql,args)).rows[0].result;
const submit = (method='liveklass_card', receipt=null, name=null) => result('select public.stella_upgrade($1,$2,$3) result',[method,receipt,name]);
const snapshot = () => result('select coalesce(jsonb_agg(to_jsonb(r) order by id),\'[]\') result from stella_upgrade_requests r');
async function reset() {
  await db.exec(`reset role; truncate auth.users,class_verifications,class_redemptions,stella_upgrade_requests;
    insert into auth.users values ('${uid}','fixture@example.test'),('${other}','other@example.test');
    set test.uid='${uid}';`);
}
await test('PostgreSQL duplicate submission contracts', async t => {
  await t.test('new card and bank prices unchanged',async()=>{
    await reset(); let a=await submit(); assert.equal(a.requestReused,false); assert.equal(a.activeRequest.payableAmount,398000);
    await reset(); a=await submit('bank_transfer','01012345678','Original'); assert.equal(a.bankAmount,378100); assert.equal(a.activeRequest.payableAmount,378100);
  });
  await t.test('seven owned retains card 48000 and bank 45600',async()=>{
    await reset(); await db.exec(`insert into class_verifications(email,book_code) select 'fixture@example.test',unnest(array['kidari','anne','littlewomen1','littlewomen2','pride','sherlock','theory']);`);
    const a=await submit('bank_transfer','01012345678','Original'); assert.equal(a.cardAmount,48000); assert.equal(a.activeRequest.payableAmount,45600);
  });
  for (const status of ['pending','coupon_issued','rejected','completed']) {
    await t.test(`${status}: repeat preserves every stored field`,async()=>{
      await reset(); const a=await submit();
      await db.query(`update stella_upgrade_requests set status=$1,created_at='2026-08-28Z',updated_at='2026-08-29Z',
        coupon_code='KEEP',admin_note='Keep review',processed_at='2026-08-30Z',coupon_emailed_at='2026-08-28Z'`,[status]);
      const before=await snapshot();
      const b=await submit('bank_transfer','9999999999','Changed');
      assert.equal(b.activeRequest.id,a.activeRequest.id); assert.equal(b.requestReused,true); assert.deepEqual(await snapshot(),before);
      assert.equal((await submit('bank_transfer')).requestReused,true);
      assert.deepEqual(await snapshot(),before);
    });
  }
  await t.test('new bank request still requires depositor and receipt',async()=>{
    await reset(); await assert.rejects(()=>submit('bank_transfer','01012345678'),/depositor_name_required/);
    await assert.rejects(()=>submit('bank_transfer','1','Name'),/cash_receipt_number_invalid/);
    assert.deepEqual(await snapshot(),[]);
  });
  await t.test('another account cannot reuse this request',async()=>{
    await reset(); const a=await submit(); await db.exec(`set test.uid='${other}'`);
    const b=await submit(); assert.notEqual(a.activeRequest.id,b.activeRequest.id); assert.equal(b.requestReused,false);
  });
  await t.test('quote refresh is read-only',async()=>{
    await reset(); await submit(); const before=await snapshot(); await submit(null); assert.deepEqual(await snapshot(),before);
  });
  await t.test('cancelled request remains in history when new request is allowed',async()=>{
    await reset(); const a=await submit(); await db.exec("update stella_upgrade_requests set status='cancelled'");
    const b=await submit(); assert.notEqual(a.activeRequest.id,b.activeRequest.id); assert.equal((await snapshot()).length,2);
  });
  await t.test('authenticated RPC works without direct Auth table privileges',async()=>{
    await reset(); await db.exec('set role authenticated');
    try { assert.equal((await submit()).requestReused,false); assert.equal((await submit()).requestReused,true); }
    finally { await db.exec('reset role'); }
  });
  await t.test('anonymous calls cannot submit',async()=>{
    await reset(); await db.exec('set role anon');
    try { await assert.rejects(()=>submit(),/permission denied/); } finally { await db.exec('reset role'); }
    await db.exec("set test.uid=''"); await assert.rejects(()=>submit(),/login_required/);
  });
  await t.test('multiple queued submissions retain one immutable request',async()=>{
    await reset(); const responses=await Promise.all(Array.from({length:10},()=>submit()));
    assert.equal(new Set(responses.map(r=>r.activeRequest.id)).size,1);
    assert.equal(responses.filter(r=>!r.requestReused).length,1); assert.equal((await snapshot()).length,1);
  });
});
await db.close();
