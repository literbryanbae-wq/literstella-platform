// 구독 정기결제(토스 빌링) — /api/class-subscription/{quote,prepare,confirm,status,cancel,upgrade-quote,upgrade,gift-redeem,webhook}
//   + 기간권(한 번 결제, 2026-11-14) — /api/class-subscription/{once-prepare,once-confirm} · 스위치 CLASS_SUBSCRIPTION_ONETIME_ENABLED
//   🔴 아직 진입 모듈에 연결하지 않았다(미배포). 여는 순서 = LIVE-SOURCE.md '구독 결제' 절.
//   금액은 서버가 정한다(class-subscription-pricing.mjs). 화면이 보낸 금액은 '같은지'만 본다.
//   카드 정보는 이 서버를 지나가지 않는다 — 토스 창이 authKey 를 주고, 서버가 그것으로 빌링키를 받는다.
import { subscriptionQuote, conversionQuote, pointsPlan } from './class-subscription-pricing.mjs';

const TOSS = 'https://api.tosspayments.com/v1';
// 클래스 결제 위젯 공개 키(공개값) — class-member-checkout.mjs CLIENT_KEY · challenge-card-checkout.mjs CLASS_WIDGET_CLIENT_KEY 와 같은 값.
//   그 두 모듈을 import 하지 않는다(라이브에서 묶는 방식이 달라 모듈 하나를 더 올려야 한다). 서버 변수 TOSS_CLASS_CLIENT_KEY 가 있으면 그쪽이 우선.
const CLASS_WIDGET_CLIENT_KEY = 'live_gck_vZnjEJeQVxJnOWvQa2jZ8PmOoBN0';
const ORDER_ID = /^sub[a-f0-9]{32}$/;

function terms(env) {
  try {
    const url = new URL(env.CLASS_SUBSCRIPTION_TERMS_URL);
    const version = env.CLASS_SUBSCRIPTION_TERMS_VERSION;
    if (url.protocol !== 'https:' || !['class-new.literstella.co.kr', 'challenge.literstella.co.kr'].includes(url.hostname) ||
        !/^[a-zA-Z0-9._-]{1,80}$/.test(version || '')) return null;
    return { url: url.href, version };
  } catch { return null; }
}

