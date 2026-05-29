// Boot-time backup prompts:
//   • If the database is empty (e.g. eviction wiped it, or a fresh install),
//     offer to restore from a backup — once — with guidance on finding the file.
//   • Otherwise, if it's been ≥6 days since the last backup, nudge a one-tap backup.

import { el, sheet, toast } from '../ui.js';
import { isIOS } from '../storage.js';
import {
  isDatabaseEmpty, getLastBackupAt, getCounts, isEmptyCounts, shouldRemindBackup,
  backupNow, restoreFromFile, restoreFromHandle, hasReusableDestination
} from '../backup.js';

const STARTED_FRESH_KEY = 'outfit-planner:startedFresh';
const RESTORE_SHOWN_SESSION = 'outfit-planner:restorePromptShown';

// Run the right prompt for the current state. Call once after boot.
export async function runBackupPrompts() {
  let counts;
  try { counts = await getCounts(); } catch { return; }

  if (isEmptyCounts(counts)) {
    await maybePromptRestore();
    return;
  }
  await maybePromptBackupReminder(counts);
}

// ---------- Blank-app restore ----------

async function maybePromptRestore() {
  // "Ask one time": skip if the user already chose to start fresh, or we've
  // already shown it this session.
  let startedFresh = false, shownThisSession = false;
  try { startedFresh = localStorage.getItem(STARTED_FRESH_KEY) === '1'; } catch {}
  try { shownThisSession = sessionStorage.getItem(RESTORE_SHOWN_SESSION) === '1'; } catch {}
  if (startedFresh || shownThisSession) return;
  try { sessionStorage.setItem(RESTORE_SHOWN_SESSION, '1'); } catch {}

  await showRestorePrompt();
}

export async function showRestorePrompt() {
  const ios = isIOS();
  let reusable = false;
  try { reusable = await hasReusableDestination(); } catch {}

  return sheet({
    title: 'Restore your data?',
    dismissible: true,
    body: (close) => {
      const fileInput = el('input', {
        type: 'file', accept: '.json,application/json',
        style: { display: 'none' },
        onChange: async (e) => {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file) return;
          await doRestore(() => restoreFromFile(file, { mode: 'replace' }), close);
        }
      });

      return el('div', { class: 'restore-prompt' }, [
        el('p', null, 'This app has no data yet. If you’ve backed up before, you can restore everything now.'),
        ios ? el('div', { class: 'restore-hint' }, [
          el('strong', null, 'Where’s my backup on iPhone?'),
          el('ul', null, [
            el('li', null, ['Open the ', el('strong', null, 'Files'), ' app.']),
            el('li', null, ['Look in ', el('strong', null, 'iCloud Drive'), ' or ', el('strong', null, 'On My iPhone'), '.']),
            el('li', null, ['Search for ', el('strong', null, 'outfit-planner-backup'), '.']),
            el('li', null, ['If you saved it to Mail or Notes, check there too.'])
          ])
        ]) : null,
        reusable ? el('button', {
          type: 'button', class: 'btn btn-primary btn-block', style: { marginBottom: '8px' },
          onClick: () => doRestore(() => restoreFromHandle({ mode: 'replace' }), close)
        }, 'Restore from my backup file') : null,
        el('label', { class: 'btn btn-secondary btn-block', style: { cursor: 'pointer', marginBottom: '8px' } }, [
          fileInput, reusable ? 'Choose a different file…' : 'Choose backup file…'
        ]),
        el('button', {
          type: 'button', class: 'btn btn-ghost btn-block',
          onClick: () => { try { localStorage.setItem(STARTED_FRESH_KEY, '1'); } catch {} close(); }
        }, 'Start fresh')
      ]);
    }
  });
}

async function doRestore(fn, close) {
  try {
    const res = await fn();
    if (res && res.ok) {
      // They now have data — clear the "start fresh" suppression.
      try { localStorage.removeItem(STARTED_FRESH_KEY); } catch {}
      const c = res.counts || {};
      toast(`Restored ${c.items || 0} items, ${c.outfits || 0} outfits, ${c.trips || 0} trips`, { kind: 'success' });
      close();
      // Re-render the current view so restored data appears immediately.
      setTimeout(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); }, 50);
    } else if (res && res.reason === 'permission') {
      toast('Permission needed to read the backup file', { kind: 'danger' });
    }
  } catch (err) {
    toast('Restore failed: ' + (err && err.message ? err.message : 'unreadable file'), { kind: 'danger' });
  }
}

// ---------- Periodic backup reminder ----------

async function maybePromptBackupReminder(counts) {
  const hasData = !isEmptyCounts(counts);
  const lastBackupAt = getLastBackupAt();
  if (!shouldRemindBackup({ lastBackupAt, now: Date.now(), hasData })) return;
  await showBackupReminder(lastBackupAt);
}

export function showBackupReminder(lastBackupAt) {
  const when = lastBackupAt ? `Last backup: ${formatRelative(lastBackupAt)}.` : 'You haven’t backed up yet.';
  return sheet({
    title: 'Back up your data',
    body: (close) => el('div', { class: 'backup-reminder' }, [
      el('p', null, `${when} A backup is your safety net if this device’s data ever gets cleared.`),
      el('button', {
        type: 'button', class: 'btn btn-primary btn-block', style: { marginBottom: '8px' },
        onClick: async (ev) => {
          const btn = ev.currentTarget;
          btn.disabled = true; btn.textContent = 'Backing up…';
          try {
            const res = await backupNow({ allowPrompt: true });
            if (res.method === 'cancelled') { btn.disabled = false; btn.textContent = 'Back up now'; return; }
            toast('Backup saved', { kind: 'success' });
            close();
          } catch (err) {
            toast('Backup failed: ' + (err && err.message ? err.message : 'unknown error'), { kind: 'danger' });
            btn.disabled = false; btn.textContent = 'Back up now';
          }
        }
      }, 'Back up now'),
      el('button', { type: 'button', class: 'btn btn-ghost btn-block', onClick: () => close() }, 'Later')
    ])
  });
}

function formatRelative(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const diff = Date.now() - t;
  const days = Math.floor(diff / 86400000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs >= 1) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const mins = Math.floor(diff / 60000);
  if (mins >= 1) return `${mins} min ago`;
  return 'just now';
}
