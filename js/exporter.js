import { getDb } from './db.js';

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
    trips: tripsList,
    dayPlans: daysList
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

  // Pre-resolve image blobs BEFORE starting the transaction —
  // IndexedDB transactions auto-close on the next microtask after the last
  // pending request resolves, so awaiting fetch() inside the tx breaks it.
  const itemRecords = [];
  for (const raw of (data.items || [])) {
    const imageBlob = raw.image ? await base64ToBlob(raw.image) : null;
    itemRecords.push({
      id: raw.id,
      name: raw.name || '',
      category: raw.category || 'top',
      subcategory: raw.subcategory || '',
      description: raw.description || '',
      purchaseUrl: raw.purchaseUrl || '',
      imageBlob,
      owned: raw.owned ? 1 : 0,
      createdAt: raw.createdAt || nowIso,
      updatedAt: raw.updatedAt || raw.createdAt || nowIso
    });
  }

  const db = await getDb();
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
  for (const o of (data.outfits || [])) {
    sOutfits.put({
      id: o.id,
      name: o.name || '',
      topId: o.topId ?? null,
      pantId: o.pantId ?? null,
      shoesId: o.shoesId ?? null,
      accessoryIds: Array.isArray(o.accessoryIds) ? o.accessoryIds : [],
      otherIds: Array.isArray(o.otherIds) ? o.otherIds : [],
      notes: o.notes || '',
      aiGenerated: !!o.aiGenerated,
      aiPrompt: o.aiPrompt || '',
      aiRationale: o.aiRationale || '',
      createdAt: o.createdAt || nowIso,
      updatedAt: o.updatedAt || o.createdAt || nowIso
    });
  }
  for (const t of (data.trips || [])) {
    sTrips.put({
      id: t.id,
      name: t.name || '',
      startDate: t.startDate || '',
      endDate: t.endDate || '',
      notes: t.notes || '',
      createdAt: t.createdAt || nowIso,
      updatedAt: t.updatedAt || t.createdAt || nowIso
    });
  }
  for (const d of (data.dayPlans || [])) {
    // Backward-compat: convert legacy `outfitId` to `outfitIds[]`
    const outfitIds = Array.isArray(d.outfitIds)
      ? d.outfitIds.filter(Boolean)
      : (d.outfitId ? [d.outfitId] : []);
    sDays.put({
      id: d.id || `${d.tripId}_${d.date}`,
      tripId: d.tripId,
      date: d.date,
      outfitIds,
      notes: d.notes || ''
    });
  }
  await tx.done;
  return {
    items: (data.items || []).length,
    outfits: (data.outfits || []).length,
    trips: (data.trips || []).length,
    dayPlans: (data.dayPlans || []).length
  };
}
