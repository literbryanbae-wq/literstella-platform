-- Operational verification only; supply growth_test.user_id / growth_test.email session settings.
-- Refuses to overwrite an existing application. All writes roll back.
begin;
set local role service_role;

insert into public.growth_panel_campaigns(id,enabled,approved_at,starts_at,policy_version,privacy_version,feedback_version,retention_version,privacy_notice,feedback_notice,retention_notice)
values ('growth-quality-panel-v1',true,now(),now(),'2026-09-05-v1','2026-09-05-v1','2026-09-05-v1','2026-09-05-v1',
'평가단 선정과 참여 안내를 위해 별명, 계정 이메일, 관심 분야, 연습하고 싶은 영역, 이용 기기 및 선택 입력한 연습 상황을 수집합니다. 동의하지 않으면 신청할 수 없습니다. 기존 학습 서비스 이용에는 영향을 주지 않습니다.',
'더 나은 기능을 위해 사용 경험에 관한 짧은 설문이나 의견을 요청할 수 있습니다. 개별 의견 요청의 참여 여부는 자유롭게 선택할 수 있습니다.',
'신청 정보는 제출일로부터 90일간 보관합니다. 신청을 철회하면 연락처와 답변은 즉시 삭제하고, 철회·동의 확인 기록은 해당 보관기간까지만 유지합니다. 기존 학습 기록은 신청 정보와 분리되어 기존 서비스 정책에 따라 관리됩니다.') on conflict (id) do nothing;
do $test$
declare s jsonb; a jsonb; b jsonb; w jsonb; rid uuid;
u uuid := current_setting('growth_test.user_id')::uuid;
e text := current_setting('growth_test.email');
p jsonb := jsonb_build_object('nickname','운영 검수','interests',jsonb_build_array('travel'),'skills',jsonb_build_array('speaking'),'device','desktop','situation','운영 접수 검증 · 저장되지 않는 트랜잭션','privacyConsent',true,'feedbackConsent',true,'privacyVersion','2026-09-05-v1','feedbackVersion','2026-09-05-v1','retentionVersion','2026-09-05-v1','clientSubmissionId',gen_random_uuid());
begin
s := public.growth_panel_request('status','growth-quality-panel-v1',u,e);
if s#>>'{member,eligible}' <> 'true' or s#>>'{campaign,open}' <> 'true' then raise exception 'eligible status failed %',s; end if;
b := public.growth_panel_request('submit','growth-quality-panel-v1',u,'qa-no-ownership@example.invalid',p);
if b->>'error' <> 'ineligible' then raise exception 'ownership denial failed'; end if;
b := public.growth_panel_request('submit','growth-quality-panel-v1',u,e,p || '{"privacyVersion":"stale"}'::jsonb);
if b->>'error' <> 'policy_changed' then raise exception 'consent version check failed'; end if;
a := public.growth_panel_request('submit','growth-quality-panel-v1',u,e,p);
if a->>'ok' <> 'true' or a->>'existing' <> 'false' then raise exception 'submit failed %',a; end if;
rid := (a#>>'{application,id}')::uuid;
if not exists(select 1 from public.growth_panel_applications where id=rid and jsonb_array_length(ownership_snapshot->'books')=8 and retain_until>now()+interval '89 days' and retain_until<now()+interval '91 days') then raise exception 'snapshot/retention failed'; end if;
b := public.growth_panel_request('submit','growth-quality-panel-v1',u,e,p || '{"nickname":"must not overwrite"}'::jsonb);
if b#>>'{application,id}' <> rid::text or b->>'existing' <> 'true' or b#>>'{application,submitted,nickname}' <> '운영 검수' then raise exception 'idempotency failed'; end if;
b := public.growth_panel_request('get','growth-quality-panel-v1',u,e);
if b#>>'{application,id}' <> rid::text then raise exception 'reload receipt failed'; end if;
w := public.growth_panel_request('withdraw','growth-quality-panel-v1',u,e);
if w#>>'{application,status}' <> 'withdrawn' or exists(select 1 from public.growth_panel_applications where id=rid and (nickname is not null or email is not null or answers<>'{}'::jsonb)) then raise exception 'withdraw erase failed'; end if;
update public.growth_panel_applications set retain_until=now()-interval '1 second' where id=rid;
if public.growth_panel_purge_expired() <> 1 then raise exception 'purge failed'; end if;
if exists(select 1 from public.growth_panel_applications where id=rid) then raise exception 'purge persistence failed'; end if;
end $test$;
select jsonb_build_object('result','PASS','checks',array['exact8_owner','ineligible_denied','stale_consent_denied','submit','ownership_snapshot','90_day_retention','idempotent_retry','reload','withdraw_erases_contact_answers','expired_purge'],'mode','service_role; transaction rolled back') as verification;
rollback;
