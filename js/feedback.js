import { el, sheet, toast } from './ui.js';
import {
  getActivationEvents,
  normalizeRoute,
  sanitizeActivationData,
  trackActivation
} from './activation.js';

export const FEEDBACK_LOG_KEY = 'outfit-planner:feedbackLog';
export const FEEDBACK_STATE_KEY = 'outfit-planner:feedbackState';
export const FEEDBACK_PENDING_KEY = 'outfit-planner:feedbackPendingFlow';
export const FEEDBACK_SESSION_KEY = 'outfit-planner:feedbackPromptedThisSession';

const PROMPT_COOLDOWN_MS = 30 * 60 * 1000;
const DISMISS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_FEEDBACK = 80;

const FLOW_PROMPTS = {
  demo_trip: {
    title: 'Quick feedback',
    question: 'Was the demo trip helpful?'
  },
  trip_created: {
    title: 'Quick feedback',
    question: 'Was creating that trip easy?'
  },
  item_created: {
    title: 'Quick feedback',
    question: 'Was adding clothing easy?'
  },
  outfit_created: {
    title: 'Quick feedback',
    question: 'Was building that outfit easy?'
  },
  day_planned: {
    title: 'Quick feedback',
    question: 'Was planning that day easy?'
  }
};

export function queueFeedbackPrompt(flow, meta = {}) {
  if (!FLOW_PROMPTS[flow]) return false;
  try {
    sessionStorage.setItem(FEEDBACK_PENDING_KEY, JSON.stringify({
      flow,
      meta: sanitizeActivationData(meta),
      queuedAt: new Date().toISOString()
    }));
  } catch {}
  return true;
}

export function showQueuedFeedbackPrompt() {
  const pending = readPendingPrompt();
  if (!pending) return null;
  if (hasOpenSurface()) return null;
  try { sessionStorage.removeItem(FEEDBACK_PENDING_KEY); } catch {}
  return showFeedbackPrompt(pending.flow);
}

export function showFeedbackPrompt(flow, { force = false, now = Date.now() } = {}) {
  if (!FLOW_PROMPTS[flow]) return null;
  const state = getFeedbackState();
  const sessionPrompted = getSessionPrompted();
  if (!force && !shouldPromptFeedback({ flow, state, now, sessionPrompted })) return null;

  markPromptShown(flow, now, state);
  try { sessionStorage.setItem(FEEDBACK_SESSION_KEY, '1'); } catch {}

  const root = ensureFeedbackRoot();
  root.replaceChildren(renderPrompt(flow));
  return root.firstElementChild;
}

export function shouldPromptFeedback({ flow, state = {}, now = Date.now(), sessionPrompted = false } = {}) {
  if (!FLOW_PROMPTS[flow]) return false;
  if (state.disabled || sessionPrompted) return false;
  const lastPrompt = Date.parse(state.lastPromptAt || '');
  if (!Number.isNaN(lastPrompt) && now - lastPrompt < PROMPT_COOLDOWN_MS) return false;
  const flowState = (state.flows && state.flows[flow]) || {};
  if (flowState.respondedAt) return false;
  const dismissed = Date.parse(flowState.dismissedAt || '');
  if (!Number.isNaN(dismissed) && now - dismissed < DISMISS_COOLDOWN_MS) return false;
  return true;
}

export function recordFeedback(flow, rating, comment = '') {
  const entry = {
    at: new Date().toISOString(),
    flow: FLOW_PROMPTS[flow] ? flow : 'general',
    rating: rating === 'positive' ? 'positive' : 'negative',
    comment: sanitizeFeedbackText(comment),
    route: normalizeRoute()
  };
  const next = [...getFeedbackEntries(), entry].slice(-MAX_FEEDBACK);
  try { localStorage.setItem(FEEDBACK_LOG_KEY, JSON.stringify(next)); } catch {}

  const state = getFeedbackState();
  state.flows = state.flows || {};
  state.flows[entry.flow] = { ...(state.flows[entry.flow] || {}), respondedAt: entry.at };
  setFeedbackState(state);

  trackActivation('feedback_submitted', {
    flow: entry.flow,
    rating: entry.rating,
    hasComment: !!entry.comment
  });
  return entry;
}

export function dismissFeedbackFlow(flow) {
  const state = getFeedbackState();
  state.flows = state.flows || {};
  state.flows[flow] = { ...(state.flows[flow] || {}), dismissedAt: new Date().toISOString() };
  setFeedbackState(state);
  trackActivation('feedback_dismissed', { flow });
}

export function getFeedbackEntries() {
  return readJson(FEEDBACK_LOG_KEY, []);
}

export function clearFeedbackEntries() {
  try { localStorage.removeItem(FEEDBACK_LOG_KEY); } catch {}
  try { localStorage.removeItem(FEEDBACK_STATE_KEY); } catch {}
}

