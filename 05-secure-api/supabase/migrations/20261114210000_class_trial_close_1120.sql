-- 무료로 먼저 써 보기 마감 = 2026-11-20(KST 11-21 00:00) — 운영자 확정 2026-11-14(정본 YANAWAN-GIFT-RULES-20261114.md 4절).
--   ① 신청 마감: private.class_trial_deadline() 이 infinity → 2026-11-21 00:00 KST.
--   ② 지금 이용 중인 분도 11-20 까지: ends_at 이 비어 있고 취소되지 않은 행만 ends_at = 그 시각(값이 있는 행·취소된 행은 그대로).
--   ③ 마감 전(오늘~11-20)에 새로 신청하는 분도 같은 시각에 끝나게: class_trial_start 의 insert 에 ends_at 을 넣는다
--      (안 넣으면 ends_at null = 끝없이 열린다 — class-gate 도 null 을 '기한 없음'으로 읽는다).
--   ④ my_class_trial 이 화면에 주는 'deadline' 글자 '2026-11-30' → '2026-11-20'.
--   그 뒤 my_class_trial: open=false · 신청자 active = (ends_at > now()) → 11-21 00:00 KST 부터 false. class_trial_start 는 'closed'.
--   되돌리기: class_trial_deadline 을 timestamptz 'infinity' 로 · 이 파일이 채운 행만 ends_at = null
--     (update public.class_trial_signups set ends_at = null where ends_at = timestamptz '2026-11-21 00:00:00+09' and canceled_at is null)
--     · 두 함수에서 반대 치환.

create or replace function private.class_trial_deadline() returns timestamptz
language sql immutable set search_path = '' as $$ select timestamptz '2026-11-21 00:00:00+09' $$;

update public.class_trial_signups
   set ends_at = timestamptz '2026-11-21 00:00:00+09'
 where ends_at is null and canceled_at is null;

do $patch$
declare v_def text; n int;
  a1 text := 'insert into public.class_trial_signups (user_id, email, kind, owned_originals, consent_version)';
  b1 text := 'values (v_uid, v_email, v_kind, v_owned, btrim(p_consent_version))';
  a2 text := '''deadline'', ''2026-11-30''';
begin
  -- ③ class_trial_start
  select pg_get_functiondef('public.class_trial_start(text)'::regprocedure) into v_def;
  v_def := replace(v_def, E'\r\n', E'\n');
  if position('consent_version, ends_at)' in v_def) = 0 then
    n := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
    if n <> 1 then raise exception 'class_trial_start insert anchor matched % times', n; end if;
    n := (length(v_def) - length(replace(v_def, b1, ''))) / length(b1);
    if n <> 1 then raise exception 'class_trial_start values anchor matched % times', n; end if;
    v_def := replace(v_def, a1, 'insert into public.class_trial_signups (user_id, email, kind, owned_originals, consent_version, ends_at)');
    v_def := replace(v_def, b1, 'values (v_uid, v_email, v_kind, v_owned, btrim(p_consent_version), private.class_trial_deadline())');
    execute v_def;
  end if;

  -- ④ my_class_trial
  select pg_get_functiondef('public.my_class_trial()'::regprocedure) into v_def;
  v_def := replace(v_def, E'\r\n', E'\n');
  if position('''deadline'', ''2026-11-20''' in v_def) = 0 then
    n := (length(v_def) - length(replace(v_def, a2, ''))) / length(a2);
    if n <> 3 then raise exception 'my_class_trial deadline anchor matched % times (expected 3)', n; end if;
    execute replace(v_def, a2, '''deadline'', ''2026-11-20''');
  end if;
end $patch$;
