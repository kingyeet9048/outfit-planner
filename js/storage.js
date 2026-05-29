// Storage persistence / eviction-protection helpers.
//
// WebKit (iOS Safari/Brave) evicts all script-writable storage — IndexedDB,
// localStorage, Cache API — after 7 days of not opening a site that lives in a
// browser tab. Two things exempt a site from that clock:
//   1. Being installed to the Home Screen (runs in "standalone" display mode).
//   2. The browser granting persistent storage via navigator.storage.persist().
// Installed PWAs are granted persistence automatically; a plain browser tab on
// iOS generally is not. So "protected" === installed OR persisted.

// True when the app is launched from the Home Screen (installed PWA) rather
// than a browser tab.
export function isStandalone() {
  try {
    if (typeof window !== 'undefined' && window.matchMedia &&
        window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {}
  // Legacy iOS Safari/Brave flag (predates display-mode media query support).
  return typeof navigator !== 'undefined' && navigator.standalone === true;
}

// Whether the browser has already marked our storage persistent.
export async function isPersisted() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persisted) {
    try { return await navigator.storage.persisted(); } catch {}
  }
  return false;
}

// Ask the browser to mark storage persistent. Safe to call repeatedly — it is a
// no-op once granted. Returns the resulting persisted state (boolean).
export async function requestPersistence() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch {}
  }
  return false;
}

// Data is safe from the 7-day eviction when the app is installed OR the browser
// has granted persistent storage.
export async function isStorageProtected() {
  if (isStandalone()) return true;
  return await isPersisted();
}

// Best-effort platform sniff so install instructions match the user's device.
// Not security-sensitive — only used to show the right "Add to Home Screen" copy.
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports as desktop Safari but is a touch device.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
