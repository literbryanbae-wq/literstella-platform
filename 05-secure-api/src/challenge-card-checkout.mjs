// 챌린지 도전 카드 결제 — 클래스 결제 상점(lclassljzq · 토스 결제위젯)으로 받는다(운영자 2026-11-09).
//   흐름: ① toss-prepare(product:'challenge') — 로그인 회원만 · 금액은 서버 가격표 · 주문과 '등록할 내용'을 먼저 저장
//         ② 위젯 결제창 → 복귀 → ③ toss-confirm — 클래스 상점 키로 승인하고 **같은 호출 안에서 서버가 도전을 등록**한다.
//   🔑 브라우저가 등록하던 옛 경로(결제 복귀 뒤 클라이언트가 enrollments 를 씀)는 결제 직후 창을 닫거나 네트워크가 끊기면
//      '돈은 나갔는데 도전이 없는' 상태가 됐고, 10-11 '끝난 도전 새로 시작' 처리도 빠져 있었다 → 서버로 옮겼다.
//   🔑 같은 주문을 다시 불러도 결과가 같다: 승인은 Idempotency-Key, 등록은 raw.enrolledAt 이 있으면 건너뛰고,
//      결제는 됐는데 등록이 실패했으면 다음 호출이 토스를 다시 부르지 않고 등록만 다시 시도한다.
//   🔑 배지 재지급 판정(private.yanawan_challenge_days)은 '새 도전' 기록을 포인트 거래의 enroll_pay 꼬리로 읽는다 —
//      카드 결제는 payments.raw.ref 에 같은 꼬리를 남기고, DB 함수가 둘 다 읽는다(migration challenge_card_restart_ref).
//   취소·환불 실행은 클래스처럼 사람이 한다(토스 상점 관리자). 환불 기준 = 결제 7일 안 + 인증 0회면 전액(챌린지 약관).

export const CHALLENGE_CARD_PRICES = Object.freeze({ 30: 3000, 66: 5800, 100: 9800 });
const ORDER_NAMES = Object.freeze({
  30: '영어 챌린지 야나완™ 30일 도전',
  66: '영어 챌린지 야나완™ 66일 도전',
  100: '영어 챌린지 야나완™ 100일 도전',
});
// 클래스 결제 위젯 공개 키(클래스 회원 결제와 같은 값). 서버 변수 TOSS_CLASS_CLIENT_KEY 가 있으면 그쪽이 우선.
export const CLASS_WIDGET_CLIENT_KEY = 'live_gck_vZnjEJeQVxJnOWvQa2jZ8PmOoBN0';
export const CHALLENGE_SOURCE_PREFIX = 'toss:challenge-';
const SEASON_RE = /^yanawan-\d{4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BOOK_RE = /^[A-Za-z0-9_-]{1,40}$/;
const TOSS_API = 'https://api.tosspayments.com';

export const kstToday = (now = new Date()) => new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);

// 등록할 내용 검사 — new(첫 신청) · extend(진행 중 늘리기) · restart(끝난 도전 뒤 새 도전).
export function challengeIntent(body = {}, now = new Date()) {
  const goalDays = Number(body.goalDays);
  if (!CHALLENGE_CARD_PRICES[goalDays]) return { ok: false, error: 'bad_goal_days' };
  const season = String(body.season || '');
  if (!SEASON_RE.test(season)) return { ok: false, error: 'bad_season' };
  const mode = String(body.mode || '');
  const today = kstToday(now);
  const startDate = body.startDate == null ? null : String(body.startDate);
  const bookId = body.bookId && BOOK_RE.test(String(body.bookId)) ? String(body.bookId) : 'HP001';
  if (mode === 'restart') {
    if (!DATE_RE.test(startDate || '') || Math.abs(dayDiff(startDate, today)) > 1) return { ok: false, error: 'bad_start_date' };
    return { ok: true, intent: { kind: 'challenge', season, goalDays, mode, startDate, bookId, ref: `enroll_pay:${season}:${goalDays}:${startDate}` } };
  }
  if (mode === 'new') {
    if (!DATE_RE.test(startDate || '')) return { ok: false, error: 'bad_start_date' };
    const ahead = dayDiff(startDate, today);
    if (ahead < -1 || ahead > 31) return { ok: false, error: 'bad_start_date' };
    return { ok: true, intent: { kind: 'challenge', season, goalDays, mode, startDate, bookId, ref: `enroll_pay:${season}:${goalDays}` } };
  }
  if (mode === 'extend') return { ok: true, intent: { kind: 'challenge', season, goalDays, mode, startDate: null, bookId, ref: `enroll_pay:${season}:${goalDays}` } };
  return { ok: false, error: 'bad_mode' };
}

