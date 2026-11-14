-- 야나완 성공 선물 — 운영 DB 되돌림 시험(전부 한 트랜잭션 · 끝에 반드시 rollback · 쓰기 0이 남는다).
--   실행(운영자): psql 로 이 폴더(05-secure-api)에서
--     psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f ops/yanawan-gift-rollback-test.sql
--   SQL 편집기·MCP 로 돌릴 때는 \ir 두 줄 자리에 두 마이그레이션 본문을 그대로 붙여 넣는다(begin 과 rollback 사이).
--   기대 숫자(7·8·3·18)는 2026-11-14 실측 기준 — 그 뒤 새로 단계를 넘긴 회원이 있으면 숫자가 늘어난다(그때는 ① 의 notice 를 보고 고친다).
--   실패하면 raise exception 으로 멈추고, psql 은 트랜잭션을 버린다(rollback 과 같다).
--   메일·외부 호출 0: 선물 코드·자리·수강권 표에는 트리거가 없다(11-14 확인). 인증 1건을 넣는 시험은 pg_notify 만 깨우는데 rollback 으로 사라진다.
\set ON_ERROR_STOP on
begin;

\ir ../supabase/migrations/20261114200000_yanawan_gift_auto.sql
\ir ../supabase/migrations/20261114210000_class_trial_close_1120.sql

-- ① 계획(쓰기 0): 기대 = 올인원 7명 자리 · 구독권 8장 · 소장 회원 수강권 3장
do $t$
declare v_seat int; v_pass int; v_vou int; v_rows int;
begin
  select count(*) filter (where (p ->> 'seat')::boolean), coalesce(sum((p ->> 'passes')::int), 0), coalesce(sum((p ->> 'vouchers')::int), 0)
    into v_seat, v_pass, v_vou
    from (select private.yanawan_gift_plan(a.auth_uid) p
            from (select distinct u.auth_uid from public.check_ins c join public.users u on u.id = c.user_id
                   where u.auth_uid is not null and c.is_yanawan and c.checked_in_at >= date '2026-07-01') a) x;
  raise notice 'plan: seat % pass % voucher %', v_seat, v_pass, v_vou;
  if (v_seat, v_pass, v_vou) <> (7, 8, 3) then raise exception 'plan mismatch: % % %', v_seat, v_pass, v_vou; end if;
  select count(*) into v_rows from private.yanawan_gifts;
  if v_rows <> 0 then raise exception 'plan wrote rows'; end if;
end $t$;

-- ② 소급 한 번 → 결과 세기 → 한 번 더(늘지 않아야)
create temp table yg_run as
select private.yanawan_gift_sync(a.auth_uid) r
  from (select distinct u.auth_uid from public.check_ins c join public.users u on u.id = c.user_id
         where u.auth_uid is not null and c.is_yanawan and c.checked_in_at >= date '2026-07-01') a;
do $t$
declare v_seat int; v_pass int; v_code int; v_held int; v_vou int; v_bonus int; v_again int;
begin
  select count(*) filter (where kind = 'seat'), count(*) filter (where kind = 'subscription_pass'),
         count(pass_code), count(*) filter (where hold_reason is not null), count(*) filter (where kind = 'course_voucher')
    into v_seat, v_pass, v_code, v_held, v_vou from private.yanawan_gifts;
  select count(*) into v_bonus from private.together_seat_bonus where basis = 'yanawan_auto';
  raise notice 'synced: seat % pass % code % held % voucher % bonus %', v_seat, v_pass, v_code, v_held, v_vou, v_bonus;
  if (v_seat, v_pass, v_code, v_held, v_vou, v_bonus) <> (7, 8, 8, 0, 3, 7) then raise exception 'sync mismatch'; end if;
  if (select count(*) from public.class_subscription_gift_codes where issued_by = 'yanawan_auto'
        and expires_at between now() + interval '59 days' and now() + interval '61 days') <> 8 then
    raise exception 'pass codes expiry/issuer mismatch'; end if;
  select coalesce(sum((r ->> 'created')::int), 0) into v_again
    from (select private.yanawan_gift_sync(a.auth_uid) r
            from (select distinct u.auth_uid from public.check_ins c join public.users u on u.id = c.user_id
                   where u.auth_uid is not null and c.is_yanawan and c.checked_in_at >= date '2026-07-01') a) x;
  if v_again <> 0 or (select count(*) from private.yanawan_gifts) <> 18 then raise exception 'not idempotent: %', v_again; end if;
  if (select count(*) from private.together_seat_bonus b where basis = 'yanawan_auto' and not private.together_seat_bonus_on(b.sponsor_uid)) <> 0 then
    raise exception 'auto seat bonus not effective'; end if;
end $t$;

