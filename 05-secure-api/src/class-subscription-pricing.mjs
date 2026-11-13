// 구독 요금 계산 — 서버 정본(2026-11-09 운영자 결정 · 2026-11-12 전환 차감).
//   화면(클래스 src/data/annualSubscription.js)의 숫자와 같이 움직인다. 화면은 이 계산 결과를 그리기만 한다.
//   순수 함수만 둔다 — 시험이 DB·토스 없이 돈다(class-subscription-pricing-test.mjs).

export const SUBSCRIPTION_PLANS = {
  solo: { month: 9900, year: 99000, seats: 1 },
  together: { month: 14900, year: 149000, seats: 3 },
};
export const ALLINONE_FULL_PRICE = 398000;      // 올인원 8종 소장 정가
export const ALLINONE_PER_OWNED = 50000;        // 이미 소장한 1권마다 빼는 금액
export const OWNERSHIP_STEER_FROM = 4;          // 오리지널 4권 이상 소장 = 구독 대신 올인원 소장을 권한다
export const ANNUAL_BOOKS = 9;                  // 연간 구독이 여는 책 수(오리지널 7 + 오즈 + 어린 왕자) — 겹침 할인의 분모(충돌표 22번, 운영자 2026-11-13)
export const POINT_SHARE_MAX = 0.3;             // 구독료의 30%까지 포인트(1P = 10원)
export const CONVERSION_DEADLINE = '2026-12-31'; // 구독 → 올인원 소장 전환 차감 기한(KST)

const round100 = (n) => Math.round(n / 100) * 100;
const ownedN = (n) => Math.max(0, Math.min(8, Math.trunc(Number(n) || 0)));

/** 구독 결제 금액. 소장 겹침 할인은 연간에만 — 월 구독은 정가(운영자 2026-11-13 확정).
 *  ownedCount = 소장한 오리지널 강독 수(0~7).
 *  ownedTheory = 핵심 이론을 소장으로 세는가 — 올인원 결제(class_checkout_quote)와 같은 규칙(운영자 2026-11-13):
 *    오리지널 2권 이상 소장했거나 theory 를 실제로 소장했으면 true. 판정은 DB(class_subscription_summary)가 한다.
 *  할인에 세는 권수(discountBooks) = 오리지널 + 이론(0/1). 분모는 9(ANNUAL_BOOKS) 그대로.
 *  🔴 올인원 권유(할인 중단) 문턱은 오리지널 권수만 본다 — 오리지널 3 + 이론 = 4/9 할인이 적용된다. */
export function subscriptionQuote({ plan, cycle, ownedCount = 0, ownedTheory = false } = {}) {
  const p = SUBSCRIPTION_PLANS[plan];
  if (!p || !['month', 'year'].includes(cycle)) return { ok: false, error: 'bad_plan' };
  const owned = ownedN(ownedCount);
  const discountBooks = Math.min(ANNUAL_BOOKS, owned + (ownedTheory === true ? 1 : 0));
  const list = p[cycle];
  let amount = list;
  if (cycle === 'year' && discountBooks > 0 && owned < OWNERSHIP_STEER_FROM) {
    // 개인 = 전체에서 겹치는 만큼 · 함께 읽기 = 본인 몫(1/3)에서만 겹치는 만큼
    const share = plan === 'together' ? list / p.seats : list;
    amount = round100(list - share * (discountBooks / ANNUAL_BOOKS));
  }
  return {
    ok: true, plan, cycle, listAmount: list, amount, ownedDiscount: list - amount, discountBooks,
    suggestOwnership: owned >= OWNERSHIP_STEER_FROM,
    pointsMax: Math.floor((amount * POINT_SHARE_MAX) / 10), // 쓸 수 있는 최대 포인트(P)
  };
}

/**
 * 첫 결제에 쓸 포인트(1P = 10원). 구독 금액의 30%까지 · 가진 만큼만. 다음 자동 결제에는 쓰지 않는다.
 *   usePoints 가 없거나 0 이면 포인트 없이 전액 카드.
 */
export function pointsPlan(quote, usePoints, balance = 0) {
  if (!quote?.ok) return { ok: false, error: 'bad_plan' };
  if (usePoints === undefined || usePoints === null || usePoints === 0) return { ok: true, usePoints: 0, cardAmount: quote.amount };
  if (!Number.isInteger(usePoints) || usePoints < 0 || usePoints > quote.pointsMax) return { ok: false, error: 'bad_points' };
  if (usePoints > Math.max(0, Math.trunc(Number(balance) || 0))) return { ok: false, error: 'points_short' };
  return { ok: true, usePoints, cardAmount: quote.amount - usePoints * 10 };
}

/** 다음 결제일 — 같은 날짜(말일은 그 달 말일로). ISO 문자열을 받고 돌려준다. */
export function nextPeriodEnd(startIso, cycle) {
  const d = new Date(startIso);
  if (!Number.isFinite(d.getTime())) return null;
  const day = d.getUTCDate();
  const t = new Date(d);
  t.setUTCDate(1);
  if (cycle === 'year') t.setUTCFullYear(t.getUTCFullYear() + 1); else t.setUTCMonth(t.getUTCMonth() + 1);
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString();
}

/** 올인원 소장 완성가 — 398,000 − 50,000 × 이미 소장한 권수(8권이면 0). */
export function allInOneCompletionPrice(ownedCount = 0) {
  const owned = ownedN(ownedCount);
  return owned >= 8 ? 0 : Math.max(0, ALLINONE_FULL_PRICE - ALLINONE_PER_OWNED * owned);
}

const kstDay = (d) => new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 구독 회원 → 올인원 소장 전환(운영자 2026-11-12):
 *   전환가 = 올인원 완성가 − 2026-12-31(KST)까지 실제로 낸 구독료(취소·환불된 결제는 뺀다). 0원 밑으로 내려가지 않는다.
 *   payments = [{ amount, paidAt, canceledAmount }]
 */
export function conversionQuote({ ownedCount = 0, payments = [], now = new Date() } = {}) {
  const base = allInOneCompletionPrice(ownedCount);
  const open = kstDay(now) <= CONVERSION_DEADLINE;
  const credited = (Array.isArray(payments) ? payments : [])
    .filter((p) => p && p.paidAt && kstDay(p.paidAt) <= CONVERSION_DEADLINE)
    .reduce((sum, p) => sum + Math.max(0, (Number(p.amount) || 0) - (Number(p.canceledAmount) || 0)), 0);
  let credit = open ? Math.min(base, credited) : 0;
  // 차감 뒤 1~999원 자투리는 회사가 부담해 0원(토스 결제가 안 될 수 있다 · 운영자 2026-11-13).
  //   DB class_checkout_quote 와 같은 규칙 — 구독 차감이 있는 회원만. 올린 금액은 roundedDown(차감 줄에 포함된다).
  const left = base - credit;
  const roundedDown = credit > 0 && left >= 1 && left <= 999 ? left : 0;
  credit += roundedDown;
  return {
    ok: true, open, deadline: CONVERSION_DEADLINE, ownedCount: ownedN(ownedCount),
    basePrice: base, paidTotal: credited, credit, amount: base - credit, roundedDown,
    steps: [
      { label: '올인원 8종 소장', amount: ALLINONE_FULL_PRICE },
      { label: `이미 소장한 ${ownedN(ownedCount)}권`, amount: -(ALLINONE_FULL_PRICE - base) },
      { label: '구독으로 결제한 금액', amount: -credit },
    ],
  };
}