export function getFeedbackState() {
  const parsed = readJson(FEEDBACK_STATE_KEY, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

export function setFeedbackState(state) {
  try { localStorage.setItem(FEEDBACK_STATE_KEY, JSON.stringify(state || {})); } catch {}
}

export function getFeedbackSummary() {
  return {
    feedbackCount: getFeedbackEntries().length,
    activationEventCount: getActivationEvents().length
  };
}

export function buildFeedbackPacket() {
  return {
    schema: 1,
    product: 'Outfit Planner',
    exportedAt: new Date().toISOString(),
    feedback: getFeedbackEntries(),
    activationEvents: getActivationEvents()
  };
}

export function feedbackPacketText() {
  return JSON.stringify(buildFeedbackPacket(), null, 2);
}

export async function copyFeedbackPacket() {
  const text = feedbackPacketText();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Feedback packet copied', { kind: 'success' });
      return { method: 'clipboard' };
    } catch {}
  }
  showFeedbackPacketText(text);
  return { method: 'sheet' };
}

export function sanitizeFeedbackText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function readPendingPrompt() {
  try {
    const raw = sessionStorage.getItem(FEEDBACK_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && FLOW_PROMPTS[parsed.flow] ? parsed : null;
  } catch {
    return null;
  }
}

function getSessionPrompted() {
  try { return sessionStorage.getItem(FEEDBACK_SESSION_KEY) === '1'; } catch { return false; }
}

function markPromptShown(flow, now, state = getFeedbackState()) {
  const at = new Date(now).toISOString();
  state.lastPromptAt = at;
  state.flows = state.flows || {};
  state.flows[flow] = { ...(state.flows[flow] || {}), promptedAt: at };
  setFeedbackState(state);
  trackActivation('feedback_prompt_shown', { flow });
}

function renderPrompt(flow) {
  const copy = FLOW_PROMPTS[flow];
  const card = el('section', {
    class: 'feedback-prompt',
    role: 'dialog',
    'aria-label': 'Quick feedback'
  });
  renderQuestion(card, flow, copy);
  return card;
}

function renderQuestion(card, flow, copy) {
  card.replaceChildren(
    el('div', { class: 'feedback-copy' }, [
      el('strong', null, copy.title),
      el('span', null, copy.question)
    ]),
    el('div', { class: 'feedback-actions' }, [
      el('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm',
        onClick: () => {
          recordFeedback(flow, 'positive');
          renderThanks(card);
        }
      }, 'Yes'),
      el('button', {
        type: 'button',
        class: 'btn btn-secondary btn-sm',
        onClick: () => renderDetailForm(card, flow)
      }, 'Not really'),
      el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        onClick: () => {
          dismissFeedbackFlow(flow);
          removePrompt(card);
        }
      }, 'Not now')
    ])
  );
}

function renderDetailForm(card, flow) {
  const textarea = el('textarea', {
    rows: 3,
    maxlength: '500',
    placeholder: 'What got in the way?',
    'aria-label': 'Feedback details'
  });
  card.replaceChildren(
    el('div', { class: 'feedback-copy' }, [
      el('strong', null, 'What should improve?'),
      el('span', null, 'A sentence is enough.')
    ]),
    el('form', {
      class: 'feedback-form',
      onSubmit: (event) => {
        event.preventDefault();
        recordFeedback(flow, 'negative', textarea.value);
        renderThanks(card);
      }
    }, [
      textarea,
      el('div', { class: 'feedback-actions' }, [
        el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Send'),
        el('button', {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          onClick: () => {
            recordFeedback(flow, 'negative');
            renderThanks(card);
          }
        }, 'Skip details')
      ])
    ])
  );
  setTimeout(() => textarea.focus(), 30);
}

function renderThanks(card) {
  card.replaceChildren(
    el('div', { class: 'feedback-copy feedback-thanks' }, [
      el('strong', null, 'Thank you'),
      el('span', null, 'Saved in this app for your alpha notes.')
    ])
  );
  setTimeout(() => removePrompt(card), 1400);
}

function removePrompt(card) {
  const root = card && card.parentNode;
  if (card && card.parentNode) card.remove();
  if (root && !root.childElementCount) root.remove();
}

function ensureFeedbackRoot() {
  let root = document.getElementById('feedback-root');
  if (!root) {
    root = el('div', { id: 'feedback-root', class: 'feedback-root' });
    document.body.appendChild(root);
  }
  return root;
}

function hasOpenSurface() {
  return !!document.querySelector('dialog[open], .sheet-fallback');
}

function showFeedbackPacketText(text) {
  sheet({
    title: 'Feedback packet',
    body: () => el('div', null, [
      el('p', { class: 'meta', style: { marginBottom: '8px' } }, 'Select all and copy this alpha feedback packet.'),
      el('textarea', {
        value: text,
        rows: 18,
        readonly: true,
        style: { width: '100%', fontFamily: 'monospace', fontSize: '11px' }
      })
    ])
  });
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
