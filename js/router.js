// Hash-based router with production-grade history: per-entry scroll restoration
// and history-aware back navigation.
//
// Each history entry is tagged in history.state with a unique { navId, idx }:
//   • navId keys a saved scroll position, so returning to an entry (Back/Forward)
//     restores exactly where the user was — including which part of a long page.
//   • idx is a monotonic depth counter, so a Back control knows whether there's
//     an in-app entry to return to (history.back) or whether to fall back to a
//     logical parent (e.g. a deep link opened cold).
// Filters and other view state live in the hash query string (e.g.
// "#/items?filter=tops"), so they travel with the history entry too.

import { uuid } from './db.js';

const routes = [];

export function register(pattern, loader) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ pattern, regex, keys, loader });
}

export function match(hash) {
  // Strip leading '#' if present; ensure starts with '/'
  let path = hash || '#/';
  if (path[0] === '#') path = path.slice(1);
  if (!path || path[0] !== '/') path = '/' + path;
  // Drop query string
  const qIdx = path.indexOf('?');
  const search = qIdx >= 0 ? path.slice(qIdx + 1) : '';
  if (qIdx >= 0) path = path.slice(0, qIdx);
  // Normalize trailing slash (except for root)
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params, search };
    }
  }
  return null;
}

let currentCleanup = null;
let currentRouteHandler = null;

export function setRouteChangeHandler(fn) { currentRouteHandler = fn; }

// ---------- History / scroll state ----------

const scrollPositions = new Map(); // navId -> scrollY
let lastNavId = null;              // entry we're currently on (the one we'll leave next)
let lastIdx = -1;                  // depth of the current entry

function scrollY() {
  return window.scrollY || document.documentElement.scrollTop || 0;
}

// Decide on the scroll restoration helper (the document scrolls in this layout).
function restoreScroll(y) {
  // Apply across a couple of frames so it sticks once the new view has laid out.
  requestAnimationFrame(() => {
    window.scrollTo(0, y);
    requestAnimationFrame(() => window.scrollTo(0, y));
  });
}

// Ensure the current history entry carries our { navId, idx } metadata. A fresh
// push (no state, or pre-existing state without a navId) gets the next idx.
function currentMeta() {
  const st = history.state;
  if (st && st.navId != null && typeof st.idx === 'number') return st;
  const meta = { ...(st || {}), navId: uuid(), idx: lastIdx + 1 };
  try { history.replaceState(meta, ''); } catch {}
  return meta;
}

// Is there an in-app entry to go back to? (idx 0 is the first entry of the session.)
export function canGoBack() {
  const st = history.state;
  return !!(st && typeof st.idx === 'number' && st.idx > 0);
}

// History-aware back: return to the exact previous in-app entry if there is one,
// otherwise navigate to a sensible fallback parent (for cold deep links).
export function back(fallback = '#/') {
  if (canGoBack()) history.back();
  else go(fallback);
}

export async function go(hash) {
  if (location.hash === hash) {
    await resolve();
  } else {
    location.hash = hash;
  }
}

// Replace the current entry (no new history) and re-render — used for view state
// changes like filter toggles that shouldn't add a Back step.
export async function replace(hash) {
  const meta = currentMeta(); // keep this entry's navId/idx
  const target = hash[0] === '#' ? hash : '#' + hash;
  try { history.replaceState(meta, '', target); } catch { location.hash = target; }
  await resolve();
}

export async function resolve() {
  // Save the outgoing entry's scroll before we tear it down.
  if (lastNavId != null) scrollPositions.set(lastNavId, scrollY());

  if (currentCleanup) {
    try { currentCleanup(); } catch (e) { console.error(e); }
    currentCleanup = null;
  }
  const root = document.getElementById('view-root');
  if (!root) return;

  const meta = currentMeta();
  lastIdx = meta.idx;
  const navId = meta.navId;
  // Saved position if we've been here before (Back/Forward); else top.
  const targetY = scrollPositions.has(navId) ? scrollPositions.get(navId) : 0;

  const m = match(location.hash);
  if (!m) {
    root.innerHTML = '<div class="state"><div class="state-icon">🤔</div><h3>Page not found</h3><p>The page you’re looking for doesn’t exist.</p><a class="btn btn-primary" href="#/">Go home</a></div>';
    if (currentRouteHandler) currentRouteHandler({ path: location.hash });
    lastNavId = navId;
    restoreScroll(targetY);
    return;
  }
  try {
    const result = await m.route.loader(m.params, m.search);
    if (result && typeof result === 'object') {
      if (result.node) {
        root.replaceChildren(result.node);
      }
      if (typeof result.cleanup === 'function') currentCleanup = result.cleanup;
    }
    if (currentRouteHandler) currentRouteHandler({ path: location.hash, pattern: m.route.pattern });
    lastNavId = navId;
    restoreScroll(targetY);
  } catch (err) {
    console.error('Route error', err);
    const msg = document.createElement('div');
    msg.className = 'state';
    msg.innerHTML = '<div class="state-icon">⚠️</div><h3>Something went wrong</h3><p>' + (err && err.message ? err.message : 'Unknown error') + '</p>';
    root.replaceChildren(msg);
    lastNavId = navId;
  }
}

export function start() {
  // We manage scroll ourselves; stop the browser from fighting us.
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch {}
  window.addEventListener('hashchange', resolve);
  if (!location.hash) location.hash = '#/';
  else resolve();
}
