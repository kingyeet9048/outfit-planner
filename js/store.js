import { getDb, uuid } from './db.js';

const nowIso = () => new Date().toISOString();

// ---------- Items ----------
export const items = {
  async all() {
    const db = await getDb();
    return db.getAll('items');
  },
  async get(id) {
    const db = await getDb();
    return db.get('items', id);
  },
  async byCategory(cat) {
    const db = await getDb();
    return db.getAllFromIndex('items', 'by_category', cat);
  },
  async byOwned(owned) {
    const db = await getDb();
    return db.getAllFromIndex('items', 'by_owned', owned ? 1 : 0);
  },
  async put(input) {
    const db = await getDb();
    const id = input.id || uuid();
    const existing = input.id ? await db.get('items', input.id) : null;

    // imageBlob handling.
    // WebKit (iOS Safari/Brave, 17+) corrupts blobs that were retrieved from
    // IndexedDB when those same blob objects are re-stored. Symptom: after
    // an update that doesn't touch the photo, reads return a lazily-loaded
    // / empty blob and the image doesn't render until the page is refreshed
    // a few times. Workaround: when we're not given a fresh blob, materialize
    // the existing one into an ArrayBuffer and wrap it in a new Blob — that
    // new Blob is detached from IDB internals and survives re-storage.
    let imageBlob;
    if ('imageBlob' in input) {
      imageBlob = input.imageBlob;
    } else if (existing && existing.imageBlob && existing.imageBlob.size > 0) {
      const buf = await existing.imageBlob.arrayBuffer();
      imageBlob = new Blob([buf], { type: existing.imageBlob.type || 'image/jpeg' });
    } else {
      imageBlob = existing ? existing.imageBlob : null;
    }

    const item = {
      id,
      name: input.name || '',
      category: input.category || 'top',
      subcategory: input.subcategory || '',
      description: input.description || '',
      purchaseUrl: input.purchaseUrl || '',
      imageBlob,
      // Store as 0/1 so it can be indexed (IDB indices don't support boolean)
      owned: input.owned === false || input.owned === 0 ? 0 : 1,
      createdAt: existing ? existing.createdAt : (input.createdAt || nowIso()),
      updatedAt: nowIso()
    };
    await db.put('items', item);
    return item;
  },
  async setOwned(id, owned) {
    const db = await getDb();
    const it = await db.get('items', id);
    if (!it) return null;
    it.owned = owned ? 1 : 0;
    it.updatedAt = nowIso();
    await db.put('items', it);
    return it;
  },
  async remove(id, { cascadeOutfits = true } = {}) {
    const db = await getDb();
    const tx = db.transaction(['items', 'outfits'], 'readwrite');
    await tx.objectStore('items').delete(id);
    if (cascadeOutfits) {
      const allOutfits = await tx.objectStore('outfits').getAll();
      for (const o of allOutfits) {
        let dirty = false;
        if (o.topId === id) { o.topId = null; dirty = true; }
        if (o.pantId === id) { o.pantId = null; dirty = true; }
        if (o.shoesId === id) { o.shoesId = null; dirty = true; }
        if (Array.isArray(o.accessoryIds) && o.accessoryIds.includes(id)) {
          o.accessoryIds = o.accessoryIds.filter(x => x !== id);
          dirty = true;
        }
        if (Array.isArray(o.otherIds) && o.otherIds.includes(id)) {
          o.otherIds = o.otherIds.filter(x => x !== id);
          dirty = true;
        }
        if (dirty) await tx.objectStore('outfits').put(o);
      }
    }
    await tx.done;
  },
  async usedByOutfits(id) {
    const db = await getDb();
    const all = await db.getAll('outfits');
    return all.filter(o => o.topId === id || o.pantId === id || o.shoesId === id || (o.accessoryIds || []).includes(id) || (o.otherIds || []).includes(id));
  }
};

// ---------- Outfits ----------
export const outfits = {
  async all() {
    const db = await getDb();
    return db.getAll('outfits');
  },
  async get(id) {
    const db = await getDb();
    return db.get('outfits', id);
  },
  async put(input) {
    const db = await getDb();
    const id = input.id || uuid();
    const existing = input.id ? await db.get('outfits', input.id) : null;
    const outfit = {
      id,
      name: input.name || 'Untitled outfit',
      topId: input.topId ?? null,
      pantId: input.pantId ?? null,
      shoesId: input.shoesId ?? null,
      accessoryIds: Array.isArray(input.accessoryIds) ? input.accessoryIds.slice() : [],
      otherIds: Array.isArray(input.otherIds) ? input.otherIds.slice() : [],
      notes: input.notes || '',
      // AI-generated tracking — preserved across updates unless explicitly cleared
      aiGenerated: 'aiGenerated' in input ? !!input.aiGenerated : !!(existing && existing.aiGenerated),
      aiPrompt: 'aiPrompt' in input ? (input.aiPrompt || '') : (existing ? (existing.aiPrompt || '') : ''),
      aiRationale: 'aiRationale' in input ? (input.aiRationale || '') : (existing ? (existing.aiRationale || '') : ''),
      createdAt: existing ? existing.createdAt : (input.createdAt || nowIso()),
      updatedAt: nowIso()
    };
    await db.put('outfits', outfit);
    return outfit;
  },
  async remove(id) {
    const db = await getDb();
    const tx = db.transaction(['outfits', 'dayPlans'], 'readwrite');
    await tx.objectStore('outfits').delete(id);
    // Remove this outfit id from any dayPlans that reference it
    const days = await tx.objectStore('dayPlans').getAll();
    for (const d of days) {
      const list = Array.isArray(d.outfitIds) ? d.outfitIds : (d.outfitId ? [d.outfitId] : []);
      if (list.includes(id)) {
        const next = list.filter(x => x !== id);
        if (next.length === 0 && !(d.notes && d.notes.trim())) {
          await tx.objectStore('dayPlans').delete(d.id);
        } else {
          d.outfitIds = next;
          delete d.outfitId;
          await tx.objectStore('dayPlans').put(d);
        }
      }
    }
    await tx.done;
  },
  itemIds(outfit) {
    if (!outfit) return [];
    return [outfit.topId, outfit.pantId, outfit.shoesId, ...(outfit.accessoryIds || []), ...(outfit.otherIds || [])].filter(Boolean);
  }
};