-- ③ 회원 조회(본인) — 100일 올인원 회원 한 분의 화면 값 · 이메일 누출 0 · 비로그인 거절
do $t$
declare v_uid uuid; j jsonb;
begin
  select g.auth_uid into v_uid from private.yanawan_gifts g where g.kind = 'subscription_pass' and g.level = 100 limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated',
    'email', private.together_email(v_uid))::text, true);
  set local role authenticated;
  j := public.my_yanawan_gifts();
  reset role;
  if not (j ->> 'ok')::boolean or jsonb_array_length(j -> 'steps') <> 3 or jsonb_array_length(j -> 'passes') <> 2
     or not (j -> 'owner' ->> 'allInOne')::boolean or not (j ->> 'seatBonus')::boolean then
    raise exception 'my_yanawan_gifts shape: %', j; end if;
  if j::text like '%@%' then raise exception 'email leaked'; end if;
  raise notice 'my_yanawan_gifts ok: days %', j -> 'days';
  perform set_config('request.jwt.claims', '', true);
  begin
    set local role anon;
    perform public.my_yanawan_gifts();
    raise exception 'anon could execute';
  exception when insufficient_privilege then reset role;
  end;
end $t$;

-- ④ 수강권: 소장 회원이 고르기 → 코드 → 본인 등록 거절 → 남이 등록 가능(그 갱신까지 rollback)
do $t$
declare v_uid uuid; v_vid uuid; j jsonb; v_books text[]; v_code text;
begin
  select g.auth_uid, g.id into v_uid, v_vid from private.yanawan_gifts g where g.kind = 'course_voucher' order by g.seq limit 1;
  v_books := array(select b from unnest(private.together_owned_books(private.together_email(v_uid))) b where b = any (private.together_k8()) and b <> 'theory');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.my_yanawan_voucher_pick(v_vid, 'kidari');   -- 그 회원은 키다리 미소장(11-14)
  if j ->> 'error' <> 'not_owned' then reset role; raise exception 'not_owned expected: %', j; end if;
  j := public.my_yanawan_voucher_pick(v_vid, v_books[1]);
  reset role;
  v_code := j -> 'voucher' ->> 'code';
  if not (j ->> 'ok')::boolean or v_code is null then raise exception 'pick failed: %', j; end if;
  begin
    update public.class_redemptions set redeemed_by = private.together_email(v_uid), redeemed_at = now() where code = v_code and redeemed_by is null;
    raise exception 'self redeem allowed';
  exception when insufficient_privilege then null;
  end;
  update public.class_redemptions set redeemed_by = 'rollback-test@invalid.test', redeemed_at = now() where code = v_code and redeemed_by is null;
  if (private.yanawan_voucher_json(v_vid) ->> 'status') <> 'redeemed' then raise exception 'voucher status'; end if;
  raise notice 'voucher ok: %', v_books[1];
end $t$;

-- ⑤ 함께 읽기 상대 사진 키 · ⑥ 무료 체험 마감
do $t$
declare v_conn uuid; v_uid uuid; j jsonb;
begin
  select c.id, c.sponsor_uid into v_conn, v_uid from public.member_connections c where c.member_uid is not null and c.status <> 'ended' limit 1;
  if v_conn is not null then
    j := private.together_view(v_conn, v_uid);
    if not (j ? 'partnerAvatar') or not (j ? 'partnerNickname') then raise exception 'partnerAvatar missing: %', j; end if;
    raise notice 'together_view partnerAvatar present (null=% )', j -> 'partnerAvatar' = 'null'::jsonb;
  else
    raise notice 'no live connection to check together_view';
  end if;
  if private.class_trial_deadline() <> timestamptz '2026-11-21 00:00+09' then raise exception 'trial deadline'; end if;
  if exists (select 1 from public.class_trial_signups where canceled_at is null and ends_at is null) then raise exception 'trial ends_at null left'; end if;
  if position($q$'deadline', '2026-11-20'$q$ in pg_get_functiondef('public.my_class_trial()'::regprocedure)) = 0 then raise exception 'my_class_trial text'; end if;
end $t$;

-- ⑦ 인증 저장 시각 고정(회원 권한으로 넣은 created_at 은 무시된다)
do $t$
declare v_uid uuid; v_pu uuid; v_at timestamptz;
begin
  select u.auth_uid, u.id into v_uid, v_pu from public.users u
   where u.auth_uid is not null and not exists (select 1 from public.check_ins c where c.user_id = u.id and c.checked_in_at = date '2026-07-02')
   limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.check_ins (user_id, season_id, is_yanawan, checked_in_at, created_at)
  values (v_pu, 'yanawan-2607', true, date '2026-07-02', timestamptz '2026-07-02 12:00+09');
  reset role;
  select c.created_at into v_at from public.check_ins c where c.user_id = v_pu and c.checked_in_at = date '2026-07-02';
  if v_at < now() - interval '1 minute' then raise exception 'created_at not forced: %', v_at; end if;
  raise notice 'check_in created_at forced ok';
end $t$;

rollback;
