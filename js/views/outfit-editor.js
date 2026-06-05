import { el, renderTopbar, toast, confirm, backControl } from '../ui.js';
import { back } from '../router.js';
import { dayPlans, items as itemsStore, outfits as outfitsStore } from '../store.js';
import { urlFor, releaseOwner, hasBytes } from '../image.js';
import { pickItem } from '../components/picker.js';
import { trackActivation } from '../activation.js';
import { queueFeedbackPrompt } from '../feedback.js';
import { categoryIcon } from '../categories.js';
import {
  clearOutfitCreateContinuation,
  peekOutfitCreateContinuation,
  startItemCreateContinuation,
  takeItemCreateContinuationFor,
  takeOutfitCreateContinuation
} from '../continuations.js';

export async function view({ id }) {
  const OWNER = 'outfit-editor';
  releaseOwner(OWNER);

  const isNew = !id || id === 'new';
  const existing = isNew ? null : await outfitsStore.get(id);
  if (!isNew && !existing) {
    renderTopbar({ title: 'Not found', left: backControl('#/outfits') });
    return { node: el('div', { class: 'state' }, [el('h3', null, 'Outfit not found')]) };
  }

  const itemContinuation = takeItemCreateContinuationFor(location.hash);
  const draft = itemContinuation?.draft;

  const state = {
    name: existing?.name || '',
    topId: existing?.topId || null,
    pantId: existing?.pantId || null,
    shoesId: existing?.shoesId || null,
    accessoryIds: (existing?.accessoryIds || []).slice(),
    otherIds: (existing?.otherIds || []).slice(),
    notes: existing?.notes || '',
    dirty: false
  };
  applyDraft(state, draft);
  applyCreatedItem(state, itemContinuation);

  let itemsCache = await itemsStore.all();
  const refreshItemsCache = async () => { itemsCache = await itemsStore.all(); };
  const itemById = (id) => itemsCache.find(i => i.id === id);

  const saveBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: onSave }, 'Save');
  const backBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back', onClick: tryLeave }, '◀');
  renderTopbar({ title: isNew ? 'New outfit' : 'Edit outfit', left: backBtn, right: saveBtn });

  const pendingOutfitContinuation = isNew ? peekOutfitCreateContinuation() : null;
  const exitHash = pendingOutfitContinuation?.returnHash || (existing ? `#/outfit/${existing.id}` : '#/outfits');

  async function tryLeave() {
    if (state.dirty) {
      const ok = await confirm({ title: 'Discard changes?', message: 'You have unsaved changes.', confirmLabel: 'Discard', danger: true });
      if (!ok) return;
    }
    if (pendingOutfitContinuation) {
      clearOutfitCreateContinuation();
      back(exitHash);
      return;
    }
    back(exitHash);
  }

  const root = el('form', { class: 'outfit-editor', onSubmit: (e) => { e.preventDefault(); onSave(); } });

  // Name
  root.appendChild(el('div', { class: 'field' }, [
    el('label', null, 'Name'),
    el('input', { type: 'text', value: state.name, placeholder: 'e.g., Linen Casual', onInput: (e) => { state.name = e.target.value; state.dirty = true; } })
  ]));

  // --- Slot sections in anatomical top-down order. New categories reuse the
  // existing outfit arrays so old exports/imports remain compatible.
  root.appendChild(renderMultiSection('accessoryIds', 'accessory', 'Accessories', '✨'));
  root.appendChild(renderMultiSection('accessoryIds', 'purse', 'Purses', '👜'));
  root.appendChild(renderMultiSection('otherIds', 'dress', 'Dresses', '👗'));
  root.appendChild(renderSingleSlot({ stateKey: 'topId', categories: ['top'], label: 'Top' }));
  root.appendChild(renderSingleSlot({ stateKey: 'pantId', categories: ['pant', 'skirt'], label: 'Bottom' }));
  root.appendChild(renderSingleSlot({ stateKey: 'shoesId', categories: ['shoes'], label: 'Shoes' }));
  root.appendChild(renderMultiSection('otherIds', 'other', 'Other', '🎒'));

  // Notes
  root.appendChild(el('div', { class: 'field' }, [
    el('label', null, 'Notes (optional)'),
    el('textarea', { value: state.notes, rows: 2, onInput: (e) => { state.notes = e.target.value; state.dirty = true; } })
  ]));

  root.appendChild(el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Save outfit'));

  if (existing) {
    root.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block',
      style: { marginTop: '12px', color: 'var(--danger)' },
      onClick: async () => {
        const ok = await confirm({ title: 'Delete outfit?', message: 'Days that use this outfit will be cleared. Items are not deleted.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await outfitsStore.remove(existing.id);
        toast('Outfit deleted');
        location.hash = '#/outfits';
      }
    }, 'Delete outfit'));
  }

  function renderSingleSlot({ stateKey, categories, label }) {
    const section = el('div', { class: 'slot-section' });
    section.appendChild(el('div', { class: 'slot-header' }, [el('h3', null, label)]));
    const tileWrap = el('div');
    section.appendChild(tileWrap);
    redraw();

    async function redraw() {
      const curId = state[stateKey];
      const cur = curId ? itemById(curId) : null;

      if (!cur) {
        tileWrap.replaceChildren(el('button', {
          type: 'button',
          class: 'slot-tile empty',
          onClick: openPicker
        }, [
          el('span', null, `+ Add ${label.toLowerCase()}`)
        ]));
      } else {
        tileWrap.replaceChildren(el('div', { class: 'slot-tile' }, [
          el('div', { class: 'slot-thumb', onClick: openPicker }, [
            hasBytes(cur.imageBlob) ? el('img', { src: urlFor(OWNER, cur.imageBlob), alt: '' }) : el('span', null, categoryIcon(cur.category)),
            el('span', { class: `ownership-badge sm ${cur.owned ? 'owned' : 'tobuy'}`, title: cur.owned ? 'Owned' : 'To buy' }, cur.owned ? '✓' : '$')
          ]),
          el('div', { class: 'slot-text', onClick: openPicker }, [
            el('div', { class: 'slot-name' }, cur.name || '(unnamed)'),
            cur.subcategory ? el('div', { class: 'slot-sub' }, cur.subcategory) : null
          ]),
          el('button', {
            type: 'button',
            class: 'slot-remove',
            'aria-label': 'Remove',
            onClick: () => { state[stateKey] = null; state.dirty = true; redraw(); }
          }, '×')
        ]));
      }
    }

    async function openPicker() {
      const result = await pickItem({
        category: categories,
        currentId: state[stateKey],
        ownerKey: OWNER,
        onCreate: () => startItemCreateContinuation({
          returnHash: location.hash,
          draft: outfitDraft(state),
          target: { type: 'single', stateKey },
          defaultCategory: categories[0]
        })
      });
      if (result === undefined) {
        // dismissed without choice; if user navigated to /item/new, refresh on return
        await refreshItemsCache();
        redraw();
        return;
      }
      state[stateKey] = result;
      state.dirty = true;
      await refreshItemsCache();
      redraw();
    }

    return section;
  }

  // Multi-item slot for array-backed categories like accessory, purse, dress, and other.
  function renderMultiSection(stateKey, category, label, fallbackIcon) {
    const section = el('div', { class: 'slot-section' });
    section.appendChild(el('div', { class: 'slot-header' }, [el('h3', null, label)]));
    const row = el('div', { class: 'accessory-row' });
    section.appendChild(row);
    redraw();

    async function redraw() {
      const ids = state[stateKey];
      const children = [];
      ids.forEach((aid, sourceIdx) => {
        const it = itemById(aid);
        const fallbackCategory = stateKey === 'accessoryIds' ? 'accessory' : 'other';
        if (it ? it.category !== category : category !== fallbackCategory) return;
        const tile = el('div', { class: 'acc-tile' }, [
          el('div', { class: 'slot-thumb', onClick: () => openPickerForReplace(sourceIdx) }, [
            it && hasBytes(it.imageBlob) ? el('img', { src: urlFor(OWNER, it.imageBlob), alt: '' }) : el('span', null, fallbackIcon),
            it ? el('span', { class: `ownership-badge sm ${it.owned ? 'owned' : 'tobuy'}` }, it.owned ? '✓' : '$') : null,
            el('button', {
              type: 'button',
              class: 'slot-remove',
              'aria-label': 'Remove',
              style: { position: 'absolute', top: '-6px', right: '-6px', width: '22px', height: '22px', fontSize: '14px' },
              onClick: (e) => { e.stopPropagation(); state[stateKey].splice(sourceIdx, 1); state.dirty = true; redraw(); }
            }, '×')
          ]),
          el('div', { class: 'acc-name' }, it ? (it.subcategory || it.name) : 'Removed')
        ]);
        children.push(tile);
      });
      children.push(el('button', { type: 'button', class: 'acc-add', 'aria-label': `Add ${label.toLowerCase()}`, onClick: openPickerForAdd }, '+'));
      row.replaceChildren(...children);
    }

    async function openPickerForAdd() {
      const result = await pickItem({
        category,
        currentId: null,
        allowClear: false,
        ownerKey: OWNER,
        onCreate: () => startItemCreateContinuation({
          returnHash: location.hash,
          draft: outfitDraft(state),
          target: { type: 'multi', stateKey, mode: 'add' },
          defaultCategory: category
        })
      });
      if (typeof result !== 'string') { await refreshItemsCache(); redraw(); return; }
      if (!state[stateKey].includes(result)) {
        state[stateKey].push(result);
        state.dirty = true;
      }
      await refreshItemsCache();
      redraw();
    }
    async function openPickerForReplace(idx) {
      const result = await pickItem({
        category,
        currentId: state[stateKey][idx],
        allowClear: true,
        ownerKey: OWNER,
        onCreate: () => startItemCreateContinuation({
          returnHash: location.hash,
          draft: outfitDraft(state),
          target: { type: 'multi', stateKey, mode: 'replace', index: idx },
          defaultCategory: category
        })
      });
      if (result === undefined) { await refreshItemsCache(); redraw(); return; }
      if (result === null) state[stateKey].splice(idx, 1);
      else state[stateKey][idx] = result;
      state.dirty = true;
      await refreshItemsCache();
      redraw();
    }

    return section;
  }

  async function onSave() {
    if (!state.name.trim()) {
      toast('Please give your outfit a name', { kind: 'danger' });
      return;
    }
    saveBtn.disabled = true;
    try {
      const saved = await outfitsStore.put({
        id: existing?.id,
        name: state.name.trim(),
        topId: state.topId,
        pantId: state.pantId,
        shoesId: state.shoesId,
        accessoryIds: state.accessoryIds,
        otherIds: state.otherIds,
        notes: state.notes.trim()
      });
      const slotCount = [state.topId, state.pantId, state.shoesId, ...state.accessoryIds, ...state.otherIds]
        .filter(Boolean).length;
      trackActivation(isNew ? 'outfit_created' : 'outfit_saved', { slotCount });
      if (isNew) queueFeedbackPrompt('outfit_created', { slotCount });
      state.dirty = false;
      const continuation = takeOutfitCreateContinuation();
      if (continuation && continuation.tripId && continuation.date) {
        await applyOutfitToTrip(continuation, saved.id);
        toast('Outfit added to trip', { kind: 'success' });
        trackActivation('day_planned', { source: 'outfit_create_continuation' });
        queueFeedbackPrompt('day_planned');
        back(continuation.returnHash || `#/trip/${continuation.tripId}`);
        return;
      }
      toast(isNew ? 'Outfit created' : 'Outfit saved', { kind: 'success' });
      location.hash = `#/outfit/${saved.id}`;
    } catch (err) {
      toast('Save failed: ' + err.message, { kind: 'danger' });
    } finally {
      saveBtn.disabled = false;
    }
  }

  return { node: root, cleanup: () => releaseOwner(OWNER) };
}

