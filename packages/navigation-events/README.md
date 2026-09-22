# Shared Navigation and Events

Production release completed, 2026-09-13. Canonical source; generated app copies must not be manually edited.

## Menu split follow-up, 2026-09-13

The newer approved contract supersedes the merged menu described below: mobile/wide header hamburger calls `openMenu()` for current-app functions and account/help only. Mobile bottom All calls `openServiceMenu()` for the representative service cards. They are two views in one hub, not one combined list.

`ServiceMenuCards` and the page dashboard share `ServiceCard` and the catalog in `packages/service-discovery`. The latest user correction restores the bottom menu to SVG icons and text, NOT image cards. From 14 entries, omit held Goods and the CURRENT host: READ=diagnosis, Class=lecture, Challenge=challenge, Diary=diary, English=english-learning. This keeps 12 entries, including Global last. A mode switch updates the omitted item. Do not omit Global to make the count fit, hide both Challenge and Diary, or remove Global/Goods from the original page dashboard.

Sync both packages to the intended latest app checkout. For an isolated release use `service-discovery/sync.mjs --root=<app-root> --existing`, then `navigation-events/sync.mjs <app-root>`. The first command retains the consumer's manifest boundary instead of updating unrelated legacy targets. Run `node packages/navigation-events/menu-split-test.mjs <app-root>` for actual SSR/asset/trigger contracts plus each app's own tests/build.

Bottom menu items use the same Lucide icon per service across hosts (26px, stroke 1.75), text and NEW only. Use three columns on mobile and four from 600px; no background image, review or CTA prose. The body dashboard retains its original image cards. Menu colors follow the portal layer theme, independent of the host body class. No new data fetch is made by opening the menu. Parent handoff: `.ai-coordination/inbox-claude/navigation-menu-split-20260913.md` (status is separate from the earlier LIVE release).

## Integration contract

`src/NavigationHub.jsx` exports:
- default `NavigationHub({ app, sections, navigate, locationKey })`. Mount once outside page routes. `sections` is an array of `{id,title,items:[{id,label,href?,action?}]}` for THIS APP and account/support functions. Actions execute through the passed callback `onAction(action)` prop. Common events and network services are appended by the hub.
- `NavigationButtons({compact=false,eventsOnly=false})`: header menu and events triggers; CSS hides button text below 900px, maintains accessible names. `eventsOnly` reuses the same event trigger beside a host's existing mobile hamburger without adding a duplicate menu button.
- `openMenu()` (app functions), `openServiceMenu()` (representative cards), `openEvents(slug?)`, `openHighlights()` dispatch separate shared browser events.
- `EventHighlights({onSelect})`: four compact cards suitable inside the EXISTING campaign modal. `onSelect(slug)` must close the old modal with its existing history cleanup THEN call openEvents(slug). Preserve current suppression/schedule policies. Do not add a second automatic popup.

`navigate(path)` is the app's router callback. If absent, native history.pushState plus popstate is used. `locationKey` is pathname+search+hash; changes reconcile direct links and Back. Events pages are `/events` and `/events/:slug` (no new submission form or backend). The host renders an accessible full-page event surface and menu as body portals. Add `/events/*` no-op route in a Routes-based app to avoid fallback redirects. Existing forms remain mounted where possible; do not change auth or data contracts.

`node LiterStella-DEV/packages/navigation-events/sync.mjs <app-root>` copies src to `<app-root>/src/core/navigation-events` and illustration assets to `public/navigation-events`. It does NOT rewrite app entry points, package.json, or unrelated shared components. Parent runs sync after source ready.

Released consumers: READ `4864533`, Class `8fc7f3f`, Challenge/Diary `7e42ddae`, English `967fc2b`.
The original September 11/12 development worktrees are not the final release baseline. Use the latest deployed app commit for subsequent work.

Preserve 5 primary tabs. Their full-menu launcher uses openServiceMenu, while header hamburger uses openMenu. Add events in header and app menu instead of deleting reader/report tabs. Keep tools dock for running tools, not a second all-menu.

App menu groups: current app, events entry, account/support. Representative services are exclusively in the separate card view. Existing local feature actions and account APIs stay owned by app adapters. Gift/partner excluded from popup rollout. Mobile navigation controls have a 48px minimum target. This package does not deploy consumers automatically: sync, run each app's guards, build, and verify each production deployment separately.

Release details: project-root `.ai-coordination/inbox-claude/navigation-events-live-20260913.md`. READ and both Pages apps were pushed to their existing main branches; English was backed up on its own branch and deployed by its owner without changing Class main. No DB, API, email, or eligibility changes are part of this package.
