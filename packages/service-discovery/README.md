# Shared Service Cards

This is the editable source of truth for diagnosis, class, and challenge/diary service cards.

- Edit `src/ServiceDiscoveryDashboard.jsx` for the menu, rating ordering and markup.
- Edit `src/ServiceDiscoveryDashboard.css` for all card styles.
- Approved images live in `assets/`.
- `targets.json` explicitly selects current development worktrees. Review it before a new integration; never silently overwrite an arbitrary checkout.

From the workspace root:

```powershell
node LiterStella-DEV/packages/service-discovery/sync.mjs
node LiterStella-DEV/packages/service-discovery/test.mjs
```

One sync updates every configured consumer. `sync.mjs --check` fails if any target differs from the current canonical source. Run this before coordinated release.

Apps import their generated `src/core/service-discovery` files, not a path outside their repository. Generated files and assets must be committed with their manifest. This preserves isolated Cloudflare builds without npm workspaces, symlinks, or a runtime CDN dependency. No package publishing credential is needed.

Every app prebuild runs the generated hash verifier. It rejects edits to generated source/styles/assets relative to the committed manifest. A remote isolated build cannot know that the canonical workspace has a newer uncommitted version; the cross-app `--check` step is required before release. Do not claim that one app deployment automatically deploys others.

Host contracts: `client` supplies the existing anonymous public ratings RPC client; `onTimer` supplies the app's existing two-timer event. Class and challenge keep their own modal/session behavior. Diagnosis mounts the same React component with a WeakMap-owned root and uses the shared inline two-link chooser. Auth, DB writes, entitlement and timer engines remain outside this package.

`migrate.mjs` and `prepare-source.mjs` are one-time migration tools, not normal update commands. Do not rerun them after integration. Routine changes use only sync/check/test.

Coverage: card menus present on class, diagnosis, challenge and diary. Other sites without this menu (shop/partner/global/standalone timer) are not given new UI. Their footer/navigation is not this component.

2026-09-09: release integration for diagnosis, class and challenge/diary. English learning is pinned first with NEW; Global is last with NEW. Four dedicated square scenes replace reused backgrounds; ten original landscape scenes use contain, preserving the whole image. New artwork provenance: artifacts/service-card-art-20260909/HANDOFF.md.

Text manifest hashes normalize CRLF to LF; binary assets remain byte-exact. This is required because Windows Git checkout and Linux Pages checkout use different line endings. Test both the canonical check and committed blob hashes before release. Per-app live status is recorded in CODEX-CLAUDE-HANDOFF.md, not inferred from local builds. Shop is excluded; English/partner footer integration remains separate and incomplete.
