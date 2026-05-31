import { register, start, setRouteChangeHandler } from './router.js';
import { renderNav } from './components/nav.js';
import { releaseAll } from './image.js';
import { toast } from './ui.js';
import { requestPersistence } from './storage.js';
import { refreshStorageBanner } from './components/storage-banner.js';
import { runBackupPrompts } from './components/backup-prompts.js';
import { setupUpdates } from './update.js';

// ---- Register routes ----
register('/', () => import('./views/trips.js').then(m => m.view({})));
register('/trips', () => import('./views/trips.js').then(m => m.view({})));
register('/trip/:id/packing', (p) => import('./views/trip-packing.js').then(m => m.view(p)));
register('/trip/:id', (p) => import('./views/trip-detail.js').then(m => m.view(p)));
register('/outfits', () => import('./views/outfits.js').then(m => m.view({})));
register('/outfit/new', () => import('./views/outfit-editor.js').then(m => m.view({ id: 'new' })));
register('/outfit/:id/edit', (p) => import('./views/outfit-editor.js').then(m => m.view(p)));
register('/outfit/:id', (p) => import('./views/outfit-view.js').then(m => m.view(p)));
register('/items', () => import('./views/items.js').then(m => m.view({})));
register('/item/new', () => import('./views/item-editor.js').then(m => m.view({ id: 'new' })));
register('/item/:id/edit', (p) => import('./views/item-editor.js').then(m => m.view(p)));
register('/item/:id', (p) => import('./views/item-view.js').then(m => m.view(p)));
register('/stylist', () => import('./views/stylist.js').then(m => m.view({})));
register('/settings', () => import('./views/settings.js').then(m => m.view({})));

setRouteChangeHandler(({ path }) => {
  renderNav(path);
  // Keep the eviction-warning bar in sync on every navigation (cheap, and the
  // protection state can change while the app is open).
  refreshStorageBanner();
});

// ---- Boot ----
function boot() {
  // Initial nav render before first route resolves
  renderNav(location.hash || '#/');

  // Eviction protection (Tier 1): ask the browser to keep our storage, then
  // show / hide the warning bar based on whether we're actually protected.
  requestPersistence().finally(refreshStorageBanner);
  // Re-check when the app regains focus or its install state changes — e.g. the
  // user just added it to the Home Screen and came back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshStorageBanner();
  });
  try {
    window.matchMedia('(display-mode: standalone)').addEventListener('change', refreshStorageBanner);
  } catch {}

  // Backup prompts (Tier 2): restore-on-blank, or the 24h backup reminder.
  // Deferred so the first view paints first.
  setTimeout(() => { runBackupPrompts().catch(() => {}); }, 800);

  // Topbar scroll shadow
  const topbar = document.getElementById('topbar');
  const main = document.getElementById('view-root');
  if (main && topbar) {
    main.addEventListener('scroll', () => {
      topbar.classList.toggle('scrolled', main.scrollTop > 0);
    });
    // also listen on window for cases where the main grows tall
    window.addEventListener('scroll', () => {
      topbar.classList.toggle('scrolled', (window.scrollY || document.documentElement.scrollTop) > 0);
    });
  }

  // Sidebar quick-export hook
  document.querySelectorAll('[data-action="quick-export"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { downloadExport } = await import('./exporter.js');
      try {
        await downloadExport();
        toast('Export downloaded', { kind: 'success' });
      } catch (err) {
        toast('Export failed: ' + err.message, { kind: 'danger' });
      }
    });
  });

  // Keyboard shortcuts (desktop)
  document.addEventListener('keydown', handleShortcuts);

  // Cleanup object URLs when page hides — frees memory on iOS
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // don't release while modals/views might still depend on URLs; just trust per-view cleanup
    }
  });
  window.addEventListener('pagehide', releaseAll);

  // Service worker registration + update flow (checks for new versions on
  // launch, periodically, on resume, and on reconnect; offers a one-tap reload).
  setupUpdates();

  start();
}

let gPrefix = null;
let gPrefixTimer = null;
function handleShortcuts(e) {
  // Skip when typing in an input/textarea
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      // Submit form in editor if present
      const form = document.querySelector('main#view-root form');
      if (form) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    }
    return;
  }
  const k = e.key.toLowerCase();
  if (gPrefix === 'g') {
    gPrefix = null;
    clearTimeout(gPrefixTimer);
    const map = { t: '#/trips', o: '#/outfits', i: '#/items', s: '#/settings' };
    if (map[k]) {
      e.preventDefault();
      location.hash = map[k];
    }
    return;
  }
  if (k === 'g') {
    gPrefix = 'g';
    clearTimeout(gPrefixTimer);
    gPrefixTimer = setTimeout(() => { gPrefix = null; }, 800);
    return;
  }
  if (k === 'n') {
    // Context-aware "new"
    const h = location.hash;
    if (h.startsWith('#/items')) { e.preventDefault(); location.hash = '#/item/new'; return; }
    if (h.startsWith('#/outfits')) { e.preventDefault(); location.hash = '#/outfit/new'; return; }
    if (h === '#/' || h.startsWith('#/trips')) {
      // open trips list new-trip flow: simplest is to navigate to /trips so the user can hit + (already a route)
      // but we'll dispatch a custom event to let trips view open the sheet
      window.dispatchEvent(new CustomEvent('open-new-trip'));
      return;
    }
  }
  if (k === 'escape') {
    // Close any open dialog
    const open = document.querySelector('dialog[open]');
    if (open && open.close) { open.close(); }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
