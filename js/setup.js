import { el } from './ui.js';
import { getDb } from './db.js';
import { isStorageProtected } from './storage.js';
import { openInstallGuide } from './components/storage-banner.js';
import { shouldOfferRestorePromptForCounts } from './components/backup-prompts.js';

export const SETUP_DISMISSED_KEY = 'outfit-planner:setupDismissedAt';

export function isSetupDismissed() {
  try { return !!localStorage.getItem(SETUP_DISMISSED_KEY); } catch { return false; }
}

export function dismissSetup() {
  try { localStorage.setItem(SETUP_DISMISSED_KEY, new Date().toISOString()); } catch {}
}

export function resetSetupDismissal() {
  try { localStorage.removeItem(SETUP_DISMISSED_KEY); } catch {}
}

export async function loadSetupFacts() {
  const db = await getDb();
  const [itemCount, outfitCount, tripsList, dayPlansList] = await Promise.all([
    db.count('items'),
    db.count('outfits'),
    db.getAll('trips'),
    db.getAll('dayPlans')
  ]);
  const trips = (tripsList || []).slice()
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || (a.name || '').localeCompare(b.name || ''));
  const dayPlans = dayPlansList || [];
  return {
    itemCount: itemCount || 0,
    outfitCount: outfitCount || 0,
    tripCount: trips.length,
    dayPlanCount: dayPlans.length,
    assignedDayCount: dayPlans.filter(hasAssignedOutfit).length,
    firstTripId: trips[0] ? trips[0].id : ''
  };
}

export async function loadSetupStatus() {
  const [facts, storageProtected] = await Promise.all([
    loadSetupFacts(),
    isStorageProtected().catch(() => false)
  ]);
  const counts = {
    items: facts.itemCount,
    outfits: facts.outfitCount,
    trips: facts.tripCount,
    dayPlans: facts.dayPlanCount
  };
  return buildSetupStatus({
    facts,
    storageProtected,
    restorePromptPending: shouldOfferRestorePromptForCounts(counts)
  });
}

export function buildSetupStatus({ facts = {}, storageProtected = false, restorePromptPending = false } = {}) {
  const f = normalizeFacts(facts);
  const steps = [
    {
      id: 'protect',
      label: 'Protect this app',
      detail: 'Add it to Home Screen or allow persistent storage.',
      complete: !!storageProtected,
      action: 'Protect'
    },
    {
      id: 'items',
      label: 'Add clothing',
      detail: 'Save one owned or to-buy piece.',
      complete: f.itemCount > 0,
      href: '#/item/new',
      action: 'Add'
    },
    {
      id: 'outfits',
      label: 'Build an outfit',
      detail: 'Combine saved items into a look.',
      complete: f.outfitCount > 0,
      href: '#/outfit/new',
      action: 'Build'
    },
    {
      id: 'trip',
      label: 'Create a trip',
      detail: 'Set the travel dates.',
      complete: f.tripCount > 0,
      href: '#/trips',
      action: 'Create'
    },
    {
      id: 'plan',
      label: 'Plan a day',
      detail: f.tripCount > 0
        ? 'Assign an outfit to one trip day.'
        : 'Create a trip first, then assign an outfit to a day.',
      complete: f.assignedDayCount > 0,
      href: f.firstTripId ? `#/trip/${f.firstTripId}` : '',
      action: f.firstTripId ? 'Plan' : 'After trip',
      blocked: !f.firstTripId
    }
  ];
  const completeCount = steps.filter(step => step.complete).length;
  return {
    facts: f,
    storageProtected: !!storageProtected,
    restorePromptPending: !!restorePromptPending,
    steps,
    completeCount,
    totalCount: steps.length,
    done: completeCount === steps.length,
    nextStep: steps.find(step => !step.complete) || null
  };
}

export function shouldShowSetupCard(status, { dismissed = isSetupDismissed() } = {}) {
  if (!status || status.restorePromptPending) return false;
  return !dismissed;
}

export function isSetupEmpty(status) {
  const facts = status && status.facts;
  if (!facts) return false;
  return (facts.itemCount + facts.outfitCount + facts.tripCount + facts.dayPlanCount) === 0;
}

export function shouldShowActivationHero(status) {
  if (!status || status.restorePromptPending) return false;
  return isSetupEmpty(status);
}

