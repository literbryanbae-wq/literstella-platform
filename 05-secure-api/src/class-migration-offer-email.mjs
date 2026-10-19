export const MIGRATION_OFFER_CAMPAIGN = 'class-migration-toss-20261019-v1';
export const MIGRATION_OFFER_CUTOFF = '2026-10-19T10:01:03Z';
const CLASS = 'https://class-new.literstella.co.kr';
const BOOKS = new Set(['kidari', 'anne', 'pride', 'littlewomen1', 'littlewomen2', 'gatsby', 'sherlock', 'theory']);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function migrationOfferSendingHours(now = new Date()) {
  const hour = new Date(now.getTime() + 9 * 3600000).getUTCHours();
  return hour >= 8 && hour < 20;
}

export function renderMigrationOffer({ unsubscribeUrl, wrapHtml, complete = false }) {
  const unsubscribe = new URL(unsubscribeUrl);
  if (unsubscribe.protocol !== 'https:' || !unsubscribe.searchParams.get('t')) throw Error('invalid_unsubscribe');
  const links = [
    ['함께 읽기 선물 자리 1개', `${CLASS}/together`, '초대한 분이 켜 둔 수업을 한 분이 자기 계정에서 함께 들어요. 신청 조건이 적용됩니다.'],
    ['올인원 영어 학습실 프리미엄', 'https://english.literstella.co.kr/growth-lab?preview=1&page=invitation', '수강을 연결한 계정으로 이용 범위와 기능별 한도를 확인하세요.'],
    ['야나완 100일 성공 선물', `${CLASS}/events/last100`, '올인원 8종 소장 회원이 100일에 성공하면 한 분에게 올인원 평생소장 수강권을 더 선물하는 혜택을 준비하고 있어요. 새로 시작하는 100일 도전도 포함됩니다. 지급 안내를 확인하세요.'],
  ];
  const subject = '(광고) [리터스텔라] 수강 연결 완료 · ' + (complete ? '올인원 회원 혜택 안내' : '올인원 소장 할인 안내');
  const intro = complete ? '연결된 올인원 소장 혜택을 확인해 보세요.'
    : '올인원 기준가 398,000원에서 연결된 소장 1개당 50,000원을 할인해요. 최종 금액은 주문서에서 확인하세요. 쿠폰 없이 토스로 결제합니다.';
  const cta = complete ? `${CLASS}/library` : `${CLASS}/purchase/member`;
  const label = complete ? '내 서재에서 혜택 보기' : '소장 할인 확인하고 토스로 결제';
  const body = `<h1 style="font-size:22px;line-height:1.4;margin:0 0 16px">기존 수강 연결이 완료됐어요</h1><p>${intro}</p>`
    + `<p><a href="${cta}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#c8a84b;color:#171006;font-weight:700;text-decoration:none">${label}</a></p>`
    + links.map(([title, href, detail]) => `<p><strong><a href="${href}">${title}</a></strong><br>${detail}</p>`).join('')
    + `<p style="font-size:12px"><a href="${CLASS}/library">내 서재</a> · <a href="${CLASS}/refund">구매·환불 안내</a><br>혜택·이벤트 안내 수신에 동의한 회원에게 보내는 메일입니다.<br><a href="${escape(unsubscribe.href)}">무료 수신거부</a> · 발신: 리터스텔라 · 문의 literbryanbae@gmail.com</p>`;
  return { subject, html: wrapHtml(body), text: ['기존 수강 연결이 완료됐어요.', intro, `${label}: ${cta}`, ...links.map(([title, href, detail]) => `${title}\n${detail}\n${href}`), `내 서재: ${CLASS}/library`, `구매·환불 안내: ${CLASS}/refund`, `무료 수신거부: ${unsubscribe.href}`, '발신: 리터스텔라 · 문의 literbryanbae@gmail.com'].join('\n\n') };
}

// The queue is written in the same DB transaction as the verified entitlement.
// No caller-supplied email or client-side "linked" flag can create a message.
export async function processMigrationOfferEmails(env, deps, now = new Date()) {
  if (env.CLASS_MIGRATION_OFFER_ENABLED !== 'true' || !migrationOfferSendingHours(now) || !deps.key || !deps.from || !env.OTP_SECRET) return;
  const { db } = deps;
  for (let i = 0; i < 2; i++) {
    let job;
    try {
      job = await db('rpc/class_migration_offer_claim', { method: 'POST', body: '{}' });
      if (!job) break;
      const finish = async patch => {
        const rows = await db(`class_migration_offer_outbox?id=eq.${job.id}&lease_token=eq.${job.lease_token}&status=eq.processing`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ ...patch, lease_token: null, lease_until: null, updated_at: now.toISOString() }),
        });
        if (!rows?.length) throw Error('lease_lost');
      };
      try {
        if (new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10) > '2026-12-31') {
          await finish({ status: 'skipped', last_error: 'campaign_closed' });
          continue;
        }
        const email = encodeURIComponent(job.email);
        const [users, prefs, unsubs, bounces, verified, redeemed] = await Promise.all([
          db(`users?email=eq.${email}&select=marketing_consent&limit=1`),
          db(`email_prefs?email=eq.${email}&select=lifecycle&limit=1`),
          db(`email_unsub_log?email=eq.${email}&channel=in.(marketing,all)&select=email&limit=1`),
          db(`email_bounces?email=eq.${email}&or=(event.eq.suppressed,event.eq.complained,bounce_type.eq.Permanent)&select=email&limit=1`),
          db(`class_verifications?email=eq.${email}&select=book_code`),
          db(`class_redemptions?redeemed_by=eq.${email}&select=book_code`),
        ]);
        if (users.length !== 1 || users[0].marketing_consent !== true || prefs[0]?.lifecycle === false || unsubs.length || bounces.length) {
          await finish({ status: 'skipped', last_error: 'consent_or_delivery_block' });
          continue;
        }
        const owned = new Set([...verified, ...redeemed].map(row => row.book_code).filter(code => BOOKS.has(code)));
        if (!owned.size) { await finish({ status: 'skipped', last_error: 'no_current_ownership' }); continue; }
        const unsubscribeUrl = await deps.unsubscribeFor(job.email);
        const envelope = job.envelope || {
          from: deps.from, to: [job.email],
          ...renderMigrationOffer({ unsubscribeUrl, wrapHtml: deps.wrapHtml, complete: owned.size === BOOKS.size }),
          headers: await deps.headersFor(job.email),
          tags: [{ name: 'category', value: 'class_migration_offer' }],
        };
        // Persist the exact envelope and renew our lease before the external side effect.
        const rows = await db(`class_migration_offer_outbox?id=eq.${job.id}&lease_token=eq.${job.lease_token}&status=eq.processing`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ envelope, lease_until: new Date(now.getTime() + 180000).toISOString() }),
        });
        if (!rows?.length) throw Error('lease_lost');
        const response = await deps.send(envelope, `class-migration-offer/${job.id}`);
        if (response.ok && typeof response.id === 'string' && response.id) {
          await finish({ status: 'accepted', provider_email_id: response.id, last_error: null });
        } else if (response.status === 429 || response.status >= 500 || response.ok) {
          throw Error('provider_retry');
        } else await finish({ status: 'failed', last_error: 'provider_rejected' });
      } catch {
        await finish({ status: 'pending', last_error: 'retry_or_uncertain', next_attempt_at: new Date(now.getTime() + 300000).toISOString() }).catch(() => {});
      }
    } catch {
      console.log(JSON.stringify({ evt: 'class_migration_offer_queue_unavailable' }));
      break;
    }
  }
}
