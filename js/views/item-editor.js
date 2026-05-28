import { el, renderTopbar, toast, confirm } from '../ui.js';
import { items as itemsStore } from '../store.js';
import { resizeFile, urlFor, releaseOwner, hasBytes } from '../image.js';

const CATEGORIES = [
  { value: 'top', label: 'Top' },
  { value: 'pant', label: 'Pant' },
  { value: 'shoes', label: 'Shoes' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'other', label: 'Other' }
];

export async function view({ id }) {
  const OWNER = 'item-editor';
  releaseOwner(OWNER);

  const isNew = !id || id === 'new';
  const existing = isNew ? null : await itemsStore.get(id);

  if (!isNew && !existing) {
    renderTopbar({ title: 'Not found', left: el('a', { class: 'icon-btn', href: '#/items' }, '◀') });
    return { node: el('div', { class: 'state' }, [el('h3', null, 'Item not found')]) };
  }

  const state = {
    name: existing?.name || '',
    category: existing?.category || 'top',
    subcategory: existing?.subcategory || '',
    description: existing?.description || '',
    purchaseUrl: existing?.purchaseUrl || '',
    owned: existing ? !!existing.owned : true,
    imageBlob: existing?.imageBlob || null,
    // True only when the user actually replaced the photo in this session.
    // Avoids re-writing an unchanged Blob to IndexedDB, which can corrupt the
    // blob on WebKit (iOS Safari / Brave) in some scenarios.
    imageBlobDirty: false,
    dirty: false
  };

  const saveBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: onSave }, 'Save');
  const backLink = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back', onClick: tryLeave }, '◀');

  renderTopbar({
    title: isNew ? 'New item' : 'Edit item',
    left: backLink,
    right: saveBtn
  });

  const exitHash = existing ? `#/item/${existing.id}` : '#/items';

  async function tryLeave() {
    if (state.dirty) {
      const ok = await confirm({ title: 'Discard changes?', message: 'You have unsaved changes.', confirmLabel: 'Discard', danger: true });
      if (!ok) return;
    }
    location.hash = exitHash;
  }

  // ---- Form ----
  const root = el('form', { class: 'item-editor', onSubmit: (e) => { e.preventDefault(); onSave(); } });

  // Image picker
  const hasInitialImage = hasBytes(state.imageBlob);
  const picker = el('label', { class: 'image-picker' + (hasInitialImage ? ' has-image' : '') });
  const imgEl = el('img', { src: hasInitialImage ? urlFor(OWNER, state.imageBlob) : '', alt: '', style: hasInitialImage ? null : { display: 'none' } });
  const placeholder = el('div', { class: 'picker-empty' }, [
    el('span', { class: 'picker-icon' }, '📷'),
    el('span', { class: 'picker-text' }, 'Add photo')
  ]);
  const fileInput = el('input', {
    type: 'file', accept: 'image/*',
    onChange: async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      picker.classList.add('busy');
      try {
        const blob = await resizeFile(file);
        // Replace previous URL
        releaseOwner(OWNER);
        state.imageBlob = blob;
        state.imageBlobDirty = true;
        state.dirty = true;
        const url = urlFor(OWNER, blob);
        imgEl.src = url;
        imgEl.style.display = '';
        placeholder.style.display = 'none';
        picker.classList.add('has-image');
      } catch (err) {
        toast('Could not process image: ' + err.message, { kind: 'danger' });
      } finally {
        picker.classList.remove('busy');
        fileInput.value = '';
      }
    }
  });
  if (!hasInitialImage) imgEl.style.display = 'none';
  else placeholder.style.display = 'none';
  picker.appendChild(imgEl);
  picker.appendChild(placeholder);
  picker.appendChild(fileInput);
  root.appendChild(picker);

  // Name
  root.appendChild(field('Name', el('input', {
    type: 'text', value: state.name, placeholder: 'e.g., Linen Shirt',
    onInput: (e) => { state.name = e.target.value; state.dirty = true; }
  })));

  // Category — segmented control
  const segmented = el('div', { class: 'segmented', role: 'tablist' });
  const subcatVisible = (cat) => cat === 'accessory' || cat === 'other';
  const subcatPlaceholder = (cat) => cat === 'other' ? 'e.g., jacket, bag, hat' : 'e.g., watch, necklace, ring';
  const subcatInput = el('input', {
    type: 'text', value: state.subcategory, placeholder: subcatPlaceholder(state.category),
    onInput: (e) => { state.subcategory = e.target.value; state.dirty = true; }
  });
  const subcatField = el('div', { class: 'field', style: subcatVisible(state.category) ? null : { display: 'none' } }, [
    el('label', null, 'Subcategory'),
    subcatInput
  ]);
  CATEGORIES.forEach(c => {
    segmented.appendChild(el('button', {
      type: 'button',
      role: 'tab',
      'aria-pressed': state.category === c.value ? 'true' : 'false',
      onClick: () => {
        state.category = c.value;
        state.dirty = true;
        segmented.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.textContent === c.label ? 'true' : 'false'));
        subcatField.style.display = subcatVisible(c.value) ? '' : 'none';
        subcatInput.placeholder = subcatPlaceholder(c.value);
      }
    }, c.label));
  });
  root.appendChild(field('Category', segmented));
  root.appendChild(subcatField);

  // Ownership toggle
  const toggleInput = el('input', {
    type: 'checkbox',
    checked: state.owned,
    role: 'switch',
    'aria-label': 'I own this item',
    onChange: (e) => { state.owned = e.target.checked; state.dirty = true; }
  });
  const toggle = el('label', { class: 'toggle-row' }, [
    el('div', { class: 'toggle-label' }, [
      el('strong', null, state.owned ? 'I own this' : 'Need to buy'),
      el('small', null, state.owned ? 'Hidden from trip shopping lists.' : 'Will appear in trip shopping lists.')
    ]),
    el('span', { class: 'toggle-switch' }, [toggleInput, el('span', { class: 'track' }), el('span', { class: 'thumb' })])
  ]);
  // Update label text live
  toggleInput.addEventListener('change', () => {
    const label = toggle.querySelector('.toggle-label');
    label.replaceChildren(
      el('strong', null, state.owned ? 'I own this' : 'Need to buy'),
      el('small', null, state.owned ? 'Hidden from trip shopping lists.' : 'Will appear in trip shopping lists.')
    );
  });
  root.appendChild(toggle);

  // Description
  root.appendChild(field('Description (optional)', el('textarea', {
    value: state.description, rows: 3, placeholder: 'Color, brand, notes…',
    onInput: (e) => { state.description = e.target.value; state.dirty = true; }
  })));

  // Purchase URL
  root.appendChild(field('Purchase URL (optional)', el('input', {
    type: 'url', value: state.purchaseUrl, placeholder: 'https://…', inputmode: 'url',
    onInput: (e) => { state.purchaseUrl = e.target.value; state.dirty = true; }
  })));

  // Save button (full width on mobile)
  root.appendChild(el('button', { type: 'submit', class: 'btn btn-primary btn-block', style: { marginTop: '8px' } }, 'Save item'));

  // Delete (only on edit)
  if (existing) {
    root.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block',
      style: { marginTop: '16px', color: 'var(--danger)' },
      onClick: async () => {
        const used = await itemsStore.usedByOutfits(existing.id);
        const message = used.length
          ? `This item is used in ${used.length} outfit${used.length === 1 ? '' : 's'}. It will be removed from those outfits.`
          : 'This will permanently delete the item.';
        const ok = await confirm({ title: 'Delete item?', message, confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await itemsStore.remove(existing.id);
        toast('Item deleted');
        location.hash = '#/items';
      }
    }, 'Delete item'));
  }

  async function onSave() {
    if (!state.name.trim()) {
      toast('Please enter a name', { kind: 'danger' });
      return;
    }
    saveBtn.disabled = true;
    try {
      const payload = {
        id: existing?.id,
        name: state.name.trim(),
        category: state.category,
        subcategory: state.subcategory.trim(),
        description: state.description.trim(),
        purchaseUrl: state.purchaseUrl.trim(),
        owned: state.owned
      };
      // Only pass imageBlob when the user touched it. items.put() falls back to
      // the existing record's imageBlob when the key isn't present.
      if (state.imageBlobDirty) payload.imageBlob = state.imageBlob;
      const saved = await itemsStore.put(payload);
      toast(isNew ? 'Item added' : 'Item saved', { kind: 'success' });
      state.dirty = false;
      // Land on the read-only view after save — user can re-tap Edit to keep editing.
      location.hash = `#/item/${saved.id}`;
    } catch (err) {
      toast('Save failed: ' + err.message, { kind: 'danger' });
    } finally {
      saveBtn.disabled = false;
    }
  }

  return { node: root, cleanup: () => releaseOwner(OWNER) };
}

function field(labelText, control) {
  return el('div', { class: 'field' }, [el('label', null, labelText), control]);
}
