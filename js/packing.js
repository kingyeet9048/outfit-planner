import { uuid } from './db.js';
import { CATEGORY_ORDER } from './categories.js';

function itemIds(outfit) {
  if (!outfit) return [];
  return [
    outfit.topId,
    outfit.pantId,
    outfit.shoesId,
    ...(outfit.accessoryIds || []),
    ...(outfit.otherIds || [])
  ].filter(Boolean);
}

function normalizeCustomItem(item, index = 0) {
  const label = String(item?.label || item?.name || '').trim().slice(0, 80);
  if (!label) return null;
  return {
    id: String(item?.id || `custom-${index + 1}`).trim() || `custom-${index + 1}`,
    label,
    checked: !!(item.checked || item.packed),
    createdAt: item.createdAt || item.nowIso || '',
    updatedAt: item.updatedAt || ''
  };
}

function uniqueCustomId(id, usedIds, index) {
  const base = String(id || `custom-${index + 1}`).trim() || `custom-${index + 1}`;
  let candidate = base;
  let counter = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter++;
  }
  usedIds.add(candidate);
  return candidate;
}

export function normalizePackingState(input = {}) {
  const checkedItemIds = Array.isArray(input?.checkedItemIds)
    ? [...new Set(input.checkedItemIds.map(id => String(id || '').trim()).filter(Boolean))]
    : [];
  const usedCustomIds = new Set();
  const customItems = [];
  if (Array.isArray(input?.customItems)) {
    input.customItems.forEach((item, index) => {
      const normalized = normalizeCustomItem(item, index);
      if (!normalized) return;
      normalized.id = uniqueCustomId(normalized.id, usedCustomIds, index);
      customItems.push(normalized);
    });
  }
  return {
    checkedItemIds,
    customItems
  };
}

export const normalizePacking = normalizePackingState;

function formatUseLabel(dateIso) {
  const [y, m, d] = String(dateIso || '').split('-').map(Number);
  if (!y || !m || !d) return dateIso || '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][dt.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()];
  return `${weekday} ${month} ${dt.getUTCDate()}`;
}

function categorySort(a, b) {
  const ia = CATEGORY_ORDER.indexOf(a.item?.category || a.category || 'other');
  const ib = CATEGORY_ORDER.indexOf(b.item?.category || b.category || 'other');
  if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return (a.item?.name || a.custom?.label || '').localeCompare(b.item?.name || b.custom?.label || '', undefined, { sensitivity: 'base' });
}

function getById(collection, id) {
  if (!collection || !id) return undefined;
  if (collection instanceof Map) return collection.get(id);
  if (Array.isArray(collection)) return collection.find(entry => entry?.id === id);
  if (typeof collection.get === 'function') return collection.get(id);
  return collection[id];
}

export function deriveTripPacking({ plans = [], outfitsById = new Map(), itemsById = new Map(), packing = {} } = {}) {
  const state = normalizePackingState(packing);
  const checkedSet = new Set(state.checkedItemIds);
  const usesByItem = new Map();

  for (const plan of plans || []) {
    for (const outfitId of (plan.outfitIds || (plan.outfitId ? [plan.outfitId] : []))) {
      const outfit = getById(outfitsById, outfitId);
      if (!outfit) continue;
      for (const itemId of itemIds(outfit)) {
        const item = getById(itemsById, itemId);
        if (!item) continue;
        if (!usesByItem.has(itemId)) usesByItem.set(itemId, []);
        usesByItem.get(itemId).push({
          date: plan.date,
          label: formatUseLabel(plan.date),
          outfitId,
          outfitName: outfit.name || 'Untitled'
        });
      }
    }
  }

  const itemRows = [...usesByItem.entries()].map(([itemId, uses]) => {
    const item = getById(itemsById, itemId);
    const owned = item.owned !== false && item.owned !== 0;
    return {
      type: 'item',
      item,
      uses: uses.sort((a, b) => String(a.date).localeCompare(String(b.date))),
      checked: owned && checkedSet.has(itemId),
      packable: owned
    };
  }).sort(categorySort);

  const packableItems = itemRows.filter(row => row.packable);
  const toBuyItems = itemRows.filter(row => !row.packable).map(row => row.item);
  const customItems = state.customItems.map(custom => ({
    type: 'custom',
    custom,
    checked: !!custom.checked,
    packable: true
  }));
  const checkedCount = packableItems.filter(row => row.checked).length + customItems.filter(row => row.checked).length;
  const totalCount = packableItems.length + customItems.length;

  return {
    itemRows,
    ownedItems: packableItems.map(row => row.item),
    packableItems,
    toBuyItems,
    customItems,
    checkedCount,
    totalCount,
    progress: totalCount ? checkedCount / totalCount : 0
  };
}

export function derivePackingList(args = {}) {
  const summary = deriveTripPacking(args);
  return {
    clothing: summary.itemRows,
    custom: summary.customItems,
    toBuy: summary.toBuyItems,
    packable: [...summary.packableItems, ...summary.customItems],
    packedCount: summary.checkedCount,
    totalCount: summary.totalCount,
    groups: []
  };
}

export function setPackingItemChecked(packing, itemId, checked) {
  const next = normalizePackingState(packing);
  const id = String(itemId || '').trim();
  if (!id) return next;
  const ids = new Set(next.checkedItemIds);
  if (checked) ids.add(id);
  else ids.delete(id);
  next.checkedItemIds = [...ids];
  return next;
}

export function setCustomPackingItemChecked(packing, id, checked, nowIso = new Date().toISOString()) {
  const next = normalizePackingState(packing);
  next.customItems = next.customItems.map(item => item.id === id ? { ...item, checked: !!checked, updatedAt: nowIso } : item);
  return next;
}

export function addCustomPackingItem(packing, input) {
  const next = normalizePackingState(packing);
  const custom = normalizeCustomItem(typeof input === 'string' ? { id: uuid(), label: input, nowIso: new Date().toISOString() } : input, next.customItems.length);
  if (!custom) return next;
  next.customItems.push(custom);
  return normalizePackingState(next);
}

export function removeCustomPackingItem(packing, id) {
  const next = normalizePackingState(packing);
  next.customItems = next.customItems.filter(item => item.id !== id);
  return next;
}

export function setPacked(packing, row, packed) {
  if (row?.type === 'custom') return setCustomPackingItemChecked(packing, row.id || row.custom?.id, packed);
  return setPackingItemChecked(packing, row?.id || row?.item?.id, packed);
}
