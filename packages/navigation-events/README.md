# Shared Navigation and Events

Production release completed, 2026-09-13. Canonical source; generated app copies must not be manually edited.

## Integration contract

`src/NavigationHub.jsx` exports:
- default `NavigationHub({ app, sections, navigate, locationKey })`. Mount once outside page routes. `sections` is an array of `{id,title,items:[{id,label,href?,action?}]}` for THIS APP and account/support functions. Actions execute through the passed callback `onAction(action)` prop. Common events and network services are appended by the hub.
- `NavigationButtons({compact=false})`: header menu and events triggers; CSS hides button text below 900px, maintains accessible names.
- `openMenu()`, `openEvents(slug?)`, `openHighlights()` exported functions dispatch shared browser events.
- `EventHighlights({onSelect})`: four compact cards suitable inside the EXISTING campaign modal. `onSelect(slug)` must close the old modal with its existing history cleanup THEN call openEvents(slug). Preserve current suppression/schedule policies. Do not add a second automatic popup.

`navigate(path)` is the app's router callback. If absent, native history.pushState plus popstate is used. `locationKey` is pathname+search+hash; changes reconcile direct links and Back. Events pages are `/events` and `/events/:slug` (no new submission form or backend). The host renders an accessible full-page event surface and menu as body portals. Add `/events/*` no-op route in a Routes-based app to avoid fallback redirects. Existing forms remain mounted where possible; do not change auth or data contracts.

`node LiterStella-DEV/packages/navigation-events/sync.mjs <app-root>` copies src to `<app-root>/src/core/navigation-events` and illustration assets to `public/navigation-events`. It does NOT rewrite app entry points, package.json, or unrelated shared components. Parent runs sync after source ready.

Released consumers: READ `4864533`, Class `8fc7f3f`, Challenge/Diary `7e42ddae`, English `967fc2b`.
The original September 11/12 development worktrees are not the final release baseline. Use the latest deployed app commit for subsequent work.

Preserve 5 existing primary tabs in this first integration. Replace their entire-menu launcher with openMenu. Add events in header and entire menu instead of deleting reader/report tabs. Unify hamburger and full menu. Keep tools dock for running tools, not a second all-menu.

Full menu four groups: current app, events, shared services, account/support. Existing local feature actions and account APIs stay owned by app adapters. Gift/partner excluded from popup rollout. Mobile navigation controls have a 48px minimum target. This package does not deploy consumers automatically: sync, run each app's guards, build, and verify each production deployment separately.

Release details: project-root `.ai-coordination/inbox-claude/navigation-events-live-20260913.md`. READ and both Pages apps were pushed to their existing main branches; English was backed up on its own branch and deployed by its owner without changing Class main. No DB, API, email, or eligibility changes are part of this package.
