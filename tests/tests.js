// Tiny in-browser test runner + suite. No build, no framework.

import { openDB } from '../js/vendor/idb.js';
import { match, register } from '../js/router.js';
import { el } from '../js/ui.js';
import { parseIntent } from '../js/stylist/intent.js';
import { buildItemContext, generateOutfits } from '../js/stylist/engine.js';
import { rgbToHsv, colorTone, harmonyScore, classifyHarmony } from '../js/stylist/color.js';
import { blobToBase64, base64ToBlob, buildExport, importFromObject, SCHEMA_VERSION } from '../js/exporter.js';
import * as db from '../js/db.js';
import { items, outfits, trips, dayPlans, daysBetween, formatDayLabel, formatDateRange, tripShoppingList, tripStats } from '../js/store.js';
import { renderOutfitsCanvas, canvasToBlob, shareOutfits } from '../js/share.js';
import { isStandalone, isPersisted, isStorageProtected, isIOS } from '../js/storage.js';
import {
  shouldRemindBackup, isEmptyCounts, BACKUP_FILENAME, BACKUP_INTERVAL_MS,
  getCounts, isDatabaseEmpty, restoreFromFile, supportsFileSystemAccess, supportsShareFile,
  getLastBackupAt, setLastBackupAt, LAST_BACKUP_KEY
} from '../js/backup.js';
import { openInstallGuide, refreshStorageBanner } from '../js/components/storage-banner.js';
import { showBackupReminder, showRestorePrompt } from '../js/components/backup-prompts.js';

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

test('router: strips trailing slash but preserves root', () => {
  register('/foo', () => null);
  assertTrue(match('#/foo') && match('#/foo/'), 'should match both');
});

test('router: no match for unknown', () => {
  const m = match('#/this-route-does-not-exist-xyz');
  assertTrue(!m, 'should not match');
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

test('el(): textarea `value` populates the displayed value (regression: setAttribute(value) is silently ignored on textareas)', () => {
  const ta = el('textarea', { value: 'multi\nline\ntext' });
  assertEq(ta.value, 'multi\nline\ntext');
});

test('el(): input `value` populates the displayed value', () => {
  const inp = el('input', { type: 'text', value: 'hello' });
  assertEq(inp.value, 'hello');
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

test('trips: rejects reversed date range', async () => {
  await withTestDb();
  await assertThrows(() => trips.put({ name: 'X', startDate: '2026-07-10', endDate: '2026-07-01' }), 'End date');
});

test('export/import: full roundtrip preserves items, outfits, trips, dayPlans', async () => {
  await withTestDb();
  // Seed
  const top = await items.put({ name: 'Shirt', category: 'top', owned: true });
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
  const got = await outfits.get(o.id);
  assertEq(got.name, 'Outfit A');
  const plans = await dayPlans.byTrip(trip.id);
  assertEq(plans.length, 1);
  assertEq(plans[0].outfitIds, [o.id]);
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
  // Sample a top-left background pixel — should match the section bg color #fafafa
  const px = canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
  assertEq(Array.from(px).slice(0, 3), [250, 250, 250]);
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

test('UI: storage banner reflects protection state (shown + tappable when unprotected)', async () => {
  ensureUiRoots();
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
