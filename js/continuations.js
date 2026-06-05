const ITEM_KEY = 'outfit-planner:create-item-continuation';
const OUTFIT_KEY = 'outfit-planner:create-outfit-continuation';
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function nowMs() {
  return Date.now();
}

function read(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!value || typeof value !== 'object') return null;
    if (value.createdAt && nowMs() - value.createdAt > MAX_AGE_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...value, createdAt: nowMs() }));
  } catch {}
}

function clear(key) {
  try { sessionStorage.removeItem(key); } catch {}
}

function currentHash() {
  return location.hash || '#/';
}

function sameHash(a, b) {
  return String(a || '').split('?')[0] === String(b || '').split('?')[0];
}

export function startItemCreateContinuation({ returnHash = currentHash(), draft, target, defaultCategory = 'top' } = {}) {
  write(ITEM_KEY, {
    kind: 'item-for-outfit',
    returnHash,
    draft: draft || null,
    target: target || null,
    defaultCategory
  });
}

export function peekItemCreateContinuation() {
  return read(ITEM_KEY);
}

export function completeItemCreateContinuation(itemId) {
  const pending = read(ITEM_KEY);
  if (!pending) return null;
  const next = { ...pending, itemId };
  write(ITEM_KEY, next);
  return next;
}

export function takeItemCreateContinuationFor(hash = currentHash()) {
  const pending = read(ITEM_KEY);
  if (!pending || !sameHash(pending.returnHash, hash)) return null;
  clear(ITEM_KEY);
  return pending;
}

export function returnToItemCreateContinuation() {
  const pending = read(ITEM_KEY);
  if (!pending) return null;
  write(ITEM_KEY, { ...pending, canceled: true });
  return pending.returnHash || null;
}

export function clearItemCreateContinuation() {
  clear(ITEM_KEY);
}

export function startOutfitCreateContinuation({ returnHash = currentHash(), tripId, date, mode = 'add', index = null } = {}) {
  write(OUTFIT_KEY, {
    kind: 'outfit-for-trip',
    returnHash,
    tripId,
    date,
    mode,
    index
  });
}

export function peekOutfitCreateContinuation() {
  return read(OUTFIT_KEY);
}

export function takeOutfitCreateContinuation() {
  const pending = read(OUTFIT_KEY);
  if (pending) clear(OUTFIT_KEY);
  return pending;
}

export function clearOutfitCreateContinuation() {
  clear(OUTFIT_KEY);
}
