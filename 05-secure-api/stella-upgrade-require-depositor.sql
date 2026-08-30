-- 계좌이체 스텔라 등급 신청은 통장 대조용 입금자명이 반드시 필요하다.
-- 기존 신청 행은 수정하지 않고, 이 공개 RPC를 통한 신규·재신청만 차단한다.
create or replace function public.stella_upgrade(
  p_payment_method text default null,
  p_cash_receipt_number text default null,
  p_depositor_name text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_data jsonb;
  v_card_amount integer;
begin
  if p_payment_method is not null
     and lower(trim(p_payment_method)) = 'bank_transfer'
     and nullif(trim(coalesce(p_depositor_name, '')), '') is null then
    raise exception 'depositor_name_required' using errcode = '22023';
  end if;

  v_data := private.stella_upgrade(
    p_payment_method,
    p_cash_receipt_number,
    p_depositor_name
  );
  v_card_amount := coalesce((v_data ->> 'payableAmount')::integer, 0);

  return v_data || jsonb_build_object(
    'pricingVersion', '2026-08-bank-5-depositor',
    'classNewLogin', v_data ->> 'email',
    'cardAmount', v_card_amount,
    'bankDiscountAmount', floor(v_card_amount * 5::numeric / 100)::integer,
    'bankAmount', v_card_amount - floor(v_card_amount * 5::numeric / 100)::integer
  );
end;
$function$;

comment on function public.stella_upgrade(text, text, text) is
  '스텔라 등급 견적·신청 RPC. 계좌이체 신청 시 입금자명을 필수 검증한다.';
