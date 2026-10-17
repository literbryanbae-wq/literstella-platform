-- Synthetic database-only check. Never call a payment or mail provider here.
begin;
set local statement_timeout='20s';
select set_config('first_course.test_uid',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at)
values(current_setting('first_course.test_uid')::uuid,'first-course-qa-'||current_setting('first_course.test_uid')||'@example.invalid',now());
set local role service_role;
update private.first_course_campaign set enabled=true;
do $$
declare u uuid:=current_setting('first_course.test_uid')::uuid; e text; p uuid; q jsonb; o jsonb; r jsonb; total integer;
begin
 select email into e from auth.users where id=u;
 insert into public.users(auth_uid,email,nickname,diag_level,diag_type) values(u,e,'first-course-rollback-qa','B1','QA') returning id into p;
 insert into public.point_transactions(user_id,amount,reason,ref_id) values(p,100,'adjust','qa-existing-points');
 q:=public.class_course_checkout_quote(u,'kidari');
 if q->>'amount'<>'39000' or q#>>'{promotion,applied}'<>'true' then raise exception 'discount quote failed: %',q; end if;
 r:=public.class_course_checkout_prepare(u,'kidari',39000,'course-terms-2026-10-01','https://challenge.literstella.co.kr/course-terms');
 if r->>'error'<>'terms_changed' then raise exception 'consent guard failed'; end if;
 o:=public.class_course_checkout_prepare(u,'kidari',39000,'course-terms-2026-10-01','https://challenge.literstella.co.kr/course-terms','first-course-2026-v1');
 if o->>'ok'<>'true' then raise exception 'prepare failed: %',o; end if;
 r:=public.class_checkout_claim(u,o->>'orderId','qa-not-a-payment',39000);
 if r->>'ok'<>'true' then raise exception 'claim failed: %',r; end if;
 r:=public.class_checkout_settle(o->>'orderId','qa-not-a-payment',39000,'DONE');
 if r#>>'{promotion,premiumActive}'<>'true' then raise exception 'grant failed: %',r; end if;
 perform public.class_checkout_settle(o->>'orderId','qa-not-a-payment',39000,'DONE');
 select sum(amount) into total from public.point_transactions where user_id=p;
 if total<>400 then raise exception 'duplicate/bonus failed: %',total; end if;
 r:=public.growth_panel_request('status','growth-quality-panel-v1',u,e,'{}');
 if r#>>'{member,firstCoursePremium}'<>'true' then raise exception 'premium status failed: %',r; end if;
 if (select count(*) from public.class_checkout_email_outbox where order_id=o->>'orderId')<>2 then raise exception 'mail dedupe failed'; end if;
 perform public.class_checkout_settle(o->>'orderId','qa-not-a-payment',39000,'CANCELED');
 perform public.class_checkout_settle(o->>'orderId','qa-not-a-payment',39000,'CANCELED');
 select sum(amount) into total from public.point_transactions where user_id=p;
 if total<>100 then raise exception 'refund must preserve existing points: %',total; end if;
 if private.first_course_premium_active(u) then raise exception 'premium not revoked'; end if;
 q:=public.class_course_checkout_quote(u,'kidari');
 if q->>'amount'<>'69000' then raise exception 'refund allowed discount reuse'; end if;
end $$;
rollback;
select 'PASS: service-role quote/consent/prepare/claim/grant/duplicate/refund/premium, rolled back' result,
 (select enabled from private.first_course_campaign) campaign_enabled,
 (select count(*) from auth.users where email like 'first-course-qa-%@example.invalid') remaining_test_users,
 (select count(*) from public.class_checkout_orders where payment_key='qa-not-a-payment') remaining_test_orders;
