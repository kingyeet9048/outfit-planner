export const ACTIVATION_LOG_KEY = 'outfit-planner:activationEvents';

const SESSION_ONCE_PREFIX = 'outfit-planner:activationOnce:';
const MAX_EVENTS = 120;
const SAFE_KEYS = new Set([
  'assignedDayCount',
  'category',
  'dayPlanCount',
  'dayPlans',
  'demoCreated',
  'flow',
  'hasComment',
  'itemCount',
  'items',
  'method',
  'outfitCount',
  'outfits',
  'owned',
  'rating',
  'result',
  'route',
  'source',
  'standalone',
  'storageProtected',
  'toBuyCount',
  'tripCount',
  'trips',
  'slotCount'
]);

export function normalizeRoute(value = '') {
  let raw = String(value || (typeof location !== 'undefined' ? location.hash : '') || '#/');
  if (raw.startsWith('#')) raw = raw.slice(1);
  if (!raw.startsWith('/')) raw = '/' + raw;
  raw = raw.split('?')[0].split('#')[0] || '/';
  return raw.replace(/\/(trip|item|outfit)\/(?!new(?:\/|$))[^/?#]+/g, (_match, type) => `/${type}/:id`);
}

export function sanitizeActivationData(input = {}) {
  const out = {};
  const src = input && typeof input === 'object' ? input : {};
  Object.entries(src).forEach(([key, value]) => {
    if (key === 'counts' && value && typeof value === 'object') {
      ['items', 'outfits', 'trips', 'dayPlans'].forEach(countKey => {
        const n = safeNumber(value[countKey]);
        if (n != null) out[countKey] = n;
      });
      return;
    }
    if (!SAFE_KEYS.has(key)) return;
    const safe = key === 'route' ? normalizeRoute(String(value || '')) : safeValue(value);
    if (safe != null) out[key] = safe;
  });
  return out;
}

export function trackActivation(name, data = {}) {
  const eventName = sanitizeEventName(name);
  if (!eventName) return null;
  const event = {
    name: eventName,
    at: new Date().toISOString(),
    route: normalizeRoute(),
    data: sanitizeActivationData(data)
  };
  appendActivationEvent(event);
  sendToUmami(event);
  return event;
}

export function trackActivationOnce(key, name, data = {}) {
  const storageKey = SESSION_ONCE_PREFIX + sanitizeEventName(key || name);
  try {
    if (sessionStorage.getItem(storageKey) === '1') return null;
    sessionStorage.setItem(storageKey, '1');
  } catch {}
  return trackActivation(name, data);
}

export function getActivationEvents() {
  return readJson(ACTIVATION_LOG_KEY, []);
}

export function clearActivationEvents() {
  try { localStorage.removeItem(ACTIVATION_LOG_KEY); } catch {}
}

function appendActivationEvent(event) {
  const next = [...getActivationEvents(), event].slice(-MAX_EVENTS);
  try { localStorage.setItem(ACTIVATION_LOG_KEY, JSON.stringify(next)); } catch {}
}

function sanitizeEventName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function safeValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return safeNumber(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.length > 80) return null;
    return trimmed;
  }
  return null;
}

function safeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback) : parsed;
  } catch {
    return fallback;
  }
}

function sendToUmami(event) {
  try {
    if (typeof window === 'undefined' || !window.umami || typeof window.umami.track !== 'function') return;
    window.umami.track(event.name, event.data);
  } catch {}
}
