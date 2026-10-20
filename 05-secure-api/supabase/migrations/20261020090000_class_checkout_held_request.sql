-- A held legacy coupon request is history, not a payment in progress.
-- Preserve active legacy requests, ownership policy, permissions and order guards.
do $migration$
declare
  source text := pg_catalog.pg_get_functiondef('public.class_checkout_quote(uuid)'::regprocedure);
begin
  if pg_catalog.md5(source) <> '7e72acff8b872dca20ad05f45adefbda' then
    raise exception 'class_checkout_quote changed: review before applying held-request fix';
  end if;
  execute pg_catalog.replace(source,
    'status in (''pending'',''coupon_issued'',''rejected'',''completed'')',
    'status in (''pending'',''coupon_issued'',''completed'')');
end
$migration$;
