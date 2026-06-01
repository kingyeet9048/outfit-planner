import { el, renderTopbar, toast, confirm, backControl } from '../ui.js';
import { back } from '../router.js';
import { items as itemsStore, outfits as outfitsStore } from '../store.js';
import { urlFor, releaseOwner, hasBytes } from '../image.js';
import { pickItem } from '../components/picker.js';
import { trackActivation } from '../activation.js';
import { queueFeedbackPrompt } from '../feedback.js';

const CATEGORY_ICONS = { top: '👕', pant: '👖', shoes: '👟', accessory: '✨' };

export async function view({ id }) {
  const OWNER = 'outfit-editor';
  releaseOwner(OWNER);

  const isNew = !id || id === 'new';
  const existing = isNew ? null : await outfitsStore.get(id);
  if (!isNew && !existing) {
    renderTopbar({ title: 'Not found', left: backControl('#/outfits') });
    return { node: el('div', { class: 'state' }, [el('h3', null, 'Outfit not found')]) };
  }

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

  let itemsCache = await itemsStore.all();
  const refreshItemsCache = async () => { itemsCache = await itemsStore.all(); };
  const itemById = (id) => itemsCache.find(i => i.id === id);

  const saveBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: onSave }, 'Save');
  const backBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back', onClick: tryLeave }, '◀');
  renderTopbar({ title: isNew ? 'New outfit' : 'Edit outfit', left: backBtn, right: saveBtn });

  const exitHash = existing ? `#/outfit/${existing.id}` : '#/outfits';

  async function tryLeave() {
    if (state.dirty) {
      const ok = await confirm({ title: 'Discard changes?', message: 'You have unsaved changes.', confirmLabel: 'Discard', danger: true });
      if (!ok) return;
    }
    back(exitHash);
  }

  const root = el('form', { class: 'outfit-editor', onSubmit: (e) => { e.preventDefault(); onSave(); } });

  // Name
  root.appendChild(el('div', { class: 'field' }, [
    el('label', null, 'Name'),
    el('input', { type: 'text', value: state.name, placeholder: 'e.g., Linen Casual', onInput: (e) => { state.name = e.target.value; state.dirty = true; } })
  ]));

  // --- Slot sections in anatomical top-down order: Accessories → Top → Pant → Shoes → Other (catch-all at the bottom) ---
  root.appendChild(renderMultiSection('accessoryIds', 'accessory', 'Accessories', '✨'));
  root.appendChild(renderSingleSlot('top', 'Top'));
  root.appendChild(renderSingleSlot('pant', 'Pant'));
  root.appendChild(renderSingleSlot('shoes', 'Shoes'));
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

  function renderSingleSlot(cat, label) {
    const section = el('div', { class: 'slot-section' });
    section.appendChild(el('div', { class: 'slot-header' }, [el('h3', null, label)]));
    const tileWrap = el('div');
    section.appendChild(tileWrap);
    redraw();

    async function redraw() {
      const slotKey = `${cat}Id`;
      const curId = state[slotKey];
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
            hasBytes(cur.imageBlob) ? el('img', { src: urlFor(OWNER, cur.imageBlob), alt: '' }) : el('span', null, CATEGORY_ICONS[cat]),
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
            onClick: () => { state[slotKey] = null; state.dirty = true; redraw(); }
          }, '×')
        ]));
      }
    }

    async function openPicker() {
      const result = await pickItem({ category: cat, currentId: state[`${cat}Id`], ownerKey: OWNER });
      if (result === undefined) {
        // dismissed without choice; if user navigated to /item/new, refresh on return
        await refreshItemsCache();
        redraw();
        return;
      }
      state[`${cat}Id`] = result;
      state.dirty = true;
      await refreshItemsCache();
      redraw();
    }

    return section;
  }

  // Multi-item slot for categories like 'accessory' and 'other' — N items, picker-driven.
  function renderMultiSection(stateKey, category, label, fallbackIcon) {
    const section = el('div', { class: 'slot-section' });
    section.appendChild(el('div', { class: 'slot-header' }, [el('h3', null, label)]));
    const row = el('div', { class: 'accessory-row' });
    section.appendChild(row);
    redraw();

    async function redraw() {
      const ids = state[stateKey];
      const children = [];
      ids.forEach((aid, idx) => {
        const it = itemById(aid);
        const tile = el('div', { class: 'acc-tile' }, [
          el('div', { class: 'slot-thumb', onClick: () => openPickerForReplace(idx) }, [
            it && hasBytes(it.imageBlob) ? el('img', { src: urlFor(OWNER, it.imageBlob), alt: '' }) : el('span', null, fallbackIcon),
            it ? el('span', { class: `ownership-badge sm ${it.owned ? 'owned' : 'tobuy'}` }, it.owned ? '✓' : '$') : null,
            el('button', {
              type: 'button',
              class: 'slot-remove',
              'aria-label': 'Remove',
              style: { position: 'absolute', top: '-6px', right: '-6px', width: '22px', height: '22px', fontSize: '14px' },
              onClick: (e) => { e.stopPropagation(); state[stateKey].splice(idx, 1); state.dirty = true; redraw(); }
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
      const result = await pickItem({ category, currentId: null, allowClear: false, ownerKey: OWNER });
      if (typeof result !== 'string') { await refreshItemsCache(); redraw(); return; }
      if (!state[stateKey].includes(result)) {
        state[stateKey].push(result);
        state.dirty = true;
      }
      await refreshItemsCache();
      redraw();
    }
    async function openPickerForReplace(idx) {
      const result = await pickItem({ category, currentId: state[stateKey][idx], allowClear: true, ownerKey: OWNER });
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
      toast(isNew ? 'Outfit created' : 'Outfit saved', { kind: 'success' });
      const slotCount = [state.topId, state.pantId, state.shoesId, ...state.accessoryIds, ...state.otherIds]
        .filter(Boolean).length;
      trackActivation(isNew ? 'outfit_created' : 'outfit_saved', { slotCount });
      if (isNew) queueFeedbackPrompt('outfit_created', { slotCount });
      state.dirty = false;
      location.hash = `#/outfit/${saved.id}`;
    } catch (err) {
      toast('Save failed: ' + err.message, { kind: 'danger' });
    } finally {
      saveBtn.disabled = false;
    }
  }

  return { node: root, cleanup: () => releaseOwner(OWNER) };
}
