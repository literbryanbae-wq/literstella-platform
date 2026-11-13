// 구독 안내 메일(2026-11-14) — 결제 완료 · 환불 완료 · 끝나기 전 안내(기간권·선물).
//   모양은 클래스 결제 메일(class-checkout-email.mjs)과 같다: DB outbox(20261114110000) → claim → Resend(RESEND_API_KEY · RESEND_FROM, 같은 키·같은 발신자).
//   🔴 발송 스위치 = CLASS_SUBSCRIPTION_MAIL_ENABLED === 'true' — 꺼져 있으면 아무것도 보내지 않는다(줄만 쌓인다).
//   링크 = CLASS_SUBSCRIPTION_PAGE_URL(구독 페이지 주소, https · class-new/class/challenge.literstella.co.kr 만) — 없으면 보내지 않는다.

// ═════════════════════════════════════════════════════════════════════════════════════
// ▼▼▼ 메일 문구(운영자 검토용) — 이 블록만 고치면 된다. {날짜}처럼 바뀌는 값은 함수 인자로 들어온다. ▼▼▼
// ═════════════════════════════════════════════════════════════════════════════════════
export const SUBSCRIPTION_MAIL_COPY = {
  planName: (plan, cycle) => `${plan === 'together' ? '함께 읽기' : '개인'} ${cycle === 'year' ? '연간' : '월'} 구독`,
  footer: '리터스텔라 · 구독 안내\n이 메일은 구독 결제와 이용에 관한 안내입니다.',
  kakao: '카카오톡 문의',
  library: '내 서재',
  refundGuide: '구매·환불 안내',
  paid: {
    subject: '[리터스텔라] 구독 결제가 끝났어요',
    title: { first: '구독이 시작됐어요', renewal: '구독 기간이 늘어났어요', upgrade: '연간 구독으로 바뀌었어요' },
    rows: { plan: '구독', period: '이용 기간', amount: '결제 금액', points: '사용한 포인트', bonus: '더 드린 기간', order: '주문번호', account: '계정' },
    bonus: (months) => `${months}달(무료로 먼저 써 본 분께 드리는 선물)`,
    once: '자동 결제 되지 않아요. 구독이 끝나기 전에 미리 알려 드려요.',
    auto: (date) => `다음 결제일은 ${date}이에요. 그날 등록한 카드로 자동 결제돼요. 그만두려면 내 서재에서 해지할 수 있어요.`,
    body: '결제한 계정으로 로그인하면 바로 강의를 들을 수 있어요.',
    button: '강의실로 가기',
  },
  refund: {
    subject: '[리터스텔라] 구독 환불이 끝났어요',
    title: '환불이 끝났어요',
    rows: { plan: '구독', amount: '환불 금액', points: '돌려드린 포인트', order: '주문번호', account: '계정' },
    ended: '이 결제로 이용하던 구독은 끝났어요.',
    continues: (date) => `구독은 ${date}까지 그대로 이용할 수 있어요.`,
    card: '카드 환불은 카드사에 따라 며칠 걸릴 수 있어요.',
  },
  reminder: {
    subject: (date) => `[리터스텔라] 구독이 ${date}에 끝나요`,
    title: '구독이 곧 끝나요',
    once: (plan, date) => `${plan}이 ${date}에 끝나요. 자동 결제가 아니라서, 계속 들으려면 다시 구독해 주세요.`,
    onceHow: '지금 다시 구독하면 남은 기간이 끝난 다음 날부터 이어져요. 남은 기간은 그대로예요.',
    gift: (date) => `선물로 받은 구독이 ${date}에 끝나요.`,
    giftHow: '선물 구독이 끝난 뒤에 구독 페이지에서 다시 구독할 수 있어요.',
    button: '구독 페이지로 가기',
  },
};
// ═════════════════════════════════════════════════════════════════════════════════════
// ▲▲▲ 메일 문구 끝 ▲▲▲
// ═════════════════════════════════════════════════════════════════════════════════════

