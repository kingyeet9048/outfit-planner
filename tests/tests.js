// Tiny in-browser test runner + suite. No build, no framework.

import { openDB } from '../js/vendor/idb.js';
import { match, register } from '../js/router.js';
import { el, backControl } from '../js/ui.js';
import { renderNav } from '../js/components/nav.js';
import {
  TAG_LIMITS, availableTags, filterItems, itemMatchesQuery, normalizeItemFilter, normalizeTags, outfitMatchesQuery
} from '../js/search.js';
import { parseIntent } from '../js/stylist/intent.js';
import { buildItemContext, generateOutfits } from '../js/stylist/engine.js';
import { rgbToHsv, colorTone, harmonyScore, classifyHarmony } from '../js/stylist/color.js';
import { blobToBase64, base64ToBlob, buildExport, importFromObject, SCHEMA_VERSION } from '../js/exporter.js';
import * as db from '../js/db.js';
import { items, outfits, trips, dayPlans, daysBetween, formatDayLabel, formatDateRange, tripShoppingList, tripStats, retailerFromUrl, groupShoppingByRetailer } from '../js/store.js';
import { buildOutfitReuseSummary, mergeOutfitIds, nextCopyName, reuseSummaryCopy, reuseSummaryShortText } from '../js/reuse.js';
import { pickItem, pickOutfit } from '../js/components/picker.js';
import { renderStack } from '../js/components/outfit-stack.js';
import {
  addCustomPackingItem,
  deriveTripPacking,
  normalizePackingState,
  removeCustomPackingItem,
  setCustomPackingItemChecked
} from '../js/packing.js';
import { renderOutfitsCanvas, canvasToBlob, shareOutfits } from '../js/share.js';
import { isStandalone, isPersisted, isStorageProtected, isIOS } from '../js/storage.js';
import {
  shouldRemindBackup, isEmptyCounts, BACKUP_FILENAME, BACKUP_INTERVAL_MS,
  getCounts, isDatabaseEmpty, restoreFromFile, supportsFileSystemAccess, supportsShareFile,
  getLastBackupAt, setLastBackupAt, LAST_BACKUP_KEY
} from '../js/backup.js';
import {
  buildSetupStatus, dismissSetup, isSetupDismissed, loadSetupFacts, renderSetupCard,
  renderActivationHero, renderSetupSettingsRow, resetSetupDismissal, SETUP_DISMISSED_KEY,
  shouldShowActivationHero, shouldShowSetupCard
} from '../js/setup.js';
import { buildDemoDates, DEMO_TRIP_KEY, seedDemoTrip } from '../js/demo.js';
import {
  ACTIVATION_LOG_KEY, clearActivationEvents, getActivationEvents, normalizeRoute,
  sanitizeActivationData, trackActivation
} from '../js/activation.js';
import {
  buildFeedbackPacket, clearFeedbackEntries, FEEDBACK_LOG_KEY, FEEDBACK_PENDING_KEY,
  FEEDBACK_SESSION_KEY, FEEDBACK_STATE_KEY, getFeedbackEntries, queueFeedbackPrompt,
  recordFeedback, shouldPromptFeedback, showFeedbackPrompt, showQueuedFeedbackPrompt
} from '../js/feedback.js';
import { openInstallGuide, refreshStorageBanner, storageBannerMode } from '../js/components/storage-banner.js';
import {
  EMPTY_APP_SEEN_KEY, markEmptyAppSeen, shouldOfferRestorePromptForCounts,
  showBackupReminder, showRestorePrompt
} from '../js/components/backup-prompts.js';
import { shouldPromptUpdate, showUpdateBanner, dismissUpdateBanner, UPDATE_CHECK_INTERVAL_MS } from '../js/update.js';
import {
  clearItemCreateContinuation,
  clearOutfitCreateContinuation,
  peekOutfitCreateContinuation,
  startOutfitCreateContinuation
} from '../js/continuations.js';

const TEST_DB = 'outfit-planner-test';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'assertEq'}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
}
function assertTrue(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function assertThrows(fn, expected) {
  return Promise.resolve().then(fn).then(
    () => { throw new Error(`expected to throw${expected ? `: ${expected}` : ''}`); },
    (err) => { if (expected && !err.message.includes(expected)) throw new Error(`wrong error: ${err.message}`); }
  );
}

// Replace getDb in store.js by overriding the cached connection.
// We achieve this by re-opening the test DB ourselves and storing it via db._resetCache + a setter.
let lastConn = null;
async function withTestDb() {
  // Close prior connection so deleteDatabase doesn't block
  if (lastConn) { try { lastConn.close(); } catch {} lastConn = null; }
  db._setTestDb(null);
  // Wipe test DB first
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(TEST_DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  // Open via the same upgrade callback as the real db
  const conn = await openDB(TEST_DB, db.DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains('items')) {
        const s = d.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('by_category', 'category');
        s.createIndex('by_owned', 'owned');
        s.createIndex('by_createdAt', 'createdAt');
      }
      if (!d.objectStoreNames.contains('outfits')) {
        const s = d.createObjectStore('outfits', { keyPath: 'id' });
        s.createIndex('by_createdAt', 'createdAt');
      }
      if (!d.objectStoreNames.contains('trips')) {
        const s = d.createObjectStore('trips', { keyPath: 'id' });
        s.createIndex('by_startDate', 'startDate');
      }
      if (!d.objectStoreNames.contains('dayPlans')) {
        const s = d.createObjectStore('dayPlans', { keyPath: 'id' });
        s.createIndex('by_tripId', 'tripId');
      }
    }
  });
  // Inject this conn as the cached db
  db._setTestDb(conn);
  lastConn = conn;
  return conn;
}

// We need a hook on db.js to inject a test connection. Patch via global registry.
// Since we can't modify db.js circularly here, we use a side-channel: monkey-patch getDb's underlying cache via the exported _resetCache + writing a separate _setTestDb.
// To support this, db.js exports _resetCache; we now also need _setTestDb. Adjust below if missing.
// (See db.js — if _setTestDb does not exist, we fall back to opening the real DB and prefixing IDs.)
// In practice this file expects db.js to expose _setTestDb. If it doesn't, we'll add it during integration.

// ----- Pure-logic tests -----
test('uuid: generates v4-shaped string', () => {
  const id = db.uuid();
  assertTrue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id), `bad uuid: ${id}`);
});

test('router: match plain route', () => {
  register('/test-route', () => null);
  const m = match('#/test-route');
  assertTrue(m && m.route, 'no match');
  assertEq(m.params, {});
});

test('router: match with single param', () => {
  register('/trip/:id', () => null);
  const m = match('#/trip/abc-123');
  assertTrue(m && m.route, 'no match');
  assertEq(m.params, { id: 'abc-123' });
});

test('router: match trip packing route', () => {
  register('/trip/:id/packing', () => null);
  const m = match('#/trip/abc-123/packing');
  assertTrue(m && m.route, 'no match');
  assertEq(m.params, { id: 'abc-123' });
});

test('router: strips trailing slash but preserves root', () => {
  register('/foo', () => null);
  assertTrue(match('#/foo') && match('#/foo/'), 'should match both');
});

test('router: no match for unknown', () => {
  const m = match('#/this-route-does-not-exist-xyz');
  assertTrue(!m, 'should not match');
});

test('router: match extracts the query string (filters travel with the route)', () => {
  register('/items', () => null);
  const m = match('#/items?filter=tops');
  assertTrue(m && m.route, 'matched');
  assertEq(m.search, 'filter=tops');
  assertEq(new URLSearchParams(m.search).get('filter'), 'tops');
});

test('ui.backControl: renders a real <button> (history-aware), not a hardcoded link', () => {
  // The navigation bug was hardcoded <a href> back buttons. The fix is a button
  // that goes through the router's history-aware back(); assert it's a button.
  const b = backControl('#/items');
  assertEq(b.tagName, 'BUTTON');
  assertEq(b.getAttribute('aria-label'), 'Back');
  assertTrue(!b.getAttribute('href'), 'must not be an anchor with a fixed href');
});

test('nav.renderNav: renders modern SVG tab icons and preserves active state', () => {
  const tabbar = el('nav', { id: 'tabbar' });
  const sidebar = el('nav', { id: 'sidebar-nav' });
  document.body.append(tabbar, sidebar);
  try {
    renderNav('#/items?filter=top');
    assertEq(tabbar.querySelectorAll('.nav-icon svg').length, 5);
    assertEq(sidebar.querySelectorAll('.nav-icon svg').length, 5);
    assertEq(tabbar.querySelector('[aria-current="page"] .tab-label').textContent, 'Items');
    assertTrue(!tabbar.querySelector('.tab-icon'), 'old emoji tab icon class should not render');
  } finally {
    tabbar.remove();
    sidebar.remove();
  }
});

test('daysBetween: inclusive range', () => {
  const d = daysBetween('2026-07-01', '2026-07-03');
  assertEq(d, ['2026-07-01', '2026-07-02', '2026-07-03']);
});

test('daysBetween: single day', () => {
  const d = daysBetween('2026-07-01', '2026-07-01');
  assertEq(d, ['2026-07-01']);
});

