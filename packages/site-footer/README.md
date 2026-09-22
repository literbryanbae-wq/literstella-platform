# Shared Site Footer

Single source for READ, Class, Challenge/Diary, and English footers and brand icons.
Do not edit generated `src/core/site-footer` files in an application.

## Update

1. Edit `src/footer.mjs`, `src/footer.css`, or `src/serviceMenu.js` here.
2. Brand files live in `assets/`; they are the existing READ originals.
3. Run `node test.mjs`, then `node sync.mjs <app-root> <read|class|challenge|english>` for each intended checkout.
4. Build each app. `scripts/verify-site-footer.mjs` rejects generated-file drift, including favicon drift; text hashes normalize CRLF.
5. Review and deploy each app separately. Sync does not commit, push, or deploy.

READ uses generated static markup so its existing legal-dialog IDs remain available at page load.
React apps use `SiteFooter.jsx` with callbacks for their existing legal/payment actions.
English keeps the `.ls-network-surface` portal under `.gl-preview`; focused practice still hides it.

Only this package is synchronized. Do not synchronize the separate service-discovery package as part of a footer update: its app-specific timer/bridge changes may be newer.

Favicons, Apple touch icons, and manifest icons are copied to `public/brand/shared`. Legacy `/favicon.ico` and `/favicon.png` also receive the same source. OG metadata and images are not changed.

Current local review checkouts: `E:/LiterStella Project/.codex-worktrees/shared-footer-{read,class,challenge,english}-20260911`.
Use `qa.mjs` with their Vite servers on ports 5238-5241. It checks 320/390/768/1440, light/dark, loaded logos, targets, overflow and favicon equality. Screenshots hide fixed headers only to show the isolated footer without screenshot clipping; the application headers are unchanged.