const KAKAO = 'https://pf.kakao.com/_xkxdZxeb/chat';
const C = SUBSCRIPTION_MAIL_COPY;
const escape = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const validEmail = (x) => typeof x === 'string' && x.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x);
const won = (n) => Number(n).toLocaleString('ko-KR') + '원';
/** 한국 날짜 'YYYY년 M월 D일' */
export function kstDate(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw Error('invalid_date');
  const k = new Date(d.getTime() + 9 * 3600e3);
  return `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}

/** 구독 페이지 주소 — 회사 도메인만(새 도메인을 코드에 박지 않는다). 틀리면 null(보내지 않는다). */
export function subscriptionPageUrl(env) {
  try {
    const u = new URL(env.CLASS_SUBSCRIPTION_PAGE_URL);
    if (u.protocol !== 'https:' || u.username || u.password || u.port ||
        !['class-new.literstella.co.kr', 'class.literstella.co.kr', 'challenge.literstella.co.kr'].includes(u.hostname)) return null;
    return u;
  } catch { return null; }
}

/** facts(DB claim 결과) → Resend 봉투. 잘못된 설정·사실이면 던진다(보내지 않는다). */
export function renderSubscriptionEmail(facts, env) {
  const page = subscriptionPageUrl(env);
  if (!validEmail(facts?.email) || !env.RESEND_FROM || /[\r\n]/.test(env.RESEND_FROM) || !page) throw Error('mail_configuration');
  const origin = page.origin;
  const plan = C.planName(facts.plan, facts.cycle);
  let subject; let title; let rows = []; let lines = []; let button = null;
  if (facts.kind === 'paid') {
    subject = C.paid.subject;
    title = C.paid.title[facts.paymentKind] || C.paid.title.first;
    rows = [[C.paid.rows.plan, plan], [C.paid.rows.period, `${kstDate(facts.periodStart)} ~ ${kstDate(facts.periodEnd)}`],
      [C.paid.rows.amount, won(facts.amount)]];
    if (facts.pointsUsed > 0) rows.push([C.paid.rows.points, `${Number(facts.pointsUsed).toLocaleString('ko-KR')}P (${won(facts.pointsUsed * 10)})`]);
    if (facts.bonusMonths > 0) rows.push([C.paid.rows.bonus, C.paid.bonus(facts.bonusMonths)]);
    rows.push([C.paid.rows.order, facts.orderId], [C.paid.rows.account, facts.email]);
    lines = [C.paid.body, facts.billingMode === 'once' ? C.paid.once : C.paid.auto(kstDate(facts.nextChargeAt || facts.periodEnd))];
    button = [`${origin}/room`, C.paid.button];
  } else if (facts.kind === 'refund') {
    subject = C.refund.subject; title = C.refund.title;
    rows = [[C.refund.rows.plan, plan], [C.refund.rows.amount, won(facts.refundAmount)]];
    if (facts.pointsUsed > 0) rows.push([C.refund.rows.points, `${Number(facts.pointsReturned).toLocaleString('ko-KR')}P`]);
    rows.push([C.refund.rows.order, facts.orderId], [C.refund.rows.account, facts.email]);
    const live = ['active', 'past_due'].includes(facts.subscriptionStatus) && facts.subscriptionPeriodEnd && new Date(facts.subscriptionPeriodEnd) > new Date();
    lines = [live ? C.refund.continues(kstDate(facts.subscriptionPeriodEnd)) : C.refund.ended, C.refund.card];
  } else if (facts.kind === 'reminder') {
    const date = kstDate(facts.periodEnd);
    subject = C.reminder.subject(date); title = C.reminder.title;
    lines = facts.source === 'gift' ? [C.reminder.gift(date), C.reminder.giftHow] : [C.reminder.once(plan, date), C.reminder.onceHow];
    button = [page.href, C.reminder.button];
  } else throw Error('mail_configuration');
  const btn = button ? `<p><a href="${escape(button[0])}" style="display:inline-block;background:#c8a84b;color:#161b25;padding:13px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">${escape(button[1])}</a></p>` : '';
  const body = `<h1 style="font-size:22px;line-height:1.4;margin:0 0 16px;word-break:keep-all;">${escape(title)}</h1>` +
    (rows.length ? `<table role="presentation" style="width:100%;font-size:14px;border-collapse:collapse;">${rows.map(([k, v]) => `<tr><td style="padding:6px 8px 6px 0;vertical-align:top;white-space:nowrap;color:#666;">${escape(k)}</td><td style="padding:6px 0;word-break:break-word;">${escape(v)}</td></tr>`).join('')}</table>` : '') +
    lines.map((l) => `<p style="word-break:keep-all;">${escape(l)}</p>`).join('') + btn +
    `<p style="font-size:13px;"><a href="${escape(origin)}/library">${C.library}</a> · <a href="${escape(origin)}/refund">${C.refundGuide}</a> · <a href="${KAKAO}">${C.kakao}</a></p>`;
  // 클래스 결제 메일과 같은 거래 안내 틀(로고·카카오 문의) — 홍보 내용 없음
  const html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f4f1ea;font-family:Arial,'Apple SD Gothic Neo',sans-serif;color:#1d2433;line-height:1.7;"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" style="max-width:480px;background:#fffdf8;border:1px solid #e8e2d4;"><tr><td style="padding:24px;text-align:center;"><img src="https://challenge.literstella.co.kr/logo-symbol.png" alt="" width="46" height="46"><br><img src="https://challenge.literstella.co.kr/logo-literstella-en.png" alt="LiterStella" height="22"></td></tr><tr><td style="padding:0 24px 24px;">${body}</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #e8e2d4;font-size:12px;color:#666;">${C.footer.split('\n').map(escape).join('<br>')}</td></tr></table></td></tr></table></body></html>`;
  const text = [subject, title, ...rows.map(([k, v]) => `${k}: ${v}`), ...lines, ...(button ? [`${button[1]}: ${button[0]}`] : []),
    `${C.refundGuide}: ${origin}/refund`, `${C.kakao}: ${KAKAO}`].join('\n');
  return { from: env.RESEND_FROM, to: [facts.email], subject, html, text,
    tags: [{ name: 'category', value: 'class_subscription_transactional' }, { name: 'kind', value: facts.kind }] };
}