test('daysBetween: spans month boundary', () => {
  const d = daysBetween('2026-06-29', '2026-07-02');
  assertEq(d, ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02']);
});

test('formatDayLabel: weekday + short month', () => {
  const l = formatDayLabel('2026-07-01');
  assertEq(l.weekday, 'WED'); // Jul 1 2026 is a Wednesday
  assertEq(l.short, 'Jul 1');
});

test('formatDateRange: across days', () => {
  const s = formatDateRange('2026-07-01', '2026-07-14');
  assertEq(s, 'Jul 1 – Jul 14, 2026');
});

test('reuse: top/pant cross-day reuse produces a strong warning', () => {
  const itemsById = new Map([
    ['top1', { id: 'top1', name: 'White tee' }],
    ['pant1', { id: 'pant1', name: 'Blue pants' }],
    ['shoe1', { id: 'shoe1', name: 'Sneakers' }]
  ]);
  const planned = { id: 'o1', name: 'Monday', topId: 'top1', pantId: 'pant1', shoesId: 'shoe1', accessoryIds: [] };
  const candidate = { id: 'o2', name: 'Tuesday', topId: 'top1', pantId: 'pant1', shoesId: 'shoe1', accessoryIds: [] };
  const outfitsById = new Map([[planned.id, planned], [candidate.id, candidate]]);
  const planByDate = new Map([['2026-07-01', { date: '2026-07-01', outfitIds: [planned.id] }]]);
  const summary = buildOutfitReuseSummary({ outfit: candidate, date: '2026-07-02', planByDate, outfitsById, itemsById });
  assertEq(summary.level, 'strong');
  assertTrue(summary.strongMatches.some(m => m.slot === 'top'), 'top is strong');
  assertTrue(summary.strongMatches.some(m => m.slot === 'pant'), 'pant is strong');
  const copy = reuseSummaryCopy(summary);
  assertEq(copy.title, 'Main pieces repeat');
  assertTrue(/White tee \(top\) repeats on Jul 1 in Monday/.test(copy.detail), copy.detail);
  assertTrue(/Blue pants \(pant\) repeats on Jul 1 in Monday/.test(copy.detail), copy.detail);
});

test('reuse: slot-specific warnings only count the same slot on the planned outfit', () => {
  const itemsById = new Map([
    ['top1', { id: 'top1', name: 'White tee' }],
    ['pant1', { id: 'pant1', name: 'Blue pants' }],
    ['otherTop', { id: 'otherTop', name: 'Black shirt' }],
    ['otherPant', { id: 'otherPant', name: 'Khakis' }]
  ]);
  const planned = {
    id: 'o1',
    name: 'Packed extras',
    topId: 'otherTop',
    pantId: 'otherPant',
    shoesId: null,
    accessoryIds: ['top1'],
    otherIds: ['pant1']
  };
  const candidate = {
    id: 'o2',
    name: 'Candidate',
    topId: 'top1',
    pantId: 'pant1',
    shoesId: null,
    accessoryIds: [],
    otherIds: []
  };
  const outfitsById = new Map([[planned.id, planned], [candidate.id, candidate]]);
  const planByDate = new Map([['2026-07-01', { date: '2026-07-01', outfitIds: [planned.id] }]]);
  const summary = buildOutfitReuseSummary({ outfit: candidate, date: '2026-07-02', planByDate, outfitsById, itemsById });
  assertEq(summary.hasReuse, false);
  assertEq(summary.strongMatches, []);
});

test('reuse: mixed-slot matches do not inflate top and pant copy', () => {
  const itemsById = new Map([
    ['top1', { id: 'top1', name: 'White tee' }],
    ['pant1', { id: 'pant1', name: 'Blue pants' }],
    ['otherPant', { id: 'otherPant', name: 'Khakis' }]
  ]);
  const planned = {
    id: 'o1',
    name: 'Monday',
    topId: 'top1',
    pantId: 'otherPant',
    shoesId: null,
    accessoryIds: [],
    otherIds: ['pant1']
  };
  const candidate = {
    id: 'o2',
    name: 'Tuesday',
    topId: 'top1',
    pantId: 'pant1',
    shoesId: null,
    accessoryIds: [],
    otherIds: []
  };
  const outfitsById = new Map([[planned.id, planned], [candidate.id, candidate]]);
  const planByDate = new Map([['2026-07-01', { date: '2026-07-01', outfitIds: [planned.id] }]]);
  const summary = buildOutfitReuseSummary({ outfit: candidate, date: '2026-07-02', planByDate, outfitsById, itemsById });
  assertEq(summary.level, 'strong');
  assertEq(summary.strongMatches.map(m => m.slot), ['top']);
  assertTrue(/White tee \(top\) repeats on Jul 1 in Monday/.test(reuseSummaryCopy(summary).detail));
});

test('reuse: split repeated slots stay tied to their actual dates and outfits', () => {
  const itemsById = new Map([
    ['top1', { id: 'top1', name: 'White tee' }],
    ['pant1', { id: 'pant1', name: 'Blue pants' }],
    ['top2', { id: 'top2', name: 'Black shirt' }],
    ['pant2', { id: 'pant2', name: 'Khakis' }]
  ]);
  const topDay = { id: 'o1', name: 'Top day', topId: 'top1', pantId: 'pant2' };
  const pantDay = { id: 'o2', name: 'Pant day', topId: 'top2', pantId: 'pant1' };
  const candidate = { id: 'o3', name: 'Candidate', topId: 'top1', pantId: 'pant1' };
  const outfitsById = new Map([[topDay.id, topDay], [pantDay.id, pantDay], [candidate.id, candidate]]);
  const planByDate = new Map([
    ['2026-07-01', { date: '2026-07-01', outfitIds: [topDay.id] }],
    ['2026-07-02', { date: '2026-07-02', outfitIds: [pantDay.id] }]
  ]);
  const summary = buildOutfitReuseSummary({ outfit: candidate, date: '2026-07-03', planByDate, outfitsById, itemsById });
  const short = reuseSummaryShortText(summary);
  assertTrue(/White tee \(top\) repeats on Jul 1/.test(short), short);
  assertTrue(/Blue pants \(pant\) repeats on Jul 2/.test(short), short);
  assertTrue(!/White tee \(top\) and Blue pants \(pant\) repeat on Jul 1 and Jul 2/.test(short), short);
  const copy = reuseSummaryCopy(summary).detail;
  assertTrue(/White tee \(top\) repeats on Jul 1 in Top day/.test(copy), copy);
  assertTrue(/Blue pants \(pant\) repeats on Jul 2 in Pant day/.test(copy), copy);
});

test('reuse: shoes/accessories are lower-severity and same-day use is ignored', () => {
  const itemsById = new Map([
    ['shoe1', { id: 'shoe1', name: 'Sneakers' }],
    ['watch1', { id: 'watch1', name: 'Watch' }]
  ]);
  const planned = { id: 'o1', name: 'Monday', topId: null, pantId: null, shoesId: 'shoe1', accessoryIds: ['watch1'] };
  const candidate = { id: 'o2', name: 'Tuesday', topId: null, pantId: null, shoesId: 'shoe1', accessoryIds: ['watch1'] };
  const outfitsById = new Map([[planned.id, planned], [candidate.id, candidate]]);
  const planByDate = new Map([['2026-07-01', { date: '2026-07-01', outfitIds: [planned.id] }]]);
  const summary = buildOutfitReuseSummary({ outfit: candidate, date: '2026-07-02', planByDate, outfitsById, itemsById });
  assertEq(summary.level, 'soft');
  assertEq(reuseSummaryCopy(summary).title, 'Easy repeat');

  const sameDay = buildOutfitReuseSummary({ outfit: candidate, date: '2026-07-01', planByDate, outfitsById, itemsById });
  assertEq(sameDay.hasReuse, false);
});

test('reuse: mergeOutfitIds and copy names prevent accidental duplicates', () => {
  assertEq(mergeOutfitIds(['a', 'b'], ['b', 'c'], { mode: 'add' }), ['a', 'b', 'c']);
  assertEq(mergeOutfitIds(['a', 'b'], ['b', 'c', 'c'], { mode: 'replace' }), ['b', 'c']);
  assertEq(nextCopyName('Airport outfit', ['Airport outfit', 'Airport outfit copy']), 'Airport outfit copy 2');
});

test('packing: derives assigned outfit items once and splits owned vs to-buy', () => {
  const top = { id: 'top1', name: 'White tee', category: 'top', owned: 1 };
  const pant = { id: 'pant1', name: 'Jeans', category: 'pant', owned: true };
  const shoes = { id: 'shoes1', name: 'Sandals', category: 'shoes', owned: 0 };
  const outfitA = { id: 'outfitA', topId: top.id, pantId: null, shoesId: shoes.id, accessoryIds: [], otherIds: [] };
  const outfitB = { id: 'outfitB', topId: top.id, pantId: pant.id, shoesId: shoes.id, accessoryIds: [], otherIds: [] };
  const summary = deriveTripPacking({
    plans: [
      { date: '2026-07-01', outfitIds: [outfitA.id, outfitB.id] },
      { date: '2026-07-02', outfitIds: [outfitA.id] }
    ],
    outfitsById: new Map([[outfitA.id, outfitA], [outfitB.id, outfitB]]),
    itemsById: new Map([[top.id, top], [pant.id, pant], [shoes.id, shoes]])
  });
  assertEq(summary.ownedItems.map(i => i.id), [top.id, pant.id]);
  assertEq(summary.toBuyItems.map(i => i.id), [shoes.id]);
  assertEq(summary.totalCount, 2);
});

test('packing: progress includes checked owned items and custom checklist items', () => {
  const top = { id: 'top1', name: 'Top', category: 'top', owned: true };
  const outfit = { id: 'outfit1', topId: top.id, pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
  const summary = deriveTripPacking({
    plans: [{ date: '2026-07-01', outfitIds: [outfit.id] }],
    outfitsById: new Map([[outfit.id, outfit]]),
    itemsById: new Map([[top.id, top]]),
    packing: {
      checkedItemIds: [top.id],
      customItems: [
        { id: 'passport', label: 'Passport', checked: true },
        { id: 'charger', label: 'Charger', checked: false }
      ]
    }
  });
  assertEq(summary.totalCount, 3);
  assertEq(summary.checkedCount, 2);
  assertEq(summary.progress, 2 / 3);
});

test('packing: custom helpers normalize, check, and remove custom items', () => {
  let state = addCustomPackingItem(null, { id: 'passport', label: '  Passport  ', nowIso: '2026-07-01T00:00:00.000Z' });
  assertEq(state.customItems.map(i => i.label), ['Passport']);
  state = setCustomPackingItemChecked(state, 'passport', true, '2026-07-02T00:00:00.000Z');
  assertEq(state.customItems[0].checked, true);
  assertEq(state.customItems[0].updatedAt, '2026-07-02T00:00:00.000Z');
  state = removeCustomPackingItem(state, 'passport');
  assertEq(state.customItems, []);
  assertEq(normalizePackingState({ checkedItemIds: ['a', 'a', '', null], customItems: [{ name: 'Legacy', packed: true }] }), {
    checkedItemIds: ['a'],
    customItems: [{ id: 'custom-1', label: 'Legacy', checked: true, createdAt: '', updatedAt: '' }]
  });
  const duplicateIds = normalizePackingState({
    customItems: [
      { id: 'passport', label: 'Passport' },
      { id: 'passport', label: 'Backup passport copy' },
      { label: 'Adapter' }
    ]
  });
  assertEq(duplicateIds.customItems.map(item => item.id), ['passport', 'passport-2', 'custom-3']);
});

test('el(): textarea `value` populates the displayed value (regression: setAttribute(value) is silently ignored on textareas)', () => {
  const ta = el('textarea', { value: 'multi\nline\ntext' });
  assertEq(ta.value, 'multi\nline\ntext');
});

test('el(): input `value` populates the displayed value', () => {
  const inp = el('input', { type: 'text', value: 'hello' });
  assertEq(inp.value, 'hello');
});

test('search.normalizeTags: lowercases, dedupes, strips hashes, and enforces limits', () => {
  const many = Array.from({ length: TAG_LIMITS.maxTags + 5 }, (_, i) => `Extra${i}`);
  const tags = normalizeTags([' Beach ', '#BEACH', 'Dinner Fits', 'x'.repeat(80), ...many]);
  assertEq(tags[0], 'beach');
  assertEq(tags[1], 'dinner fits');
  assertEq(tags[2], 'x'.repeat(TAG_LIMITS.maxLength));
  assertEq(tags.length, TAG_LIMITS.maxTags);
  assertEq(new Set(tags).size, tags.length);
});

test('search.filterItems: combines category, ownership, q, and tag filters', () => {
  const wardrobe = [
    { id: '1', name: 'White Linen Shirt', category: 'top', owned: 1, tags: ['Beach', 'Capsule'] },
    { id: '2', name: 'Black Jeans', category: 'pant', owned: 1, tags: ['city'] },
    { id: '3', name: 'Gold Sandals', category: 'shoes', owned: 0, tags: ['beach'] }
  ];
  assertEq(availableTags(wardrobe), ['beach', 'capsule', 'city']);
  assertEq(filterItems(wardrobe, { filter: 'top', q: 'linen', tag: 'BEACH' }).map(i => i.id), ['1']);
  assertEq(filterItems(wardrobe, { filter: 'tobuy', tag: 'beach' }).map(i => i.id), ['3']);
  assertEq(itemMatchesQuery(wardrobe[0], 'capsule shirt'), true);
});

test('search.filterItems: supports dress, skirt, and purse item categories', () => {
  const wardrobe = [
    { id: 'dress1', name: 'Black Travel Dress', category: 'dress', owned: 1 },
    { id: 'skirt1', name: 'Pleated Midi', category: 'skirt', owned: 1 },
    { id: 'purse1', name: 'Crossbody Bag', category: 'purse', owned: 0 }
  ];
  assertEq(normalizeItemFilter('dress'), 'dress');
  assertEq(normalizeItemFilter('skirt'), 'skirt');
  assertEq(normalizeItemFilter('purse'), 'purse');
  assertEq(filterItems(wardrobe, { filter: 'dress' }).map(i => i.id), ['dress1']);
  assertEq(filterItems(wardrobe, { filter: 'skirt' }).map(i => i.id), ['skirt1']);
  assertEq(filterItems(wardrobe, { filter: 'purse' }).map(i => i.id), ['purse1']);
  assertEq(filterItems(wardrobe, { filter: 'tobuy' }).map(i => i.id), ['purse1']);
  assertEq(itemMatchesQuery(wardrobe[2], 'purse crossbody'), true);
});

test('search.outfitMatchesQuery: matches outfit text and contained item names/tags', () => {
  const top = { id: 'top1', name: 'Silk Cami', tags: ['Dinner'] };
  const shoes = { id: 'shoe1', name: 'Black Heel', tags: ['Formal'] };
  const outfit = { name: 'Evening look', notes: 'Rooftop reservation', topId: top.id, shoesId: shoes.id, accessoryIds: [], otherIds: [] };
  const itemsById = new Map([[top.id, top], [shoes.id, shoes]]);
  assertEq(outfitMatchesQuery(outfit, itemsById, 'rooftop'), true);
  assertEq(outfitMatchesQuery(outfit, itemsById, 'silk dinner'), true);
  assertEq(outfitMatchesQuery(outfit, itemsById, 'formal heel'), true);
  assertEq(outfitMatchesQuery(outfit, itemsById, 'airport'), false);
});

test('items.put: preserves existing imageBlob when imageBlob is not in input (defensive against WebKit IDB blob corruption on re-write)', async () => {
  await withTestDb();
  const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' });
  const first = await items.put({ name: 'X', category: 'top', owned: true, imageBlob: blob });
  // Update without passing imageBlob — existing blob must be preserved
  const second = await items.put({ id: first.id, name: 'Y', category: 'pant', owned: false });
  assertTrue(second.imageBlob, 'imageBlob preserved');
  const bytes = new Uint8Array(await second.imageBlob.arrayBuffer());
  assertEq(Array.from(bytes), [1, 2, 3, 4, 5]);
  assertEq(second.category, 'pant');
});

test('items.put: re-wraps the existing blob into a fresh in-memory Blob (not the same instance as what was stored)', async () => {
  // This is the actual WebKit workaround. After put-without-imageBlob, the
  // stored blob should be a fresh Blob built from arrayBuffer() — detached
  // from any IDB-internal reference. We verify the bytes survive multiple
  // back-to-back updates, which is the precise scenario that triggers the
  // WebKit corruption when the workaround is absent.
  await withTestDb();
  const original = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
  const blob = new Blob([original], { type: 'image/jpeg' });
  const first = await items.put({ name: 'A', category: 'top', owned: true, imageBlob: blob });
  // Three back-to-back updates without touching the image
  let cur = first;
  for (let i = 0; i < 3; i++) {
    cur = await items.put({ id: cur.id, name: `A${i}`, category: 'top', owned: true });
    assertTrue(cur.imageBlob && cur.imageBlob.size === original.length, `iteration ${i}: blob size preserved`);
    const bytes = new Uint8Array(await cur.imageBlob.arrayBuffer());
    assertEq(Array.from(bytes), Array.from(original));
  }
});

test('items.put: normalizes tags and preserves them on metadata-only updates', async () => {
  await withTestDb();
  const first = await items.put({ name: 'Taggy Tee', category: 'top', tags: ['Beach', '#BEACH', ' Capsule '] });
  assertEq(first.tags, ['beach', 'capsule']);
  const updated = await items.put({ id: first.id, name: 'Renamed Tee', category: 'top', owned: true });
  assertEq(updated.tags, ['beach', 'capsule']);
  const cleared = await items.put({ id: first.id, name: 'Renamed Tee', category: 'top', owned: true, tags: [] });
  assertEq(cleared.tags, []);
});

test('items.put: partial updates preserve to-buy ownership', async () => {
  await withTestDb();
  const first = await items.put({ name: 'Wishlist Sandals', category: 'shoes', owned: false, tags: ['beach'] });
  assertEq(first.owned, 0);
  const updated = await items.put({ id: first.id, name: 'Wishlist Sandals', category: 'shoes', tags: ['beach', 'sale'] });
  assertEq(updated.owned, 0);
});

// ----- Stylist tests -----
test('stylist.intent: extracts formality from prompt', () => {
  assertEq(parseIntent('something formal for dinner').formality, 'formal');
  assertEq(parseIntent('casual weekend look').formality, 'casual');
  assertEq(parseIntent('smart business meeting').formality, 'smart');
  assertEq(parseIntent('gym workout').formality, 'athletic');
  assertEq(parseIntent('beach day').formality, 'beach');
});

test('stylist.intent: extracts weather and count', () => {
  const i = parseIntent('3 outfits for warm summer weather');
  assertEq(i.weather, 'hot');
  assertEq(i.count, 3);
});

test('stylist.intent: "a week of looks" maps to count 5', () => {
  assertEq(parseIntent('give me a week of looks').count, 5);
});

test('stylist.intent: extracts preferred colors', () => {
  const i = parseIntent('something in navy blue and white');
  assertTrue(i.preferredColors.includes('blue'), 'blue preferred');
  assertTrue(i.preferredColors.includes('white'), 'white preferred');
});

test('stylist.intent: detects refinement directives', () => {
  const i = parseIntent('swap the top for something else');
  assertEq(i.refine.swapTop, true);
});

test('stylist.color: rgbToHsv basic conversions', () => {
  const red = rgbToHsv({ r: 255, g: 0, b: 0 });
  assertTrue(red.h < 5 || red.h > 355, 'red hue');
  assertTrue(red.s > 0.9, 'red saturated');
});

test('stylist.color: tone classification', () => {
  assertEq(colorTone({ h: 240, s: 0.8, v: 0.5 }), 'blue');
  assertEq(colorTone({ h: 0, s: 0, v: 0.1 }), 'black');
  assertEq(colorTone({ h: 0, s: 0, v: 0.95 }), 'white');
  assertEq(colorTone({ h: 0, s: 0.05, v: 0.5 }), 'gray');
});

test('stylist.color: harmony rules', () => {
  const blue = { h: 240, s: 0.7, v: 0.5 };
  const blueShade = { h: 245, s: 0.7, v: 0.6 };
  const orange = { h: 30, s: 0.7, v: 0.7 };
  const yellow = { h: 60, s: 0.7, v: 0.8 };
  // Monochromatic close hues — score perfect
  assertTrue(harmonyScore(blue, blueShade) >= 0.95, 'mono harmonious');
  // Complementary (~180° apart): blue 240, orange 30 → 210° diff, wraps to 150° — actually that's not complementary. Let's pick proper pair:
  const yellow180 = { h: 60, s: 0.7, v: 0.7 };
  const purple = { h: 240, s: 0.7, v: 0.7 };
  assertTrue(harmonyScore(yellow180, purple) >= 0.8, 'complementary harmonious');
});

test('stylist.color: classifyHarmony', () => {
  // All neutrals
  assertEq(classifyHarmony([{ h: 0, s: 0.05, v: 0.5 }, { h: 0, s: 0.05, v: 0.2 }]), 'neutral palette');
  // Single accent
  assertEq(classifyHarmony([{ h: 0, s: 0.05, v: 0.5 }, { h: 240, s: 0.7, v: 0.5 }]), 'neutral with a single accent');
  // Two close hues
  assertEq(classifyHarmony([{ h: 220, s: 0.7, v: 0.5 }, { h: 240, s: 0.7, v: 0.5 }]), 'analogous');
});

test('stylist.engine: generates a full outfit from seed items', async () => {
  await withTestDb();
  const seed = [
    { name: 'White tee', category: 'top', owned: true },
    { name: 'Blue jeans', category: 'pant', owned: true },
    { name: 'White sneakers', category: 'shoes', owned: false },
    { name: 'Watch', category: 'accessory', subcategory: 'watch', owned: true }
  ];
  for (const it of seed) await items.put(it);
  const all = await items.all();
  const ctx = await buildItemContext(all);
  const generated = generateOutfits(ctx, parseIntent('casual look'), { seed: 42 });
  assertEq(generated.length, 1);
  const o = generated[0];
  assertTrue(o.topId, 'has top');
  assertTrue(o.shoesId, 'has shoes');
  assertTrue(o._meta, 'metadata attached');
});

test('stylist.engine: uses a dress as a main outfit piece', async () => {
  await withTestDb();
  const dress = await items.put({ name: 'Black Travel Dress', category: 'dress', owned: true });
  const shoes = await items.put({ name: 'Walking Flats', category: 'shoes', owned: true });
  const purse = await items.put({ name: 'Crossbody Purse', category: 'purse', owned: true });
  const ctx = await buildItemContext(await items.all());
  const generated = generateOutfits(ctx, parseIntent('formal dress outfit'), { seed: 7 });
  assertEq(generated.length, 1);
  assertEq(generated[0].topId, null);
  assertEq(generated[0].pantId, null);
  assertEq(generated[0].otherIds, [dress.id]);
  assertEq(generated[0].shoesId, shoes.id);
  assertTrue((generated[0].accessoryIds || []).includes(purse.id), 'purse can be used like an accessory');
});

test('stylist.engine: respects count from intent', async () => {
  await withTestDb();
  // Need enough items to generate multiple outfits without exhausting pool
  for (let i = 0; i < 4; i++) {
    await items.put({ name: `Top ${i}`, category: 'top', owned: true });
    await items.put({ name: `Pant ${i}`, category: 'pant', owned: true });
    await items.put({ name: `Shoe ${i}`, category: 'shoes', owned: true });
  }
  const ctx = await buildItemContext(await items.all());
  const generated = generateOutfits(ctx, parseIntent('3 outfits for the weekend'), { seed: 100 });
  assertEq(generated.length, 3);
  // No item reused across outfits
  const usedTops = new Set(generated.map(g => g.topId));
  assertEq(usedTops.size, 3);
});

test('stylist.engine: returns empty when no tops exist', async () => {
  await withTestDb();
  await items.put({ name: 'Pant', category: 'pant', owned: true });
  await items.put({ name: 'Shoe', category: 'shoes', owned: true });
  const ctx = await buildItemContext(await items.all());
  const generated = generateOutfits(ctx, parseIntent('casual'), { seed: 1 });
  assertEq(generated.length, 0);
});

test('outfits.put: persists aiGenerated, aiPrompt, aiRationale', async () => {
  await withTestDb();
  const o = await outfits.put({
    name: 'AI Look',
    aiGenerated: true,
    aiPrompt: 'formal dinner',
    aiRationale: 'Clean lines, dark palette.'
  });
  assertEq(o.aiGenerated, true);
  assertEq(o.aiPrompt, 'formal dinner');
  assertEq(o.aiRationale, 'Clean lines, dark palette.');
  // Update without specifying ai fields — they should be preserved
  const updated = await outfits.put({ id: o.id, name: 'Renamed' });
  assertEq(updated.aiGenerated, true);
  assertEq(updated.aiPrompt, 'formal dinner');
  assertEq(updated.aiRationale, 'Clean lines, dark palette.');
});

test('image.hasBytes(): guards against empty / missing blobs', async () => {
  const { hasBytes } = await import('../js/image.js');
  assertEq(hasBytes(null), false);
  assertEq(hasBytes(undefined), false);
  assertEq(hasBytes(new Blob([])), false);
  assertEq(hasBytes(new Blob([new Uint8Array([1])])), true);
});

test('blob ↔ base64 roundtrip preserves bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252, 253, 254, 255]);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const { mime, base64 } = await blobToBase64(blob);
  assertEq(mime, 'application/octet-stream');
  const restored = await base64ToBlob({ mime, base64 });
  const buf = new Uint8Array(await restored.arrayBuffer());
  assertEq(Array.from(buf), Array.from(bytes));
});

// ----- IndexedDB integration tests -----
test('IDB: put + get + delete (items)', async () => {
  await withTestDb();
  const it = await items.put({ name: 'Test Shirt', category: 'top', owned: true });
  assertTrue(it.id, 'id assigned');
  const got = await items.get(it.id);
  assertEq(got.name, 'Test Shirt');
  await items.remove(it.id);
  const gone = await items.get(it.id);
  assertEq(gone, undefined);
});

test('IDB: byCategory index returns only matching items', async () => {
  await withTestDb();
  await items.put({ name: 'Shirt', category: 'top' });
  await items.put({ name: 'Jeans', category: 'pant' });
  await items.put({ name: 'Shoes', category: 'shoes' });
  const tops = await items.byCategory('top');
  assertEq(tops.length, 1);
  assertEq(tops[0].name, 'Shirt');
});

test('IDB: outfit reuses item ids', async () => {
  await withTestDb();
  const top = await items.put({ name: 'T', category: 'top' });
  const pant = await items.put({ name: 'P', category: 'pant' });
  const outfit = await outfits.put({ name: 'O1', topId: top.id, pantId: pant.id, accessoryIds: [] });
  const got = await outfits.get(outfit.id);
  assertEq(got.topId, top.id);
  assertEq(got.pantId, pant.id);
});

test('IDB: duplicate outfit creates a new outfit id while reusing item ids', async () => {
  await withTestDb();
  const beforeItems = await items.all();
  const top = await items.put({ name: 'T', category: 'top' });
  const shoes = await items.put({ name: 'S', category: 'shoes' });
  const original = await outfits.put({ name: 'Travel look', topId: top.id, shoesId: shoes.id, accessoryIds: [top.id], notes: 'Keep this' });
  const copy = await outfits.duplicate(original.id);
  assertTrue(copy.id !== original.id, 'copy gets a new id');
  assertEq(copy.name, 'Travel look copy');
  assertEq(copy.topId, top.id);
  assertEq(copy.shoesId, shoes.id);
  assertEq(copy.accessoryIds, [top.id]);
  assertEq(copy.notes, 'Keep this');
  const afterItems = await items.all();
  assertEq(afterItems.length, beforeItems.length + 2);
});

test('IDB: delete item cascades — removed from outfits', async () => {
  await withTestDb();
  const top = await items.put({ name: 'T', category: 'top' });
  const acc = await items.put({ name: 'A', category: 'accessory' });
  const o = await outfits.put({ name: 'O', topId: top.id, accessoryIds: [acc.id] });
  await items.remove(top.id);
  const after = await outfits.get(o.id);
  assertEq(after.topId, null);
  await items.remove(acc.id);
  const after2 = await outfits.get(o.id);
  assertEq(after2.accessoryIds, []);
});

test('IDB: delete trip cascades to dayPlans', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-03' });
  const o = await outfits.put({ name: 'O' });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [o.id]);
  await dayPlans.setOutfits(trip.id, '2026-07-02', [o.id]);
  const before = await dayPlans.byTrip(trip.id);
  assertEq(before.length, 2);
  await trips.remove(trip.id);
  const after = await dayPlans.byTrip(trip.id);
  assertEq(after.length, 0);
});

