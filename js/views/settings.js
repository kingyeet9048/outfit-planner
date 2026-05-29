import { el, renderTopbar, toast, confirm, sheet } from '../ui.js';
import { downloadExport, exportAsString, importFromObject } from '../exporter.js';
import { getDb } from '../db.js';
import { isStorageProtected, isStandalone } from '../storage.js';
import {
  backupNow, getLastBackupAt, chooseDestination, hasReusableDestination,
  forgetDestination, supportsFileSystemAccess, destinationLabel
} from '../backup.js';
import { openInstallGuide } from '../components/storage-banner.js';

const LAST_EXPORT_KEY = 'outfit-planner:lastExportedAt';

export async function view() {
  renderTopbar({ title: 'Settings' });
  const root = el('div', { class: 'settings-view' });

  // --- Data group ---
  const lastExport = localStorage.getItem(LAST_EXPORT_KEY);
  const dataGroup = el('div', { class: 'settings-group' }, [
    el('h3', null, 'Data'),
    el('div', { class: 'settings-card' }, [
      settingsRow({
        label: 'Export to file',
        sub: lastExport ? `Last exported ${formatRelative(lastExport)}` : 'No exports yet',
        control: el('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: onExport }, 'Export')
      }),
      settingsRow({
        label: 'Copy export as text',
        sub: 'Fallback when file download is blocked.',
        control: el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: onCopyExport }, 'Copy')
      }),
      settingsRow({
        label: 'Import from file',
        sub: 'Restore from a previous export.',
        control: el('label', { class: 'btn btn-secondary btn-sm', style: { cursor: 'pointer' } }, [
          el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: onImportFile }),
          'Import'
        ])
      })
    ])
  ]);
  root.appendChild(dataGroup);

  // --- Backup group (automatic safety net) ---
  const backupGroup = el('div', { class: 'settings-group' }, [el('h3', null, 'Backup')]);
  const backupCard = el('div', { class: 'settings-card' });
  backupGroup.appendChild(backupCard);
  root.appendChild(backupGroup);
  renderBackupCard(backupCard);

  // --- Storage group ---
  const storageGroup = el('div', { class: 'settings-group' }, [el('h3', null, 'Storage')]);
  const storageCard = el('div', { class: 'settings-card' });
  const protectionTarget = el('div');
  const usageTarget = el('div');
  storageCard.append(protectionTarget, usageTarget);
  storageGroup.appendChild(storageCard);
  root.appendChild(storageGroup);
  loadProtectionStatus(protectionTarget);
  loadStorageEstimate(usageTarget);

  async function renderBackupCard(card) {
    const last = getLastBackupAt();
    const rows = [
      settingsRow({
        label: 'Back up now',
        sub: last ? `Last backup ${formatRelative(last)}` : 'Not backed up yet',
        control: el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: onBackupNow }, 'Back up')
      }),
      settingsRow({
        label: 'Backup destination',
        sub: `Saves a single file to ${destinationLabel()} — overwritten each time, so backups never pile up.`,
        control: null
      })
    ];
    if (supportsFileSystemAccess()) {
      const reusable = await hasReusableDestination().catch(() => false);
      rows.push(settingsRow({
        label: reusable ? 'Backup file chosen' : 'Choose backup file',
        sub: reusable ? 'One-click backups overwrite this file.' : 'Pick a file once; later backups overwrite it.',
        control: el('div', { style: { display: 'flex', gap: '6px' } }, [
          el('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: onChooseDestination }, reusable ? 'Change' : 'Choose'),
          reusable ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: onForgetDestination }, 'Forget') : null
        ])
      }));
    }
    rows.push(settingsRow({
      label: 'Restore from backup',
      sub: 'Replaces current data with a backup file.',
      control: el('label', { class: 'btn btn-secondary btn-sm', style: { cursor: 'pointer' } }, [
        el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: onRestoreFile }),
        'Restore'
      ])
    }));
    card.replaceChildren(...rows);
  }

  async function onBackupNow() {
    try {
      const res = await backupNow({ allowPrompt: true });
      if (res.method === 'cancelled') return;
      toast('Backup saved', { kind: 'success' });
      renderBackupCard(backupCard);
    } catch (err) {
      toast('Backup failed: ' + (err && err.message ? err.message : 'unknown error'), { kind: 'danger' });
    }
  }

  async function onChooseDestination() {
    const res = await chooseDestination();
    if (res.ok) {
      toast('Backup file set', { kind: 'success' });
      renderBackupCard(backupCard);
    } else if (res.reason === 'error') {
      toast('Could not set backup file', { kind: 'danger' });
    }
  }

  async function onForgetDestination() {
    await forgetDestination();
    renderBackupCard(backupCard);
  }

  async function onRestoreFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      toast('Could not read file: ' + err.message, { kind: 'danger' });
      return;
    }
    const mode = await chooseImportMode();
    if (!mode) return;
    try {
      const counts = await importFromObject(parsed, { mode });
      toast(`Restored ${counts.items} items, ${counts.outfits} outfits, ${counts.trips} trips`, { kind: 'success' });
      loadStorageEstimate(usageTarget);
    } catch (err) {
      toast('Restore failed: ' + err.message, { kind: 'danger' });
    }
  }

  // --- Danger group ---
  root.appendChild(el('div', { class: 'settings-group' }, [
    el('h3', null, 'Danger zone'),
    el('div', { class: 'settings-card' }, [
      settingsRow({
        label: 'Delete all data',
        sub: 'Removes every item, outfit and trip. Cannot be undone.',
        control: el('button', { type: 'button', class: 'btn btn-ghost btn-sm', style: { color: 'var(--danger)' }, onClick: onClearAll }, 'Clear')
      })
    ])
  ]));

  // --- About ---
  root.appendChild(el('div', { class: 'settings-group' }, [
    el('h3', null, 'About'),
    el('div', { class: 'settings-card' }, [
      settingsRow({ label: 'Outfit Planner', sub: 'v1.0 · Offline-first PWA' })
    ])
  ]));

  async function onExport() {
    try {
      await downloadExport();
      localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
      toast('Export downloaded', { kind: 'success' });
    } catch (err) {
      toast('Export failed: ' + err.message, { kind: 'danger' });
    }
  }

  async function onCopyExport() {
    try {
      const str = await exportAsString();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(str);
        toast('Copied to clipboard', { kind: 'success' });
      } else {
        showExportText(str);
      }
      localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
    } catch (err) {
      try {
        const str = await exportAsString();
        showExportText(str);
      } catch (e2) {
        toast('Copy failed: ' + (err.message || e2.message), { kind: 'danger' });
      }
    }
  }

  function showExportText(str) {
    sheet({
      title: 'Export JSON',
      body: () => el('div', null, [
        el('p', { class: 'meta', style: { marginBottom: '8px' } }, 'Select all and copy this text to save it.'),
        el('textarea', { value: str, rows: 18, readonly: true, style: { width: '100%', fontFamily: 'monospace', fontSize: '11px' } })
      ])
    });
  }

  async function onImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let parsed;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch (err) {
      toast('Could not read file: ' + err.message, { kind: 'danger' });
      return;
    }
    const mode = await chooseImportMode();
    if (!mode) return;
    try {
      const counts = await importFromObject(parsed, { mode });
      toast(`Imported ${counts.items} items, ${counts.outfits} outfits, ${counts.trips} trips`, { kind: 'success' });
      loadStorageEstimate(storageCard);
    } catch (err) {
      toast('Import failed: ' + err.message, { kind: 'danger' });
    }
  }

  async function chooseImportMode() {
    return new Promise(resolve => {
      sheet({
        title: 'Import data',
        body: (close) => el('div', null, [
          el('p', { class: 'meta', style: { marginBottom: '12px' } }, 'Choose how to apply the import:'),
          el('button', {
            type: 'button',
            class: 'btn btn-secondary btn-block',
            style: { marginBottom: '8px' },
            onClick: () => { close(); resolve('merge'); }
          }, 'Merge — add or update by id'),
          el('button', {
            type: 'button',
            class: 'btn btn-danger btn-block',
            onClick: () => { close(); resolve('replace'); }
          }, 'Replace — erase current data first'),
          el('button', { type: 'button', class: 'btn btn-ghost btn-block', style: { marginTop: '8px' }, onClick: () => { close(); resolve(null); } }, 'Cancel')
        ])
      });
    });
  }

  async function onClearAll() {
    const ok1 = await confirm({ title: 'Clear all data?', message: 'This will delete every item, outfit, and trip.', confirmLabel: 'Continue', danger: true });
    if (!ok1) return;
    const ok2 = await confirm({ title: 'Are you sure?', message: 'There is no undo. Consider exporting first.', confirmLabel: 'Delete everything', danger: true });
    if (!ok2) return;
    const ok3 = await confirm({ title: 'Final confirmation', message: 'Tap delete one more time to confirm.', confirmLabel: 'Delete', danger: true });
    if (!ok3) return;
    const db = await getDb();
    const tx = db.transaction(['items', 'outfits', 'trips', 'dayPlans'], 'readwrite');
    await tx.objectStore('items').clear();
    await tx.objectStore('outfits').clear();
    await tx.objectStore('trips').clear();
    await tx.objectStore('dayPlans').clear();
    await tx.done;
    toast('All data deleted');
    loadStorageEstimate(storageCard);
  }

  return { node: root };
}