/** 보낼 수 있는 상태인가 — 스위치·키·발신자·페이지 주소. */
export function subscriptionMailReady(env) {
  return env.CLASS_SUBSCRIPTION_MAIL_ENABLED === 'true' && !!env.RESEND_API_KEY && !!env.RESEND_FROM && !!subscriptionPageUrl(env);
}

async function db(env, sbFetch, path, init = {}) {
  const r = await sbFetch(env, path, init);
  if (!r.ok) throw Error('mail_storage_unavailable');
  return r.status === 204 ? null : r.json();
}
async function update(env, sbFetch, j, patch) {
  const result = await db(env, sbFetch, `class_subscription_email_outbox?id=eq.${j.id}&lease_token=eq.${j.lease_token}&status=eq.processing`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
  if (!result?.length) throw Error('mail_lease_lost');
}

async function runOne(env, sbFetch, paymentId) {
  const claimed = await db(env, sbFetch, 'rpc/class_subscription_email_claim', { method: 'POST', body: JSON.stringify({ p_payment_id: paymentId || null }) });
  if (!claimed) return false;
  const { job: j, facts } = claimed;
  const done = (patch) => update(env, sbFetch, j, { ...patch, lease_token: null, lease_until: null });
  try {
    const envelope = j.envelope || renderSubscriptionEmail(facts, env);
    if (!j.envelope) await update(env, sbFetch, j, { envelope });
    await update(env, sbFetch, j, { lease_until: new Date(Date.now() + 180000).toISOString() });
    const sent = await fetch('https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': `class-subscription/${j.id}` },
      body: JSON.stringify(envelope), signal: AbortSignal.timeout(5000) });
    const result = await sent.json().catch(() => null);
    if (sent.ok && typeof result?.id === 'string') await done({ status: 'accepted', provider_email_id: result.id, last_error: null });
    else if (sent.status === 429 || sent.status >= 500 || sent.ok) throw Error('mail_provider_retry');
    else await done({ status: 'failed', last_error: `resend_http_${sent.status}` });
  } catch (e) {
    const safe = ['mail_configuration', 'invalid_date', 'mail_storage_unavailable', 'mail_provider_retry'].includes(e.message) ? e.message : 'mail_attempt_uncertain';
    await done({ status: 'pending', last_error: safe, next_attempt_at: new Date(Date.now() + 300000).toISOString() }).catch(() => {});
  }
  return true;
}

/** 보낼 줄을 최대 limit 개 보낸다. 스위치가 꺼져 있으면 DB 도 건드리지 않는다. 보낸(시도한) 수를 돌려준다. */
export async function processSubscriptionEmails(env, { sbFetch, paymentId = null, limit = 5 } = {}) {
  if (!subscriptionMailReady(env)) return 0;
  let n = 0;
  try { for (let i = 0; i < limit; i++) { if (!await runOne(env, sbFetch, paymentId)) break; n++; } }
  catch { console.log(JSON.stringify({ evt: 'class_subscription_email_queue_error' })); }
  return n;
}

/** 끝나기 전 안내 줄을 쌓는다(매일 크론) — 스위치가 꺼져 있으면 쌓지도 않는다(켠 날 지난 안내가 몰려 나가지 않게). */
export async function queueSubscriptionReminders(env, { sbFetch, days = 7 } = {}) {
  if (!subscriptionMailReady(env)) return 0;
  try { return Number(await db(env, sbFetch, 'rpc/class_subscription_email_queue_reminders', { method: 'POST', body: JSON.stringify({ p_days: days }) })) || 0; }
  catch { return 0; }
}
