// 구독 정기결제 진입 — 지금 라이브 진입(class-checkout-email-entry.mjs)을 그대로 감싼다.
//   2026-11-13 부터 wrangler.jsonc 의 main(라이브 진입). 판매는 CLASS_SUBSCRIPTION_ENABLED + 토스 빌링 키 + 약관 변수가 다 있을 때만 열린다.
//   /api/class-subscription/* 만 가로채고 나머지는 전부 아래로 넘긴다. 매일 크론(25 18 * * * = KST 03:25)에 청구·정리.
//   2026-11-14 더함:
//   · 기간권(한 번 결제)은 클래스 결제 위젯 상점에서 결제된다 → 그 상점의 웹훅(/api/class-checkout/webhook)으로 오는
//     구독 주문(orderId 가 'sub…')만 여기서 받아 구독 웹훅으로 돌린다. 그 밖(cls…)은 손대지 않고 아래(라이브)로 넘긴다.
//   · 구독 안내 메일(class-subscription-email.mjs) — 결제·환불 응답 뒤 바로 한 번 · 5분 크론 재시도 · 매일 크론에 '끝나기 전 안내'.
//     발송은 CLASS_SUBSCRIPTION_MAIL_ENABLED === 'true' 일 때만(꺼져 있으면 아무것도 안 보낸다).
import live from './class-checkout-email-entry.mjs';
import { classSubscription, chargeDueSubscriptions } from './class-subscription.mjs';
import { processSubscriptionEmails, queueSubscriptionReminders } from './class-subscription-email.mjs';
export * from './class-checkout-email-entry.mjs';

const PREFIX = '/api/class-subscription/';
const CLASS_MID_WEBHOOK = '/api/class-checkout/webhook';
const SUB_ORDER = /^sub[a-f0-9]{32}$/;
const sbFetch = (env, pathAndQuery, init = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
  ...init, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...init.headers },
  signal: AbortSignal.timeout(10000),
});
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const deps = (env) => ({
  sbFetch, json,
  requireUser: async (request) => {
    const token = request.headers.get('X-User-Token');
    if (!token) return null;
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const user = await res.json();
    return { id: user.id, emailConfirmed: !!user.email_confirmed_at };
  },
});

export async function classSubscriptionRoute(req, env) {
  const path = new URL(req.url).pathname;
  if (!path.startsWith(PREFIX)) return null;
  const action = path.slice(PREFIX.length);
  const origin = req.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  const cors = { Vary: 'Origin', 'Cache-Control': 'no-store', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-User-Token' };
  if (origin && !allowed.includes(origin)) return json({ ok: false, error: 'origin_forbidden' }, 403, cors);
  if (origin) cors['Access-Control-Allow-Origin'] = origin;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!origin && action !== 'webhook') return json({ ok: false, error: 'origin_required' }, 403, cors); // 웹훅만 출처 없이(토스 서버)
  return classSubscription(req, env, cors, action, deps(env));
}

/** 클래스 결제 위젯 상점 웹훅 중 구독 주문(sub…)만 받는다. 아니면 null(라이브가 처리). 원래 요청은 소비하지 않는다(clone). */
export async function classMidSubscriptionWebhook(req, env) {
  if (req.method !== 'POST' || new URL(req.url).pathname !== CLASS_MID_WEBHOOK) return null;
  const text = await req.clone().text().catch(() => '');
  let id = null;
  try { id = JSON.parse(text)?.data?.orderId; } catch { return null; }
  if (!SUB_ORDER.test(id || '')) return null;
  const inner = new Request(new URL(PREFIX + 'webhook', req.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
  return classSubscription(inner, env, { 'Cache-Control': 'no-store' }, 'webhook', deps(env));
}

// 결제·환불이 반영된 응답 뒤 메일을 바로 한 번 보낸다(실패분은 5분 크론이 다시)
const MAIL_AFTER = /^\/api\/class-subscription\/(confirm|once-confirm|webhook|upgrade)$|^\/api\/class-checkout\/webhook$/;
async function mailAfter(req, env, ctx, response) {
  if (!response || !response.ok || req.method !== 'POST' || !MAIL_AFTER.test(new URL(req.url).pathname)) return;
  const result = await response.clone().json().catch(() => null);
  if (['paid', 'canceled', 'partial_canceled'].includes(result?.status)) {
    ctx.waitUntil(processSubscriptionEmails(env, { sbFetch, paymentId: result.orderId || null }).catch(() => null));
  }
}

export default {
  ...live,
  async fetch(req, env, ctx) {
    const mine = (await classMidSubscriptionWebhook(req, env)) ?? (await classSubscriptionRoute(req, env));
    if (mine) { await mailAfter(req, env, ctx, mine); return mine; }
    return live.fetch(req, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (event.cron === '25 18 * * *') {
      ctx.waitUntil((async () => {
        await chargeDueSubscriptions(env, { sbFetch }).catch(() => null);
        await queueSubscriptionReminders(env, { sbFetch }).catch(() => null);   // 끝나기 7일 안 기간권·선물 구독 — 기간마다 한 번
        await processSubscriptionEmails(env, { sbFetch, limit: 20 }).catch(() => null);
      })());
    }
    if (event.cron === '*/5 * * * *') ctx.waitUntil(processSubscriptionEmails(env, { sbFetch }).catch(() => null));
    if (live.scheduled) await live.scheduled(event, env, ctx);
  },
};
