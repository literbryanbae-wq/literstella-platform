import { classMemberCheckout } from './class-member-checkout.mjs';
import { classCourseCheckout } from './class-course-checkout.mjs';

const PREFIX = '/api/class-checkout/';
export async function classMemberCheckoutRoute(req, env) {
  const path = new URL(req.url).pathname;
  const course = path.match(/^\/api\/class-course-checkout\/([a-z0-9]+)\/([a-z]+)$/);
  if (!path.startsWith(PREFIX) && !course) return null;
  const action = course ? course[2] : path.slice(PREFIX.length);
  const origin = req.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  const cors = { 'Vary': 'Origin', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Token' };
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
  if (origin && !allowed.includes(origin)) return json({ ok: false, error: 'origin_forbidden' }, 403, cors);
  if (origin) cors['Access-Control-Allow-Origin'] = origin;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!origin && action !== 'webhook') return json({ ok: false, error: 'origin_required' }, 403, cors);
  const requireUser = async request => {
    const token = request.headers.get('X-User-Token');
    if (!token) return null;
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const user = await res.json();
    return { id: user.id, emailConfirmed: !!user.email_confirmed_at };
  };
  const sbFetch = (bindings, pathAndQuery, init = {}) => fetch(`${bindings.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init, headers: { apikey: bindings.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${bindings.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(10000),
  });
  const deps={requireUser,sbFetch,json};
  return course ? classCourseCheckout(req,env,cors,course[1],action,deps) : classMemberCheckout(req, env, cors, action, deps);
}
