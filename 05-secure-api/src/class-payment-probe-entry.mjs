import live from './index.js';
import { classPaymentProbe } from './class-payment-probe.mjs';
export * from './index.js';

async function requireUser(req, env) {
  const token = req.headers.get('X-User-Token');
  if (!token) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const u = await r.json();
  return { id: u.id, email: String(u.email || '').toLowerCase(), emailConfirmed: !!u.email_confirmed_at };
}

export default {
  ...live,
  async fetch(req, env, ctx) {
    if (new URL(req.url).pathname.startsWith('/api/class-payment-probe/')) {
      return classPaymentProbe(req, {
        TOSS_CLASS_SECRET_KEY: env.TOSS_CLASS_SECRET_KEY,
        OTP_GUARD: env.OTP_GUARD,
        CLASS_PAYMENT_PROBE_ENABLED: env.CLASS_PAYMENT_PROBE_ENABLED ?? 'true',
      }, { requireUser: request => requireUser(request, env) });
    }
    return live.fetch(req, env, ctx);
  },
};