// ---------- Trips ----------
export const trips = {
  async all() {
    const db = await getDb();
    const list = await db.getAll('trips');
    return list.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  },
  async get(id) {
    const db = await getDb();
    return db.get('trips', id);
  },
  async put(input) {
    const db = await getDb();
    const id = input.id || uuid();
    const existing = input.id ? await db.get('trips', input.id) : null;
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      throw new Error('End date must be on or after start date');
    }
    const trip = {
      id,
      name: input.name || 'Untitled trip',
      startDate: input.startDate || '',
      endDate: input.endDate || '',
      notes: input.notes || '',
      createdAt: existing ? existing.createdAt : (input.createdAt || nowIso()),
      updatedAt: nowIso()
    };
    await db.put('trips', trip);
    return trip;
  },
  async remove(id) {
    const db = await getDb();
    const tx = db.transaction(['trips', 'dayPlans'], 'readwrite');
    await tx.objectStore('trips').delete(id);
    const days = await tx.objectStore('dayPlans').index('by_tripId').getAll(id);
    for (const d of days) {
      await tx.objectStore('dayPlans').delete(d.id);
    }
    await tx.done;
  }
};

// ---------- Day plans ----------
// A day plan holds a list of outfits assigned to a single trip day.
// Schema note: pre-v1.0.1 used a singular `outfitId`. We migrate on read.
function normalizeDayPlan(dp) {
  if (!dp) return dp;
  if (!Array.isArray(dp.outfitIds)) {
    dp.outfitIds = dp.outfitId ? [dp.outfitId] : [];
  }
  // outfitId is no longer authoritative; drop it for serialization simplicity
  delete dp.outfitId;
  return dp;
}

export const dayPlans = {
  async byTrip(tripId) {
    const db = await getDb();
    const list = await db.getAllFromIndex('dayPlans', 'by_tripId', tripId);
    return list.map(normalizeDayPlan).sort((a, b) => a.date.localeCompare(b.date));
  },
  async get(tripId, date) {
    const db = await getDb();
    return normalizeDayPlan(await db.get('dayPlans', `${tripId}_${date}`));
  },
  async setOutfits(tripId, date, outfitIds, notes) {
    const db = await getDb();
    const id = `${tripId}_${date}`;
    const existing = normalizeDayPlan(await db.get('dayPlans', id));
    const dp = {
      id, tripId, date,
      outfitIds: Array.isArray(outfitIds) ? outfitIds.filter(Boolean) : [],
      notes: notes != null ? notes : (existing ? existing.notes : '')
    };
    if (dp.outfitIds.length === 0 && !dp.notes) {
      await db.delete('dayPlans', id);
      return null;
    }
    await db.put('dayPlans', dp);
    return dp;
  },
  async addOutfit(tripId, date, outfitId) {
    const existing = await this.get(tripId, date);
    const list = (existing && existing.outfitIds) || [];
    if (outfitId && !list.includes(outfitId)) list.push(outfitId);
    return this.setOutfits(tripId, date, list, existing ? existing.notes : '');
  },
  async removeOutfit(tripId, date, outfitId) {
    const existing = await this.get(tripId, date);
    if (!existing) return null;
    const list = (existing.outfitIds || []).filter(x => x !== outfitId);
    return this.setOutfits(tripId, date, list, existing.notes);
  },
  async clear(tripId, date) {
    const db = await getDb();
    await db.delete('dayPlans', `${tripId}_${date}`);
  }
};

// ---------- Date helpers ----------
export function* iterateDates(startIso, endIso) {
  if (!startIso || !endIso) return;
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    yield iso;
  }
}

export function daysBetween(startIso, endIso) {
  return Array.from(iterateDates(startIso, endIso));
}

export function formatDayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][dt.getUTCDay()];
  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()];
  return { weekday, short: `${monthName} ${dt.getUTCDate()}`, monthName, day: dt.getUTCDate() };
}

export function formatDateRange(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const a = formatDayLabel(startIso);
  const b = formatDayLabel(endIso);
  const [ay] = startIso.split('-').map(Number);
  return `${a.short} – ${b.short}, ${ay}`;
}

// ---------- Trip aggregate helpers ----------
export async function tripShoppingList(tripId) {
  const days = await dayPlans.byTrip(tripId);
  const outfitIds = [...new Set(days.flatMap(d => d.outfitIds || []))];
  const seen = new Set();
  const need = [];
  for (const oid of outfitIds) {
    const outfit = await outfits.get(oid);
    if (!outfit) continue;
    for (const itemId of outfits.itemIds(outfit)) {
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      const it = await items.get(itemId);
      if (it && !it.owned) need.push(it);
    }
  }
  return need;
}

export async function tripStats(tripId) {
  const trip = await trips.get(tripId);
  if (!trip) return null;
  const allDays = daysBetween(trip.startDate, trip.endDate);
  const plans = await dayPlans.byTrip(tripId);
  const planned = plans.filter(p => (p.outfitIds || []).length > 0).length;
  const shopping = await tripShoppingList(tripId);
  return { totalDays: allDays.length, plannedDays: planned, toBuy: shopping.length };
}
