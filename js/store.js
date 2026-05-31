import { getDb, uuid } from './db.js';
import { dedupeIds, nextCopyName } from './reuse.js';
import { normalizeTags } from './search.js';
import { normalizePackingState } from './packing.js';

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
      tags: 'tags' in input ? normalizeTags(input.tags) : normalizeTags(existing?.tags),
      imageBlob,
      // Store as 0/1 so it can be indexed (IDB indices don't support boolean)
      owned: 'owned' in input
        ? (input.owned === false || input.owned === 0 ? 0 : 1)
        : (existing ? (existing.owned ? 1 : 0) : 1),
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
  async duplicate(id, overrides = {}) {
    const db = await getDb();
    const source = await db.get('outfits', id);
    if (!source) throw new Error('Outfit not found');
    const all = await db.getAll('outfits');
    return outfits.put({
      name: overrides.name || nextCopyName(source.name || 'Untitled outfit', all.map(o => o.name)),
      topId: source.topId ?? null,
      pantId: source.pantId ?? null,
      shoesId: source.shoesId ?? null,
      accessoryIds: Array.isArray(source.accessoryIds) ? source.accessoryIds.slice() : [],
      otherIds: Array.isArray(source.otherIds) ? source.otherIds.slice() : [],
      notes: source.notes || '',
      aiGenerated: !!source.aiGenerated,
      aiPrompt: source.aiPrompt || '',
      aiRationale: source.aiRationale || ''
    });
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
    list.forEach(t => { t.packing = normalizePackingState(t.packing); });
    return list.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  },
  async get(id) {
    const db = await getDb();
    const trip = await db.get('trips', id);
    if (trip) trip.packing = normalizePackingState(trip.packing);
    return trip;
  },
  async put(input) {
    const db = await getDb();
    const id = input.id || uuid();
    const existing = input.id ? await db.get('trips', input.id) : null;
    const nextName = 'name' in input ? (input.name || 'Untitled trip') : (existing ? (existing.name || 'Untitled trip') : 'Untitled trip');
    const nextStartDate = 'startDate' in input ? (input.startDate || '') : (existing ? (existing.startDate || '') : '');
    const nextEndDate = 'endDate' in input ? (input.endDate || '') : (existing ? (existing.endDate || '') : '');
    if (nextStartDate && nextEndDate && nextEndDate < nextStartDate) {
      throw new Error('End date must be on or after start date');
    }
    const trip = {
      id,
      name: nextName,
      startDate: nextStartDate,
      endDate: nextEndDate,
      notes: 'notes' in input ? (input.notes || '') : (existing ? (existing.notes || '') : ''),
      packing: normalizePackingState('packing' in input ? input.packing : (existing && existing.packing)),
      createdAt: existing ? existing.createdAt : (input.createdAt || nowIso()),
      updatedAt: nowIso()
    };
    await db.put('trips', trip);
    return trip;
  },
  async setPacking(id, packing) {
    const db = await getDb();
    const trip = await db.get('trips', id);
    if (!trip) return null;
    trip.packing = normalizePackingState(packing);
    trip.updatedAt = nowIso();
    await db.put('trips', trip);
    return trip.packing;
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
  const outfitIds = Array.isArray(dp.outfitIds)
    ? dp.outfitIds
    : (dp.outfitId ? [dp.outfitId] : []);
  dp.outfitIds = dedupeIds(outfitIds);
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
      outfitIds: Array.isArray(outfitIds) ? dedupeIds(outfitIds) : [],
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

// ---------- Retailer grouping (shopping list "where to buy") ----------

// Some purchase links are shorteners / alternate domains that don't reveal the
// real store. We can't follow redirects offline, so fold known ones into their
// retailer here. Keyed by registrable domain.
const DOMAIN_ALIASES = {
  'amzn.to': { key: 'amazon.com', label: 'Amazon' },  // Amazon link shortener
  'a.co': { key: 'amazon.com', label: 'Amazon' }       // Amazon short links
};

// Nicer display names for common stores; otherwise we Title-case the domain.
const KNOWN_RETAILERS = {
  amazon: 'Amazon', walmart: 'Walmart', target: 'Target', bestbuy: 'Best Buy',
  ebay: 'eBay', etsy: 'Etsy', nike: 'Nike', adidas: 'Adidas', zara: 'Zara',
  hm: 'H&M', uniqlo: 'Uniqlo', nordstrom: 'Nordstrom', macys: "Macy's",
  asos: 'ASOS', shein: 'SHEIN', aliexpress: 'AliExpress', costco: 'Costco',
  ikea: 'IKEA', gap: 'Gap', oldnavy: 'Old Navy', lululemon: 'lululemon',
  sephora: 'Sephora', ulta: 'Ulta', rei: 'REI'
};

// Registrable-domain detection needs to know common two-level public suffixes
// (e.g. amazon.co.uk → registrable "amazon.co.uk", not "co.uk").
const TWO_LEVEL_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk',
  'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in', 'co.il',
  'com.au', 'com.br', 'com.mx', 'com.tr', 'com.cn', 'com.hk', 'com.sg', 'com.tw'
]);

function titleCase(s) {
  return s.split(/[-_ ]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const NO_STORE = { key: '', label: 'No store link' };

// Derive a stable retailer { key, label } from a purchase URL. Returns a shared
// "No store link" bucket for empty / unparseable URLs.
export function retailerFromUrl(url) {
  const raw = (url || '').trim();
  if (!raw) return { ...NO_STORE };
  let host;
  try {
    host = new URL(raw).hostname;
  } catch {
    // Tolerate URLs the user typed without a scheme ("amazon.com/...").
    try { host = new URL('https://' + raw).hostname; } catch { return { ...NO_STORE }; }
  }
  if (!host) return { ...NO_STORE };
  host = host.toLowerCase().replace(/^www\./, '');
  // A real store domain has a dot and only valid hostname chars. This rejects
  // junk that the lenient scheme-prepend above can coerce into a "hostname"
  // (e.g. "not a url at all" → "not%20a%20url..."), and bare hosts like localhost.
  if (!host.includes('.') || !/^[a-z0-9.-]+$/.test(host)) return { ...NO_STORE };

  const parts = host.split('.');
  let domain, sld;
  if (parts.length >= 3 && TWO_LEVEL_TLDS.has(parts.slice(-2).join('.'))) {
    domain = parts.slice(-3).join('.');
    sld = parts[parts.length - 3];
  } else if (parts.length >= 2) {
    domain = parts.slice(-2).join('.');
    sld = parts[parts.length - 2];
  } else {
    domain = host;
    sld = parts[0];
  }

  if (DOMAIN_ALIASES[domain]) return { ...DOMAIN_ALIASES[domain] };
  return { key: domain, label: KNOWN_RETAILERS[sld] || titleCase(sld) };
}

// Group shopping-list items by retailer. Returns ordered groups
// [{ key, label, items }] sorted alphabetically by label, with the
// "No store link" bucket always last; items within a group sorted by name.
export function groupShoppingByRetailer(itemsArr) {
  const groups = new Map();
  for (const it of (itemsArr || [])) {
    const { key, label } = retailerFromUrl(it.purchaseUrl);
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key).items.push(it);
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.items.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  }
  out.sort((a, b) => {
    if (a.key === '' ) return 1;   // ungrouped bucket last
    if (b.key === '' ) return -1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  return out;
}
