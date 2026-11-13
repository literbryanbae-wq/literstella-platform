// 구독 정기결제 진입 — 지금 라이브 진입(class-checkout-email-entry.mjs)을 그대로 감싼다.
//   2026-11-13 부터 wrangler.jsonc 의 main(라이브 진입). 판매는 CLASS_SUBSCRIPTION_ENABLED + 토스 빌링 키 + 약관 변수가 다 있을 때만 열린다.
//   /api/class-subscription/* 만 가로채고 나머지는 전부 아래로 넘긴다. 매일 크론(25 18 * * * = KST 03:25)에 청구·정리.
import live from './class-checkout-email-entry.mjs';
import { classSubscription, chargeDueSubscriptions } from './class-subscription.mjs';
export * from './class-checkout-email-entry.mjs';

const PREFIX = '/api/class-subscription/';
const sbFetch = (env, pathAndQuery, init = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
  ...init, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...init.headers },
  signal: AbortSignal.timeout(10000),
});

export async function classSubscriptionRoute(req, env) {
  const path = new URL(req.url).pathname;
  if (!path.startsWith(PREFIX)) return null;
  const action = path.slice(PREFIX.length);
  const origin = req.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  const cors = { Vary: 'Origin', 'Cache-Control': 'no-store', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-User-Token' };
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  if (origin && !allowed.includes(origin)) return json({ ok: false, error: 'origin_forbidden' }, 403, cors);
  if (origin) cors['Access-Control-Allow-Origin'] = origin;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!origin && action !== 'webhook') return json({ ok: false, error: 'origin_required' }, 403, cors); // 웹훅만 출처 없이(토스 서버)
  const requireUser = async (request) => {
    const token = request.headers.get('X-User-Token');
    if (!token) return null;
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const user = await res.json();
    return { id: user.id, emailConfirmed: !!user.email_confirmed_at };
  };
  return classSubscription(req, env, cors, action, { requireUser, sbFetch, json });
}

export default {
  ...live,
  async fetch(req, env, ctx) {
    return (await classSubscriptionRoute(req, env)) ?? live.fetch(req, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (event.cron === '25 18 * * *') ctx.waitUntil(chargeDueSubscriptions(env, { sbFetch }).catch(() => null));
    if (live.scheduled) await live.scheduled(event, env, ctx);
  },
};