function settingsRow({ label, sub, control }) {
  return el('div', { class: 'settings-row' }, [
    el('div', { class: 'row-label' }, [
      el('strong', null, label),
      sub ? el('small', null, sub) : null
    ]),
    control || null
  ]);
}

async function loadProtectionStatus(target) {
  let prot = false;
  try { prot = await isStorageProtected(); } catch {}
  if (prot) {
    target.replaceChildren(settingsRow({
      label: 'Eviction protection',
      sub: isStandalone() ? 'Protected — running as an installed app.' : 'Protected — persistent storage granted.',
      control: el('span', { class: 'status-pill status-ok', 'aria-hidden': 'true' }, '✓ Safe')
    }));
  } else {
    target.replaceChildren(settingsRow({
      label: 'Eviction protection',
      sub: 'At risk — your browser can clear this app’s data. Add it to your Home Screen.',
      control: el('button', { type: 'button', class: 'btn btn-danger btn-sm', onClick: () => openInstallGuide() }, 'Protect')
    }));
  }
}

async function loadStorageEstimate(target) {
  target.replaceChildren(el('div', { class: 'settings-row' }, [
    el('div', { class: 'row-label' }, [
      el('strong', null, 'Storage usage'),
      el('small', null, 'Calculating…')
    ])
  ]));
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      const used = est.usage || 0;
      const quota = est.quota || 0;
      const pct = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0;
      target.replaceChildren(el('div', { class: 'settings-row' }, [
        el('div', { class: 'row-label', style: { flex: '1' } }, [
          el('strong', null, 'Storage usage'),
          el('small', null, quota ? `${formatBytes(used)} of ${formatBytes(quota)} (${pct}%)` : `${formatBytes(used)} used`),
          el('div', { class: 'storage-bar' }, [el('span', { style: { width: `${pct}%` } })])
        ])
      ]));
    } catch {
      target.replaceChildren(el('div', { class: 'settings-row' }, [
        el('div', { class: 'row-label' }, [el('strong', null, 'Storage usage'), el('small', null, 'Unavailable')])
      ]));
    }
  } else {
    target.replaceChildren(el('div', { class: 'settings-row' }, [
      el('div', { class: 'row-label' }, [el('strong', null, 'Storage usage'), el('small', null, 'Unavailable in this browser')])
    ]));
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(bytes < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatRelative(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