test('IDB: trip packing state persists on trips and survives trip edits', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-03' });
  await trips.setPacking(trip.id, {
    checkedItemIds: ['item1'],
    customItems: [{ id: 'passport', label: 'Passport', checked: true }]
  });
  const saved = await trips.get(trip.id);
  assertEq(saved.packing.checkedItemIds, ['item1']);
  assertEq(saved.packing.customItems[0].label, 'Passport');

  await trips.put({ id: trip.id, name: 'Renamed trip' });
  const edited = await trips.get(trip.id);
  assertEq(edited.name, 'Renamed trip');
  assertEq(edited.startDate, '2026-07-01');
  assertEq(edited.endDate, '2026-07-03');
  assertEq(edited.packing.checkedItemIds, ['item1']);
  assertEq(edited.packing.customItems[0].checked, true);
});

test('IDB: delete outfit removes it from outfitIds in dayPlans', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-02' });
  const o1 = await outfits.put({ name: 'O1' });
  const o2 = await outfits.put({ name: 'O2' });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [o1.id, o2.id]);
  await outfits.remove(o1.id);
  const plans = await dayPlans.byTrip(trip.id);
  assertEq(plans.length, 1);
  assertEq(plans[0].outfitIds, [o2.id]);
  // Remove last outfit — day auto-deletes since there are no notes
  await outfits.remove(o2.id);
  const plans2 = await dayPlans.byTrip(trip.id);
  assertEq(plans2.length, 0);
});

test('IDB: setOwned toggles + appears in shopping list', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-01' });
  const top = await items.put({ name: 'BuyMe', category: 'top', owned: false });
  const o = await outfits.put({ name: 'O', topId: top.id });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [o.id]);
  const list1 = await tripShoppingList(trip.id);
  assertEq(list1.length, 1);
  assertEq(list1[0].name, 'BuyMe');
  await items.setOwned(top.id, true);
  const list2 = await tripShoppingList(trip.id);
  assertEq(list2.length, 0);
});

test('IDB: outfit otherIds — items flow to outfit + shopping list', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-01' });
  const jacket = await items.put({ name: 'Rain Jacket', category: 'other', subcategory: 'jacket', owned: false });
  const bag = await items.put({ name: 'Tote', category: 'other', subcategory: 'bag', owned: true });
  const o = await outfits.put({ name: 'Rainy day', otherIds: [jacket.id, bag.id] });
  // itemIds includes both
  assertEq(outfits.itemIds(o).sort(), [jacket.id, bag.id].sort());
  await dayPlans.setOutfits(trip.id, '2026-07-01', [o.id]);
  // Only the unowned 'other' item appears in shopping list
  const list = await tripShoppingList(trip.id);
  assertEq(list.length, 1);
  assertEq(list[0].name, 'Rain Jacket');
});

test('IDB: deleting an "other" item cascades — removed from outfit otherIds', async () => {
  await withTestDb();
  const jacket = await items.put({ name: 'J', category: 'other', owned: true });
  const o = await outfits.put({ name: 'O', otherIds: [jacket.id] });
  await items.remove(jacket.id);
  const after = await outfits.get(o.id);
  assertEq(after.otherIds, []);
});

test('IDB: tripStats correctly counts', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-05' });
  const top = await items.put({ name: 'T', category: 'top', owned: false });
  const o = await outfits.put({ name: 'O', topId: top.id });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [o.id]);
  await dayPlans.setOutfits(trip.id, '2026-07-02', [o.id]);
  const s = await tripStats(trip.id);
  assertEq(s.totalDays, 5);
  assertEq(s.plannedDays, 2);
  assertEq(s.toBuy, 1);
});

test('IDB: multiple outfits per day — shopping list dedupes + day counted as planned', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-01' });
  const shared = await items.put({ name: 'Shared Shoes', category: 'shoes', owned: false });
  const morningTop = await items.put({ name: 'Morning Top', category: 'top', owned: false });
  const eveningTop = await items.put({ name: 'Evening Top', category: 'top', owned: true });
  const morning = await outfits.put({ name: 'Morning', topId: morningTop.id, shoesId: shared.id });
  const evening = await outfits.put({ name: 'Evening', topId: eveningTop.id, shoesId: shared.id });
  await dayPlans.addOutfit(trip.id, '2026-07-01', morning.id);
  await dayPlans.addOutfit(trip.id, '2026-07-01', evening.id);
  const plan = await dayPlans.get(trip.id, '2026-07-01');
  assertEq(plan.outfitIds, [morning.id, evening.id]);
  const list = await tripShoppingList(trip.id);
  assertEq(list.length, 2);
  assertTrue(list.some(i => i.name === 'Shared Shoes'), 'shared shoes in list');
  assertTrue(list.some(i => i.name === 'Morning Top'), 'morning top in list');
  const s = await tripStats(trip.id);
  assertEq(s.plannedDays, 1);
});

test('IDB: addOutfit is idempotent + removeOutfit auto-deletes empty day', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-01' });
  const o = await outfits.put({ name: 'O' });
  await dayPlans.addOutfit(trip.id, '2026-07-01', o.id);
  await dayPlans.addOutfit(trip.id, '2026-07-01', o.id); // duplicate
  const plan1 = await dayPlans.get(trip.id, '2026-07-01');
  assertEq(plan1.outfitIds, [o.id]);
  await dayPlans.removeOutfit(trip.id, '2026-07-01', o.id);
  const plan2 = await dayPlans.get(trip.id, '2026-07-01');
  assertEq(plan2, undefined);
});

test('IDB: setOutfits dedupes target-day outfit ids', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-01' });
  const o1 = await outfits.put({ name: 'O1' });
  const o2 = await outfits.put({ name: 'O2' });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [o1.id, o2.id, o1.id, o2.id]);
  const plan = await dayPlans.get(trip.id, '2026-07-01');
  assertEq(plan.outfitIds, [o1.id, o2.id]);
});

test('importer: legacy outfitId → outfitIds[] migration', async () => {
  await withTestDb();
  const legacyData = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items: [], outfits: [],
    trips: [{ id: 'trip1', name: 'T', startDate: '2026-07-01', endDate: '2026-07-01', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    dayPlans: [{ id: 'trip1_2026-07-01', tripId: 'trip1', date: '2026-07-01', outfitId: 'old-outfit-id', notes: '' }]
  };
  await importFromObject(legacyData, { mode: 'replace' });
  const plans = await dayPlans.byTrip('trip1');
  assertEq(plans.length, 1);
  assertEq(plans[0].outfitIds, ['old-outfit-id']);
});

test('importer: canonicalizes day plan ids and dedupes outfit ids', async () => {
  await withTestDb();
  await importFromObject({
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items: [],
    outfits: [
      { id: 'outfit-1', name: 'One' },
      { id: 'outfit-2', name: 'Two' }
    ],
    trips: [{ id: 'trip1', name: 'T', startDate: '2026-07-01', endDate: '2026-07-01' }],
    dayPlans: [{
      id: 'stale-plan-id',
      tripId: 'trip1',
      date: '2026-07-01',
      outfitIds: ['outfit-1', 'outfit-2', 'outfit-1', '', null],
      notes: 'Keep this'
    }]
  }, { mode: 'replace' });

  const plan = await dayPlans.get('trip1', '2026-07-01');
  assertEq(plan.id, 'trip1_2026-07-01');
  assertEq(plan.outfitIds, ['outfit-1', 'outfit-2']);
  assertEq(plan.notes, 'Keep this');

  const exported = await buildExport();
  assertEq(exported.dayPlans[0].id, 'trip1_2026-07-01');
  assertEq(exported.dayPlans[0].outfitIds, ['outfit-1', 'outfit-2']);
  assertEq('outfitId' in exported.dayPlans[0], false);
});

test('trips: rejects reversed date range', async () => {
  await withTestDb();
  await assertThrows(() => trips.put({ name: 'X', startDate: '2026-07-10', endDate: '2026-07-01' }), 'End date');
});

test('export/import: full roundtrip preserves items, outfits, trips, dayPlans', async () => {
  await withTestDb();
  // Seed
  const top = await items.put({ name: 'Shirt', category: 'top', owned: true, tags: ['Beach', 'Capsule'] });
  const pant = await items.put({ name: 'Pants', category: 'pant', owned: false });
  const acc = await items.put({ name: 'Watch', category: 'accessory', subcategory: 'watch', owned: true });
  const o = await outfits.put({ name: 'Outfit A', topId: top.id, pantId: pant.id, accessoryIds: [acc.id] });
  const trip = await trips.put({ name: 'Test trip', startDate: '2026-07-01', endDate: '2026-07-02' });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [o.id]);

  const exported = await buildExport();
  assertEq(exported.schemaVersion, SCHEMA_VERSION);
  assertEq(exported.items.length, 3);
  assertEq(exported.outfits.length, 1);
  assertEq(exported.trips.length, 1);
  assertEq(exported.dayPlans.length, 1);
  assertEq(exported.items.find(i => i.id === top.id).tags, ['beach', 'capsule']);

  // Serialize through JSON to simulate file roundtrip
  const json = JSON.stringify(exported);
  const parsed = JSON.parse(json);

  // Wipe and reimport
  await withTestDb();
  const counts = await importFromObject(parsed, { mode: 'replace' });
  assertEq(counts.items, 3);
  assertEq(counts.outfits, 1);

  const allItems = await items.all();
  assertEq(allItems.length, 3);
  assertEq(allItems.find(i => i.id === top.id).tags, ['beach', 'capsule']);
  const got = await outfits.get(o.id);
  assertEq(got.name, 'Outfit A');
  const plans = await dayPlans.byTrip(trip.id);
  assertEq(plans.length, 1);
  assertEq(plans[0].outfitIds, [o.id]);
});

