// PWA update flow.
//
// The problem this solves: an installed iOS PWA is "sticky" — the old cached
// code keeps running, iOS rarely checks for a new service worker on resume,
// and there's no address bar to force a reload. So we:
//   1. Actively check for a new version — on launch, periodically, on resume,
//      and whenever connectivity returns (update() is a no-op when offline).
//   2. When a new worker has installed and is waiting, show a one-tap
//      "Reload to update" banner (the refresh affordance standalone PWAs lack).
//   3. On tap, tell the waiting worker to take over and reload once it does.

import { el } from './ui.js';

export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// A waiting worker should only prompt when it's a genuine update — i.e. it has
// finished installing AND there's already a controller (so it's replacing a
// running version, not the very first install).
export function shouldPromptUpdate(workerState, hasController) {
  return workerState === 'installed' && !!hasController;
}

// Persistent (non-auto-dismiss) banner with a Reload action.
export function showUpdateBanner(onReload) {
  dismissUpdateBanner();
  const banner = el('div', { id: 'update-banner', class: 'update-banner', role: 'status', 'aria-live': 'polite' }, [
    el('span', { class: 'update-banner-icon', 'aria-hidden': 'true' }, '⬆️'),
    el('span', { class: 'update-banner-text' }, 'A new version is available.'),
    el('button', { type: 'button', class: 'update-reload-btn', onClick: () => onReload && onReload() }, 'Reload'),
    el('button', { type: 'button', class: 'update-dismiss', 'aria-label': 'Dismiss', onClick: dismissUpdateBanner }, '×')
  ]);
  document.body.appendChild(banner);
  return banner;
}

export function dismissUpdateBanner() {
  document.getElementById('update-banner')?.remove();
}

// Manual "check now" — triggered from Settings. Fetches a fresh service worker;
// if one is waiting, surfaces the reload banner. Returns a small status object.
export async function checkForUpdates() {
  if (!('serviceWorker' in navigator)) return { ok: false, reason: 'unsupported' };
  let reg;
  try { reg = await navigator.serviceWorker.getRegistration(); } catch { reg = null; }
  if (!reg) return { ok: false, reason: 'no-registration' };
  try { await reg.update(); } catch { /* offline / transient */ }
  if (reg.waiting && navigator.serviceWorker.controller) {
    showUpdateBanner(() => reg.waiting.postMessage({ type: 'SKIP_WAITING' }));
    return { ok: true, updateAvailable: true };
  }
  return { ok: true, updateAvailable: false };
}

// Nuclear "hard refresh" — for when the app is wedged on a stale version.
// Clears the Cache Storage (NOT IndexedDB, so user data is untouched) and
// reloads, forcing a fresh fetch of everything. Safe to call anytime.
export async function forceRefresh() {
  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch { /* ignore — still reload */ }
  window.location.reload();
}

// Wire up registration + update detection + periodic checks. Call once on boot.
export function setupUpdates({ checkIntervalMs = UPDATE_CHECK_INTERVAL_MS } = {}) {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  // Whether the page was already controlled when we started. Guards against an
  // unwanted reload when the very first service worker claims the page.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    window.location.reload();
  });

  const promptFor = (worker) => {
    if (worker) showUpdateBanner(() => worker.postMessage({ type: 'SKIP_WAITING' }));
  };

  const wireRegistration = (reg) => {
    // A new version may already be waiting (installed while the app was closed).
    if (reg.waiting && navigator.serviceWorker.controller) promptFor(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (shouldPromptUpdate(nw.state, navigator.serviceWorker.controller)) promptFor(nw);
      });
    });

    // Pull the latest: now, on an interval, on resume, and on reconnect.
    // update() quietly does nothing when offline or when nothing changed.
    const check = () => { if (navigator.onLine !== false) reg.update().catch(() => {}); };
    check();
    if (checkIntervalMs > 0) setInterval(check, checkIntervalMs);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    window.addEventListener('online', check);
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(wireRegistration)
      .catch((err) => console.warn('SW registration failed', err));
  });
}
