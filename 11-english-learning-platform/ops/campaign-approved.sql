-- Approved public campaign configuration, 2026-09-05. Run once; never reseed over a changed live policy.

insert into public.growth_panel_campaigns(id,enabled,approved_at,starts_at,policy_version,privacy_version,feedback_version,retention_version,privacy_notice,feedback_notice,retention_notice)
values ('growth-quality-panel-v1',true,now(),now(),'2026-09-05-v1','2026-09-05-v1','2026-09-05-v1','2026-09-05-v1',
'평가단 선정과 참여 안내를 위해 별명, 계정 이메일, 관심 분야, 연습하고 싶은 영역, 이용 기기 및 선택 입력한 연습 상황을 수집합니다. 동의하지 않으면 신청할 수 없습니다. 기존 학습 서비스 이용에는 영향을 주지 않습니다.',
'더 나은 기능을 위해 사용 경험에 관한 짧은 설문이나 의견을 요청할 수 있습니다. 개별 의견 요청의 참여 여부는 자유롭게 선택할 수 있습니다.',
'신청 정보는 제출일로부터 90일간 보관합니다. 신청을 철회하면 연락처와 답변은 즉시 삭제하고, 철회·동의 확인 기록은 해당 보관기간까지만 유지합니다. 기존 학습 기록은 신청 정보와 분리되어 기존 서비스 정책에 따라 관리됩니다.');
