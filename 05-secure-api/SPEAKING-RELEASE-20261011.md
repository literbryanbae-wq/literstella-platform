# Speech UX release — 2026-10-11

Baseline: platform origin/main 3e4a87a (live API 5b293842-43db-4931-9c81-4e377f308668).

## Scope

- Existing auth, English premium/panel entitlement and CORS reused. No membership grants.
- ETRI: enforce 20 seconds / 30 words / one sentence before external dispatch. Recording autostop remains 19 seconds. Read-only member remainder RPC, existing ten-per-day ledger unchanged.
- Speaking: server-only provider and atomic reservation pipeline added, **default OFF**. Each verified member can use 2 per KST day when activated. Policy must have approved expiry and global daily cap, max 5 concurrent. Request replay cannot dispatch again.
- Only actual numeric scores/observations retained for 30 days. Speech recognition returned once, no raw audio or transcript columns. Service-only RPC and RLS-denied private tables, hourly retention cleanup.
- Database migration applied with enabled=false, expiry/global cap unset. No assessment requests submitted by migration.

## Activation gates

Await user confirmation: whole-service daily cap, precise trial end, and whether the locally provided SpeechSuper key has been rotated since its earlier disclosure. Never publish credentials. Keep SPEAKING_ENABLED off until all confirmed.

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
