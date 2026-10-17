import live from './class-payment-probe-entry.mjs';
import { classMemberCheckoutRoute } from './class-member-checkout-route.mjs';
export * from './class-payment-probe-entry.mjs';

// Approved public sales; explicit environment flags remain emergency shutoffs.
export default { ...live, async fetch(req, env, ctx) {
  const checkoutEnv = {
    ...env,
    CLASS_MEMBER_CHECKOUT_ENABLED: env.CLASS_MEMBER_CHECKOUT_ENABLED ?? 'true',
    CLASS_MEMBER_CHECKOUT_TERMS_URL: env.CLASS_MEMBER_CHECKOUT_TERMS_URL ?? 'https://challenge.literstella.co.kr/course-terms#article-5',
    CLASS_MEMBER_CHECKOUT_TERMS_VERSION: env.CLASS_MEMBER_CHECKOUT_TERMS_VERSION ?? 'course-terms-2026-10-01',
    CLASS_COURSE_CHECKOUT_ENABLED: env.CLASS_COURSE_CHECKOUT_ENABLED ?? 'true',
    CLASS_COURSE_CHECKOUT_TERMS_URL: env.CLASS_COURSE_CHECKOUT_TERMS_URL ?? 'https://challenge.literstella.co.kr/course-terms#article-5',
    CLASS_COURSE_CHECKOUT_TERMS_VERSION: env.CLASS_COURSE_CHECKOUT_TERMS_VERSION ?? 'course-terms-2026-10-01',
  };
  return (await classMemberCheckoutRoute(req, checkoutEnv)) ?? live.fetch(req, env, ctx);
} };