const classHeaders = (env, extra) => ({ Authorization: `Basic ${btoa(`${env.TOSS_CLASS_SECRET_KEY}:`)}`, 'Content-Type': 'application/json', ...(extra || {}) });

async function memberIdFor(sbFetch, env, authId) {
  const r = await sbFetch(env, `users?auth_uid=eq.${encodeURIComponent(authId)}&select=id&limit=1`);
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows[0]?.id ? String(rows[0].id) : null;
}

async function enrollmentOf(sbFetch, env, memberId, season) {
  const r = await sbFetch(env, `enrollments?user_id=eq.${encodeURIComponent(memberId)}&season_id=eq.${encodeURIComponent(season)}&select=goal_days,status,start_date&limit=1`);
  if (!r.ok) return { ok: false };
  const rows = await r.json().catch(() => []);
  return { ok: true, row: Array.isArray(rows) ? rows[0] || null : null };
}

// 지금 도전 상태와 등록할 내용이 맞는지 — 결제 전에 막는다(10-11 사고: 결제가 먼저 되고 등록이 막혔다).
export function intentFits(intent, row) {
  if (intent.mode === 'new') return row ? 'enrollment_exists' : null;
  if (!row) return 'enrollment_missing';
  if (intent.mode === 'extend' && !(Number(row.goal_days) < intent.goalDays)) return 'cannot_extend';
  return null;
}

export async function prepareChallengeOrder({ req, env, body, cors, json, sbFetch, requireUser, recordPayment, newPaymentId, now }) {
  if (!env.TOSS_CLASS_SECRET_KEY) return json({ ok: false, error: 'checkout_closed' }, 503, cors);
  const user = await requireUser(req, env);
  if (!user || user.isAnonymous) return json({ ok: false, error: 'login_required' }, 401, cors);
  const checked = challengeIntent(body, now);
  if (!checked.ok) return json({ ok: false, error: checked.error }, 400, cors);
  const intent = checked.intent;
  const memberId = await memberIdFor(sbFetch, env, user.id);
  if (!memberId) return json({ ok: false, error: 'member_not_linked' }, 409, cors);
  const enr = await enrollmentOf(sbFetch, env, memberId, intent.season);
  if (!enr.ok) return json({ ok: false, error: 'enrollment_check_failed' }, 503, cors);
  const misfit = intentFits(intent, enr.row);
  if (misfit) return json({ ok: false, error: misfit }, 409, cors);
  const orderId = newPaymentId();
  const amount = CHALLENGE_CARD_PRICES[intent.goalDays];
  const at = new Date().toISOString();
  const stored = await recordPayment(env, {
    id: orderId, email: user.email, user_id: user.id, amount, status: 'READY',
    source: `${CHALLENGE_SOURCE_PREFIX}${intent.goalDays}`,
    raw: { ...intent, memberId, preparedAt: at },
    created_at: at, updated_at: at,
  });
  if (!stored) return json({ ok: false, error: 'order_store_failed' }, 503, cors);
  return json({
    ok: true, orderId, amount, orderName: ORDER_NAMES[intent.goalDays],
    clientKey: env.TOSS_CLASS_CLIENT_KEY || CLASS_WIDGET_CLIENT_KEY, customerKey: user.id, customerEmail: user.email,
  }, 200, cors);
}

