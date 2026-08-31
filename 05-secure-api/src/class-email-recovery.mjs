const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const validEmail = (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const TTL = 10 * 60 * 1000;
export const RECOVERY_KIND = 'legacy-email-unreachable-v1';

export function recoveryMessage(user, claimedEmail, code, exp) {
  return JSON.stringify([RECOVERY_KIND, user.id, normalizeEmail(user.email), claimedEmail, code, exp]);
}

// Inbox ownership is not legacy enrollment ownership. This route only queues review.
export async function classEmailRecoveryRoute(req, env, cors, deps) {
  const { json, requireUser, sbFetch, hmacHex, timingSafeEq, sha256Hex,
    otpGuardIssue, otpGuardConsume, otpGuardBurn,
    isEmailSuppressed, sendResendEmail, otpEmailHtml, findClassEnrollments } = deps;
  const fail = (error, status = 400) => json({ ok: false, error }, status, cors);
  if (req.method !== 'POST') return fail('method', 405);
  const user = await requireUser(req, env);
  if (!user || !validEmail(normalizeEmail(user.email))) return fail('login_required', 401);
  if (!env.OTP_GUARD || !env.OTP_SEND_LIMIT || !env.OTP_SECRET || !env.AUTH_EMAIL_SERVICE) return fail('recovery_unavailable', 503);
  let body;
  try { body = await req.json(); } catch { return fail('bad_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('bad_json');
  const claimedEmail = normalizeEmail(body.claimedEmail);
  if (!validEmail(claimedEmail)) return fail('bad_email');
  const isSend = new URL(req.url).pathname.endsWith('/send');
  try {
    if (isSend) {
      if ((await env.OTP_SEND_LIMIT.limit({ key: await sha256Hex(user.email) }))?.success !== true) return fail('too_many_requests', 429);
      if (await isEmailSuppressed(env, user.email, 'auth')) return fail('suppressed', 422);
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
      const exp = Date.now() + TTL;
      const token = `${exp}.${await hmacHex(env.OTP_SECRET, recoveryMessage(user, claimedEmail, code, exp))}`;
      await otpGuardIssue(env, token, TTL);
      const sent = await sendResendEmail(env, {
        to: user.email, subject: '[리터스텔라] 수강 이전 신청 이메일 인증',
        html: otpEmailHtml(code, new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })), lane: 'auth',
      });
      if (!sent) { await otpGuardBurn(env, token); return fail('send_failed', 502); }
      return json({ ok: true, token, exp }, 200, cors);
    }
    const name = String(body.name || '').trim().slice(0, 60);
    const phone = String(body.phone || '').replace(/\D/g, '').slice(0, 20);
    const courses = String(body.courses || '').trim().slice(0, 300);
    if (!name || phone.length < 9 || !courses) return fail('missing_fields');
    const token = String(body.token || '');
    const code = String(body.code || '').trim();
    const [expires, signature, extra] = token.split('.');
    const exp = Number(expires);
    if (!exp || !signature || extra || exp > Date.now() + TTL || Date.now() > exp) return fail('expired');
    if (!/^\d{6}$/.test(code)) return fail('invalid_code');
    if ((await env.OTP_SEND_LIMIT.limit({ key: await sha256Hex(`class-recovery-verify:${user.id}`) }))?.success !== true) return fail('too_many_requests', 429);
    // Read-only receipt lookup makes a lost successful response safely retryable.
    const proofHash = await sha256Hex(token);
    const receipt = await sbFetch(env, `class_link_requests?auth_uid=eq.${user.id}&roster_match->>proofHash=eq.${proofHash}&select=id,status,claimed_email&limit=1`);
    if (!receipt.ok) return fail('upstream', 502);
    const previous = (await receipt.json())[0];
    if (previous?.claimed_email === claimedEmail && ['pending', 'approved'].includes(previous.status)) {
      return json({ ok: true, already: true, id: previous.id, status: previous.status }, 200, cors);
    }
    const guard = await otpGuardConsume(env, token);
    if (guard) return json({ ok: false, ...guard }, 400, cors);
    const expected = await hmacHex(env.OTP_SECRET, recoveryMessage(user, claimedEmail, code, exp));
    if (!timingSafeEq(expected, signature)) return fail('invalid_code');
    const found = await findClassEnrollments(env, claimedEmail);
    if (!found.ok) return fail('upstream', 502);
    if (!found.records.length) return fail('legacy_record_not_found');
    const rpc = await sbFetch(env, 'rpc/class_email_recovery_submit_v1', {
      method: 'POST', body: JSON.stringify({ p_user: user.id, p_email: user.email,
        p_payload: { claimed_email: claimedEmail, name, phone, courses,
          paid_at: String(body.paidAt || '').trim().slice(0, 60),
          order_info: String(body.orderInfo || '').trim().slice(0, 300),
          proofHash, records: found.records } }),
    });
    if (!rpc.ok) return fail('save_failed', 502);
    const saved = await rpc.json();
    if (!saved.ok) return json(saved, 409, cors);
    await otpGuardBurn(env, token);
    if (!saved.already && env.ADMIN_EMAIL) {
      // Only an opaque request ID goes to email; names and phone numbers stay in admin.
      try {
        const sent = await sendResendEmail(env, { to: env.ADMIN_EMAIL,
          subject: '[수강 이전] 새 사이트 이메일 인증 완료 · 검토 요청',
          html: `<p>요청 ${saved.id}</p><p>새 이메일 인증은 완료됐습니다. 기존 수강자의 본인 확인 후 승인해 주세요.</p><p><a href="https://class-new.literstella.co.kr/admin">수강 연결 신청 검토</a></p>`,
          lane: 'auth', idempotencyKey: `class-recovery:${saved.id}:${proofHash}` });
        if (!sent) console.error(JSON.stringify({ evt: 'class_recovery_admin_mail_failed', requestId: saved.id }));
      } catch { console.error(JSON.stringify({ evt: 'class_recovery_admin_mail_failed', requestId: saved.id })); }
    }
    return json(saved, 200, cors);
  } catch {
    console.error(JSON.stringify({ evt: 'class_recovery_failed' }));
    return fail('upstream', 502);
  }
}