function outfitDraft(state) {
  return {
    name: state.name || '',
    topId: state.topId || null,
    pantId: state.pantId || null,
    shoesId: state.shoesId || null,
    accessoryIds: Array.isArray(state.accessoryIds) ? state.accessoryIds.slice() : [],
    otherIds: Array.isArray(state.otherIds) ? state.otherIds.slice() : [],
    notes: state.notes || ''
  };
}

function applyDraft(state, draft) {
  if (!draft || typeof draft !== 'object') return;
  state.name = draft.name || '';
  state.topId = draft.topId || null;
  state.pantId = draft.pantId || null;
  state.shoesId = draft.shoesId || null;
  state.accessoryIds = Array.isArray(draft.accessoryIds) ? draft.accessoryIds.slice() : [];
  state.otherIds = Array.isArray(draft.otherIds) ? draft.otherIds.slice() : [];
  state.notes = draft.notes || '';
  state.dirty = true;
}

function applyCreatedItem(state, continuation) {
  const itemId = continuation?.itemId;
  const target = continuation?.target;
  if (!itemId || !target) return;
  if (target.type === 'single' && target.stateKey) {
    state[target.stateKey] = itemId;
    state.dirty = true;
    return;
  }
  if (target.type !== 'multi' || !target.stateKey || !Array.isArray(state[target.stateKey])) return;
  if (target.mode === 'replace' && Number.isInteger(target.index) && target.index >= 0) {
    state[target.stateKey][target.index] = itemId;
  } else if (!state[target.stateKey].includes(itemId)) {
    state[target.stateKey].push(itemId);
  }
  state.dirty = true;
}

async function applyOutfitToTrip(continuation, outfitId) {
  if (continuation.mode === 'replace' && Number.isInteger(continuation.index)) {
    const existing = await dayPlans.get(continuation.tripId, continuation.date);
    const list = existing ? [...(existing.outfitIds || [])] : [];
    list[continuation.index] = outfitId;
    await dayPlans.setOutfits(continuation.tripId, continuation.date, list, existing ? existing.notes : '');
    return;
  }
  await dayPlans.addOutfit(continuation.tripId, continuation.date, outfitId);
}