// 서버가 도전을 등록한다 — 브라우저의 restartEnrollment·updateEnrollmentGoalDays·submitEnrollment 와 같은 쓰기.
async function enrollPaid(sbFetch, env, intent) {
  const base = `enrollments?user_id=eq.${encodeURIComponent(intent.memberId)}&season_id=eq.${encodeURIComponent(intent.season)}`;
  const repr = { Prefer: 'return=representation' };
  let r;
  if (intent.mode === 'restart') {
    r = await sbFetch(env, base, { method: 'PATCH', headers: repr, body: JSON.stringify({ goal_days: intent.goalDays, start_date: intent.startDate, status: 'active', dropped_at: null }) });
  } else if (intent.mode === 'extend') {
    r = await sbFetch(env, `${base}&goal_days=lt.${intent.goalDays}`, { method: 'PATCH', headers: repr, body: JSON.stringify({ goal_days: intent.goalDays }) });
  } else {
    r = await sbFetch(env, 'enrollments?on_conflict=user_id,season_id', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ user_id: intent.memberId, season_id: intent.season, is_yanawan: true, primary_book_id: intent.bookId, goal_days: intent.goalDays, reading_modes: ['혼자 읽기'], start_date: intent.startDate, status: 'active' }),
    });
  }
  if (!r.ok) return false;
  const rows = await r.json().catch(() => []);
  if (Array.isArray(rows) && rows.length) return true;
  // 이미 같은 결과가 들어가 있으면(재시도) 성공으로 본다.
  const now = await enrollmentOf(sbFetch, env, intent.memberId, intent.season);
  return !!(now.ok && now.row && Number(now.row.goal_days) === intent.goalDays && (intent.mode !== 'restart' || now.row.start_date === intent.startDate));
}

export async function confirmChallengeOrder({ env, body, prepared, cors, json, sbFetch, recordPayment }) {
  if (!env.TOSS_CLASS_SECRET_KEY) return json({ ok: false, error: 'checkout_closed' }, 503, cors);
  const intent = prepared.raw || {};
  const goalDays = Number(intent.goalDays);
  const expected = CHALLENGE_CARD_PRICES[goalDays];
  if (intent.kind !== 'challenge' || !expected || Number(prepared.amount) !== expected || prepared.source !== `${CHALLENGE_SOURCE_PREFIX}${goalDays}`) {
    return json({ ok: false, error: 'order_invalid' }, 409, cors);
  }
  if (Number(body.amount) !== expected) return json({ ok: false, error: 'amount_mismatch' }, 400, cors);
  const paymentKey = String(body.paymentKey || '');
  const orderId = prepared.id;
  const result = { ok: true, orderId, goalDays, mode: intent.mode, startDate: intent.startDate || null };
  if (prepared.status === 'DONE' && intent.enrolledAt) return json({ ...result, enrolled: true }, 200, cors);

  let paid = prepared.status === 'DONE';
  let pay = null;
  if (!paid) {
    const cr = await fetch(`${TOSS_API}/v1/payments/confirm`, { method: 'POST', headers: classHeaders(env, { 'Idempotency-Key': orderId }), body: JSON.stringify({ paymentKey, orderId, amount: expected }) });
    pay = await cr.json().catch(() => null);
    paid = cr.ok && pay?.status === 'DONE' && pay?.totalAmount === expected;
    if (!paid && pay?.code === 'ALREADY_PROCESSED_PAYMENT') {
      const qr = await fetch(`${TOSS_API}/v1/payments/orders/${encodeURIComponent(orderId)}`, { headers: classHeaders(env) });
      const qp = qr.ok ? await qr.json().catch(() => null) : null;
      if (qp?.status === 'DONE' && qp?.totalAmount === expected) { paid = true; pay = qp; }
    }
    await recordPayment(env, {
      id: orderId, payment_key: paymentKey || prepared.payment_key || null, amount: expected,
      status: paid ? 'DONE' : (pay?.code || pay?.status || 'confirm_failed'),
      raw: { ...intent, ...(paid ? { paidAt: new Date().toISOString() } : {}) }, updated_at: new Date().toISOString(),
    });
    if (!paid) return json({ ok: false, error: pay?.code || 'not_paid' }, 402, cors);
  }
  const enrolled = await enrollPaid(sbFetch, env, intent);
  await recordPayment(env, {
    id: orderId, status: 'DONE',
    raw: { ...intent, paidAt: intent.paidAt || new Date().toISOString(), ...(enrolled ? { enrolledAt: new Date().toISOString() } : { enrollFailedAt: new Date().toISOString() }) },
    updated_at: new Date().toISOString(),
  });
  // 결제는 됐는데 등록이 실패하면 202 — 화면은 '결제 완료 · 도전 설정 확인 중'을 보여 주고, 같은 주문으로 다시 부르면 등록만 다시 한다.
  return json({ ...result, enrolled }, enrolled ? 200 : 202, cors);
}