test('export/import: preserves trip packing checklist state', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'Packing trip', startDate: '2026-07-01', endDate: '2026-07-02' });
  await trips.setPacking(trip.id, {
    checkedItemIds: ['owned-item'],
    customItems: [{ id: 'passport', label: 'Passport', checked: true }]
  });
  const exported = await buildExport();
  assertEq(exported.trips[0].packing.checkedItemIds, ['owned-item']);
  assertEq(exported.trips[0].packing.customItems[0].label, 'Passport');

  await withTestDb();
  await importFromObject(JSON.parse(JSON.stringify(exported)), { mode: 'replace' });
  const restored = await trips.get(trip.id);
  assertEq(restored.packing.checkedItemIds, ['owned-item']);
  assertEq(restored.packing.customItems[0].checked, true);
});

test('export/import: older exports without trip.packing import with an empty checklist', async () => {
  await withTestDb();
  await importFromObject({
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items: [{ id: 'old-item', name: 'Old shirt', category: 'top', owned: true }],
    outfits: [],
    trips: [{ id: 'old-trip', name: 'Old', startDate: '2026-07-01', endDate: '2026-07-01' }],
    dayPlans: []
  }, { mode: 'replace' });
  const restoredItem = await items.get('old-item');
  assertEq(restoredItem.tags, []);
  const restored = await trips.get('old-trip');
  assertEq(restored.packing, { checkedItemIds: [], customItems: [] });
});

test('export/import: merge of older export preserves existing tags, image blobs, and packing', async () => {
  await withTestDb();
  const bytes = new Uint8Array([9, 8, 7, 6]);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const item = await items.put({
    id: 'merge-item',
    name: 'Existing shirt',
    category: 'top',
    owned: false,
    tags: ['Beach'],
    imageBlob: blob
  });
  const trip = await trips.put({ id: 'merge-trip', name: 'Existing trip', startDate: '2026-08-01', endDate: '2026-08-02' });
  await trips.setPacking(trip.id, {
    checkedItemIds: [item.id],
    customItems: [{ id: 'passport', label: 'Passport', checked: true }]
  });

  await importFromObject({
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items: [{ id: item.id, name: 'Imported shirt', category: 'top', owned: true }],
    outfits: [],
    trips: [{ id: trip.id, name: 'Imported trip', startDate: '2026-08-01', endDate: '2026-08-02' }],
    dayPlans: []
  }, { mode: 'merge' });

  const mergedItem = await items.get(item.id);
  assertEq(mergedItem.name, 'Imported shirt');
  assertEq(mergedItem.owned, 1);
  assertEq(mergedItem.tags, ['beach']);
  assertTrue(mergedItem.imageBlob && mergedItem.imageBlob.size === bytes.length, 'existing image blob preserved');
  assertEq(Array.from(new Uint8Array(await mergedItem.imageBlob.arrayBuffer())), Array.from(bytes));

  const mergedTrip = await trips.get(trip.id);
  assertEq(mergedTrip.name, 'Imported trip');
  assertEq(mergedTrip.packing.checkedItemIds, [item.id]);
  assertEq(mergedTrip.packing.customItems[0].label, 'Passport');
  assertEq(mergedTrip.packing.customItems[0].checked, true);
});

test('export/import: rejects wrong schemaVersion', async () => {
  await withTestDb();
  await assertThrows(() => importFromObject({ schemaVersion: 999, items: [] }), 'Unsupported schema');
});

test('export/import: bytes preserved for image blob', async () => {
  await withTestDb();
  const bytes = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  await items.put({ name: 'I', category: 'top', owned: true, imageBlob: blob });

  const exported = await buildExport();
  await withTestDb();
  await importFromObject(JSON.parse(JSON.stringify(exported)), { mode: 'replace' });
  const all = await items.all();
  assertEq(all.length, 1);
  const restored = all[0].imageBlob;
  assertTrue(restored, 'image blob restored');
  const restoredBytes = new Uint8Array(await restored.arrayBuffer());
  assertEq(Array.from(restoredBytes), Array.from(bytes));
});

// ----- Retailer grouping tests -----
test('retailerFromUrl: amazon full URL → Amazon', () => {
  assertEq(retailerFromUrl('https://www.amazon.com/dp/B000123'), { key: 'amazon.com', label: 'Amazon' });
});
test('retailerFromUrl: walmart product URL (real example) → Walmart', () => {
  const r = retailerFromUrl('https://www.walmart.com/ip/Casio-Men-s-Watch-MTPV001GL-9B/771523612?classType=REGULAR&from=/search');
  assertEq(r, { key: 'walmart.com', label: 'Walmart' });
});
test('retailerFromUrl: amzn.to shortener folds into Amazon (real example)', () => {
  assertEq(retailerFromUrl('https://amzn.to/4uuQbfw'), { key: 'amazon.com', label: 'Amazon' });
});
test('retailerFromUrl: a.co short link folds into Amazon', () => {
  assertEq(retailerFromUrl('https://a.co/d/abc123'), { key: 'amazon.com', label: 'Amazon' });
});
test('retailerFromUrl: empty / missing → shared No store link bucket', () => {
  assertEq(retailerFromUrl(''), { key: '', label: 'No store link' });
  assertEq(retailerFromUrl(null), { key: '', label: 'No store link' });
  assertEq(retailerFromUrl('   '), { key: '', label: 'No store link' });
});
test('retailerFromUrl: scheme-less URL is tolerated', () => {
  assertEq(retailerFromUrl('walmart.com/ip/123'), { key: 'walmart.com', label: 'Walmart' });
});
test('retailerFromUrl: unknown domain is Title-cased', () => {
  assertEq(retailerFromUrl('https://shop.cool-threads.io/x'), { key: 'cool-threads.io', label: 'Cool Threads' });
});
test('retailerFromUrl: two-level TLD keeps registrable domain (amazon.co.uk)', () => {
  assertEq(retailerFromUrl('https://www.amazon.co.uk/dp/x'), { key: 'amazon.co.uk', label: 'Amazon' });
});
test('retailerFromUrl: garbage string → No store link (no throw)', () => {
  assertEq(retailerFromUrl('not a url at all'), { key: '', label: 'No store link' });
});

test('groupShoppingByRetailer: groups by store, ungrouped last, sorted', () => {
  const list = [
    { name: 'Watch', purchaseUrl: 'https://www.walmart.com/ip/1' },
    { name: 'Belt', purchaseUrl: 'https://amzn.to/abc' },
    { name: 'Socks', purchaseUrl: '' },
    { name: 'Adapter', purchaseUrl: 'https://www.amazon.com/dp/2' },
    { name: 'Hat', purchaseUrl: 'https://www.walmart.com/ip/3' }
  ];
  const groups = groupShoppingByRetailer(list);
  assertEq(groups.map(g => g.label), ['Amazon', 'Walmart', 'No store link']);
  // Amazon merges amzn.to + amazon.com; items sorted by name (Adapter, Belt)
  const amazon = groups.find(g => g.label === 'Amazon');
  assertEq(amazon.key, 'amazon.com');
  assertEq(amazon.items.map(i => i.name), ['Adapter', 'Belt']);
  const walmart = groups.find(g => g.label === 'Walmart');
  assertEq(walmart.items.map(i => i.name), ['Hat', 'Watch']);
  const none = groups.find(g => g.key === '');
  assertEq(none.items.map(i => i.name), ['Socks']);
});
test('groupShoppingByRetailer: empty input → no groups', () => {
  assertEq(groupShoppingByRetailer([]), []);
  assertEq(groupShoppingByRetailer(null), []);
});
test('groupShoppingByRetailer: all unlinked → single No store link group', () => {
  const groups = groupShoppingByRetailer([{ name: 'A', purchaseUrl: '' }, { name: 'B' }]);
  assertEq(groups.length, 1);
  assertEq(groups[0].key, '');
  assertEq(groups[0].items.length, 2);
});
test('groupShoppingByRetailer: integration — derives groups from a real trip shopping list', async () => {
  await withTestDb();
  const watch = await items.put({ name: 'Watch', category: 'accessory', owned: false, purchaseUrl: 'https://www.walmart.com/ip/1' });
  const belt = await items.put({ name: 'Belt', category: 'accessory', owned: false, purchaseUrl: 'https://amzn.to/xyz' });
  const top = await items.put({ name: 'Shirt', category: 'top', owned: true });
  const outfit = await outfits.put({ name: 'O', topId: top.id, accessoryIds: [watch.id, belt.id] });
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-02' });
  await dayPlans.addOutfit(trip.id, '2026-07-01', outfit.id);
  const shopping = await tripShoppingList(trip.id);
  const groups = groupShoppingByRetailer(shopping);
  // owned top excluded; watch (Walmart) + belt (Amazon) grouped
  assertEq(groups.map(g => g.label), ['Amazon', 'Walmart']);
});

// ----- Share API tests -----
// Create a tiny real PNG via canvas so the renderer's image-bitmap path is exercised
async function makeTinyImageBlob(color = 'red', size = 16) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  return await new Promise(res => c.toBlob(b => res(b), 'image/png'));
}

function setNavShare(canShareFn, shareFn) {
  try {
    navigator.canShare = canShareFn;
    navigator.share = shareFn;
    if (navigator.canShare === canShareFn && navigator.share === shareFn) return () => {};
  } catch {}
  const prevDescCan = Object.getOwnPropertyDescriptor(Navigator.prototype, 'canShare') || Object.getOwnPropertyDescriptor(navigator, 'canShare');
  const prevDescShare = Object.getOwnPropertyDescriptor(Navigator.prototype, 'share') || Object.getOwnPropertyDescriptor(navigator, 'share');
  Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: canShareFn });
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: shareFn });
  return () => {
    if (prevDescCan) Object.defineProperty(navigator, 'canShare', prevDescCan);
    else { try { delete navigator.canShare; } catch {} }
    if (prevDescShare) Object.defineProperty(navigator, 'share', prevDescShare);
    else { try { delete navigator.share; } catch {} }
  };
}

test('share.renderOutfitsCanvas: single outfit produces a 1080px-wide non-blank canvas', async () => {
  const blob = await makeTinyImageBlob('red', 32);
  const top = { id: 't1', name: 'Linen Top', category: 'top', owned: 1, imageBlob: blob };
  const pant = { id: 'p1', name: 'Black Pant', category: 'pant', owned: 0, imageBlob: blob };
  const outfit = { id: 'o1', name: 'Test Outfit', topId: 't1', pantId: 'p1', shoesId: null, accessoryIds: [], otherIds: [] };
  const itemsById = new Map([[top.id, top], [pant.id, pant]]);
  const canvas = await renderOutfitsCanvas([outfit], itemsById);
  assertEq(canvas.width, 1080);
  assertTrue(canvas.height > 400, 'canvas tall enough for title + 2 items');
  // Sample a top-left background pixel — should match the section bg color #f7f8fb
  const px = canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
  assertEq(Array.from(px).slice(0, 3), [247, 248, 251]);
  assertEq(px[3], 255); // opaque, never transparent
});

