// Backup orchestration: a single, always-overwritten backup file the user can
// restore from if WebKit ever evicts the database.
//
// The data lives only on the device, so the durable safety net is a copy that
// lives somewhere else (Files / iCloud Drive, or a folder on desktop). We keep
// exactly one file — a stable filename so re-saving to the same place REPLACES
// it instead of piling up dated copies.
//
// Platforms differ in what they allow:
//   • Desktop Chromium (showSaveFilePicker): the user picks the file ONCE, we
//     remember the handle, and every later backup silently overwrites it.
//   • iOS / Safari / Firefox (no File System Access API): there is no silent
//     file write, so we hand the file to the OS share sheet (Save to Files,
//     iCloud Drive, Mail…). Same stable filename, so saving to the same folder
//     overwrites the previous one.
//   • Last resort: a normal download.

import { buildExport, exportAsString, importFromObject } from './exporter.js';
import { getDb } from './db.js';
import { openDB } from './vendor/idb.js';

export const BACKUP_FILENAME = 'outfit-planner-backup.json';
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
export const LAST_BACKUP_KEY = 'outfit-planner:lastBackupAt';

// ---------- Pure decision helpers (unit-tested) ----------

// Whether to nudge the user to back up. We only nag when there is data worth
// protecting and it has been a full day (or never) since the last backup.
export function shouldRemindBackup({ lastBackupAt, now, hasData }) {
  if (!hasData) return false;
  if (!lastBackupAt) return true;
  const last = Date.parse(lastBackupAt);
  if (Number.isNaN(last)) return true;
  return (now - last) >= BACKUP_INTERVAL_MS;
}

// Whether a counts object represents a completely empty dataset.
export function isEmptyCounts(c) {
  if (!c) return true;
  return ((c.items | 0) + (c.outfits | 0) + (c.trips | 0) + (c.dayPlans | 0)) === 0;
}

// ---------- Last-backup timestamp ----------

export function getLastBackupAt() {
  try { return localStorage.getItem(LAST_BACKUP_KEY); } catch { return null; }
}
export function setLastBackupAt(iso) {
  try { localStorage.setItem(LAST_BACKUP_KEY, iso); } catch {}
}

// ---------- Dataset counts ----------

export async function getCounts() {
  const db = await getDb();
  const [items, outfits, trips, dayPlans] = await Promise.all([
    db.count('items'),
    db.count('outfits'),
    db.count('trips'),
    db.count('dayPlans')
  ]);
  return { items, outfits, trips, dayPlans };
}

export async function isDatabaseEmpty() {
  return isEmptyCounts(await getCounts());
}

// ---------- Capability detection ----------

export function supportsFileSystemAccess() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

export function supportsShareFile() {
  if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false;
  try {
    const probe = new File(['{}'], BACKUP_FILENAME, { type: 'application/json' });
    return navigator.canShare({ files: [probe] });
  } catch { return false; }
}

// ---------- File System Access handle persistence ----------
// Stored in a tiny dedicated DB so we never have to bump the main schema.

const META_DB = 'outfit-planner-meta';
let metaDbPromise = null;
function metaDb() {
  if (!metaDbPromise) {
    metaDbPromise = openDB(META_DB, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      }
    });
  }
  return metaDbPromise;
}

async function saveBackupHandle(handle) {
  try { const d = await metaDb(); await d.put('kv', handle, 'backupHandle'); } catch {}
}
export async function getBackupHandle() {
  try { const d = await metaDb(); return await d.get('kv', 'backupHandle'); } catch { return null; }
}
async function clearBackupHandle() {
  try { const d = await metaDb(); await d.delete('kv', 'backupHandle'); } catch {}
}

async function ensureHandlePermission(handle, { withPrompt = false } = {}) {
  if (!handle || !handle.queryPermission) return true;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (withPrompt && handle.requestPermission) {
    return (await handle.requestPermission(opts)) === 'granted';
  }
  return false;
}

