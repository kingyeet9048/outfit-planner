# AI Agent Rules

These rules apply to all Claude work in this repository.

## Project Context

Outfit Planner is an offline-first, static PWA for non-technical people planning trip outfits day by day. The core promise is simple: users can photograph clothing, mark what they own or still need to buy, assemble outfits, assign outfits to trip days, and shop only what is missing.

The primary target device is an iPhone Home Screen app running WebKit through Safari or Brave. Desktop Chrome/Brave is useful for development, but iPhone behavior is the production truth. Protecting user data is a central product concern because WebKit can evict IndexedDB for browser-tab sites that are not installed to the Home Screen.

The app is intentionally deployable as a static GitHub Pages site with no build step and no backend. Treat IndexedDB as the local source of truth, the service worker as the offline/update layer, and JSON export/backup/restore as the user's safety net.

## Product Principles

- Optimize for non-technical users. Prefer plain language, obvious controls, forgiving recovery paths, and minimal setup.
- Never make data loss easy. Preserve IndexedDB data, maintain import/export compatibility, and keep backup/restore paths visible and understandable.
- iPhone standalone PWA details matter: safe areas, touch targets, 16px inputs to avoid zoom, WebKit storage behavior, Share Sheet limitations, and service worker update quirks.
- Navigation must feel native. Back should return to the exact prior context, including filters and scroll position, rather than a generic parent screen.
- Keep the app useful offline. Features should degrade clearly when network-only behavior is unavailable.
- Follow HCI principles for UI changes: visibility, feedback, consistency, discoverability, error prevention, recovery, accessibility, and low cognitive load.

## Domain Model

- **Items** are clothing entries with category, optional subcategory, photo blob, description, purchase URL, ownership status, and timestamps.
- **Outfits** combine item IDs into anatomical slots: accessories, top, pant, shoes, and other.
- **Trips** define a date range.
- **Day plans** assign one or more outfits to individual trip days.
- **Shopping list** is derived from unowned items used by outfits in a trip, deduped by item ID and grouped by retailer from purchase-link domains.

## Architecture Notes

- No build step: pure ES modules loaded directly by `index.html`.
- Persistent data lives in IndexedDB via `js/db.js` and `js/store.js`.
- Export/import/backup behavior lives in `js/exporter.js` and `js/backup.js`.
- Routing is hash-based in `js/router.js`; keep query parameters shareable for state such as filters.
- The service worker precaches the app shell and manages offline/update behavior. Every production-facing code or asset change must bump `CACHE_NAME`.
- Tests run in-browser at `/tests/test.html`; use the local HTTP server, never `file://`.

## Branching and PRs

- Do not push directly to `main`. Direct pushes are blocked.
- Create or use a feature branch for every change set.
- Produce a pull request for every change set and keep the PR scoped to the requested work.

## Required Tests

- Every PR must include UI and E2E test coverage for the changed behavior.
- When changing existing behavior, update or add tests that protect the current expected functionality as well as the new path.
- Run the relevant local test suite before opening a PR and include the verification in the PR notes.

## Human Computer Interaction

- Evaluate all feature and UI changes through Human Computer Interaction principles.
- Consider usability, accessibility, consistency, discoverability, feedback, error prevention, recovery paths, cognitive load, and mobile/touch ergonomics.
- Preserve existing workflows unless the requested change intentionally improves them.

## Production Update Cache

- For every PR or production-facing change, bump the service worker cache version in `service-worker.js`.
- Keep the cache version change with the feature/fix so deployed updates reach existing production devices.

## High-Risk Areas

- IndexedDB schema, blob handling, import/export, backup, restore, and storage eviction protection.
- Service worker caching and update flow; stale iPhone Home Screen apps are a real user pain.
- iOS safe-area layout, especially top bars, bottom tab bars, modal sheets, and installed standalone mode.
- Navigation/history behavior, including Back, filters, scroll restoration, and cold deep-link fallbacks.
- Photo capture/library flows and image blob preservation on WebKit.

## Implementation Expectations

- Read the existing view/component patterns before adding abstractions.
- Keep changes scoped and preserve existing workflows unless the task explicitly changes them.
- Add functional tests and UI/E2E smoke coverage for changed behavior.
- Manually verify important mobile/PWA behavior when feasible, especially with headless browser checks for layout, routing, and console errors.
- For user-facing UI, prefer polished production controls over explanatory text blocks. Make the app itself usable, not just documented.