// secret = 어느 토스 상점 키로 묻는가. 자동 결제(빌링) = TOSS_BILLING_SECRET_KEY(기본) ·
//   기간권(한 번 결제) = 클래스 결제 위젯 상점 TOSS_CLASS_SECRET_KEY(클래스 회원·강좌 결제와 같은 키 — 새 키를 만들지 않는다).
function client(env, sbFetch, secret = env.TOSS_BILLING_SECRET_KEY) {
  const auth = () => ({ Authorization: `Basic ${btoa(`${secret}:`)}`, 'Content-Type': 'application/json' });
  const rpc = async (name, args) => {
    const r = await sbFetch(env, `rpc/class_subscription_${name}`, { method: 'POST', body: JSON.stringify(args) });
    if (!r.ok) throw new Error('storage_unavailable');
    return r.json();
  };
  const rows = async (q) => {
    const r = await sbFetch(env, q);
    if (!r.ok) throw new Error('storage_unavailable');
    return r.json();
  };
  const getPayment = async (key) => {
    const r = await fetch(`${TOSS}/payments/${encodeURIComponent(key)}`, { headers: auth(), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('provider_unavailable');
    return r.json();
  };
  // 빌링키로 한 번 청구. 같은 주문 번호는 토스가 한 번만 받는다(Idempotency-Key).
  const charge = async ({ billingKey, customerKey, orderId, amount, orderName }) => {
    const r = await fetch(`${TOSS}/billing/${encodeURIComponent(billingKey)}`, {
      method: 'POST', headers: { ...auth(), 'Idempotency-Key': orderId },
      body: JSON.stringify({ customerKey, amount, orderId, orderName }), signal: AbortSignal.timeout(15000),
    });
    const pay = await r.json().catch(() => ({}));
    return { ok: r.ok, pay };
  };
  const settle = async (pay, orderId, amount) => {
    if (pay.orderId !== orderId || pay.totalAmount !== amount || pay.currency !== 'KRW') return { ok: false, error: 'payment_mismatch' };
    return rpc('settle', { p_order_id: orderId, p_payment_key: pay.paymentKey, p_amount: amount, p_status: pay.status,
      p_canceled_amount: Math.max(0, (pay.totalAmount || 0) - (pay.balanceAmount ?? pay.totalAmount ?? 0)) });
  };
  return { auth, rpc, rows, getPayment, charge, settle };
}

const orderName = (plan, cycle) => `리터스텔라 ${plan === 'together' ? '함께 읽기' : '개인'} ${cycle === 'year' ? '연간' : '월'} 구독`;
const onceOrderName = (plan, cycle) => `${orderName(plan, cycle)}(1회 결제)`;
// 거절이 분명한 토스 오류인가 — 애매하면(시간 초과·내부 오류) 실패로 적지 않는다(두 번 청구 금지). 자동 결제와 같은 규칙.
const declined = (code) => !!code && !/TIMEOUT|UNKNOWN|PROVIDER_ERROR|FAILED_INTERNAL/.test(code);
// 기간권 DB 오류 → HTTP 상태
const onceStatus = (e) => e === 'login_required' ? 401 : ['bad_plan', 'bad_points', 'bad_amount', 'bad_payment'].includes(e) ? 400
  : e === 'order_not_found' ? 404 : 409;

/** 기간권 시험 계정 목록(CLASS_SUBSCRIPTION_ONETIME_TESTERS — 쉼표 구분 이메일, 소문자·공백 무시). */
export function onetimeTesters(env) {
  return String(env.CLASS_SUBSCRIPTION_ONETIME_TESTERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** 기간권(구독 한 기간을 일반 결제 한 번으로) 판매가 이 회원에게 열려 있는가 — 자동 결제 스위치와 별개.
 *  ONETIME_ENABLED === 'true' 면 모두에게, 아니면 로그인 회원 이메일이 시험 계정 목록에 있을 때만(2026-11-14). 토스 키·약관은 늘 필요. */
export function onetimeOpen(env, tm, email) {
  if (!env.TOSS_CLASS_SECRET_KEY || !tm) return false;
  if (env.CLASS_SUBSCRIPTION_ONETIME_ENABLED === 'true') return true;
  const e = String(email || '').trim().toLowerCase();
  return !!e && onetimeTesters(env).includes(e);
}

export async function classSubscription(req, env, cors, action, { requireUser, sbFetch, json }) {
  const reply = (body, status = 200) => json(body, status, { ...cors, 'Cache-Control': 'no-store' });
  if (req.method !== 'POST') return reply({ ok: false, error: 'method_not_allowed' }, 405);
  const t = client(env, sbFetch);
  try {
    if (action === 'webhook') {
      if (!env.TOSS_BILLING_SECRET_KEY && !env.TOSS_CLASS_SECRET_KEY) return reply({ ok: false }, 503);
      const b = await req.json();
      const key = b?.data?.paymentKey; const id = b?.data?.orderId;
      if (typeof key !== 'string' || key.length > 200 || !ORDER_ID.test(id || '')) return reply({ ok: false }, 400);
      const [row] = await t.rows(`class_subscription_payments?id=eq.${id}&select=id,amount,payment_key,subscription_id&limit=1`);
      if (!row || (row.payment_key && row.payment_key !== key)) return reply({ ok: true, ignored: true });
      // 기간권 주문은 클래스 결제 위젯 상점에서 결제됐다 → 그 상점 키로 묻는다. 자동 결제 주문은 지금처럼 빌링 키.
      const [owner] = await t.rows(`class_subscriptions?id=eq.${row.subscription_id}&select=*&limit=1`);
      const once = owner?.billing_mode === 'once';
      const secret = once ? env.TOSS_CLASS_SECRET_KEY : env.TOSS_BILLING_SECRET_KEY;
      if (!secret) return reply({ ok: false }, 503);
      const tw = once ? client(env, sbFetch, secret) : t;
      const result = await tw.settle(await tw.getPayment(key), id, row.amount); // 웹훅 본문은 믿지 않고 토스에 다시 묻는다
      // 전액 취소(환불)된 주문에 쓴 포인트는 돌려놓는다. 실패하면 503 — 토스가 웹훅을 다시 보낸다.
      if (result.ok && result.status === 'canceled') await t.rpc('points_release', { p_order_id: id });
      // 월 → 연간 전환 결제의 부분 취소(이용 일수만큼 빼고 환불) = 쓴 포인트도 같은 비율로 돌려놓는다(운영자 2026-11-13).
      //   누적 취소액으로 매번 다시 계산하므로 웹훅을 여러 번 받아도 같은 결과. 첫·갱신 결제의 부분 취소는 지금처럼 기록만.
      //   기간권(한 번 결제)의 부분 취소(연간 — 지난 개월 수만큼 빼고 환불)도 같은 비율 반환(2026-11-14).
      if (result.ok && result.status === 'partial_canceled' && (result.kind === 'upgrade' || once)) await t.rpc('points_refund', { p_order_id: id });
      return reply(result, result.ok ? 200 : 503);
    }
    const user = await requireUser(req, env);
    if (!user?.id || !user.emailConfirmed) return reply({ ok: false, error: 'login_required' }, 401);
    if (!['quote', 'prepare', 'confirm', 'status', 'cancel', 'upgrade-quote', 'upgrade', 'gift-redeem', 'once-prepare', 'once-confirm'].includes(action)) return reply({ ok: false, error: 'not_found' }, 404);
    const tm = terms(env);
    const onceOpen = onetimeOpen(env, tm, user.email);
    // 기간권 판매가 이 회원에게 닫혀 있으면(스위치 꺼짐 + 시험 계정 아님) DB·토스를 건드리기 전에 닫는다
    if ((action === 'once-prepare' || action === 'once-confirm') && !onceOpen) return reply({ ok: false, error: 'onetime_closed' }, 503);
    const enabled = env.CLASS_SUBSCRIPTION_ENABLED === 'true' && !!env.TOSS_BILLING_SECRET_KEY && !!env.TOSS_BILLING_CLIENT_KEY && !!tm;
    // 선물 구독권(야나완 성공 선물) — 판매 스위치와 별개. 결제가 없으니 토스 키는 보지 않고, 약관 변수는 있어야 열린다.
    const giftEnabled = env.CLASS_SUBSCRIPTION_GIFT_ENABLED === 'true' && !!tm;
    if (action === 'gift-redeem') {
      if (!giftEnabled) return reply({ ok: false, error: 'gift_closed' }, 503);
      const g = await req.json().catch(() => ({}));
      if (g.acceptedTermsVersion !== tm.version) return reply({ ok: false, error: 'terms_changed' }, 409);
      if (typeof g.code !== 'string' || !g.code.trim() || g.code.length > 40) return reply({ ok: false, error: 'invalid_code' }, 400);
      const r = await t.rpc('gift_redeem', { p_user_id: user.id, p_code: g.code, p_terms_version: tm.version, p_terms_url: tm.url });
      // self_not_allowed(성공한 회원 본인) · owner_not_allowed(올인원 소장) · already_subscribed = 409, 코드는 남는다(수강 조건 제6조)
      const status = r.ok ? 200 : r.error === 'too_many_attempts' ? 429 : r.error === 'login_required' ? 401
        : ['invalid_code', 'used_code', 'expired_code'].includes(r.error) ? 400 : 409;
      return reply(r, status);
    }
    const summary = await t.rpc('summary', { p_user_id: user.id });
    const owned = Number(summary?.ownedOriginals) || 0;
    // 핵심 이론을 소장으로 세는가 — 판정은 DB 한 곳(올인원 결제와 같은 규칙, 운영자 2026-11-13). 화면·DB 에는 '할인에 센 권수'를 넘긴다.
    const ownedTheory = summary?.ownedTheory === true;
    const owns = { ownedOriginals: owned, ownedTheory };
    const balance = Math.max(0, Number(summary?.pointsBalance) || 0);
    const b = action === 'status' ? {} : await req.json().catch(() => ({}));
    // 기간권은 처음 결제에만 포인트(판정 = DB private.class_subscription_points_allowed) — 못 읽으면 true(자동 결제 첫 결제와 같은 화면)
    const pointsAllowed = summary?.pointsAllowed !== false;

    if (action === 'once-prepare') {
      // 기간권 주문 만들기 — 금액은 자동 결제와 같은 서버 견적(요금제 × 주기 × 소장 할인). 포인트는 처음 결제에만.
      const q = subscriptionQuote({ plan: b.plan, cycle: b.cycle, ownedCount: owned, ownedTheory });
      if (!q.ok) return reply(q, 400);
      if (b.acceptedTermsVersion !== tm.version) return reply({ ok: false, error: 'terms_changed' }, 409);
      if (b.expectedAmount !== q.amount) return reply({ ok: false, error: 'amount_mismatch', amount: q.amount }, 409);
      const wants = b.usePoints === undefined || b.usePoints === null ? 0 : b.usePoints;
      if (wants !== 0 && Number.isInteger(wants) && wants > 0 && !pointsAllowed) return reply({ ok: false, error: 'points_not_allowed' }, 409);
      const pts = pointsPlan(q, b.usePoints, balance);
      if (!pts.ok) return reply({ ...pts, balance }, pts.error === 'points_short' ? 409 : 400);
      const r = await t.rpc('once_begin', { p_user_id: user.id, p_plan: b.plan, p_cycle: b.cycle, p_amount: q.amount,
        p_list_amount: q.listAmount, p_owned_count: q.discountBooks, p_terms_version: tm.version, p_terms_url: tm.url, p_points: pts.usePoints });
      if (!r.ok) return reply(r, onceStatus(r.error));
      return reply({ ...r, listAmount: q.listAmount, ownedDiscount: q.ownedDiscount, orderName: onceOrderName(r.plan, r.cycle),
        billingMode: 'once', clientKey: env.TOSS_CLASS_CLIENT_KEY || CLASS_WIDGET_CLIENT_KEY });
    }

    if (action === 'once-confirm') {
      // 토스 결제창이 돌려준 paymentKey·orderId·amount 로 승인한다. 같은 주문을 다시 보내도 같은 답(두 번 결제·두 기간 없음).
      if (!ORDER_ID.test(b.orderId || '') || typeof b.paymentKey !== 'string' || !b.paymentKey || b.paymentKey.length > 200 || !Number.isSafeInteger(b.amount)) {
        return reply({ ok: false, error: 'bad_payment' }, 400);
      }
      const tc = client(env, sbFetch, env.TOSS_CLASS_SECRET_KEY);
      const o = await tc.rpc('once_claim', { p_user_id: user.id, p_order_id: b.orderId, p_payment_key: b.paymentKey, p_amount: b.amount });
      if (!o.ok) return reply(o, onceStatus(o.error));
      if (o.status === 'paid') return reply({ ok: true, status: 'paid', orderId: o.orderId, periodEnd: o.periodEnd, billingMode: 'once' });
      const finish = async (pay) => {
        const result = await tc.settle(pay, o.orderId, o.amount);
        if (result.ok && result.status === 'canceled' && o.pointsUsed > 0) await tc.rpc('points_release', { p_order_id: o.orderId });
        return reply(result.ok ? { ...result, billingMode: 'once' } : result, result.ok ? 200 : 409);
      };
      // 승인 전에 토스에 먼저 묻는다 — 이미 끝난 결제면 그 결과를 반영만 한다(다시 승인하지 않는다)
      const existing = await tc.getPayment(b.paymentKey);
      if (existing.orderId !== o.orderId || existing.paymentKey !== b.paymentKey || existing.totalAmount !== o.amount || existing.currency !== 'KRW') {
        return reply({ ok: false, error: 'payment_mismatch' }, 409);
      }
      if (['DONE', 'CANCELED', 'PARTIAL_CANCELED'].includes(existing.status)) return finish(existing);
      if (['ABORTED', 'EXPIRED'].includes(existing.status)) {
        await tc.rpc('fail', { p_order_id: o.orderId, p_code: existing.status });
        if (o.pointsUsed > 0) await tc.rpc('points_release', { p_order_id: o.orderId });
        return reply({ ok: false, error: 'card_declined' }, 402);
      }
      // 포인트는 승인 직전에 차감한다 — 모자라면 승인하지 않는다(돈이 나가지 않는다)
      if (o.pointsUsed > 0) {
        const held = await tc.rpc('points_reserve', { p_order_id: o.orderId });
        if (!held.ok) return reply({ ok: false, error: held.error || 'points_short' }, 409);
      }
      const response = await fetch(`${TOSS}/payments/confirm`, {
        method: 'POST', headers: { ...tc.auth(), 'Idempotency-Key': o.orderId },
        body: JSON.stringify({ paymentKey: b.paymentKey, orderId: o.orderId, amount: o.amount }), signal: AbortSignal.timeout(10000),
      });
      const pay = await response.json().catch(() => ({}));
      if (!response.ok && pay.code !== 'ALREADY_PROCESSED_PAYMENT') {
        if (declined(pay.code)) {
          await tc.rpc('fail', { p_order_id: o.orderId, p_code: pay.code });
          if (o.pointsUsed > 0) await tc.rpc('points_release', { p_order_id: o.orderId }); // 거절이 분명하니 포인트를 돌려놓는다
          return reply({ ok: false, error: 'card_declined' }, 402);
        }
        return reply({ ok: false, error: 'payment_pending' }, 202); // 애매함 — 같은 값으로 once-confirm 을 다시 부르면 된다
      }
      return finish(await tc.getPayment(b.paymentKey));
    }

    if (action === 'status') {
      // 내 서재가 읽는다 — 구독 상태 + 올인원 전환 견적(12월 31일까지 낸 금액만큼 차감)
      const ownedAll = await sbFetch(env, 'rpc/class_checkout_quote', { method: 'POST', body: JSON.stringify({ p_user_id: user.id }) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const conversion = ownedAll?.ok && !ownedAll.complete
        ? conversionQuote({ ownedCount: ownedAll.ownedCount, payments: summary?.payments || [] }) : null;
      return reply({ ok: true, subscription: summary?.subscription || null, checkoutEnabled: enabled, giftEnabled, onetimeOpen: onceOpen, pointsAllowed, terms: tm,
        conversion: conversion && conversion.credit > 0 ? conversion : null });
    }
    if (action === 'cancel') {
      const r = await t.rpc('cancel', { p_user_id: user.id });
      return reply(r, r.ok ? 200 : 409);
    }
    if (action === 'upgrade-quote' || action === 'upgrade') {
      // 월 → 연간 전환: 이번 달 남은 날짜만큼 빼고, 등록된 카드로 바로 청구한다(운영자 2026-11-13).
      //   🔴 요금제는 지금 월 구독의 것 그대로(운영자 2026-11-13) — 화면이 보낸 plan 은 믿지 않는다.
      //   함께 읽기 → 개인으로 바꾸면 초대받은 분들의 자리가 그 순간 닫힌다. 다른 plan 을 보내면 409 plan_fixed(청구 0).
      //   upgrade_begin(DB, 운영 적용됨)은 p_plan 을 그대로 받으므로 막는 곳은 여기 한 곳이다(service_role 전용 RPC).
      // 기간권(한 번 결제)에는 등록된 카드가 없다 — 월 → 연간은 '끝나기 14일 전부터 연간으로 이어 사기'(once-prepare)로(운영자 2026-11-14)
      if (summary?.subscription?.billingMode === 'once' && ['active', 'past_due'].includes(summary.subscription.status)) {
        return reply({ ok: false, error: 'once_use_renewal', renewableFrom: summary.subscription.renewableFrom ?? null }, 409);
      }
      const uq = await t.rpc('upgrade_quote', { p_user_id: user.id });
      if (!uq.ok) return reply(uq, 409);
      const plan = uq.plan || summary?.subscription?.plan;
      if (b.plan !== undefined && b.plan !== null && b.plan !== '' && b.plan !== plan) return reply({ ok: false, error: 'plan_fixed' }, 409);
      const yq = subscriptionQuote({ plan, cycle: 'year', ownedCount: owned, ownedTheory });
      if (!yq.ok) return reply(yq, 400);
      const pointsMax = Math.min(Math.max(0, yq.pointsMax - (Number(uq.pointsUsedThisPeriod) || 0)), balance);
      const view = { ok: true, plan, cycle: 'year', listAmount: yq.listAmount, amount: yq.amount, ownedDiscount: yq.ownedDiscount, ownedCount: yq.discountBooks, ...owns,
        credit: uq.credit, daysLeft: uq.daysLeft, payAmount: yq.amount - uq.credit, pointsMax, pointsBalance: balance, terms: tm, checkoutEnabled: enabled };
      if (action === 'upgrade-quote') return reply(view);
      if (!enabled) return reply({ ok: false, error: 'checkout_closed' }, 503);
      if (b.acceptedTermsVersion !== tm.version) return reply({ ok: false, error: 'terms_changed' }, 409);
      if (b.expectedAmount !== view.payAmount) return reply({ ok: false, error: 'amount_mismatch', amount: view.payAmount }, 409);
      const use = b.usePoints === undefined || b.usePoints === null ? 0 : b.usePoints;
      if (!Number.isInteger(use) || use < 0 || use > Math.max(0, yq.pointsMax - (Number(uq.pointsUsedThisPeriod) || 0))) return reply({ ok: false, error: 'bad_points' }, 400);
      if (use > balance) return reply({ ok: false, error: 'points_short', balance }, 409);
      const o = await t.rpc('upgrade_begin', { p_user_id: user.id, p_plan: plan, p_amount: yq.amount, p_list_amount: yq.listAmount,
        p_owned_count: yq.discountBooks, p_terms_version: tm.version, p_terms_url: tm.url, p_points: use });
      if (!o.ok) return reply(o, 409);
      if (o.usePoints > 0) {
        const held = await t.rpc('points_reserve', { p_order_id: o.orderId });
        if (!held.ok) { await t.rpc('fail', { p_order_id: o.orderId, p_code: 'POINTS_SHORT' }); return reply({ ok: false, error: held.error || 'points_short' }, 409); }
      }
      const res = await t.charge({ billingKey: o.billingKey, customerKey: o.customerKey, orderId: o.orderId, amount: o.cardAmount, orderName: orderName(plan, 'year') });
      if (!res.ok && res.pay.code !== 'ALREADY_PROCESSED_PAYMENT') {
        if (res.pay.code && !/TIMEOUT|UNKNOWN|PROVIDER_ERROR|FAILED_INTERNAL/.test(res.pay.code)) {
          await t.rpc('fail', { p_order_id: o.orderId, p_code: res.pay.code });
          if (o.usePoints > 0) await t.rpc('points_release', { p_order_id: o.orderId });
          return reply({ ok: false, error: 'card_declined' }, 402); // 월 구독은 그대로 이어진다
        }
        return reply({ ok: false, error: 'payment_pending' }, 202);
      }
      if (!res.pay.paymentKey) return reply({ ok: false, error: 'payment_pending' }, 202);
      const result = await t.settle(await t.getPayment(res.pay.paymentKey), o.orderId, o.cardAmount);
      return reply(result.ok ? { ...result, credit: o.credit, cardAmount: o.cardAmount } : result, result.ok ? 200 : 409);
    }
    const q = subscriptionQuote({ plan: b.plan, cycle: b.cycle, ownedCount: owned, ownedTheory });
    if (action === 'quote') {
      if (!q.ok) return reply(q, 400);
      // 무료로 먼저 써 본 분의 첫 결제에 더 드리는 달(런칭 선물) — 못 읽으면 0 으로 보여 주고, 실제 적용은 주문을 만들 때 DB 가 다시 정한다.
      const bonus = await t.rpc('bonus', { p_user_id: user.id, p_plan: b.plan, p_cycle: b.cycle }).catch(() => null);
      q.bonusMonths = Number(bonus?.months) || 0;
      // pointsAllowed = 기간권에 포인트를 쓸 수 있는가(처음 결제만). 자동 결제 첫 결제(prepare)는 이 값과 무관하게 지금처럼.
      return reply({ ...q, pointsMax: Math.min(q.pointsMax, balance), pointsBalance: balance, pointsAllowed, ownedCount: q.discountBooks, ...owns, terms: tm, checkoutEnabled: enabled, onetimeOpen: onceOpen, subscription: summary?.subscription || null,
        clientKey: enabled ? env.TOSS_BILLING_CLIENT_KEY : null });
    }
    if (!enabled) return reply({ ok: false, error: 'checkout_closed' }, 503);
    if (action === 'prepare') {
      if (!q.ok) return reply(q, 400);
      if (b.acceptedTermsVersion !== tm.version) return reply({ ok: false, error: 'terms_changed' }, 409);
      if (b.expectedAmount !== q.amount) return reply({ ok: false, error: 'amount_mismatch', amount: q.amount }, 409);
      const pts = pointsPlan(q, b.usePoints, balance);
      if (!pts.ok) return reply({ ...pts, balance }, pts.error === 'points_short' ? 409 : 400);
      const r = await t.rpc('begin', { p_user_id: user.id, p_plan: b.plan, p_cycle: b.cycle, p_amount: q.amount,
        p_list_amount: q.listAmount, p_owned_count: q.discountBooks, p_terms_version: tm.version, p_terms_url: tm.url, p_points: pts.usePoints });
      return reply(r.ok ? { ...r, clientKey: env.TOSS_BILLING_CLIENT_KEY } : r, r.ok ? 200 : 409);
    }
    // confirm — 토스 카드 등록 창이 돌려준 authKey 로 빌링키를 받고 첫 결제를 한다.
    if (!ORDER_ID.test(b.orderId || '') || typeof b.authKey !== 'string' || !b.authKey || b.authKey.length > 300) return reply({ ok: false, error: 'bad_request' }, 400);
    const [pay] = await t.rows(`class_subscription_payments?id=eq.${b.orderId}&user_id=eq.${user.id}&select=id,amount,status,payment_key,subscription_id,points_used&limit=1`);
    if (!pay) return reply({ ok: false, error: 'order_not_found' }, 404);
    if (pay.status === 'paid') return reply({ ok: true, status: 'paid', orderId: pay.id });
    if (pay.status !== 'ready') return reply({ ok: false, error: 'order_closed' }, 409);
    const [sub] = await t.rows(`class_subscriptions?id=eq.${pay.subscription_id}&select=id,plan,cycle,customer_key,billing_key&limit=1`);
    if (!sub) return reply({ ok: false, error: 'order_not_found' }, 404);
    let billingKey = sub.billing_key;
    if (!billingKey) {
      const r = await fetch(`${TOSS}/billing/authorizations/issue`, { method: 'POST', headers: t.auth(),
        body: JSON.stringify({ authKey: b.authKey, customerKey: sub.customer_key }), signal: AbortSignal.timeout(10000) });
      const issued = await r.json().catch(() => ({}));
      if (!r.ok || !issued.billingKey) return reply({ ok: false, error: 'card_not_registered' }, 409);
      billingKey = issued.billingKey;
      await t.rpc('attach_key', { p_subscription_id: sub.id, p_billing_key: billingKey });
    }
    // 포인트는 카드 청구 직전에 차감한다 — 모자라면 카드를 청구하지 않는다(돈이 나가지 않는다).
    if (pay.points_used > 0) {
      const held = await t.rpc('points_reserve', { p_order_id: pay.id });
      if (!held.ok) return reply({ ok: false, error: held.error || 'points_short' }, 409);
    }
    const res = await t.charge({ billingKey, customerKey: sub.customer_key, orderId: pay.id, amount: pay.amount, orderName: orderName(sub.plan, sub.cycle) });
    if (!res.ok && res.pay.code !== 'ALREADY_PROCESSED_PAYMENT') {
      // 거절이 분명할 때만 실패로 적는다. 애매하면 그대로 두고(두 번 청구 금지) 화면이 status 로 다시 묻는다.
      if (res.pay.code && !/TIMEOUT|UNKNOWN|PROVIDER_ERROR|FAILED_INTERNAL/.test(res.pay.code)) {
        await t.rpc('fail', { p_order_id: pay.id, p_code: res.pay.code });
        if (pay.points_used > 0) await t.rpc('points_release', { p_order_id: pay.id }); // 거절이 분명하니 포인트를 돌려놓는다
        return reply({ ok: false, error: 'card_declined' }, 402);
      }
      return reply({ ok: false, error: 'payment_pending' }, 202);
    }
    if (!res.pay.paymentKey) return reply({ ok: false, error: 'payment_pending' }, 202);
    const result = await t.settle(await t.getPayment(res.pay.paymentKey), pay.id, pay.amount);
    return reply(result, result.ok ? 200 : 409);
  } catch {
    return reply({ ok: false, error: 'verification_pending' }, 503); // 토스·DB 원문은 밖으로 내지 않는다
  }
}

/** 크론 — 오늘 청구할 구독을 청구하고, 끝난 해지 구독을 정리한다. 결과 숫자만 돌려준다. */
export async function chargeDueSubscriptions(env, { sbFetch, limit = 20 } = {}) {
  const out = { due: 0, paid: 0, failed: 0, pending: 0, expired: 0 };
  if (env.CLASS_SUBSCRIPTION_ENABLED !== 'true' || !env.TOSS_BILLING_SECRET_KEY) {
    // 자동 결제가 꺼져 있어도 기간권·선물 구독은 기간이 끝나면 정리해야 한다(청구는 하지 않는다)
    //   시험 계정만 열린 동안(ONETIME_TESTERS)에도 그 계정의 기간권이 끝나면 정리한다.
    if (env.CLASS_SUBSCRIPTION_ONETIME_ENABLED === 'true' || onetimeTesters(env).length > 0 || env.CLASS_SUBSCRIPTION_GIFT_ENABLED === 'true') {
      try { out.expired = Number(await client(env, sbFetch).rpc('expire', {})) || 0; } catch { /* 다음 크론이 다시 */ }
    }
    return out;
  }
  const t = client(env, sbFetch);
  const due = await t.rpc('due', { p_limit: limit });
  out.due = Array.isArray(due) ? due.length : 0;
  for (const d of Array.isArray(due) ? due : []) {
    try {
      const res = await t.charge({ billingKey: d.billingKey, customerKey: d.customerKey, orderId: d.orderId, amount: d.amount, orderName: orderName(d.plan, d.cycle) });
      if (res.ok || res.pay.code === 'ALREADY_PROCESSED_PAYMENT') {
        const key = res.pay.paymentKey;
        const r = key ? await t.settle(await t.getPayment(key), d.orderId, d.amount) : { ok: false };
        if (r.ok) out.paid++; else out.pending++;
      } else if (res.pay.code && !/TIMEOUT|UNKNOWN|PROVIDER_ERROR|FAILED_INTERNAL/.test(res.pay.code)) {
        await t.rpc('fail', { p_order_id: d.orderId, p_code: res.pay.code }); out.failed++;
      } else out.pending++;
    } catch { out.pending++; }
  }
  try { out.expired = Number(await t.rpc('expire', {})) || 0; } catch { /* 다음 크론이 다시 */ }
  return out;
}
