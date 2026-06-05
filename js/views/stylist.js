import { el, renderTopbar, iconButton, toast, confirm } from '../ui.js';
import { items as itemsStore, outfits as outfitsStore } from '../store.js';
import { releaseOwner } from '../image.js';
import { renderStack } from '../components/outfit-stack.js';
import { buildItemContext, generateOutfits, refineOutfit } from '../stylist/engine.js';
import { parseIntent } from '../stylist/intent.js';
import { generateRationale, generateOutfitName, greetingMessage, unableMessage, summaryForGroup } from '../stylist/response.js';

const SESSION_KEY = 'outfit-planner:stylist-session';
const OWNER = 'stylist-view';

const QUICK_PROMPTS = [
  'Casual weekend look',
  '3 outfits for warm weather',
  'Something formal for dinner',
  'Smart casual for work',
  'Beach day in linen',
  'A week of looks'
];

// ---- Session state (persisted to sessionStorage so the chat survives tab switches) ----
function loadSession() {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (!s) return defaultSession();
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed.messages)) return defaultSession();
    return parsed;
  } catch { return defaultSession(); }
}
function saveSession(state) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch {}
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}
function defaultSession() {
  return { messages: [], lastSuggestion: null };
}

// ---- Markdown-ish bold rendering (`**word**` → <strong>) ----
function renderInline(text) {
  const out = document.createDocumentFragment();
  const parts = (text || '').split(/(\*\*[^*]+\*\*)/);
  for (const p of parts) {
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      out.appendChild(el('strong', null, p.slice(2, -2)));
    } else {
      out.appendChild(document.createTextNode(p));
    }
  }
  return out;
}

export async function view() {
  releaseOwner(OWNER);

  const allItems = await itemsStore.all();
  const itemContext = await buildItemContext(allItems);
  const itemsById = new Map(itemContext.map(i => [i.id, i]));

  const session = loadSession();
  if (!session.messages.length) {
    const outfitCount = (await outfitsStore.all()).length;
    session.messages.push({ role: 'stylist', text: greetingMessage(allItems.length, outfitCount) });
    saveSession(session);
  }

  renderTopbar({
    title: 'Stylist',
    right: iconButton('Clear chat', '↺', async () => {
      const ok = await confirm({ title: 'Clear conversation?', message: 'Saved outfits are kept. Only the chat history is cleared.', confirmLabel: 'Clear' });
      if (!ok) return;
      clearSession();
      // Reset state and re-render
      session.messages = [{ role: 'stylist', text: greetingMessage(allItems.length, 0) }];
      session.lastSuggestion = null;
      saveSession(session);
      drawMessages();
    })
  });

  // Layout: scrollable message area + sticky input bar
  const root = el('div', { class: 'stylist-view' });
  const messagesEl = el('div', { class: 'stylist-messages', 'aria-live': 'polite' });
  root.appendChild(messagesEl);

  // Quick prompts row (visible until user has interacted)
  const quickRow = el('div', { class: 'stylist-quick' });
  QUICK_PROMPTS.forEach(p => {
    quickRow.appendChild(el('button', {
      type: 'button',
      class: 'chip',
      onClick: () => { input.value = p; handleSubmit(); }
    }, p));
  });
  root.appendChild(quickRow);

  // Input bar
  const input = el('input', {
    type: 'text',
    class: 'stylist-input',
    placeholder: 'Ask for an outfit…',
    autocomplete: 'off',
    onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }
  });
  const sendBtn = el('button', { type: 'button', class: 'btn btn-primary stylist-send', onClick: () => handleSubmit() }, 'Send');
  root.appendChild(el('div', { class: 'stylist-inputbar' }, [input, sendBtn]));

  drawMessages();
  // Hide quick row once the user has sent at least one message
  if (session.messages.filter(m => m.role === 'user').length > 0) {
    quickRow.style.display = 'none';
  }

  async function handleSubmit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    quickRow.style.display = 'none';
    session.messages.push({ role: 'user', text });
    saveSession(session);
    drawMessages();

    // Compute reply
    const reply = await respond(text, itemContext, session);
    session.messages.push(reply);
    if (reply.suggestion) session.lastSuggestion = reply.suggestion;
    saveSession(session);
    drawMessages();
    setTimeout(() => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }), 30);
  }

  function drawMessages() {
    messagesEl.replaceChildren(...session.messages.map(renderMessage));
    setTimeout(() => messagesEl.scrollTo({ top: messagesEl.scrollHeight }), 0);
  }

  function renderMessage(msg) {
    if (msg.role === 'user') {
      return el('div', { class: 'msg msg-user' }, [
        el('div', { class: 'msg-bubble' }, msg.text)
      ]);
    }
    // stylist
    const bubbleChildren = [];
    if (msg.text) {
      const p = el('div', { class: 'msg-text' });
      p.appendChild(renderInline(msg.text));
      bubbleChildren.push(p);
    }
    if (msg.suggestions && msg.suggestions.length) {
      msg.suggestions.forEach(s => bubbleChildren.push(renderSuggestionCard(s)));
    }
    return el('div', { class: 'msg msg-stylist' }, [
      el('div', { class: 'msg-avatar', 'aria-hidden': 'true' }, '✨'),
      el('div', { class: 'msg-bubble' }, bubbleChildren)
    ]);
  }

  function renderSuggestionCard(s) {
    // s: { topId, pantId, shoesId, accessoryIds, otherIds, name, rationale, savedOutfitId?: string }
    const outfit = {
      topId: s.topId, pantId: s.pantId, shoesId: s.shoesId,
      accessoryIds: s.accessoryIds, otherIds: s.otherIds, name: s.name
    };
    const card = el('div', { class: 'suggestion-card' });
    card.appendChild(el('div', { class: 'suggestion-head' }, [
      el('div', { class: 'suggestion-title' }, [
        el('span', { class: 'ai-spark', 'aria-hidden': 'true' }, '✨'),
        s.name || 'Suggested look'
      ]),
      el('span', { class: 'badge badge-accent' }, 'AI-suggested')
    ]));
    card.appendChild(el('div', { class: 'suggestion-stack' }, [
      renderStack({ outfit, itemsById, size: 'md', ownerKey: OWNER })
    ]));
    if (s.rationale) {
      card.appendChild(el('p', { class: 'suggestion-rationale' }, s.rationale));
    }
    const saveBtn = el('button', {
      type: 'button',
      class: 'btn btn-primary btn-block',
      disabled: !!s.savedOutfitId,
      onClick: () => saveSuggestion(s, saveBtn)
    }, s.savedOutfitId ? '✓ Saved to Outfits' : '💾 Save outfit');
    card.appendChild(saveBtn);
    return card;
  }

  async function saveSuggestion(s, btn) {
    btn.disabled = true;
    try {
      const saved = await outfitsStore.put({
        name: s.name || 'AI-suggested look',
        topId: s.topId, pantId: s.pantId, shoesId: s.shoesId,
        accessoryIds: s.accessoryIds || [], otherIds: s.otherIds || [],
        notes: '',
        aiGenerated: true,
        aiPrompt: s.aiPrompt || '',
        aiRationale: s.rationale || ''
      });
      s.savedOutfitId = saved.id;
      btn.textContent = '✓ Saved to Outfits';
      toast('Saved to your outfits', { kind: 'success' });
      // Update the session so re-render keeps the saved state
      saveSession(session);
    } catch (err) {
      btn.disabled = false;
      toast('Could not save: ' + err.message, { kind: 'danger' });
    }
  }

  return { node: root, cleanup: () => releaseOwner(OWNER) };
}