// True when we have a remembered desktop file we can overwrite in one click.
export async function hasReusableDestination() {
  if (!supportsFileSystemAccess()) return false;
  const handle = await getBackupHandle();
  if (!handle) return false;
  return ensureHandlePermission(handle, { withPrompt: false });
}

// A short, human label for the current destination mode (for the UI).
export function destinationLabel() {
  if (supportsFileSystemAccess()) return 'a file you choose (overwritten each time)';
  if (supportsShareFile()) return 'Files / iCloud Drive via the Share sheet';
  return 'your downloads folder';
}

// ---------- Choosing a destination (desktop File System Access only) ----------
// On non-FSA platforms the destination is chosen at share time, so there is
// nothing to pre-select — callers should just run backupNow() instead.
export async function chooseDestination() {
  if (!supportsFileSystemAccess()) return { ok: false, reason: 'unsupported' };
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: BACKUP_FILENAME,
      types: [{ description: 'Outfit Planner backup', accept: { 'application/json': ['.json'] } }]
    });
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'error', error: err };
  }
  await saveBackupHandle(handle);
  return { ok: true, handle };
}

export async function forgetDestination() {
  await clearBackupHandle();
}

// ---------- Performing a backup ----------
// Returns { method: 'file' | 'share' | 'download' | 'cancelled' }.
// Must be called from a user gesture so the share sheet / picker is allowed.
export async function backupNow({ allowPrompt = true } = {}) {
  const json = await exportAsString();

  // 1. Desktop: overwrite the remembered file (or prompt to pick one).
  if (supportsFileSystemAccess()) {
    let handle = await getBackupHandle();
    if (handle) {
      const granted = await ensureHandlePermission(handle, { withPrompt: allowPrompt });
      if (!granted) handle = null;
    }
    if (!handle && allowPrompt) {
      const chosen = await chooseDestination();
      if (!chosen.ok) {
        if (chosen.reason === 'cancelled') return { method: 'cancelled' };
        // fall through to share/download if the picker errored
        handle = null;
      } else {
        handle = chosen.handle;
      }
    }
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(new Blob([json], { type: 'application/json' }));
      await writable.close();
      setLastBackupAt(new Date().toISOString());
      return { method: 'file' };
    }
  }

  // 2. iOS / mobile: hand the file to the OS share sheet.
  const blob = new Blob([json], { type: 'application/json' });
  const file = new File([blob], BACKUP_FILENAME, { type: 'application/json' });
  if (supportsShareFile()) {
    try {
      await navigator.share({ files: [file], title: 'Outfit Planner backup' });
      setLastBackupAt(new Date().toISOString());
      return { method: 'share' };
    } catch (err) {
      if (err && err.name === 'AbortError') return { method: 'cancelled' };
      // fall through to download
    }
  }

  // 3. Last resort: a normal download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = BACKUP_FILENAME;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300);
  setLastBackupAt(new Date().toISOString());
  return { method: 'download' };
}

// ---------- Restoring ----------

// Restore from a previously remembered desktop file handle, if we have one.
export async function restoreFromHandle({ mode = 'replace' } = {}) {
  const handle = await getBackupHandle();
  if (!handle) return { ok: false, reason: 'no-handle' };
  if (!(await ensureHandlePermission(handle, { withPrompt: true }))) {
    return { ok: false, reason: 'permission' };
  }
  const file = await handle.getFile();
  const text = await file.text();
  const data = JSON.parse(text);
  const counts = await importFromObject(data, { mode });
  return { ok: true, counts };
}

// Restore from a File the user picked (works on every platform).
export async function restoreFromFile(file, { mode = 'replace' } = {}) {
  const text = await file.text();
  const data = JSON.parse(text);
  const counts = await importFromObject(data, { mode });
  return { ok: true, counts };
}

// Re-export so callers can build a fresh export without a second import.
export { buildExport };
