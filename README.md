# Outfit Planner

A small offline-first web app for planning trip outfits day by day. Built as a static site so it can run on free GitHub Pages and works on iPhone via Brave (or any modern mobile browser).

## What it does

- Add clothing **items** (tops, pants, shoes, accessories) with a photo, description, and purchase URL.
- Mark each item as **owned** or **need to buy** so you know what's still outstanding.
- Combine items into named, reusable **outfits** with anatomical top-down layout (accessories → top → pant → shoes).
- Create **trips** with a date range, then assign an outfit to each day.
- Per-trip **shopping list** automatically lists every item referenced anywhere in the trip that you don't own yet.
- **Export / import** all data as a single JSON file so you can move it between devices.
- Works offline once loaded (service worker caches the app shell).

## Local testing (before deploying)

Open `index.html` directly via `file://` will NOT work — browsers block JavaScript modules and IndexedDB on file URLs. Serve the folder over HTTP first:

```sh
# Windows: double-click serve.bat, or run:
.\serve.bat

# macOS / Linux:
./serve.sh
```

Either script tries `python -m http.server`, then falls back to `npx serve`. Then open <http://127.0.0.1:5173/>.

To run the test suite, open <http://127.0.0.1:5173/tests/test.html> — it runs automatically and reports pass/fail counts inline. There are 23 tests covering pure logic (UUID, routing, date helpers, blob ↔ base64 roundtrip) and IndexedDB integration (CRUD, cascade deletes, shopping list, export/import).

## Deploying to GitHub Pages

1. Create an empty **public** GitHub repository (e.g. `outfit-planner`).
2. From this folder:
   ```sh
   git init
   git branch -M main
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/<your-username>/outfit-planner.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: main, Folder: / (root) → Save**.
4. After ~1 minute the site will be live at `https://<your-username>.github.io/outfit-planner/`.

### Installing on iPhone

1. Open the URL in **Brave** (or Safari).
2. Tap the **Share** button → **Add to Home Screen**. This lets the app launch full-screen, stay offline, and keeps IndexedDB from being evicted as aggressively.

The app respects iOS safe areas, uses 16px form fields to avoid focus zoom, and shows a native file picker action sheet so you can choose between **Camera** and **Photo Library** when adding item photos.

## Data portability

Because Safari/WebKit aggressively evicts IndexedDB on sites that aren't added to the home screen, **export to JSON regularly** as your real backup.

- **Settings → Export** downloads `outfit-planner-export-YYYY-MM-DD.json` (images are base64-embedded so it's a single file you can email / AirDrop / save to iCloud Drive).
- **Settings → Import** restores from that file. You can choose **Replace** (wipes current data first) or **Merge** (additive, upserts by id).
- **Settings → Copy export as text** is a fallback for browsers that block file downloads.

A 50-item export typically lands at 7–13 MB.

## Manual QA checklist

Before declaring a release ready, walk through this on the device you actually use (especially iPhone Brave):

- [ ] Add an item via **Camera** (action sheet shows Camera + Photo Library)
- [ ] Add an item via **Photo Library**
- [ ] Edit an item, change category to Accessory — the **Subcategory** field appears
- [ ] Toggle "I own this" off, save — item shows amber `$` badge in lists
- [ ] Create an outfit with all 4 slot types
- [ ] Create an outfit with only Top + Shoes (other slots stay dashed)
- [ ] Create a trip July 1–14, assign different outfits to 5 days
- [ ] Verify the **Shopping list** at top of trip detail aggregates only unowned items
- [ ] Mark a shopping list item as owned → it disappears live, day rollups update
- [ ] Try a reversed-date trip (end before start) — should be rejected
- [ ] **Export** → clear data → **Import** → all items/outfits/trips/days restored, images included
- [ ] Add to Home Screen → kill network → relaunch → app shell loads
- [ ] Settings shows storage estimate

### Cross-browser sanity

| Browser | Notes |
|---|---|
| iPhone Brave (primary) | The main target. WebKit under the hood. |
| iPad Safari | Tablet breakpoint shows 2–3 column grids. |
| Desktop Chrome / Brave | Sidebar layout, keyboard shortcuts (`g t/o/i/s`, `n`, `Cmd/Ctrl+S`). |
| Desktop Safari | WebKit parity check for iOS. |
| Desktop Firefox | Different IndexedDB internals; smoke test only. |

## Project structure

```
outfit-planner/
├── index.html              # SPA shell, top bar, sidebar, tab bar
├── 404.html                # GH Pages SPA fallback (redirects to base)
├── manifest.webmanifest    # PWA manifest
├── service-worker.js       # Cache-first app shell
├── .nojekyll               # Disable Jekyll on GH Pages
├── serve.bat / serve.sh    # Local dev server one-liners
├── css/
│   ├── reset.css
│   └── app.css             # All styling + responsive tokens
├── icons/                  # PNG icons + svg source
├── js/
│   ├── app.js              # Boots router, registers service worker, keyboard shortcuts
│   ├── router.js           # Hash-based router
│   ├── ui.js               # el(), bottom sheet, toast, confirm helpers
│   ├── db.js               # IndexedDB schema + getDb()
│   ├── store.js            # items/outfits/trips/dayPlans CRUD + aggregate helpers
│   ├── image.js            # File → resized JPEG Blob + objectURL lifecycle
│   ├── exporter.js         # JSON export / import (blob ↔ base64)
│   ├── vendor/idb.js       # Vendored idb library (Jake Archibald)
│   ├── components/         # nav.js, outfit-stack.js, picker.js
│   └── views/              # trips, trip-detail, outfits, outfit-editor, items, item-editor, settings
└── tests/                  # In-browser test harness + suite
```

## Tech notes

- No build step. Pure ES modules, all served as static files.
- IndexedDB stores blobs natively at runtime; base64 only used for export.
- Images resized client-side to 1024px longest side at JPEG q=0.82 — typical 80–180 KB per item.
- Top-down anatomical ordering (accessories → top → pant → shoes) is used consistently in the outfit editor, outfit cards, and trip-day rows.
- Single accent color; content imagery carries visual richness.
- Respects `prefers-color-scheme` (auto dark mode) and `prefers-reduced-motion`.

## Troubleshooting

- **Blank page when opening `index.html`** — you opened a `file://` URL. Run `serve.bat` / `serve.sh` and open `http://127.0.0.1:5173/`.
- **"Brave Shields blocked storage"** — lower shields for this site, or use Standard mode.
- **Export file opens in browser instead of downloading on iOS** — use **Settings → Copy export as text** and paste into a note.
- **Data disappeared after a week** — WebKit evicts IndexedDB for sites not on the home screen. Always Add to Home Screen and export regularly.
