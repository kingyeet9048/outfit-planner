// Tiny in-browser test runner + suite. No build, no framework.

import { openDB } from '../js/vendor/idb.js';
import { match, register } from '../js/router.js';
import { el } from '../js/ui.js';
import { blobToBase64, base64ToBlob, buildExport, importFromObject, SCHEMA_VERSION } from '../js/exporter.js';
import * as db from '../js/db.js';
import { items, outfits, trips, dayPlans, daysBetween, formatDayLabel, formatDateRange, tripShoppingList, tripStats } from '../js/store.js';

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

document.getElementById('run-btn').addEventListener('click', run);
// Auto-run on load
window.addEventListener('load', () => setTimeout(run, 50));
