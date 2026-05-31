export const TAG_LIMITS = {
  maxTags: 20,
  maxLength: 32,
  maxQueryLength: 80
};

const CATEGORY_VALUES = new Set(['all', 'top', 'pant', 'shoes', 'accessory', 'other', 'tobuy']);

function normalizeText(value) {
  const text = String(value || '');
  return (text.normalize ? text.normalize('NFKC') : text)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim() || '';
}

export function normalizeTags(value, { maxTags = TAG_LIMITS.maxTags, maxLength = TAG_LIMITS.maxLength } = {}) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,;\n]/);
  const tags = [];
  const seen = new Set();

  for (const entry of raw) {
    const tag = normalizeText(entry)
      .replace(/^#+/, '')
      .replace(/\s+/g, ' ')
      .slice(0, maxLength)
      .trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= maxTags) break;
  }
  return tags;
}

export function cleanSearchQuery(value, maxLength = TAG_LIMITS.maxQueryLength) {
  const text = String(value || '');
  return (text.normalize ? text.normalize('NFKC') : text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function searchTokens(query) {
  const q = normalizeText(cleanSearchQuery(query));
  return q ? q.split(' ') : [];
}

function includesAllTokens(fields, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const haystack = fields.map(normalizeText).filter(Boolean).join(' ');
  return tokens.every(token => haystack.includes(token));
}

export function availableTags(items = []) {
  const seen = new Set();
  for (const item of items || []) {
    normalizeTags(item && item.tags).forEach(tag => seen.add(tag));
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function itemHasTag(item, tag) {
  const normalized = normalizeTags([tag])[0] || '';
  if (!normalized) return true;
  return normalizeTags(item && item.tags).includes(normalized);
}

export function itemMatchesQuery(item, query) {
  if (!item) return false;
  return includesAllTokens([
    item.name,
    item.category,
    item.subcategory,
    item.description,
    ...normalizeTags(item.tags)
  ], query);
}

export function normalizeItemFilter(value) {
  return CATEGORY_VALUES.has(value) ? value : 'all';
}

export function filterItems(items = [], { filter = 'all', q = '', tag = '' } = {}) {
  const activeFilter = normalizeItemFilter(filter);
  const activeTag = normalizeTags([tag])[0] || '';
  return (items || []).filter(item => {
    if (activeFilter === 'tobuy' && item.owned) return false;
    if (activeFilter !== 'all' && activeFilter !== 'tobuy' && item.category !== activeFilter) return false;
    if (activeTag && !itemHasTag(item, activeTag)) return false;
    return itemMatchesQuery(item, q);
  });
}

function outfitItemFields(outfit, itemsById) {
  const ids = [
    outfit?.topId,
    outfit?.pantId,
    outfit?.shoesId,
    ...(outfit?.accessoryIds || []),
    ...(outfit?.otherIds || [])
  ].filter(Boolean);

  const fields = [];
  ids.forEach(id => {
    const item = itemsById instanceof Map ? itemsById.get(id) : null;
    if (!item) return;
    fields.push(item.name, item.subcategory, ...normalizeTags(item.tags));
  });
  return fields;
}

export function outfitMatchesQuery(outfit, itemsById, query) {
  if (!outfit) return false;
  return includesAllTokens([
    outfit.name,
    outfit.notes,
    ...outfitItemFields(outfit, itemsById)
  ], query);
}
