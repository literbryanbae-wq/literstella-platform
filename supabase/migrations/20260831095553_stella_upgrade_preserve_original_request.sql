-- Preserve the original request on retries. No existing rows are rewritten.
CREATE OR REPLACE FUNCTION private.stella_upgrade(p_payment_method text DEFAULT NULL::text, p_cash_receipt_number text DEFAULT NULL::text, p_depositor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_liveklass_id text;
  v_all constant text[] := array[
    'kidari','anne','littlewomen1','littlewomen2',
    'pride','gatsby','sherlock','theory'
  ];
  v_tier constant text[] := array[
    'kidari','anne','littlewomen1','littlewomen2',
    'pride','gatsby','sherlock'
  ];
  v_owned text[];
  v_missing text[];
  v_owned_count integer;
  v_tier_owned integer;
  v_complete boolean;
  v_credit integer;
  v_coupon integer;
  v_payable integer;
  v_method text;
  v_receipt text;
  v_depositor text;
  v_active jsonb;
  v_request_reused boolean := false;
begin
  if v_uid is null then
    raise exception 'login_required' using errcode = '42501';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    raise exception 'login_required' using errcode = '42501';
  end if;

  select coalesce(array_agg(c.code order by c.ord), array[]::text[])
  into v_owned
  from unnest(v_all) with ordinality as c(code, ord)
  where exists (
    select 1 from public.class_verifications cv
    where lower(cv.email) = v_email and cv.book_code = c.code
  ) or exists (
    select 1 from public.class_redemptions cr
    where lower(cr.redeemed_by) = v_email and cr.book_code = c.code
  );

  select coalesce(array_agg(c.code order by c.ord), array[]::text[])
  into v_missing
  from unnest(v_all) with ordinality as c(code, ord)
  where not (c.code = any(v_owned));

  v_owned_count := cardinality(v_owned);
  select count(*)::integer into v_tier_owned
  from unnest(v_tier) as t(code)
  where t.code = any(v_owned);

  select lower(cv.enrollment_email) into v_liveklass_id
  from public.class_verifications cv
  where lower(cv.email) = v_email
    and nullif(trim(cv.enrollment_email), '') is not null
  order by cv.verified_at desc nulls last
  limit 1;

  v_liveklass_id := coalesce(nullif(trim(v_liveklass_id), ''), v_email);
  v_complete := v_owned_count = 8;
  v_credit := case when v_complete then 398000 else v_owned_count * 50000 end;
  v_coupon := case when v_complete then 0 else v_owned_count * 50000 end;
  v_payable := case when v_complete then 0 else 398000 - v_coupon end;

  if p_payment_method is not null then
    -- Serialize tabs/devices for this account before inspecting its existing request.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('stella-upgrade:' || v_uid::text, 0)
    );
    select exists (
      select 1 from public.stella_upgrade_requests r
      where r.user_id = v_uid
        and r.status in ('pending', 'coupon_issued', 'rejected', 'completed')
    ) into v_request_reused;
  end if;

  if p_payment_method is not null and not v_request_reused then
    if v_complete then raise exception 'already_stella_allinone'; end if;

    v_method := lower(trim(p_payment_method));
    if v_method not in ('bank_transfer', 'liveklass_card') then
      raise exception 'payment_method_invalid';
    end if;

    if v_method = 'bank_transfer' then
      if nullif(trim(coalesce(p_depositor_name, '')), '') is null then
        raise exception 'depositor_name_required' using errcode = '22023';
      end if;
      v_receipt := regexp_replace(
        coalesce(p_cash_receipt_number, ''), '[^0-9-]', '', 'g'
      );
      if length(regexp_replace(v_receipt, '[^0-9]', '', 'g'))
         not between 5 and 20 then
        raise exception 'cash_receipt_number_invalid';
      end if;
      -- 입금자명: 통장 대조 키. 신청 행에 함께 남긴다(구 클라이언트는 null 로 와서 알림 호출이 뒤늦게 채운다).
      v_depositor := nullif(trim(coalesce(p_depositor_name, '')), '');
      if v_depositor is not null and length(v_depositor) > 40 then
        v_depositor := left(v_depositor, 40);
      end if;
    else
      v_receipt := null;
      v_depositor := null;
    end if;

    insert into public.stella_upgrade_requests (
      user_id, email, class_new_id, liveklass_id,
      owned_books, missing_books, owned_count,
      base_amount, credit_amount, coupon_amount, payable_amount,
      payment_method, cash_receipt_number, depositor_name, status
    ) values (
      v_uid, v_email, v_uid, v_liveklass_id,
      v_owned, v_missing, v_owned_count,
      398000, v_coupon, v_coupon, v_payable,
      v_method, v_receipt, v_depositor, 'pending'
    )
    on conflict (user_id)
      where status in ('pending', 'coupon_issued', 'rejected')
    do nothing;
    v_request_reused := not found;
  end if;

  select jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'paymentMethod', r.payment_method,
    'cashReceiptNumber', r.cash_receipt_number,
    'adminNote', r.admin_note,
    'couponCode', r.coupon_code,
    'couponEmailedAt', r.coupon_emailed_at,
    'couponAmount', r.coupon_amount,
    'payableAmount', r.payable_amount,
    'depositorName', r.depositor_name,
    'processedAt', r.processed_at,
    'createdAt', r.created_at,
    'updatedAt', r.updated_at
  ) into v_active
  from public.stella_upgrade_requests r
  where r.user_id = v_uid
    and r.status in ('pending', 'coupon_issued', 'rejected', 'completed')
  order by (r.status = 'completed') asc, r.updated_at desc
  limit 1;

  return jsonb_build_object(
    'baseAmount', 398000,
    'classNewId', v_uid,
    'email', v_email,
    'liveklassId', v_liveklass_id,
    'ownedBooks', v_owned,
    'missingBooks', v_missing,
    'ownedCount', v_owned_count,
    'tierOwnedCount', v_tier_owned,
    'creditAmount', v_credit,
    'couponAmount', v_coupon,
    'payableAmount', v_payable,
    'complete', v_complete,
    'requestReused', v_request_reused,
    'activeRequest', v_active
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.stella_upgrade(p_payment_method text DEFAULT NULL::text, p_cash_receipt_number text DEFAULT NULL::text, p_depositor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_data jsonb;
  v_card_amount integer;
begin
  v_data := private.stella_upgrade(
    p_payment_method,
    p_cash_receipt_number,
    p_depositor_name
  );
  v_card_amount := coalesce((v_data ->> 'payableAmount')::integer, 0);

  return v_data || jsonb_build_object(
    'pricingVersion', '2026-08-bank-5-dedup',
    'classNewLogin', v_data ->> 'email',
    'cardAmount', v_card_amount,
    'bankDiscountAmount', floor(v_card_amount * 5::numeric / 100)::integer,
    'bankAmount', v_card_amount - floor(v_card_amount * 5::numeric / 100)::integer
  );
end;
$function$
;