test('share.renderOutfitsCanvas: multiple outfits stack vertically', async () => {
  const blob = await makeTinyImageBlob('blue', 32);
  const top = { id: 't1', name: 'Top', category: 'top', owned: 1, imageBlob: blob };
  const itemsById = new Map([[top.id, top]]);
  const one = { id: 'o1', name: 'A', topId: 't1', pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
  const two = { id: 'o2', name: 'B', topId: 't1', pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
  const c1 = await renderOutfitsCanvas([one], itemsById);
  const c2 = await renderOutfitsCanvas([one, two], itemsById);
  assertEq(c2.width, 1080);
  assertTrue(c2.height > c1.height * 1.5, `two outfits should roughly double the height (was ${c1.height} → ${c2.height})`);
});

test('share.renderOutfitsCanvas: outfit with no items still renders without throwing', async () => {
  const outfit = { id: 'o1', name: 'Empty', topId: null, pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
  const canvas = await renderOutfitsCanvas([outfit], new Map());
  assertEq(canvas.width, 1080);
  assertTrue(canvas.height > 100, 'still has title + footer');
});

test('share.renderOutfitsCanvas: orphan item ids (item missing from map) are skipped silently', async () => {
  const outfit = { id: 'o1', name: 'Stale', topId: 'missing', pantId: null, shoesId: null, accessoryIds: ['also-missing'], otherIds: [] };
  const canvas = await renderOutfitsCanvas([outfit], new Map());
  assertEq(canvas.width, 1080);
  assertTrue(canvas.height > 0);
});

test('share.renderOutfitsCanvas: item with no imageBlob renders category-icon placeholder (no throw)', async () => {
  const top = { id: 't1', name: 'Top w/o photo', category: 'top', owned: 1, imageBlob: null };
  const outfit = { id: 'o1', name: 'P', topId: 't1', pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
  const canvas = await renderOutfitsCanvas([outfit], new Map([[top.id, top]]));
  assertTrue(canvas.height > 300);
});

test('outfit-stack: trip preview shows only actual items without ownership badges', () => {
  const dress = { id: 'd1', name: 'Travel Dress', category: 'dress', owned: 0, imageBlob: null };
  const outfit = { id: 'o1', name: 'Dress only', topId: null, pantId: null, shoesId: null, accessoryIds: [], otherIds: [dress.id] };
  const node = renderStack({
    outfit,
    itemsById: new Map([[dress.id, dress]]),
    size: 'trip',
    showOwnership: false,
    showEmptySlots: false
  });
  assertTrue(node.classList.contains('is-single-item'), 'single dress preview can grow larger');
  assertTrue((node.textContent || '').includes('👗'), 'dress icon is visible');
  assertTrue(!(node.textContent || '').includes('👟'), 'empty shoe placeholder is omitted');
  assertEq(node.querySelector('.ownership-badge'), null);
});

test('share.renderOutfitsCanvas: never upscales — preserves source resolution for "minimal quality loss"', async () => {
  // 64×64 source. Canvas should be 1080 wide but image draw should stay 64×64.
  // We can't easily inspect draw calls; we infer by checking total height is small (no inflated image area).
  const small = await makeTinyImageBlob('green', 64);
  const top = { id: 't1', name: 'Tiny', category: 'top', owned: 1, imageBlob: small };
  const outfit = { id: 'o1', name: 'Single tiny item', topId: 't1', pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
  const small1 = await renderOutfitsCanvas([outfit], new Map([[top.id, top]]));
  // Same outfit with no image should be only marginally shorter — confirming we didn't pad it to ITEM_MAX_IMG_H
  const top2 = { id: 't1', name: 'Tiny', category: 'top', owned: 1, imageBlob: null };
  const small2 = await renderOutfitsCanvas([outfit], new Map([[top.id, top2]]));
  // Item card with 64px tall image should be much shorter than 760px max — ceiling height delta is bounded
  assertTrue(small1.height < 800, `expected compact canvas, got ${small1.height}`);
  // sanity: heights are in the same order of magnitude
  assertTrue(Math.abs(small1.height - small2.height) < 600, 'placeholder vs tiny image height delta is bounded');
});

test('share.canvasToBlob: produces a PNG with correct signature bytes', async () => {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const blob = await canvasToBlob(c);
  assertEq(blob.type, 'image/png');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assertEq(Array.from(bytes.slice(0, 8)), [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
});

test('share.shareOutfits: falls back to a PNG download when Web Share API is unavailable', async () => {
  const restore = setNavShare(undefined, undefined);
  let clickedHref = null;
  let clickedDownload = null;
  const origCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    const n = origCreate(tag);
    if (tag === 'a') {
      n.click = function () { clickedHref = n.href; clickedDownload = n.download; };
    }
    return n;
  };
  try {
    const top = { id: 't1', name: 'A', category: 'top', owned: 1, imageBlob: null };
    const outfit = { id: 'o1', name: 'My Fit', topId: 't1', pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
    const result = await shareOutfits([outfit], new Map([[top.id, top]]));
    assertEq(result.method, 'download');
    assertTrue(/^outfit-my-fit-\d{4}-\d{2}-\d{2}\.png$/.test(clickedDownload), `filename pattern, got: ${clickedDownload}`);
    assertTrue(typeof clickedHref === 'string' && clickedHref.startsWith('blob:'), `href was blob URL, got: ${clickedHref}`);
  } finally {
    document.createElement = origCreate;
    restore();
  }
});

test('share.shareOutfits: invokes navigator.share with a PNG File when supported', async () => {
  let payload = null;
  const restore = setNavShare(
    ({ files }) => Array.isArray(files) && files.length > 0,
    async (data) => { payload = data; }
  );
  try {
    const top = { id: 't1', name: 'A', category: 'top', owned: 1, imageBlob: null };
    const outfit = { id: 'o1', name: 'Share Me', topId: 't1', pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
    const result = await shareOutfits([outfit], new Map([[top.id, top]]));
    assertEq(result.method, 'share');
    assertTrue(payload && Array.isArray(payload.files) && payload.files.length === 1, 'share() called with 1 file');
    assertEq(payload.files[0].type, 'image/png');
    assertEq(payload.title, 'Share Me');
    assertTrue(payload.files[0].size > 0, 'shared file has bytes');
  } finally {
    restore();
  }
});

test('share.shareOutfits: AbortError from user cancellation reports "cancelled" without downloading', async () => {
  let downloadAttempted = false;
  const origCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    const n = origCreate(tag);
    if (tag === 'a') {
      const origClick = n.click.bind(n);
      n.click = function () { downloadAttempted = true; origClick(); };
    }
    return n;
  };
  const restore = setNavShare(
    () => true,
    async () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
  );
  try {
    const top = { id: 't1', name: 'A', category: 'top', owned: 1, imageBlob: null };
    const outfit = { id: 'o1', name: 'X', topId: 't1', pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
    const result = await shareOutfits([outfit], new Map([[top.id, top]]));
    assertEq(result.method, 'cancelled');
    assertEq(downloadAttempted, false);
  } finally {
    document.createElement = origCreate;
    restore();
  }
});

test('share.shareOutfits: filename for multi-outfit share uses count, not a single name', async () => {
  const restore = setNavShare(undefined, undefined);
  let filename = null;
  const origCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    const n = origCreate(tag);
    if (tag === 'a') n.click = function () { filename = n.download; };
    return n;
  };
  try {
    const top = { id: 't1', name: 'A', category: 'top', owned: 1, imageBlob: null };
    const o1 = { id: 'o1', name: 'One', topId: 't1', pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
    const o2 = { id: 'o2', name: 'Two', topId: 't1', pantId: null, shoesId: null, accessoryIds: [], otherIds: [] };
    await shareOutfits([o1, o2], new Map([[top.id, top]]));
    assertTrue(/^outfits-2-\d{4}-\d{2}-\d{2}\.png$/.test(filename), `multi-outfit filename, got: ${filename}`);
  } finally {
    document.createElement = origCreate;
    restore();
  }
});

test('share.shareOutfits: rejects empty outfits array', async () => {
  await assertThrows(() => shareOutfits([], new Map()), 'No outfits');
});

// ----- Storage protection helpers -----
test('storage.isStandalone returns a boolean', () => {
  assertEq(typeof isStandalone(), 'boolean');
});
test('storage.isPersisted resolves to a boolean', async () => {
  assertEq(typeof (await isPersisted()), 'boolean');
});
test('storage.isStorageProtected resolves to a boolean', async () => {
  assertEq(typeof (await isStorageProtected()), 'boolean');
});
test('storage.isIOS returns a boolean', () => {
  assertEq(typeof isIOS(), 'boolean');
});

// ----- Backup pure logic -----
test('backup.BACKUP_FILENAME is stable (no date — single file gets overwritten, not piled up)', () => {
  assertEq(BACKUP_FILENAME, 'outfit-planner-backup.json');
  assertTrue(!/\d{4}-\d{2}-\d{2}/.test(BACKUP_FILENAME), 'filename must not contain a date');
});
test('backup.shouldRemindBackup: no data → never remind', () => {
  assertEq(shouldRemindBackup({ lastBackupAt: null, now: Date.now(), hasData: false }), false);
});
test('backup.shouldRemindBackup: has data but never backed up → remind', () => {
  assertEq(shouldRemindBackup({ lastBackupAt: null, now: Date.now(), hasData: true }), true);
});
test('backup.shouldRemindBackup: backed up well within the interval → do not remind', () => {
  const now = Date.now();
  const recent = new Date(now - (BACKUP_INTERVAL_MS - 3600 * 1000)).toISOString(); // an hour shy of due
  assertEq(shouldRemindBackup({ lastBackupAt: recent, now, hasData: true }), false);
});
test('backup.shouldRemindBackup: backed up just past the interval → remind', () => {
  const now = Date.now();
  const old = new Date(now - BACKUP_INTERVAL_MS - 1000).toISOString();
  assertEq(shouldRemindBackup({ lastBackupAt: old, now, hasData: true }), true);
});
test('backup.shouldRemindBackup: unparseable timestamp → remind (fail-safe)', () => {
  assertEq(shouldRemindBackup({ lastBackupAt: 'not-a-date', now: Date.now(), hasData: true }), true);
});
test('backup.BACKUP_INTERVAL_MS is 6 days', () => {
  assertEq(BACKUP_INTERVAL_MS, 6 * 24 * 60 * 60 * 1000);
});
test('backup.isEmptyCounts: empty / null → true; any count → false', () => {
  assertEq(isEmptyCounts(null), true);
  assertEq(isEmptyCounts({ items: 0, outfits: 0, trips: 0, dayPlans: 0 }), true);
  assertEq(isEmptyCounts({ items: 0, outfits: 0, trips: 0, dayPlans: 2 }), false);
  assertEq(isEmptyCounts({ items: 3 }), false);
});
test('backup.supports* return booleans', () => {
  assertEq(typeof supportsFileSystemAccess(), 'boolean');
  assertEq(typeof supportsShareFile(), 'boolean');
});
test('backup.last-backup timestamp round-trips through localStorage', () => {
  const prev = getLastBackupAt();
  try {
    const iso = '2026-05-01T00:00:00.000Z';
    setLastBackupAt(iso);
    assertEq(getLastBackupAt(), iso);
  } finally {
    if (prev == null) localStorage.removeItem(LAST_BACKUP_KEY); else setLastBackupAt(prev);
  }
});

// ----- Backup integration (test DB) -----
test('backup.getCounts + isDatabaseEmpty: empty DB reports empty', async () => {
  await withTestDb();
  assertEq(await isDatabaseEmpty(), true);
  assertEq(await getCounts(), { items: 0, outfits: 0, trips: 0, dayPlans: 0 });
});
test('backup.isDatabaseEmpty: false once an item exists', async () => {
  await withTestDb();
  await items.put({ name: 'X', category: 'top', owned: true });
  assertEq(await isDatabaseEmpty(), false);
  assertEq((await getCounts()).items, 1);
});
test('backup.restoreFromFile: imports a backup File and restores data into an empty DB', async () => {
  await withTestDb();
  await items.put({ name: 'Keep me', category: 'top', owned: true });
  const json = JSON.stringify(await buildExport());
  await withTestDb(); // wipe to simulate an evicted / blank app
  assertEq(await isDatabaseEmpty(), true);
  const file = new File([json], BACKUP_FILENAME, { type: 'application/json' });
  const res = await restoreFromFile(file, { mode: 'replace' });
  assertTrue(res.ok, 'restore reports ok');
  const all = await items.all();
  assertEq(all.length, 1);
  assertEq(all[0].name, 'Keep me');
});

// ----- Activation + alpha feedback -----
test('activation.normalizeRoute + sanitizeActivationData: strips IDs and unsafe fields', () => {
  assertEq(normalizeRoute('#/trip/abc-123/packing?x=1'), '/trip/:id/packing');
  assertEq(normalizeRoute('#/item/new'), '/item/new');
  const safe = sanitizeActivationData({
    route: '#/outfit/private-id/edit',
    source: 'activation_hero',
    category: 'top',
    purchaseUrl: 'https://example.com/private',
    itemName: 'Blue shirt',
    notes: 'Private note',
    imageBlob: 'blob',
    counts: { items: 2, outfits: 1, trips: 0, dayPlans: 0 }
  });
  assertEq(safe, {
    route: '/outfit/:id/edit',
    source: 'activation_hero',
    category: 'top',
    items: 2,
    outfits: 1,
    trips: 0,
    dayPlans: 0
  });
});

test('activation.trackActivation: stores only sanitized payload locally and for Umami', () => {
  const prevLog = localStorage.getItem(ACTIVATION_LOG_KEY);
  const prevUmami = window.umami;
  const calls = [];
  try {
    clearActivationEvents();
    window.umami = { track: (name, data) => calls.push({ name, data }) };
    const event = trackActivation('Trip Created!', {
      source: 'test',
      tripName: 'Secret Paris',
      purchaseUrl: 'https://example.com/private',
      route: '#/trip/secret'
    });
    assertEq(event.name, 'trip_created');
    assertEq(getActivationEvents().length, 1);
    assertEq(getActivationEvents()[0].data, { source: 'test', route: '/trip/:id' });
    assertEq(calls[0], { name: 'trip_created', data: { source: 'test', route: '/trip/:id' } });
  } finally {
    if (prevLog == null) localStorage.removeItem(ACTIVATION_LOG_KEY); else localStorage.setItem(ACTIVATION_LOG_KEY, prevLog);
    window.umami = prevUmami;
  }
});

test('feedback.shouldPromptFeedback: respects session, response, dismissal and cooldown', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z');
  assertEq(shouldPromptFeedback({ flow: 'trip_created', now }), true);
  assertEq(shouldPromptFeedback({ flow: 'trip_created', now, sessionPrompted: true }), false);
  assertEq(shouldPromptFeedback({
    flow: 'trip_created',
    now,
    state: { flows: { trip_created: { respondedAt: '2026-06-01T11:00:00.000Z' } } }
  }), false);
  assertEq(shouldPromptFeedback({
    flow: 'trip_created',
    now,
    state: { lastPromptAt: '2026-06-01T11:45:00.000Z', flows: {} }
  }), false);
  assertEq(shouldPromptFeedback({
    flow: 'trip_created',
    now,
    state: { flows: { trip_created: { dismissedAt: '2026-05-31T12:00:00.000Z' } } }
  }), false);
});

test('feedback.recordFeedback + packet: keeps comments in feedback, not activation metadata', () => {
  const prevFeedback = localStorage.getItem(FEEDBACK_LOG_KEY);
  const prevState = localStorage.getItem(FEEDBACK_STATE_KEY);
  const prevActivation = localStorage.getItem(ACTIVATION_LOG_KEY);
  try {
    clearFeedbackEntries();
    clearActivationEvents();
    recordFeedback('trip_created', 'negative', 'The date picker was confusing.');
    const packet = buildFeedbackPacket();
    assertEq(packet.feedback.length, 1);
    assertEq(packet.feedback[0].comment, 'The date picker was confusing.');
    assertEq(packet.activationEvents.length, 1);
    assertEq(packet.activationEvents[0].data, {
      flow: 'trip_created',
      rating: 'negative',
      hasComment: true
    });
    assertTrue(!JSON.stringify(packet.activationEvents).includes('date picker'), 'activation events omit free text');
  } finally {
    if (prevFeedback == null) localStorage.removeItem(FEEDBACK_LOG_KEY); else localStorage.setItem(FEEDBACK_LOG_KEY, prevFeedback);
    if (prevState == null) localStorage.removeItem(FEEDBACK_STATE_KEY); else localStorage.setItem(FEEDBACK_STATE_KEY, prevState);
    if (prevActivation == null) localStorage.removeItem(ACTIVATION_LOG_KEY); else localStorage.setItem(ACTIVATION_LOG_KEY, prevActivation);
  }
});

test('UI: feedback prompt can be queued, shown and answered once', () => {
  ensureUiRoots();
  const prevFeedback = localStorage.getItem(FEEDBACK_LOG_KEY);
  const prevState = localStorage.getItem(FEEDBACK_STATE_KEY);
  const prevPending = sessionStorage.getItem(FEEDBACK_PENDING_KEY);
  const prevSession = sessionStorage.getItem(FEEDBACK_SESSION_KEY);
  try {
    document.getElementById('feedback-root')?.remove();
    clearFeedbackEntries();
    sessionStorage.removeItem(FEEDBACK_PENDING_KEY);
    sessionStorage.removeItem(FEEDBACK_SESSION_KEY);
    assertEq(queueFeedbackPrompt('trip_created'), true);
    const prompt = showQueuedFeedbackPrompt();
    assertTrue(prompt, 'prompt rendered');
    assertTrue(/Was creating that trip easy/.test(prompt.textContent), 'flow-specific copy');
    prompt.querySelector('button').click();
    assertEq(getFeedbackEntries().length, 1);
    assertEq(getFeedbackEntries()[0].rating, 'positive');
  } finally {
    document.getElementById('feedback-root')?.remove();
    if (prevFeedback == null) localStorage.removeItem(FEEDBACK_LOG_KEY); else localStorage.setItem(FEEDBACK_LOG_KEY, prevFeedback);
    if (prevState == null) localStorage.removeItem(FEEDBACK_STATE_KEY); else localStorage.setItem(FEEDBACK_STATE_KEY, prevState);
    if (prevPending == null) sessionStorage.removeItem(FEEDBACK_PENDING_KEY); else sessionStorage.setItem(FEEDBACK_PENDING_KEY, prevPending);
    if (prevSession == null) sessionStorage.removeItem(FEEDBACK_SESSION_KEY); else sessionStorage.setItem(FEEDBACK_SESSION_KEY, prevSession);
  }
});

test('demo.seedDemoTrip: creates a reusable sample trip without duplicating on repeat', async () => {
  await withTestDb();
  const prevDemo = localStorage.getItem(DEMO_TRIP_KEY);
  try {
    localStorage.removeItem(DEMO_TRIP_KEY);
    assertEq(buildDemoDates(new Date('2026-06-01T00:00:00.000Z')), {
      startDate: '2026-06-22',
      endDate: '2026-06-24'
    });
    const first = await seedDemoTrip({ baseDate: new Date('2026-06-01T00:00:00.000Z') });
    assertEq(first.created, true);
    assertEq((await items.all()).length, 6);
    assertEq((await outfits.all()).length, 2);
    assertEq((await trips.all()).length, 1);
    assertEq((await dayPlans.byTrip(first.trip.id)).length, 3);
    assertEq((await tripShoppingList(first.trip.id)).length, 1);

    const second = await seedDemoTrip({ baseDate: new Date('2026-06-01T00:00:00.000Z') });
    assertEq(second.created, false);
    assertEq(second.trip.id, first.trip.id);
    assertEq((await items.all()).length, 6);
    assertEq((await trips.all()).length, 1);
  } finally {
    if (prevDemo == null) localStorage.removeItem(DEMO_TRIP_KEY); else localStorage.setItem(DEMO_TRIP_KEY, prevDemo);
  }
});

// ----- First-run setup -----
test('setup.buildSetupStatus: derives checklist from facts, not dismissal storage', () => {
  const prev = localStorage.getItem(SETUP_DISMISSED_KEY);
  try {
    resetSetupDismissal();
    const status = buildSetupStatus({
      facts: { itemCount: 1, outfitCount: 1, tripCount: 1, dayPlanCount: 1, assignedDayCount: 0, firstTripId: 'trip1' },
      storageProtected: true
    });
    assertEq(status.completeCount, 4);
    assertEq(status.done, false);
    assertEq(status.steps.map(s => [s.id, s.complete]), [
      ['protect', true],
      ['items', true],
      ['outfits', true],
      ['trip', true],
      ['plan', false]
    ]);
    dismissSetup();
    const afterDismiss = buildSetupStatus({
      facts: { itemCount: 1, outfitCount: 1, tripCount: 1, dayPlanCount: 1, assignedDayCount: 0, firstTripId: 'trip1' },
      storageProtected: true
    });
    assertEq(afterDismiss.steps.map(s => [s.id, s.complete]), status.steps.map(s => [s.id, s.complete]));
    assertEq(isSetupDismissed(), true);
  } finally {
    if (prev == null) localStorage.removeItem(SETUP_DISMISSED_KEY);
    else localStorage.setItem(SETUP_DISMISSED_KEY, prev);
  }
});

test('setup.shouldShowSetupCard: restore prompt and dismissal take precedence', () => {
  const prev = localStorage.getItem(SETUP_DISMISSED_KEY);
  try {
    resetSetupDismissal();
    const ready = buildSetupStatus({ facts: { itemCount: 1 }, restorePromptPending: false });
    const waitingForRestore = buildSetupStatus({ facts: {}, restorePromptPending: true });
    assertEq(shouldShowSetupCard(ready), true);
    assertEq(shouldShowSetupCard(waitingForRestore), false);
    dismissSetup();
    assertEq(shouldShowSetupCard(ready), false);
  } finally {
    if (prev == null) localStorage.removeItem(SETUP_DISMISSED_KEY);
    else localStorage.setItem(SETUP_DISMISSED_KEY, prev);
  }
});

test('backup prompt helper: restore is offered only for blank, not-started-fresh data', () => {
  const startedKey = 'outfit-planner:startedFresh';
  const shownKey = 'outfit-planner:restorePromptShown';
  const prevStarted = localStorage.getItem(startedKey);
  const prevShown = sessionStorage.getItem(shownKey);
  const prevEmptySeen = localStorage.getItem(EMPTY_APP_SEEN_KEY);
  try {
    localStorage.removeItem(startedKey);
    localStorage.removeItem(EMPTY_APP_SEEN_KEY);
    sessionStorage.removeItem(shownKey);
    assertEq(shouldOfferRestorePromptForCounts({ items: 0, outfits: 0, trips: 0, dayPlans: 0 }), false);
    markEmptyAppSeen();
    assertEq(shouldOfferRestorePromptForCounts({ items: 0, outfits: 0, trips: 0, dayPlans: 0 }), true);
    assertEq(shouldOfferRestorePromptForCounts({ items: 1, outfits: 0, trips: 0, dayPlans: 0 }), false);
    localStorage.setItem(startedKey, '1');
    assertEq(shouldOfferRestorePromptForCounts({ items: 0, outfits: 0, trips: 0, dayPlans: 0 }), false);
    localStorage.removeItem(startedKey);
    sessionStorage.setItem(shownKey, '1');
    assertEq(shouldOfferRestorePromptForCounts({ items: 0, outfits: 0, trips: 0, dayPlans: 0 }), false);
  } finally {
    if (prevStarted == null) localStorage.removeItem(startedKey);
    else localStorage.setItem(startedKey, prevStarted);
    if (prevShown == null) sessionStorage.removeItem(shownKey);
    else sessionStorage.setItem(shownKey, prevShown);
    if (prevEmptySeen == null) localStorage.removeItem(EMPTY_APP_SEEN_KEY);
    else localStorage.setItem(EMPTY_APP_SEEN_KEY, prevEmptySeen);
  }
});

test('setup.loadSetupFacts: note-only day plans do not complete the planning step', async () => {
  await withTestDb();
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-02' });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [], 'Bring sunscreen');
  let facts = await loadSetupFacts();
  assertEq(facts.tripCount, 1);
  assertEq(facts.dayPlanCount, 1);
  assertEq(facts.assignedDayCount, 0);
  assertEq(facts.firstTripId, trip.id);
  const outfit = await outfits.put({ name: 'Travel day' });
  await dayPlans.addOutfit(trip.id, '2026-07-01', outfit.id);
  facts = await loadSetupFacts();
  assertEq(facts.assignedDayCount, 1);
});

test('setup.buildSetupStatus: plan step waits for a real trip target', () => {
  const noTrip = buildSetupStatus({ facts: { itemCount: 1, outfitCount: 1 }, storageProtected: true });
  const blockedPlan = noTrip.steps.find(step => step.id === 'plan');
  assertEq(blockedPlan.blocked, true);
  assertEq(blockedPlan.href, '');
  assertEq(blockedPlan.action, 'After trip');

  const withTrip = buildSetupStatus({
    facts: { itemCount: 1, outfitCount: 1, tripCount: 1, firstTripId: 'trip1' },
    storageProtected: true
  });
  const readyPlan = withTrip.steps.find(step => step.id === 'plan');
  assertEq(readyPlan.blocked, false);
  assertEq(readyPlan.href, '#/trip/trip1');
  assertEq(readyPlan.action, 'Plan');
});

test('setup.shouldShowActivationHero: only blank, non-restore setup states show the demo path', () => {
  const empty = buildSetupStatus({ facts: {}, restorePromptPending: false });
  const hasItem = buildSetupStatus({ facts: { itemCount: 1 }, restorePromptPending: false });
  const restore = buildSetupStatus({ facts: {}, restorePromptPending: true });
  assertEq(shouldShowActivationHero(empty), true);
  assertEq(shouldShowActivationHero(hasItem), false);
  assertEq(shouldShowActivationHero(restore), false);
});

test('UI: activation hero renders demo, own-trip and restore actions', () => {
  let demo = 0, own = 0, restore = 0;
  const hero = renderActivationHero({
    onTryDemo: () => { demo++; },
    onCreateTrip: () => { own++; },
    onRestore: () => { restore++; }
  });
  assertTrue(/Try demo trip/.test(hero.textContent), 'demo CTA');
  assertTrue(/Start my own/.test(hero.textContent), 'own-trip CTA');
  assertTrue(/Restore backup/.test(hero.textContent), 'restore CTA');
  [...hero.querySelectorAll('button')].find(btn => btn.textContent === 'Try demo trip').click();
  [...hero.querySelectorAll('button')].find(btn => btn.textContent === 'Start my own').click();
  [...hero.querySelectorAll('button')].find(btn => btn.textContent === 'Restore backup').click();
  assertEq({ demo, own, restore }, { demo: 1, own: 1, restore: 1 });
});

test('UI: setup card renders checklist actions and dismissal affordance', () => {
  const status = buildSetupStatus({
    facts: { itemCount: 1, firstTripId: 'trip1' },
    storageProtected: false
  });
  let protectedClicks = 0, tripClicks = 0, dismissClicks = 0;
  const card = renderSetupCard(status, {
    onProtect: () => { protectedClicks++; },
    onCreateTrip: () => { tripClicks++; },
    onDismiss: () => { dismissClicks++; }
  });
  assertTrue(/First-run setup/.test(card.textContent), 'card title');
  assertTrue(/1 of 5 done/.test(card.textContent), 'progress comes from status');
  const buttons = [...card.querySelectorAll('button')];
  buttons.find(b => b.textContent === 'Protect').click();
  buttons.find(b => b.textContent === 'Create').click();
  card.querySelector('.setup-dismiss').click();
  assertEq(protectedClicks, 1);
  assertEq(tripClicks, 1);
  assertEq(dismissClicks, 1);
  assertTrue(card.querySelector('a[href="#/outfit/new"]'), 'outfit action is a route link');
});

test('UI: setup settings row shows progress and toggles visibility hint', () => {
  const prev = localStorage.getItem(SETUP_DISMISSED_KEY);
  try {
    resetSetupDismissal();
    const status = buildSetupStatus({ facts: { itemCount: 1 }, storageProtected: true });
    let toggles = 0;
    const visibleRow = renderSetupSettingsRow(status, { onToggleDismissal: () => { toggles++; } });
    assertTrue(/2 of 5 done/.test(visibleRow.textContent), 'shows progress');
    assertTrue(/Shown on Trips/.test(visibleRow.textContent), 'visible state');
    visibleRow.querySelector('button').click();
    assertEq(toggles, 1);
    dismissSetup();
    const hiddenRow = renderSetupSettingsRow(status, { onToggleDismissal: () => { toggles++; } });
    assertTrue(/Hidden on Trips/.test(hiddenRow.textContent), 'hidden state');
    assertEq(hiddenRow.querySelector('button').textContent, 'Show');
  } finally {
    if (prev == null) localStorage.removeItem(SETUP_DISMISSED_KEY);
    else localStorage.setItem(SETUP_DISMISSED_KEY, prev);
  }
});

// ----- UI tests -----
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function ensureUiRoots() {
  if (!document.getElementById('modal-root')) {
    const m = document.createElement('div'); m.id = 'modal-root'; document.body.appendChild(m);
  }
  if (!document.getElementById('toast-root')) {
    const t = document.createElement('div'); t.id = 'toast-root'; document.body.appendChild(t);
  }
}
function currentSheet() {
  const root = document.getElementById('modal-root');
  return root ? root.querySelector('dialog.sheet, .sheet-fallback') : null;
}
function closeAllSheets() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.querySelectorAll('dialog.sheet, .sheet-fallback').forEach(d => {
    try { if (d.close) d.close(); } catch {}
    d.remove();
  });
}
function setupShellDom() {
  let main = document.querySelector('.app-main');
  if (!main) { main = document.createElement('div'); main.className = 'app-main'; document.body.appendChild(main); }
  let banner = document.getElementById('storage-banner');
  if (!banner) { banner = document.createElement('div'); banner.id = 'storage-banner'; banner.hidden = true; main.appendChild(banner); }
  return { main, banner };
}
function ensureViewRoot() {
  let root = document.getElementById('view-root');
  if (!root) { root = document.createElement('main'); root.id = 'view-root'; document.body.appendChild(root); }
  return root;
}

test('UI: trips empty view leads with demo activation hero', async () => {
  ensureUiRoots();
  ensureViewRoot();
  const prevSetup = localStorage.getItem(SETUP_DISMISSED_KEY);
  const prevEmptySeen = localStorage.getItem(EMPTY_APP_SEEN_KEY);
  const prevActivation = localStorage.getItem(ACTIVATION_LOG_KEY);
  const onceKey = 'outfit-planner:activationOnce:first_run_viewed';
  const prevOnce = sessionStorage.getItem(onceKey);
  try {
    resetSetupDismissal();
    localStorage.removeItem(EMPTY_APP_SEEN_KEY);
    clearActivationEvents();
    sessionStorage.removeItem(onceKey);
    await withTestDb();
    const { view: tripsView } = await import('../js/views/trips.js');
    const result = await tripsView();
    const text = result.node.textContent || '';
    assertTrue(/See a planned trip in one tap/.test(text), 'activation hero headline');
    assertTrue(/Try demo trip/.test(text), 'demo CTA');
    assertTrue(!/No trips yet/.test(text), 'does not duplicate the blank empty state');
  } finally {
    if (prevSetup == null) localStorage.removeItem(SETUP_DISMISSED_KEY);
    else localStorage.setItem(SETUP_DISMISSED_KEY, prevSetup);
    if (prevEmptySeen == null) localStorage.removeItem(EMPTY_APP_SEEN_KEY);
    else localStorage.setItem(EMPTY_APP_SEEN_KEY, prevEmptySeen);
    if (prevActivation == null) localStorage.removeItem(ACTIVATION_LOG_KEY);
    else localStorage.setItem(ACTIVATION_LOG_KEY, prevActivation);
    if (prevOnce == null) sessionStorage.removeItem(onceKey);
    else sessionStorage.setItem(onceKey, prevOnce);
  }
});

test('UI: setup card avoids a duplicate empty-trip create button', async () => {
  ensureUiRoots();
  ensureViewRoot();
  const prev = localStorage.getItem(SETUP_DISMISSED_KEY);
  try {
    resetSetupDismissal();
    await withTestDb();
    await items.put({ name: 'Travel tee', category: 'top' });
    await outfits.put({ name: 'Airport look' });
    const { view: tripsView } = await import('../js/views/trips.js');
    const result = await tripsView();
    const createButtons = [...result.node.querySelectorAll('button')]
      .filter(btn => btn.textContent.trim() === 'Create');
    assertEq(createButtons.length, 1);
    assertTrue(/No trips yet/.test(result.node.textContent || ''), 'empty state remains visible');
  } finally {
    if (prev == null) localStorage.removeItem(SETUP_DISMISSED_KEY);
    else localStorage.setItem(SETUP_DISMISSED_KEY, prev);
  }
});

test('UI: list search clear buttons hide until a query is active and keep URL state', async () => {
  ensureUiRoots();
  const root = ensureViewRoot();
  await withTestDb();
  const top = await items.put({ name: 'Travel Tee', category: 'top', tags: ['Airport'] });
  await outfits.put({ name: 'Airport Look', notes: 'Boarding day', topId: top.id });

  history.replaceState(history.state, '', '#/items');
  const { view: itemsView } = await import('../js/views/items.js');
  const itemResult = await itemsView();
  root.replaceChildren(itemResult.node);
  let clear = root.querySelector('.search-clear');
  assertTrue(clear.hidden, 'item clear button starts hidden');
  assertEq(getComputedStyle(clear).display, 'none');
  let search = root.querySelector('input[type="search"]');
  search.value = 'airport';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  assertEq(location.hash, '#/items?q=airport');
  assertEq(clear.hidden, false);
  clear.click();
  assertEq(location.hash, '#/items');
  assertTrue(clear.hidden, 'item clear button hides again');
  itemResult.cleanup?.();

  history.replaceState(history.state, '', '#/outfits');
  const { view: outfitsView } = await import('../js/views/outfits.js');
  const outfitResult = await outfitsView();
  root.replaceChildren(outfitResult.node);
  clear = root.querySelector('.search-clear');
  assertTrue(clear.hidden, 'outfit clear button starts hidden');
  assertEq(getComputedStyle(clear).display, 'none');
  search = root.querySelector('input[type="search"]');
  search.value = 'boarding';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  assertEq(location.hash, '#/outfits?q=boarding');
  assertEq(clear.hidden, false);
  clear.click();
  assertEq(location.hash, '#/outfits');
  assertTrue(clear.hidden, 'outfit clear button hides again');
  outfitResult.cleanup?.();
});

test('UI: item editor exposes dress, skirt, and purse categories', async () => {
  ensureUiRoots();
  await withTestDb();
  const { view: itemEditorView } = await import('../js/views/item-editor.js');
  const result = await itemEditorView({ id: 'new' });
  try {
    const buttons = [...result.node.querySelectorAll('.segmented button')];
    const labels = buttons.map(btn => btn.textContent.trim());
    assertTrue(labels.includes('Dress'), 'Dress category button is visible');
    assertTrue(labels.includes('Skirt'), 'Skirt category button is visible');
    assertTrue(labels.includes('Purse'), 'Purse category button is visible');

    const purseBtn = buttons.find(btn => btn.textContent.trim() === 'Purse');
    purseBtn.click();
    assertEq(purseBtn.getAttribute('aria-pressed'), 'true');
    assertTrue(!!result.node.querySelector('input[placeholder*="crossbody"]'), 'purse subcategory hint is shown');

    const dressBtn = buttons.find(btn => btn.textContent.trim() === 'Dress');
    dressBtn.click();
    assertEq(dressBtn.getAttribute('aria-pressed'), 'true');
    assertTrue(!!result.node.querySelector('input[placeholder*="maxi"]'), 'dress subcategory hint is shown');
  } finally {
    result.cleanup?.();
  }
});

test('UI: item picker search filters by item name and tags inside the sheet', async () => {
  ensureUiRoots();
  closeAllSheets();
  await withTestDb();
  await items.put({ name: 'Travel Tee', category: 'top', tags: ['Airport'] });
  await items.put({ name: 'Dinner Blouse', category: 'top', tags: ['evening'] });

  const pickerPromise = pickItem({ category: 'top', allowClear: false, ownerKey: 'test-picker' });
  await wait(40);
  const dlg = currentSheet();
  assertTrue(dlg, 'picker sheet opened');
  const search = dlg.querySelector('input[type="search"]');
  assertTrue(search, 'search input rendered');
  const clear = dlg.querySelector('.search-clear');
  assertTrue(clear && clear.hidden, 'picker clear button starts hidden');
  assertEq(getComputedStyle(clear).display, 'none');
  search.value = 'airport';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  assertEq(clear.hidden, false);
  const names = [...dlg.querySelectorAll('.item-card .item-name')].map(n => n.textContent);
  assertEq(names, ['Travel Tee']);
  clear.click();
  assertEq([...dlg.querySelectorAll('.item-card .item-name')].map(n => n.textContent), ['Dinner Blouse', 'Travel Tee']);
  assertTrue(clear.hidden, 'picker clear button hides after clearing');
  dlg.querySelector('.sheet-header .icon-btn').click();
  assertEq(await pickerPromise, undefined);
});

test('UI: item picker can combine pants and skirts for the bottom slot', async () => {
  ensureUiRoots();
  closeAllSheets();
  await withTestDb();
  await items.put({ name: 'Travel Pants', category: 'pant', owned: true });
  await items.put({ name: 'Pleated Skirt', category: 'skirt', owned: true });
  await items.put({ name: 'Linen Top', category: 'top', owned: true });

  const pickerPromise = pickItem({ category: ['pant', 'skirt'], allowClear: false, ownerKey: 'test-bottom-picker' });
  await wait(40);
  const dlg = currentSheet();
  assertTrue(dlg, 'picker sheet opened');
  assertTrue(/Choose Pants \/ Skirts/.test(dlg.textContent || ''), 'grouped bottom picker title is clear');
  const names = [...dlg.querySelectorAll('.item-card .item-name')].map(n => n.textContent).sort();
  assertEq(names, ['Pleated Skirt', 'Travel Pants']);
  dlg.querySelector('.sheet-header .icon-btn').click();
  assertEq(await pickerPromise, undefined);
});

test('UI: creating an item from outfit edit returns to the draft slot', async () => {
  ensureUiRoots();
  closeAllSheets();
  clearItemCreateContinuation();
  clearOutfitCreateContinuation();
  const root = ensureViewRoot();
  await withTestDb();
  const { view: outfitEditorView } = await import('../js/views/outfit-editor.js');
  const { view: itemEditorView } = await import('../js/views/item-editor.js');

  history.replaceState({ navId: 'test-outfits', idx: 0 }, '', '#/outfits');
  location.hash = '#/outfit/new';
  await wait(20);
  history.replaceState({ navId: 'test-outfit-new', idx: 1 }, '', '#/outfit/new');
  let outfitResult = await outfitEditorView({ id: 'new' });
  root.replaceChildren(outfitResult.node);
  const outfitName = root.querySelector('input[placeholder="e.g., Linen Casual"]');
  outfitName.value = 'Dress travel look';
  outfitName.dispatchEvent(new Event('input', { bubbles: true }));
  const dressSection = [...root.querySelectorAll('.slot-section')]
    .find(section => /^Dresses$/.test(section.querySelector('h3')?.textContent || ''));
  assertTrue(dressSection, 'dress section rendered');
  const addDress = dressSection.querySelector('.acc-add');
  assertTrue(addDress, 'dress section has an add control');
  addDress.click();
  await wait(80);
  let dlg = currentSheet();
  assertTrue(dlg, 'dress picker opened');
  dlg.querySelector('a[href="#/item/new"]').click();
  await wait(80);
  history.replaceState({ navId: 'test-item-new', idx: 2 }, '', '#/item/new');

  outfitResult.cleanup?.();
  let itemResult = await itemEditorView({ id: 'new' });
  root.replaceChildren(itemResult.node);
  assertEq(root.querySelector('button[data-category-value="dress"]').getAttribute('aria-pressed'), 'true');
  const itemName = root.querySelector('input[placeholder="e.g., Linen Shirt"]');
  itemName.value = 'Trip dress';
  itemName.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector('button[type="submit"]').click();
  await wait(180);
  assertEq(location.hash, '#/outfit/new');

  itemResult.cleanup?.();
  outfitResult = await outfitEditorView({ id: 'new' });
  root.replaceChildren(outfitResult.node);
  assertEq(root.querySelector('input[placeholder="e.g., Linen Casual"]').value, 'Dress travel look');
  assertTrue(/Trip dress/.test(root.textContent || ''), 'new dress is placed in the dress slot');
  history.back();
  await wait(120);
  assertTrue(location.hash !== '#/item/new', 'browser Back skips the temporary new item route');
  outfitResult.cleanup?.();
});

test('UI: creating an outfit from a trip day assigns it after save', async () => {
  ensureUiRoots();
  closeAllSheets();
  clearItemCreateContinuation();
  clearOutfitCreateContinuation();
  const root = ensureViewRoot();
  await withTestDb();
  const trip = await trips.put({ name: 'Weekend', startDate: '2026-07-01', endDate: '2026-07-01' });
  const { view: tripDetailView } = await import('../js/views/trip-detail.js');
  const { view: outfitEditorView } = await import('../js/views/outfit-editor.js');

  history.replaceState({ navId: 'test-trip-detail', idx: 0 }, '', `#/trip/${trip.id}`);
  const tripResult = await tripDetailView({ id: trip.id });
  root.replaceChildren(tripResult.node);
  const choose = [...root.querySelectorAll('button')].find(btn => btn.textContent.trim() === '+ Choose outfit');
  assertTrue(choose, 'trip day has a choose outfit action');
  choose.click();
  await wait(80);
  const dlg = currentSheet();
  assertTrue(dlg, 'outfit picker opened');
  dlg.querySelector('a[href="#/outfit/new"]').click();
  await wait(80);
  assertEq(location.hash, '#/outfit/new');
  assertEq(peekOutfitCreateContinuation()?.tripId, trip.id, 'trip continuation is stored before outfit save');

  tripResult.cleanup?.();
  const outfitResult = await outfitEditorView({ id: 'new' });
  root.replaceChildren(outfitResult.node);
  assertEq(peekOutfitCreateContinuation()?.tripId, trip.id, 'trip continuation survives outfit editor render');
  const name = root.querySelector('input[placeholder="e.g., Linen Casual"]');
  name.value = 'Created from trip';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector('button[type="submit"]').click();
  await wait(150);

  const plan = await dayPlans.get(trip.id, '2026-07-01');
  assertTrue(plan, 'day plan was created');
  assertEq(plan.outfitIds.length, 1);
  const saved = await outfits.get(plan.outfitIds[0]);
  assertEq(saved.name, 'Created from trip');
  assertEq(location.hash, `#/trip/${trip.id}`);
  outfitResult.cleanup?.();
});

test('UI: outfit create continuation replaces the exact trip day spot', async () => {
  ensureUiRoots();
  closeAllSheets();
  clearItemCreateContinuation();
  clearOutfitCreateContinuation();
  const root = ensureViewRoot();
  await withTestDb();
  const trip = await trips.put({ name: 'Weekend', startDate: '2026-07-01', endDate: '2026-07-01' });
  const first = await outfits.put({ name: 'First outfit' });
  const second = await outfits.put({ name: 'Second outfit' });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [first.id, second.id]);
  startOutfitCreateContinuation({
    returnHash: `#/trip/${trip.id}`,
    tripId: trip.id,
    date: '2026-07-01',
    mode: 'replace',
    index: 1
  });

  history.replaceState({ navId: 'test-outfit-replace', idx: 0 }, '', '#/outfit/new');
  const { view: outfitEditorView } = await import('../js/views/outfit-editor.js');
  assertEq(peekOutfitCreateContinuation()?.index, 1, 'replace continuation is stored before render');
  const result = await outfitEditorView({ id: 'new' });
  root.replaceChildren(result.node);
  assertEq(peekOutfitCreateContinuation()?.index, 1, 'replace continuation survives outfit editor render');
  const name = root.querySelector('input[placeholder="e.g., Linen Casual"]');
  name.value = 'Replacement outfit';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector('button[type="submit"]').click();
  await wait(150);

  const plan = await dayPlans.get(trip.id, '2026-07-01');
  assertEq(plan.outfitIds.length, 2);
  assertEq(plan.outfitIds[0], first.id);
  assertTrue(plan.outfitIds[1] !== second.id, 'second spot was replaced');
  const replacement = await outfits.get(plan.outfitIds[1]);
  assertEq(replacement.name, 'Replacement outfit');
  assertEq(location.hash, `#/trip/${trip.id}`);
  result.cleanup?.();
  clearOutfitCreateContinuation();
});

test('UI: outfit picker search matches notes and contained item tags', async () => {
  ensureUiRoots();
  closeAllSheets();
  await withTestDb();
  const top = await items.put({ name: 'Silk Cami', category: 'top', tags: ['Dinner'] });
  await outfits.put({ name: 'Evening Look', notes: 'Rooftop reservation', topId: top.id });
  await outfits.put({ name: 'Airport Look', notes: 'Boarding day' });

  const pickerPromise = pickOutfit({ allowClear: false });
  await wait(40);
  const dlg = currentSheet();
  assertTrue(dlg, 'picker sheet opened');
  const search = dlg.querySelector('input[type="search"]');
  assertTrue(search, 'search input rendered');
  const clear = dlg.querySelector('.search-clear');
  assertTrue(clear && clear.hidden, 'picker clear button starts hidden');
  assertEq(getComputedStyle(clear).display, 'none');
  search.value = 'dinner';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  assertEq(clear.hidden, false);
  assertEq([...dlg.querySelectorAll('.row-title')].map(n => n.textContent), ['Evening Look']);
  search.value = 'boarding';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  assertEq([...dlg.querySelectorAll('.row-title')].map(n => n.textContent), ['Airport Look']);
  clear.click();
  assertEq([...dlg.querySelectorAll('.row-title')].map(n => n.textContent), ['Airport Look', 'Evening Look']);
  assertTrue(clear.hidden, 'picker clear button hides after clearing');
  dlg.querySelector('.sheet-header .icon-btn').click();
  assertEq(await pickerPromise, undefined);
});

test('UI: outfit picker shows actual dress outfit preview without owned/to-buy badges', async () => {
  ensureUiRoots();
  closeAllSheets();
  await withTestDb();
  const dress = await items.put({ name: 'Travel Dress', category: 'dress', owned: false });
  await outfits.put({ name: 'Dress Day', otherIds: [dress.id] });

  const pickerPromise = pickOutfit({ allowClear: false });
  await wait(40);
  const dlg = currentSheet();
  assertTrue(dlg, 'picker sheet opened');
  const stack = dlg.querySelector('.outfit-stack.trip.is-single-item');
  assertTrue(stack, 'dress-only outfit gets a large actual-item preview');
  assertTrue((stack.textContent || '').includes('👗'), 'dress icon is visible in picker preview');
  assertTrue(!(stack.textContent || '').includes('👟'), 'generic empty slot icon is omitted');
  assertEq(stack.querySelector('.ownership-badge'), null);
  dlg.querySelector('.sheet-header .icon-btn').click();
  assertEq(await pickerPromise, undefined);
});

test('UI: outfit picker shows reuse context and prevents same-day duplicates', async () => {
  ensureUiRoots();
  closeAllSheets();
  await withTestDb();
  const top = await items.put({ name: 'White tee', category: 'top', owned: true });
  const pant = await items.put({ name: 'Blue pants', category: 'pant', owned: true });
  const shoes = await items.put({ name: 'Sneakers', category: 'shoes', owned: true });
  const reused = await outfits.put({ name: 'Already planned', topId: top.id, pantId: pant.id, shoesId: shoes.id });
  const target = await outfits.put({ name: 'Target day outfit', topId: top.id, pantId: pant.id, shoesId: shoes.id });
  const trip = await trips.put({ name: 'T', startDate: '2026-07-01', endDate: '2026-07-02' });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [reused.id]);
  await dayPlans.setOutfits(trip.id, '2026-07-02', [target.id]);
  const [allItems, allOutfits, plans] = await Promise.all([items.all(), outfits.all(), dayPlans.byTrip(trip.id)]);
  const pickerPromise = pickOutfit({
    allowClear: false,
    reuseContext: {
      date: '2026-07-02',
      planByDate: new Map(plans.map(p => [p.date, p])),
      outfitsById: new Map(allOutfits.map(o => [o.id, o])),
      itemsById: new Map(allItems.map(i => [i.id, i])),
      preventTargetDuplicates: true
    }
  });
  await wait(80);
  const dlg = currentSheet();
  assertTrue(dlg, 'picker opened');
  const text = dlg.textContent || '';
  assertTrue(/White tee \(top\) and Blue pants \(pant\) repeat on Jul 1/.test(text), text);
  assertTrue(/Already on this day/.test(text), 'duplicate target note shown');
  const targetRow = [...dlg.querySelectorAll('button.list-row')].find(btn => /Target day outfit/.test(btn.textContent || ''));
  assertTrue(targetRow && targetRow.disabled, 'target-day duplicate is disabled');
  const closeBtn = dlg.querySelector('[aria-label="Close"]');
  closeBtn.click();
  assertEq(await pickerPromise, undefined);
});

test('UI: outfit picker clear action names the scoped outfit removal', async () => {
  ensureUiRoots();
  closeAllSheets();
  await withTestDb();
  const top = await items.put({ name: 'White tee', category: 'top', owned: true });
  const outfit = await outfits.put({ name: 'Current outfit', topId: top.id });
  const pickerPromise = pickOutfit({ currentId: outfit.id });
  await wait(80);
  const dlg = currentSheet();
  assertTrue(dlg, 'picker opened');
  assertTrue(/Remove this outfit/.test(dlg.textContent || ''), 'clear action is scoped to one outfit');
  assertTrue(!/Clear this day/.test(dlg.textContent || ''), 'does not imply the whole day is cleared');
  dlg.querySelector('[aria-label="Close"]').click();
  assertEq(await pickerPromise, undefined);
});

test('UI: outfit detail menu offers duplicate without replacing native Back control', async () => {
  ensureUiRoots();
  closeAllSheets();
  let topbar = document.getElementById('topbar');
  if (!topbar) { topbar = document.createElement('div'); topbar.id = 'topbar'; document.body.appendChild(topbar); }
  await withTestDb();
  const top = await items.put({ name: 'White tee', category: 'top', owned: true });
  const outfit = await outfits.put({ name: 'Original look', topId: top.id });
  const { view: outfitView } = await import('../js/views/outfit-view.js');
  const result = await outfitView({ id: outfit.id });
  try {
    const backBtn = topbar.querySelector('.topbar-left button[aria-label="Back"]');
    assertTrue(backBtn, 'detail view still renders history-aware Back button');
    topbar.querySelector('.topbar-right button[aria-label="More"]').click();
    await wait(80);
    const dlg = currentSheet();
    assertTrue(dlg, 'menu opens');
    assertTrue(/Duplicate outfit/.test(dlg.textContent || ''), 'duplicate action is in menu');
    dlg.querySelector('[aria-label="Close"]').click();
  } finally {
    result.cleanup?.();
    closeAllSheets();
  }
});

test('UI: trip detail day rows show actual dress preview without owned/to-buy badges', async () => {
  ensureUiRoots();
  await withTestDb();
  const dress = await items.put({ name: 'Travel Dress', category: 'dress', owned: false });
  const outfit = await outfits.put({ name: 'Dress Day', otherIds: [dress.id] });
  const trip = await trips.put({ name: 'Weekend', startDate: '2026-07-01', endDate: '2026-07-01' });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [outfit.id]);

  const { view: tripDetailView } = await import('../js/views/trip-detail.js');
  const result = await tripDetailView({ id: trip.id });
  try {
    const stack = result.node.querySelector('.day-row .outfit-stack.trip.is-single-item');
    assertTrue(stack, 'planned dress outfit gets a large actual-item preview');
    assertTrue((stack.textContent || '').includes('👗'), 'dress icon is visible in trip row');
    assertTrue(!(stack.textContent || '').includes('👟'), 'generic empty slot icon is omitted from trip row');
    assertEq(stack.querySelector('.ownership-badge'), null);
  } finally {
    result.cleanup?.();
  }
});

test('UI: trip detail photo previews stay compact in day rows', async () => {
  ensureUiRoots();
  closeAllSheets();
  const root = ensureViewRoot();
  await withTestDb();
  const photo = await makeTinyImageBlob('gold', 320);
  const ring = await items.put({ name: 'Gold ring set', category: 'accessory', owned: true, imageBlob: photo });
  const top = await items.put({ name: 'White knit polo', category: 'top', owned: true, imageBlob: photo });
  const pant = await items.put({ name: 'Blue jeans', category: 'pant', owned: true, imageBlob: photo });
  const shoes = await items.put({ name: 'Loafers', category: 'shoes', owned: true, imageBlob: photo });
  const outfit = await outfits.put({
    name: 'Super casual jean fit',
    topId: top.id,
    pantId: pant.id,
    shoesId: shoes.id,
    accessoryIds: [ring.id]
  });
  const trip = await trips.put({ name: 'Weekend', startDate: '2026-07-01', endDate: '2026-07-01' });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [outfit.id]);

  const { view: tripDetailView } = await import('../js/views/trip-detail.js');
  const result = await tripDetailView({ id: trip.id });
  try {
    root.replaceChildren(result.node);
    await wait(120);
    const row = root.querySelector('.day-row');
    const stack = row && row.querySelector('.outfit-stack.trip');
    assertTrue(stack, 'trip row has a preview stack');
    const stackRect = stack.getBoundingClientRect();
    assertTrue(stackRect.width <= 96, `trip preview should stay narrow, got ${stackRect.width}`);
    const oversized = [...stack.querySelectorAll('img')]
      .map(img => img.getBoundingClientRect())
      .filter(rect => rect.width > 90 || rect.height > 90);
    assertEq(oversized.length, 0, 'trip preview photos stay capped');
    const bodyRect = row.querySelector('.day-body').getBoundingClientRect();
    assertTrue(bodyRect.width > 180, `day text keeps readable width, got ${bodyRect.width}`);
  } finally {
    result.cleanup?.();
  }
});

test('UI: trip packing view renders pack/to-buy sections and persists checklist changes', async () => {
  ensureUiRoots();
  await withTestDb();
  const owned = await items.put({ name: 'Linen shirt', category: 'top', owned: true });
  const toBuy = await items.put({ name: 'Travel sandals', category: 'shoes', owned: false, purchaseUrl: 'https://example.com/sandals' });
  const outfit = await outfits.put({ name: 'Beach day', topId: owned.id, shoesId: toBuy.id });
  const trip = await trips.put({ name: 'Beach trip', startDate: '2026-07-01', endDate: '2026-07-01' });
  await dayPlans.setOutfits(trip.id, '2026-07-01', [outfit.id]);

  const { view: packingView } = await import('../js/views/trip-packing.js');
  const result = await packingView({ id: trip.id });
  try {
    const text = result.node.textContent || '';
    assertTrue(/Pack/.test(text), 'shows Pack section');
    assertTrue(/To buy/.test(text), 'shows To buy split');
    assertTrue(/Travel sandals/.test(text), 'shows unowned assigned item in to-buy split');
    assertTrue(/Used WED Jul 1/.test(text), 'shows trip-day use context');

    const markOwned = result.node.querySelector('[aria-label="Mark Travel sandals as owned"]');
    assertTrue(markOwned, 'to-buy packing row can be marked owned');
    markOwned.click();
    await wait(80);
    const nowOwned = await items.get(toBuy.id);
    assertEq(nowOwned.owned, 1);
    assertTrue(result.node.querySelector(`[data-pack-item-id="${toBuy.id}"]`), 'marked-owned item moves into pack checklist');

    const ownedCheck = result.node.querySelector(`[data-pack-item-id="${owned.id}"]`);
    assertTrue(ownedCheck, 'owned assigned item is checkable');
    ownedCheck.checked = true;
    ownedCheck.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(80);
    const saved = await trips.get(trip.id);
    assertEq(saved.packing.checkedItemIds, [owned.id]);

    const input = result.node.querySelector('input[name="customPackingItem"]');
    const form = result.node.querySelector('.packing-add-form');
    const addButton = form.querySelector('button[type="submit"]');
    assertEq(input.getAttribute('aria-label'), 'Add custom packing item');
    assertEq(addButton.getAttribute('aria-label'), 'Add custom item to packing list');
    input.value = 'Phone charger';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(80);
    const withCustom = await trips.get(trip.id);
    assertTrue(withCustom.packing.customItems.some(item => item.label === 'Phone charger'), 'custom item persisted');
  } finally {
    if (result.cleanup) result.cleanup();
  }
});

test('UI: trip packing view omits optional to-buy section without rendering null text', async () => {
  ensureUiRoots();
  await withTestDb();
  const owned = await items.put({ name: 'Tank undershirt', category: 'other', subcategory: 'undershirt', owned: true });
  const outfit = await outfits.put({ name: 'Base layer', otherIds: [owned.id] });
  const trip = await trips.put({ name: 'No buys trip', startDate: '2026-07-17', endDate: '2026-07-17' });
  await dayPlans.setOutfits(trip.id, '2026-07-17', [outfit.id]);

  const { view: packingView } = await import('../js/views/trip-packing.js');
  const result = await packingView({ id: trip.id });
  try {
    const text = result.node.textContent || '';
    assertTrue(/Tank undershirt/.test(text), 'owned item appears in pack list');
    assertTrue(!/\bnull\b/.test(text), 'no native null text node is rendered');
    assertTrue(!/To buy/.test(text), 'empty to-buy section is omitted');
  } finally {
    if (result.cleanup) result.cleanup();
  }
});

test('storageBannerMode: hides for protected or empty data, warns once data exists', () => {
  assertEq(storageBannerMode({ protected: true, counts: { items: 1, outfits: 0, trips: 0, dayPlans: 0 } }), 'hidden');
  assertEq(storageBannerMode({ protected: false, counts: { items: 0, outfits: 0, trips: 0, dayPlans: 0 } }), 'hidden');
  assertEq(storageBannerMode({ protected: false, counts: { items: 1, outfits: 0, trips: 0, dayPlans: 0 } }), 'strong');
  assertEq(storageBannerMode({ protected: false, counts: null }), 'strong');
});

test('UI: storage banner reflects protection state for non-empty data', async () => {
  ensureUiRoots();
  await withTestDb();
  await items.put({ name: 'Travel tee', category: 'top', owned: true });
  const { main, banner } = setupShellDom();
  // Best-effort force "unprotected" so the shown-branch is deterministic.
  const orig = (navigator.storage && navigator.storage.persisted) || null;
  if (navigator.storage) { try { navigator.storage.persisted = async () => false; } catch {} }
  try {
    await refreshStorageBanner();
    const persistedNow = await isPersisted();
    if (!isStandalone() && !persistedNow) {
      assertEq(banner.hidden, false);
      const btn = banner.querySelector('.storage-banner-btn');
      assertTrue(btn, 'banner renders a button');
      assertTrue(/lost|risk|protect|home screen/i.test(btn.textContent), 'shows a warning + CTA');
      assertTrue(main.classList.contains('has-storage-banner'), 'shell flags the banner for layout');
    } else {
      // Protected environment → bar must be hidden.
      assertEq(banner.hidden, true);
    }
  } finally {
    if (navigator.storage && orig) { try { navigator.storage.persisted = orig; } catch {} }
    banner.remove();
  }
});

test('UI: openInstallGuide opens a sheet with Add-to-Home-Screen / install guidance', () => {
  ensureUiRoots();
  closeAllSheets();
  openInstallGuide();
  const dlg = currentSheet();
  assertTrue(dlg, 'a sheet opened');
  assertTrue(/Home Screen|Install app/.test(dlg.textContent || ''), 'mentions the install path');
  closeAllSheets();
});

test('UI: settings view exposes local alpha feedback packet controls', async () => {
  ensureUiRoots();
  ensureViewRoot();
  await withTestDb();
  const prevFeedback = localStorage.getItem(FEEDBACK_LOG_KEY);
  const prevState = localStorage.getItem(FEEDBACK_STATE_KEY);
  const prevActivation = localStorage.getItem(ACTIVATION_LOG_KEY);
  try {
    clearFeedbackEntries();
    clearActivationEvents();
    recordFeedback('trip_created', 'positive');
    const { view: settingsView } = await import('../js/views/settings.js');
    const result = await settingsView();
    const text = result.node.textContent || '';
    assertTrue(/Alpha feedback/.test(text), 'section heading');
    assertTrue(/Copy feedback packet/.test(text), 'copy row');
    assertTrue(/1 response/.test(text), 'feedback count');
    assertTrue(/1 event/.test(text), 'activation event count');
  } finally {
    if (prevFeedback == null) localStorage.removeItem(FEEDBACK_LOG_KEY); else localStorage.setItem(FEEDBACK_LOG_KEY, prevFeedback);
    if (prevState == null) localStorage.removeItem(FEEDBACK_STATE_KEY); else localStorage.setItem(FEEDBACK_STATE_KEY, prevState);
    if (prevActivation == null) localStorage.removeItem(ACTIVATION_LOG_KEY); else localStorage.setItem(ACTIVATION_LOG_KEY, prevActivation);
  }
});

test('UI: showBackupReminder opens a sheet with "Back up now" and "Later"', () => {
  ensureUiRoots();
  closeAllSheets();
  showBackupReminder(null);
  const dlg = currentSheet();
  assertTrue(dlg, 'a sheet opened');
  const labels = [...dlg.querySelectorAll('button')].map(b => b.textContent);
  assertTrue(labels.some(t => /Back up now/i.test(t)), 'has a Back up now button');
  assertTrue(labels.some(t => /Later/i.test(t)), 'has a Later button');
  closeAllSheets();
});

test('UI: showRestorePrompt opens a sheet with restore + start-fresh options', async () => {
  ensureUiRoots();
  closeAllSheets();
  showRestorePrompt(); // async internally; give the sheet a tick to mount
  await wait(40);
  const dlg = currentSheet();
  assertTrue(dlg, 'a sheet opened');
  const text = dlg.textContent || '';
  assertTrue(/Start fresh/.test(text), 'has Start fresh');
  assertTrue(/backup file/i.test(text), 'offers a backup file chooser');
  closeAllSheets();
});

// ----- PWA update flow tests -----
test('update.shouldPromptUpdate: installed + has controller → prompt (real update)', () => {
  assertEq(shouldPromptUpdate('installed', true), true);
});
test('update.shouldPromptUpdate: installed but no controller → no prompt (first install)', () => {
  assertEq(shouldPromptUpdate('installed', false), false);
});
test('update.shouldPromptUpdate: non-installed states → no prompt', () => {
  assertEq(shouldPromptUpdate('installing', true), false);
  assertEq(shouldPromptUpdate('activated', true), false);
  assertEq(shouldPromptUpdate('redundant', true), false);
});
test('update.UPDATE_CHECK_INTERVAL_MS is a positive interval (30 min)', () => {
  assertTrue(typeof UPDATE_CHECK_INTERVAL_MS === 'number' && UPDATE_CHECK_INTERVAL_MS > 0, 'positive');
  assertEq(UPDATE_CHECK_INTERVAL_MS, 30 * 60 * 1000);
});
test('UI: showUpdateBanner renders a Reload action that fires the callback; dismiss removes it', () => {
  dismissUpdateBanner();
  let reloaded = 0;
  const banner = showUpdateBanner(() => { reloaded++; });
  assertTrue(document.getElementById('update-banner'), 'banner mounted');
  assertTrue(/new version/i.test(banner.textContent), 'has update copy');
  const reloadBtn = banner.querySelector('.update-reload-btn');
  assertTrue(reloadBtn, 'has reload button');
  reloadBtn.click();
  assertEq(reloaded, 1);
  dismissUpdateBanner();
  assertTrue(!document.getElementById('update-banner'), 'dismiss removes banner');
});
test('UI: showUpdateBanner is idempotent — only one banner at a time', () => {
  dismissUpdateBanner();
  showUpdateBanner(() => {});
  showUpdateBanner(() => {});
  assertEq(document.querySelectorAll('#update-banner').length, 1);
  dismissUpdateBanner();
});

// ---- Runner ----
async function run() {
  const resultsEl = document.getElementById('results');
  const statsEl = document.getElementById('stats');
  resultsEl.replaceChildren();
  statsEl.textContent = 'Running…';
  let pass = 0, fail = 0;
  const failures = [];
  for (const t of tests) {
    const row = document.createElement('div');
    row.className = 'test run';
    row.textContent = `… ${t.name}`;
    resultsEl.appendChild(row);
    try {
      await t.fn();
      row.className = 'test pass';
      row.textContent = `✓ ${t.name}`;
      pass++;
    } catch (err) {
      row.className = 'test fail';
      const pre = document.createElement('pre');
      pre.textContent = String(err && (err.stack || err.message || err));
      row.textContent = `✗ ${t.name}`;
      row.appendChild(pre);
      fail++;
      failures.push({ name: t.name, err });
    }
  }
  // Tear down test DB
  if (lastConn) { try { lastConn.close(); } catch {} lastConn = null; }
  db._setTestDb(null);
  await new Promise(resolve => {
    const req = indexedDB.deleteDatabase(TEST_DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  statsEl.textContent = `${pass} passed · ${fail} failed · ${tests.length} total`;
  statsEl.style.background = fail ? 'var(--danger-soft)' : 'var(--success-soft)';
  statsEl.style.color = fail ? 'var(--danger)' : 'var(--success)';
}

// Only wire up the runner when the local-dev gate (test.html inline script)
// approved this environment. In production the body has been (or will be)
// replaced with a notice and the run button no longer exists.
if (window.__TESTS_LOCAL__) {
  const runBtn = document.getElementById('run-btn');
  if (runBtn) runBtn.addEventListener('click', run);
  // Auto-run on load
  window.addEventListener('load', () => setTimeout(run, 50));
}
