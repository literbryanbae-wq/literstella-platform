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

Deployment version and actual account/quota verification must be recorded after release; do not equate these mocked tests with real provider results.
