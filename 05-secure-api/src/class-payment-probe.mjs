// One operator, one provider order, no course grants or writes to membership tables.
export const PROBE = Object.freeze({
  userId: '0bdfc8fb-4444-49a9-8f88-036603eff712',
  email: 'literbryanbae@gmail.com',
  orderId: 'lsprobe_3efb8b27a2cd45ac86745dce8f961d02',
  amount: 100,
  orderName: '리터스텔라 결제 연동 확인 (전액 취소)',
  expiresAt: '2026-10-14T00:00:00+09:00',
  clientKey: 'live_gck_vZnjEJeQVxJnOWvQa2jZ8PmOoBN0',
});
const PATH = '/api/class-payment-probe/';
const ORIGINS = new Set(['http://127.0.0.1:5612', 'https://class-new.literstella.co.kr']);
const BASE = 'https://api.tosspayments.com/v1/payments';

export async function classPaymentProbe(req, env, { requireUser, now = Date.now }) {
  const origin = req.headers.get('Origin') || '';
  const cors = ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {};
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: {
    ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-User-Token',
  } });
  if (origin && !ORIGINS.has(origin)) return reply({ ok: false, error: 'origin_denied' }, 403);
  if (req.method === 'OPTIONS') return reply({ ok: true });
  if (req.method !== 'POST') return reply({ ok: false, error: 'method_not_allowed' }, 405);
  const action = new URL(req.url).pathname.slice(PATH.length);
  if (!['status', 'prepare', 'confirm', 'cancel'].includes(action)) return reply({ ok: false }, 404);
  try {
    const user = await requireUser(req, env);
    if (!user?.emailConfirmed || user.id !== PROBE.userId || user.email?.toLowerCase() !== PROBE.email) {
      return reply({ ok: false, error: 'operator_only' }, 403);
    }
    if (!env.TOSS_CLASS_SECRET_KEY?.startsWith('live_')) return reply({ ok: false, error: 'live_key_missing' }, 503);
    if (!env.OTP_GUARD) return reply({ ok: false, error: 'storage_unavailable' }, 503);
    const storageKey = `class-payment-probe:key:${PROBE.orderId}`;
    let storedKey = await env.OTP_GUARD.get(storageKey);
    const active = env.CLASS_PAYMENT_PROBE_ENABLED === 'true' && now() < Date.parse(PROBE.expiresAt);
    if (['prepare', 'confirm'].includes(action) && !active) return reply({ ok: false, error: 'probe_closed' }, 403);
    const call = async (path, body, suffix) => {
      const response = await fetch(`${BASE}${path}`, {
        method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10000), headers: {
          Authorization: `Basic ${btoa(`${env.TOSS_CLASS_SECRET_KEY}:`)}`, 'Content-Type': 'application/json',
          ...(suffix ? { 'Idempotency-Key': `${PROBE.orderId}-${suffix}` } : {}),
        }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) {
        if (!body && response.status === 404 && data.code === 'NOT_FOUND_PAYMENT') return null;
        const error = new Error('provider_unavailable');
        error.providerCode = /^[A-Z0-9_]{1,80}$/.test(data.code || '') ? data.code : 'UNRECOGNIZED_RESPONSE';
        error.providerStatus = response.status;
        throw error;
      }
      return data;
    };
    // Unified gsk keys support paymentKey lookup, not orderId lookup.
    // Before authentication, a missing-payment GET checks key access without charging.
    const read = async (key = storedKey) => {
      const payment = await call(`/${encodeURIComponent(key || `uncreated_${PROBE.orderId}`)}`);
      if (payment && (payment.orderId !== PROBE.orderId || payment.totalAmount !== PROBE.amount || payment.currency !== 'KRW')) {
        throw new Error('payment_mismatch');
      }
      return payment;
    };
    const publicResult = p => ({
      ok: true, orderId: PROBE.orderId, amount: PROBE.amount, status: p?.status || (storedKey ? 'VERIFICATION_PENDING' : 'NOT_STARTED'),
      balanceAmount: p?.balanceAmount ?? null, approvedAt: p?.approvedAt || null,
      canceledAt: p?.cancels?.find(c => c.cancelStatus === 'DONE')?.canceledAt || null,
      canceledAmount: (p?.cancels || []).filter(c => c.cancelStatus === 'DONE').reduce((n, c) => n + c.cancelAmount, 0),
      refunded: p?.status === 'CANCELED' && p.balanceAmount === 0 &&
        (p.cancels || []).filter(c => c.cancelStatus === 'DONE').reduce((n, c) => n + c.cancelAmount, 0) === PROBE.amount,
      canStart: active && !p && !storedKey, expiresAt: PROBE.expiresAt,
    });
    let payment = await read();
    if (action === 'status') return reply(publicResult(payment));
    if (action === 'prepare') {
      if (payment || storedKey) return reply({ ...publicResult(payment), ok: false, error: 'order_already_exists' }, 409);
      return reply({ ...publicResult(null), clientKey: PROBE.clientKey, customerKey: user.id, orderName: PROBE.orderName });
    }
    if (action === 'confirm') {
      const body = await req.json();
      if (body.orderId !== PROBE.orderId || body.amount !== PROBE.amount ||
          typeof body.paymentKey !== 'string' || !body.paymentKey || body.paymentKey.length > 200) {
        return reply({ ok: false, error: 'payment_mismatch' }, 400);
      }
      if (payment && payment.paymentKey !== body.paymentKey) return reply({ ok: false, error: 'payment_mismatch' }, 409);
      if (storedKey && storedKey !== body.paymentKey) return reply({ ok: false, error: 'payment_mismatch' }, 409);
      if (!payment || ['READY', 'IN_PROGRESS'].includes(payment.status)) {
        // Persist before any charge. Fixed provider order/idempotency IDs protect
        // against duplicate charges even while KV propagation is pending.
        await env.OTP_GUARD.put(storageKey, body.paymentKey);
        storedKey = body.paymentKey;
        // A timeout is ambiguous. Re-read the same order; never generate a new one.
        try { await call('/confirm', { orderId: PROBE.orderId, amount: PROBE.amount, paymentKey: body.paymentKey }, 'confirm'); }
        catch { /* Provider GET below is the final authority. */ }
      }
      payment = await read(body.paymentKey);
      return payment ? reply(publicResult(payment)) : reply({ ok: false, error: 'verification_pending' }, 503);
    }
    const body = await req.json();
    if (body.confirm !== 'CANCEL_100_KRW') return reply({ ok: false, error: 'cancel_confirmation_required' }, 400);
    if (!payment) return reply({ ok: false, error: 'payment_not_found' }, 404);
    if (payment.status === 'CANCELED') return reply(publicResult(payment));
    if (payment.status !== 'DONE' || payment.balanceAmount !== PROBE.amount ||
        !['카드', '간편결제'].includes(payment.method) || typeof payment.paymentKey !== 'string' || !payment.paymentKey) {
      return reply({ ok: false, error: 'manual_review_required' }, 409);
    }
    try { await call(`/${encodeURIComponent(payment.paymentKey)}/cancel`, {
      cancelReason: '운영자 승인 100원 결제 연동 테스트 전액 취소',
    }, 'cancel'); } catch { /* Verify the actual cancellation, including timeout recovery. */ }
    payment = await read();
    const result = publicResult(payment);
    return reply({ ...result, ok: result.refunded, ...(result.refunded ? {} : { error: 'cancel_pending' }) }, result.refunded ? 200 : 503);
  } catch (error) {
    return reply({ ok: false, error: 'verification_pending', ...(error.providerCode ? {
      providerCode: error.providerCode, providerStatus: error.providerStatus,
    } : {}) }, 503);
  }
}