export function renderActivationHero({ onTryDemo, onCreateTrip, onRestore } = {}) {
  return el('section', { class: 'activation-hero', 'aria-label': 'Get started' }, [
    el('div', { class: 'activation-copy' }, [
      el('p', { class: 'setup-eyebrow' }, 'New here?'),
      el('h2', null, 'See a planned trip in one tap'),
      el('p', null, 'Open a sample weekend with outfits, day plans and a shopping list before adding your own closet.')
    ]),
    el('div', { class: 'activation-preview', 'aria-hidden': 'true' }, [
      el('div', { class: 'activation-preview-card' }, [
        el('span', null, 'Day 1'),
        el('strong', null, 'Travel day')
      ]),
      el('div', { class: 'activation-preview-card' }, [
        el('span', null, 'Day 2'),
        el('strong', null, 'Dinner walk')
      ]),
      el('div', { class: 'activation-preview-card is-muted' }, [
        el('span', null, 'Shopping'),
        el('strong', null, '1 to buy')
      ])
    ]),
    el('div', { class: 'activation-actions' }, [
      el('button', {
        type: 'button',
        class: 'btn btn-primary',
        onClick: () => { if (onTryDemo) onTryDemo(); }
      }, 'Try demo trip'),
      el('button', {
        type: 'button',
        class: 'btn btn-secondary',
        onClick: () => { if (onCreateTrip) onCreateTrip(); }
      }, 'Start my own'),
      onRestore ? el('button', {
        type: 'button',
        class: 'btn btn-ghost activation-restore',
        onClick: () => onRestore()
      }, 'Restore backup') : null
    ])
  ]);
}

export function renderSetupCard(status, { onDismiss, onCreateTrip, onProtect = openInstallGuide } = {}) {
  const checklist = el('ol', { class: 'setup-checklist' }, status.steps.map((step, index) => {
    return el('li', { class: 'setup-step' + (step.complete ? ' is-done' : '') }, [
      el('span', { class: 'setup-step-mark', 'aria-hidden': 'true' }, step.complete ? '✓' : String(index + 1)),
      el('div', { class: 'setup-step-text' }, [
        el('strong', null, step.label),
        el('small', null, step.detail)
      ]),
      renderStepAction(step, { onCreateTrip, onProtect })
    ]);
  }));

  return el('section', { class: 'setup-card', 'aria-label': 'First-run setup' }, [
    el('div', { class: 'setup-card-head' }, [
      el('div', { class: 'setup-card-title' }, [
        el('p', { class: 'setup-eyebrow' }, 'First-run setup'),
        el('h2', null, status.done ? 'Ready to plan trips' : 'Get set up for your first trip'),
        el('p', { class: 'setup-progress' }, setupProgressText(status))
      ]),
      el('button', {
        type: 'button',
        class: 'icon-btn setup-dismiss',
        'aria-label': 'Hide setup guide',
        onClick: () => { if (onDismiss) onDismiss(); }
      }, '×')
    ]),
    checklist
  ]);
}

export function renderSetupSettingsRow(status, { onToggleDismissal } = {}) {
  const dismissed = isSetupDismissed();
  const waitingForRestore = !!(status && status.restorePromptPending);
  const hiddenLabel = dismissed ? 'Hidden on Trips' : 'Shown on Trips';
  const sub = waitingForRestore
    ? 'Restore a backup or start fresh first.'
    : `${setupProgressText(status)} · ${hiddenLabel}`;
  return el('div', { class: 'settings-row setup-settings-row' }, [
    el('div', { class: 'row-label' }, [
      el('strong', null, 'Setup guide'),
      el('small', null, sub)
    ]),
    waitingForRestore ? null : el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-sm setup-settings-toggle',
      onClick: () => { if (onToggleDismissal) onToggleDismissal(); }
    }, dismissed ? 'Show' : 'Hide')
  ]);
}

function normalizeFacts(facts) {
  return {
    itemCount: numberOrZero(facts.itemCount),
    outfitCount: numberOrZero(facts.outfitCount),
    tripCount: numberOrZero(facts.tripCount),
    dayPlanCount: numberOrZero(facts.dayPlanCount),
    assignedDayCount: numberOrZero(facts.assignedDayCount),
    firstTripId: facts.firstTripId || ''
  };
}

function numberOrZero(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function hasAssignedOutfit(plan) {
  const ids = Array.isArray(plan && plan.outfitIds)
    ? plan.outfitIds
    : (plan && plan.outfitId ? [plan.outfitId] : []);
  return ids.some(Boolean);
}

function setupProgressText(status) {
  if (!status) return 'Not checked yet';
  if (status.done) return 'Complete';
  return `${status.completeCount} of ${status.totalCount} done`;
}

function renderStepAction(step, { onCreateTrip, onProtect }) {
  if (step.complete) return el('span', { class: 'setup-done-pill' }, 'Done');
  if (step.blocked) return el('span', { class: 'setup-pending-pill' }, step.action || 'Later');
  if (step.id === 'protect') {
    return el('button', {
      type: 'button',
      class: 'btn btn-secondary setup-action',
      onClick: onProtect
    }, step.action);
  }
  if (step.id === 'trip' && onCreateTrip) {
    return el('button', {
      type: 'button',
      class: 'btn btn-secondary setup-action',
      onClick: onCreateTrip
    }, step.action);
  }
  return el('a', { class: 'btn btn-secondary setup-action', href: step.href || '#/' }, step.action);
}
