# Member pronunciation release

## Scope

User approved an operator-controlled, no-expiry HTTP assessment pilot on 2026-09-28, superseding the earlier seven-day plan. Results are deleted 30 days after assessment, not 30 days after shutdown. Fixed first 100 consenting members; 10/member/KST day and 1000/integration/KST day; recording 1-60 seconds. Opening status never enrolls or sends audio.

Base: API 9afcd424, production before release ac5145cd-0b7a-4c32-8942-21b8af2e88d2. English canonical snapshots: 3232148; hashes in pronunciation-sources.json. The index changes only add route dispatch/import and the canonical anonymous-user flag. Existing payment/mail/cron/bindings remain unchanged. Do not deploy an old checkout after this release.

## Database

Applied migration: supabase/migrations/20260927215043_pronunciation_member_operator_controlled.sql. Six private RLS tables, no direct anon/authenticated/service_role grants, six service-role-only RPCs. Seeded disabled. No user or assessment records were inserted by release verification.

Policy contract: privacyVersion etri-member-http-pilot-20260928-v2, runtime operator-controlled, audience members, transport http-test, resultRetentionDays 30, expiresAt explicitly null, activatedAt 2026-09-27T21:57:10Z. Activation requires a separate enabled=true operation.

Hourly cron pronunciation-results-retention-v1 (minute 15) removes 30-day-old result-bearing requests and cascading outbox facts. The API refuses expired results even before the next purge. Old pending requests and old day counters are removed too. Fixed lifetime cohort slots persist; result deletion does not admit new participants. Request deduplication lasts the result retention window. The outbox is not yet projected into My English.

Security advisor reports INFO for RLS with no policy on these private tables: intentional default deny; only restricted owner-defined RPCs access them. No permissive policy should be added to silence this notice.

## Activation And Stop

Keep existing remote variables and secrets when deploying the full Worker. Required non-secret variables:

```
PRONUNCIATION_ENABLED=true
ETRI_SERVICE_USE_APPROVED=true
ETRI_HTTP_PILOT_APPROVED=true
PRONUNCIATION_OPERATOR_CONTROLLED=true
PRONUNCIATION_PILOT_ACTIVATED_AT=2026-09-27T21:57:10Z
```

Existing ETRI_API_KEY remains a Worker secret; no secret was copied. The provider receives explicit null expiry. Missing flags, missing/invalid activation, v1 consent, mismatched DB activation, disabled policy, anonymous/unconfirmed identity and absent plaintext consent all fail closed. The browser needs the v2 contract and its feature switch enabled separately.

Immediate stop: set private.pronunciation_policy_v1.enabled=false for pilot english-pronunciation-pilot-20260923, or deploy PRONUNCIATION_ENABLED=false with --keep-vars. A stop cannot recall an already dispatched request. Keep the retention cron when stopping. Do not roll back unrelated worker functionality or drop stored data as a rollback.

## Verification And Limits

New v2 store and actual API-index integration: 32/32 pass, no skips. Existing API regression: 10 files, Node 31/31 pass. Wrangler 4.141.0 dry run passes, 325.24 KiB. Tests use synthetic users and provider doubles, not real member audio. Local PGlite tests are one connection, not independent-session contention proof; SQL policy-row and request advisory locks serialize limits. Production grants/RLS and empty retention execution verified. Actual member microphone, provider response and live saved receipt require the user's phone test; do not claim those from mock tests.

Release version and verification outcome are recorded in root docs/handoffs/pronunciation-live-20260928.md after deployment.
