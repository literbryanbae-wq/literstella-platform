const PROVIDER = 'https://api.tosspayments.com/v1/payments';
const ORDER_ID = /^cls[a-f0-9]{32}$/;
const CLIENT_KEY = 'live_gck_vZnjEJeQVxJnOWvQa2jZ8PmOoBN0';

function purchaseTerms(env) {
  try {
    const url = new URL(env.CLASS_MEMBER_CHECKOUT_TERMS_URL);
    const version = env.CLASS_MEMBER_CHECKOUT_TERMS_VERSION;
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['class-new.literstella.co.kr', 'challenge.literstella.co.kr', 'literstella.co.kr'].includes(url.hostname) ||
        !/^[a-zA-Z0-9._-]{1,80}$/.test(version || '')) return null;
    return { url: url.href, version };
  } catch { return null; }
}

export async function classMemberCheckout(req, env, cors, action, { requireUser, sbFetch, json, productCode = 'class-stella-member-upgrade' }) {
  const reply = (body, status = 200) => json(body, status, { ...cors, 'Cache-Control': 'no-store' });
  if (req.method !== 'POST') return reply({ ok: false, error: 'method_not_allowed' }, 405);
  const rpc = async (name, args) => {
    const r = await sbFetch(env, `rpc/class_checkout_${name}`, { method: 'POST', body: JSON.stringify(args) });
    if (!r.ok) throw new Error('storage_unavailable');
    return r.json();
  };
  const headers = () => ({ Authorization: `Basic ${btoa(`${env.TOSS_CLASS_SECRET_KEY}:`)}`, 'Content-Type': 'application/json' });
  const getPayment = async (key) => {
    const r = await fetch(`${PROVIDER}/${encodeURIComponent(key)}`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('provider_unavailable');
    return r.json();
  };
  const findOrders = async (filter) => {
    const r = await sbFetch(env, `class_checkout_orders?${filter}&select=id,amount,payment_key,status,product_code&limit=1`);
    if (!r.ok) throw new Error('storage_unavailable');
    return r.json();
  };
  const settle = async (pay, id, key, amount) => {
    if (pay.orderId !== id || pay.paymentKey !== key || pay.totalAmount !== amount || pay.currency !== 'KRW') {
      return { ok: false, error: 'payment_mismatch' };
    }
    return rpc('settle', { p_order_id: id, p_payment_key: key, p_amount: amount, p_status: pay.status });
  };
  try {
    // The activation switch controls NEW orders, not already-paid recovery/refunds.
    if (action === 'webhook') {
      if (!env.TOSS_CLASS_SECRET_KEY) return reply({ ok: false }, 503);
      const b = await req.json();
      const key = b?.data?.paymentKey;
      const id = b?.data?.orderId;
      if (typeof key !== 'string' || key.length > 200 || !ORDER_ID.test(id || '')) return reply({ ok: false }, 400);
      const r = await sbFetch(env, `class_checkout_orders?id=eq.${encodeURIComponent(id)}&select=id,amount,payment_key&limit=1`);
      if (!r.ok) return reply({ ok: false }, 503);
      const [order] = await r.json();
      if (!order || order.payment_key !== key) return reply({ ok: true, ignored: true });
      const result = await settle(await getPayment(key), id, key, order.amount);
      return reply(result, result.ok ? 200 : 503);
    }
    const user = await requireUser(req, env);
    if (!user?.id || !user.emailConfirmed) return reply({ ok: false, error: 'login_required' }, 401);
    if (!['quote','prepare','confirm','status'].includes(action)) return reply({ ok: false, error: 'not_found' }, 404);
    const terms = purchaseTerms(env);
    const publicEnabled = env.CLASS_MEMBER_CHECKOUT_ENABLED === 'true';
    const pilot = env.CLASS_MEMBER_CHECKOUT_PILOT;
    const pilotAllowed = pilot && user.id === pilot.userId &&
      Number.isSafeInteger(pilot.amount) && pilot.amount > 0 &&
      Number.isFinite(Date.parse(pilot.expiresAt)) && Date.now() < Date.parse(pilot.expiresAt);
    let enabled = (publicEnabled || !!pilotAllowed) && !!env.TOSS_CLASS_SECRET_KEY && !!terms;
    // A private rehearsal never opens sales globally or permits another payment after refund.
    if (!publicEnabled && enabled && ['quote', 'prepare'].includes(action)) {
      const [previous] = await findOrders(`user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc`);
      if (previous && (previous.status !== 'ready' || previous.payment_key)) enabled = false;
    }
    if (action === 'quote') {
      const q = await rpc('quote', { p_user_id: user.id });
      if (!publicEnabled && q.amount !== pilot?.amount) enabled = false;
      const [pending] = await findOrders(`user_id=eq.${encodeURIComponent(user.id)}&status=in.(confirming,partial_refund_review)&order=created_at.desc`);
      const pendingBook = pending?.product_code?.match(/^class-([a-z0-9]+)-lifetime$/)?.[1];
      return reply({ ...q, pendingOrder: pending ? { orderId: pending.id, status: pending.status, checkoutPath: pendingBook ? `/purchase/course/${pendingBook}` : '/purchase/member' } : null,
        terms, checkoutEnabled: enabled, clientKey: enabled ? (env.TOSS_CLASS_CLIENT_KEY || CLIENT_KEY) : null });
    }
    const b = await req.json();
    if (action === 'status') {
      if (!ORDER_ID.test(b.orderId || '')) return reply({ ok: false, error: 'order_not_found' }, 404);
      const [order] = await findOrders(`id=eq.${encodeURIComponent(b.orderId)}&user_id=eq.${encodeURIComponent(user.id)}`);
      if (!order || order.product_code !== productCode) return reply({ ok: false, error: 'order_not_found' }, 404);
      if (!order.payment_key) return reply({ ok: false, error: 'payment_pending' }, 202);
      if (!env.TOSS_CLASS_SECRET_KEY) return reply({ ok: false, error: 'verification_pending' }, 503);
      // Recovery is GET-only at the provider: never approve a payment just by checking it.
      const result = await settle(await getPayment(order.payment_key), order.id, order.payment_key, order.amount);
      return reply(result, result.ok ? 200 : 409);
    }
    if (action === 'prepare') {
      if (!enabled) return reply({ ok: false, error: 'checkout_closed' }, 503);
      if (b.acceptedTermsVersion !== terms.version) return reply({ ok: false, error: 'terms_changed' }, 409);
      if (!Number.isSafeInteger(b.expectedAmount)) return reply({ ok: false, error: 'amount_mismatch' }, 400);
      if (!publicEnabled && b.expectedAmount !== pilot.amount) return reply({ ok: false, error: 'amount_mismatch' }, 400);
      const result = await rpc('prepare', { p_user_id: user.id, p_expected_amount: b.expectedAmount,
        p_terms_version: terms.version, p_terms_url: terms.url });
      return reply(result, result.ok ? 200 : 409);
    }
    if (!env.TOSS_CLASS_SECRET_KEY) return reply({ ok: false, error: 'checkout_closed' }, 503);
    if (!ORDER_ID.test(b.orderId || '') || typeof b.paymentKey !== 'string' || !b.paymentKey || b.paymentKey.length > 200 || !Number.isSafeInteger(b.amount)) {
      return reply({ ok: false, error: 'bad_payment' }, 400);
    }
    const [selected] = await findOrders(`id=eq.${encodeURIComponent(b.orderId)}&user_id=eq.${encodeURIComponent(user.id)}`);
    if (!selected || selected.product_code !== productCode) return reply({ ok: false, error: 'order_not_found' }, 404);
    const order = await rpc('claim', { p_user_id: user.id, p_order_id: b.orderId, p_payment_key: b.paymentKey, p_amount: b.amount });
    if (!order.ok) return reply(order, 409);
    // Repeated returns use a fresh provider GET and can never revive canceled grants.
    const existing = await getPayment(b.paymentKey);
    if (['DONE', 'CANCELED', 'PARTIAL_CANCELED', 'ABORTED', 'EXPIRED'].includes(existing.status)) {
      const result = await settle(existing, order.orderId, b.paymentKey, order.amount);
      return reply(result, result.ok ? 200 : 409);
    }
    if (existing.orderId !== order.orderId || existing.paymentKey !== b.paymentKey || existing.totalAmount !== order.amount || existing.currency !== 'KRW') {
      return reply({ ok: false, error: 'payment_mismatch' }, 409);
    }
    if (order.status !== 'paid') {
      const response = await fetch(`${PROVIDER}/confirm`, {
        method: 'POST', headers: { ...headers(), 'Idempotency-Key': order.orderId },
        body: JSON.stringify({ paymentKey: b.paymentKey, orderId: order.orderId, amount: order.amount }),
        signal: AbortSignal.timeout(8000),
      });
      const pay = await response.json().catch(() => ({}));
      if (!response.ok && pay.code !== 'ALREADY_PROCESSED_PAYMENT') {
        // Ambiguous provider failures leave the same order pending, never create a second charge.
        return reply({ ok: false, error: 'payment_pending' }, 202);
      }
    }
    const result = await settle(await getPayment(b.paymentKey), order.orderId, b.paymentKey, order.amount);
    return reply(result, result.ok ? 200 : 409);
  } catch {
    // Never return provider payloads, tokens, secrets, or DB exception details.
    return reply({ ok: false, error: 'verification_pending' }, 503);
  }
}
