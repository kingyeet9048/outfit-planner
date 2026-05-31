import { getDb } from './db.js';
import { normalizeTags } from './search.js';
import { normalizePackingState } from './packing.js';
import { dedupeIds } from './reuse.js';

export const SCHEMA_VERSION = 1;

export async function blobToBase64(blob) {
  if (!blob) return null;
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = fr.result;
      const comma = dataUrl.indexOf(',');
      resolve({ mime: blob.type || 'image/jpeg', base64: dataUrl.slice(comma + 1) });
    };
    fr.onerror = () => reject(fr.error || new Error('Failed to read blob'));
    fr.readAsDataURL(blob);
  });
}

export async function base64ToBlob({ mime, base64 }) {
  const res = await fetch(`data:${mime || 'image/jpeg'};base64,${base64}`);
  return await res.blob();
}

async function cloneBlob(blob) {
  if (!blob) return null;
  const buffer = await blob.arrayBuffer();
  return new Blob([buffer], { type: blob.type || 'image/jpeg' });
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function dayPlanId(plan) {
  return plan?.tripId && plan?.date ? `${plan.tripId}_${plan.date}` : (plan?.id || `${plan?.tripId}_${plan?.date}`);
}

function outfitIdsFromDayPlan(plan, existing) {
  if (Array.isArray(plan?.outfitIds)) return dedupeIds(plan.outfitIds);
  if (hasOwn(plan, 'outfitId')) return dedupeIds(plan.outfitId ? [plan.outfitId] : []);
  if (existing) {
    const existingIds = Array.isArray(existing.outfitIds)
      ? existing.outfitIds
      : (existing.outfitId ? [existing.outfitId] : []);
    return dedupeIds(existingIds);
  }
  return [];
}

function normalizeDayPlanRecord(plan, existing = null) {
  return {
    id: dayPlanId(plan),
    tripId: plan.tripId,
    date: plan.date,
    outfitIds: outfitIdsFromDayPlan(plan, existing),
    notes: hasOwn(plan, 'notes') ? (plan.notes || '') : (existing ? (existing.notes || '') : '')
  };
}

export async function buildExport() {
  const db = await getDb();
  const [rawItems, outfitsList, tripsList, daysList] = await Promise.all([
    db.getAll('items'),
    db.getAll('outfits'),
    db.getAll('trips'),
    db.getAll('dayPlans')
  ]);
  const items = [];
  for (const it of rawItems) {
    const image = it.imageBlob ? await blobToBase64(it.imageBlob) : null;
    items.push({
      id: it.id,
      name: it.name,
      category: it.category,
      subcategory: it.subcategory,
      description: it.description,
      purchaseUrl: it.purchaseUrl,
      tags: normalizeTags(it.tags),
      image,
      owned: !!it.owned,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items,
    outfits: outfitsList,
    trips: tripsList.map(t => ({ ...t, packing: normalizePackingState(t.packing) })),
    dayPlans: daysList.map(d => normalizeDayPlanRecord(d))
  };
}

export async function downloadExport() {
  const data = await buildExport();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `outfit-planner-export-${date}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  return data;
}

export async function exportAsString() {
  const data = await buildExport();
  return JSON.stringify(data, null, 2);
}

// mode: 'replace' (default) clears existing data; 'merge' keeps existing and adds/overwrites by id.
export async function importFromObject(data, { mode = 'replace' } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Invalid import file');
  if (data.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported schema version: ${data.schemaVersion}`);

  const nowIso = new Date().toISOString();
  const mergeMode = mode === 'merge';
  const db = await getDb();

  // Pre-resolve image blobs BEFORE starting the transaction —
  // IndexedDB transactions auto-close on the next microtask after the last
  // pending request resolves, so awaiting fetch() inside the tx breaks it.
  const itemRecords = [];
  for (const raw of (data.items || [])) {
    const existing = mergeMode && raw.id ? await db.get('items', raw.id) : null;
    const imageBlob = hasOwn(raw, 'image')
      ? (raw.image ? await base64ToBlob(raw.image) : null)
      : (existing ? await cloneBlob(existing.imageBlob) : null);
    const rawOwned = hasOwn(raw, 'owned') ? raw.owned : (existing ? existing.owned : 0);
    itemRecords.push({
      id: raw.id,
      name: hasOwn(raw, 'name') ? (raw.name || '') : (existing ? (existing.name || '') : ''),
      category: hasOwn(raw, 'category') ? (raw.category || 'top') : (existing ? (existing.category || 'top') : 'top'),
      subcategory: hasOwn(raw, 'subcategory') ? (raw.subcategory || '') : (existing ? (existing.subcategory || '') : ''),
      description: hasOwn(raw, 'description') ? (raw.description || '') : (existing ? (existing.description || '') : ''),
      purchaseUrl: hasOwn(raw, 'purchaseUrl') ? (raw.purchaseUrl || '') : (existing ? (existing.purchaseUrl || '') : ''),
      tags: hasOwn(raw, 'tags') ? normalizeTags(raw.tags) : (existing ? normalizeTags(existing.tags) : []),
      imageBlob,
      owned: rawOwned ? 1 : 0,
      createdAt: raw.createdAt || (existing && existing.createdAt) || nowIso,
      updatedAt: raw.updatedAt || (existing && existing.updatedAt) || raw.createdAt || nowIso
    });
  }

  const outfitRecords = [];
  for (const o of (data.outfits || [])) {
    const existing = mergeMode && o.id ? await db.get('outfits', o.id) : null;
    outfitRecords.push({
      id: o.id,
      name: hasOwn(o, 'name') ? (o.name || '') : (existing ? (existing.name || '') : ''),
      topId: hasOwn(o, 'topId') ? (o.topId ?? null) : (existing ? (existing.topId ?? null) : null),
      pantId: hasOwn(o, 'pantId') ? (o.pantId ?? null) : (existing ? (existing.pantId ?? null) : null),
      shoesId: hasOwn(o, 'shoesId') ? (o.shoesId ?? null) : (existing ? (existing.shoesId ?? null) : null),
      accessoryIds: hasOwn(o, 'accessoryIds') && Array.isArray(o.accessoryIds)
        ? o.accessoryIds
        : (existing && Array.isArray(existing.accessoryIds) ? existing.accessoryIds : []),
      otherIds: hasOwn(o, 'otherIds') && Array.isArray(o.otherIds)
        ? o.otherIds
        : (existing && Array.isArray(existing.otherIds) ? existing.otherIds : []),
      notes: hasOwn(o, 'notes') ? (o.notes || '') : (existing ? (existing.notes || '') : ''),
      aiGenerated: hasOwn(o, 'aiGenerated') ? !!o.aiGenerated : !!(existing && existing.aiGenerated),
      aiPrompt: hasOwn(o, 'aiPrompt') ? (o.aiPrompt || '') : (existing ? (existing.aiPrompt || '') : ''),
      aiRationale: hasOwn(o, 'aiRationale') ? (o.aiRationale || '') : (existing ? (existing.aiRationale || '') : ''),
      createdAt: o.createdAt || (existing && existing.createdAt) || nowIso,
      updatedAt: o.updatedAt || (existing && existing.updatedAt) || o.createdAt || nowIso
    });
  }

  const tripRecords = [];
  for (const t of (data.trips || [])) {
    const existing = mergeMode && t.id ? await db.get('trips', t.id) : null;
    tripRecords.push({
      id: t.id,
      name: hasOwn(t, 'name') ? (t.name || '') : (existing ? (existing.name || '') : ''),
      startDate: hasOwn(t, 'startDate') ? (t.startDate || '') : (existing ? (existing.startDate || '') : ''),
      endDate: hasOwn(t, 'endDate') ? (t.endDate || '') : (existing ? (existing.endDate || '') : ''),
      notes: hasOwn(t, 'notes') ? (t.notes || '') : (existing ? (existing.notes || '') : ''),
      packing: hasOwn(t, 'packing') ? normalizePackingState(t.packing) : (existing ? normalizePackingState(existing.packing) : normalizePackingState()),
      createdAt: t.createdAt || (existing && existing.createdAt) || nowIso,
      updatedAt: t.updatedAt || (existing && existing.updatedAt) || t.createdAt || nowIso
    });
  }

  const dayPlanRecords = [];
  for (const d of (data.dayPlans || [])) {
    const canonicalId = dayPlanId(d);
    const existing = mergeMode && canonicalId ? await db.get('dayPlans', canonicalId) : null;
    dayPlanRecords.push(normalizeDayPlanRecord({ ...d, id: canonicalId }, existing));
  }

  const tx = db.transaction(['items', 'outfits', 'trips', 'dayPlans'], 'readwrite');
  const sItems = tx.objectStore('items');
  const sOutfits = tx.objectStore('outfits');
  const sTrips = tx.objectStore('trips');
  const sDays = tx.objectStore('dayPlans');

  if (mode === 'replace') {
    sItems.clear();
    sOutfits.clear();
    sTrips.clear();
    sDays.clear();
  }
  for (const rec of itemRecords) sItems.put(rec);
  for (const o of outfitRecords) sOutfits.put(o);
  for (const t of tripRecords) sTrips.put(t);
  for (const d of dayPlanRecords) sDays.put(d);
  await tx.done;
  return {
    items: (data.items || []).length,
    outfits: (data.outfits || []).length,
    trips: (data.trips || []).length,
    dayPlans: (data.dayPlans || []).length
  };
}