// ---- Reply logic ----
async function respond(prompt, itemContext, session) {
  const intent = parseIntent(prompt, { previousOutfit: session.lastSuggestion });
  if (!itemContext.length) {
    return { role: 'stylist', text: unableMessage('no-items') };
  }
  // Refinement path
  if (Object.keys(intent.refine).length && session.lastSuggestion) {
    const refined = refineOutfit(itemContext, intent, session.lastSuggestion);
    if (!refined.length) return { role: 'stylist', text: `I couldn't find a good swap with the items available.` };
    return packReply(refined, intent, prompt, `Here's a refined version:`);
  }
  // Validate
  const hasMainPiece = itemContext.some(i => i.category === 'top' || i.category === 'dress');
  if (!hasMainPiece) return { role: 'stylist', text: unableMessage('no-main-piece') };
  const hasShoes = itemContext.some(i => i.category === 'shoes');
  if (!hasShoes) return { role: 'stylist', text: unableMessage('no-shoes') };

  const generated = generateOutfits(itemContext, intent);
  if (!generated.length) {
    return { role: 'stylist', text: unableMessage('default') };
  }
  return packReply(generated, intent, prompt);
}

function packReply(generated, intent, prompt, header) {
  const suggestions = generated.map(o => {
    const meta = o._meta;
    const rationale = generateRationale(meta);
    const name = generateOutfitName(meta);
    return {
      topId: o.topId, pantId: o.pantId, shoesId: o.shoesId,
      accessoryIds: o.accessoryIds, otherIds: o.otherIds,
      name, rationale, aiPrompt: prompt
    };
  });
  // The session-tracked "lastSuggestion" is the first one in the batch
  const reply = {
    role: 'stylist',
    text: header || summaryForGroup(generated, intent),
    suggestions,
    suggestion: { ...suggestions[0] } // shallow copy for refinement reference
  };
  return reply;
}
