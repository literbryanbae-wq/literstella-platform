# Speech UX release — 2026-10-11

## Current activation — 2026-10-11

The operator confirmed the existing key was not exposed and authorized activation.
Earlier statements below about a disclosed key were an unsupported agent assumption,
not a verified security incident; key rotation is not an activation prerequisite.
The operator approved automatic expiry at `2026-10-22T00:00:00+09:00`.

Existing credentials are installed only as Worker secrets (no plaintext copy,
source value, browser value or signature recorded). Source `21571f7` enables the
existing speaking route. Worker `92181d79-1d8d-4330-8f5f-8d5ebd7f80cb` is deployed.
DB singleton policy is ON with the approved expiry, unlimited request count and
five concurrent leases. No auth, membership, RLS or raw-audio retention changes.
Nine SQL/route tests and Worker dry-run pass. Live signed-in status is ready.
The operator-provided 27-second Korean-prompt recording completed a real
`asr.eval` request through the production member UI: overall 78, pronunciation
83, fluency 52, rhythm 80. Text recognition was uncertain, so meaning judgment
was explicitly withheld. The result dashboard and a single completed/saved DB
record match. No recognized text, audio or reference script fields were stored.
Guest status still returns 401. No actual `para.eval` or new ETRI call was tested
in this activation run. Screenshot: `D:/literstella-work/speaking-ux-audit-20261011/activation-live-result.png`.

Earlier OFF status in the historical release sections describes the earlier
deployment only and is superseded by this section.

## Superseding policy — unlimited trial (operator approved 2026-10-11)

The member 2/day rule and proposed service 100/day rule below are superseded.
`usageMode=unlimited-trial`, memberDailyLimit/serviceDailyLimit=null. New migration
`20261011051629_speaking_unlimited_trial.sql` is applied; concurrent leases remain
limited to five, with idempotency, expiry and authorization unchanged. Existing
requests are measured for utilization, not charged against a daily allowance.
Raw recording/transcript retention is still forbidden; records remain 30 days.

Nine synthetic SQL/route tests pass, including one member completing 105 requests,
five pending leases, sixth busy, completion releasing a lease, and storage privacy.
These are not 105 actual supplier calls. Existing membership/auth regressions pass.
At this earlier policy-only deployment activation remained OFF; expiry was unset.
Do not describe this code/policy deployment as an opened or provider-tested service.
No ETRI policy changes in this follow-up. Both repositories use isolated branches;
the API main branch still needs these speech commits before its next deployment.

### Unlimited trial deployed and checked

- API source `9d0ffdf`, Worker version `d5c13881-0b5e-4b21-8aa4-157d5e56e66d`.
- Frontend source `db793d6`, Worker version `29e4c878-581a-4788-9568-440fce2316ce`; 84/84 public asset SHA-256 hashes match.
- Logged-in production browser shows unlimited trial heading and touch help; 320/390/1440px document widths do not overflow. The actual service remains visibly unavailable, matching OFF policy.
- Screenshot: `D:/literstella-work/speaking-ux-audit-20261011/unlimited-live-mobile.png`.
- No real audio was submitted in that policy-only follow-up. Current activation is described above; the superseded daily-cap gate no longer applies.

Baseline: platform origin/main 3e4a87a (live API 5b293842-43db-4931-9c81-4e377f308668).

## Scope

- Existing auth, English premium/panel entitlement and CORS reused. No membership grants.
- ETRI: enforce 20 seconds / 30 words / one sentence before external dispatch. Recording autostop remains 19 seconds. Read-only member remainder RPC, existing ten-per-day ledger unchanged.
- Speaking: server-only provider and atomic reservation pipeline added, **default OFF**. Each verified member can use 2 per KST day when activated. Policy must have approved expiry and global daily cap, max 5 concurrent. Request replay cannot dispatch again.
- Only actual numeric scores/observations retained for 30 days. Speech recognition returned once, no raw audio or transcript columns. Service-only RPC and RLS-denied private tables, hourly retention cleanup.
- Database migration applied with enabled=false, expiry/global cap unset. No assessment requests submitted by migration.

## Activation gates

Historical gate list is superseded by current activation above. There was no verified key exposure. Never publish credential values. Unlimited utilization and the trial expiry are now operator-approved.

## Verification

- Frontend speech contracts: 70 passed, before final copy/file-duration follow-up.
- PGlite SQL: 4 passed (synthetic accounts only; not an independent live concurrent-session test).
- Route adapter: 3 passed; existing growth-panel service 24 groups, premium 5, auth-email 14 assertions passed.
- Worker dry run succeeds, existing service bindings preserved. No full payment regression claim.
- Post-migration checks: anon/authenticated cannot execute new RPC; service role can. Retention cron active. Security advisor's two RLS-without-policy INFO items are intentional deny-browser private tables, not unrestricted access. Existing unrelated advisor findings left untouched.
- Relevant advisory: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Deployed

- API source 8732f5e + migration 320468e. Worker d69133eb-2b87-4ca0-8848-f3b102ea1cb9. Existing bindings/vars kept.
- Frontend initial release 16088c4, Worker 44039b9e-ea5a-46e9-b947-c61bd9dacc93; 84/84 public asset hashes match. Additional waveform correction follows this release.
- Logged-in production account: single-sentence status shows 10/10 remaining. Long material selects separate valid sentences. Guest status returns 401 for both services.
- Speaking policy remains off and request count is 0. Actual transmission/charge NOT tested yet; activation gates above remain unresolved. Do not represent fixture tests or file loading as a provider analysis.
