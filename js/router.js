// Hash-based router. Routes are registered with patterns like "#/trip/:id".
// Calling start() reads location.hash, matches, mounts the view, listens for hashchange.

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

export async function go(hash) {
  if (location.hash === hash) {
    await resolve();
  } else {
    location.hash = hash;
  }
}

export async function resolve() {
  if (currentCleanup) {
    try { currentCleanup(); } catch (e) { console.error(e); }
    currentCleanup = null;
  }
  const root = document.getElementById('view-root');
  if (!root) return;
  root.scrollTop = 0;

  const m = match(location.hash);
  if (!m) {
    root.innerHTML = '<div class="state"><div class="state-icon">🤔</div><h3>Page not found</h3><p>The page you’re looking for doesn’t exist.</p><a class="btn btn-primary" href="#/">Go home</a></div>';
    if (currentRouteHandler) currentRouteHandler({ path: location.hash });
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
  } catch (err) {
    console.error('Route error', err);
    const msg = document.createElement('div');
    msg.className = 'state';
    msg.innerHTML = '<div class="state-icon">⚠️</div><h3>Something went wrong</h3><p>' + (err && err.message ? err.message : 'Unknown error') + '</p>';
    root.replaceChildren(msg);
  }
}

export function start() {
  window.addEventListener('hashchange', resolve);
  if (!location.hash) location.hash = '#/';
  else resolve();
}
