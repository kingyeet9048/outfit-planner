import { el, renderTopbar, iconLink } from '../ui.js';
import { items as itemsStore } from '../store.js';
import { urlFor, releaseOwner } from '../image.js';

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'top', label: 'Tops' },
  { value: 'pant', label: 'Pants' },
  { value: 'shoes', label: 'Shoes' },
  { value: 'accessory', label: 'Accessories' },
  { value: 'other', label: 'Other' },
  { value: 'tobuy', label: 'To buy' }
];

const CATEGORY_ICONS = { top: '👕', pant: '👖', shoes: '👟', accessory: '✨', other: '🎒' };

export async function view() {
  const OWNER = 'items-list';
  releaseOwner(OWNER);

  renderTopbar({
    title: 'Items',
    right: iconLink('#/item/new', 'New item', '+')
  });

  const all = await itemsStore.all();
  const root = el('div', { class: 'items-view' });

  // Active filter (using hash query string for shareability)
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  let filter = params.get('filter') || 'all';

  const chipRow = el('div', { class: 'chip-row', role: 'tablist' });
  CATEGORIES.forEach(c => {
    chipRow.appendChild(el('button', {
      type: 'button',
      class: 'chip',
      role: 'tab',
      'aria-pressed': filter === c.value ? 'true' : 'false',
      onClick: () => {
        filter = c.value;
        location.hash = `#/items?filter=${encodeURIComponent(filter)}`;
      }
    }, c.label));
  });
  root.appendChild(chipRow);

  // Filtered list
  let visible = all;
  if (filter === 'tobuy') visible = all.filter(i => !i.owned);
  else if (filter !== 'all') visible = all.filter(i => i.category === filter);

  if (!all.length) {
    root.appendChild(el('div', { class: 'state' }, [
      el('div', { class: 'state-icon' }, '👕'),
      el('h3', null, 'No items yet'),
      el('p', null, 'Add clothing items to start building outfits for your trip.'),
      el('a', { class: 'btn btn-primary', href: '#/item/new' }, 'Add your first item')
    ]));
    return { node: root, cleanup: () => releaseOwner(OWNER) };
  }

  if (!visible.length) {
    root.appendChild(el('div', { class: 'state' }, [
      el('div', { class: 'state-icon' }, '🔍'),
      el('h3', null, 'Nothing here'),
      el('p', null, 'No items match this filter.'),
    ]));
    return { node: root, cleanup: () => releaseOwner(OWNER) };
  }

  const grid = el('div', { class: 'item-grid' });
  visible.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  visible.forEach(it => {
    grid.appendChild(el('a', {
      class: 'item-card',
      href: `#/item/${it.id}`
    }, [
      el('div', { class: 'thumb-wrap' }, [
        it.imageBlob ? el('img', { src: urlFor(OWNER, it.imageBlob), alt: it.name, loading: 'lazy' }) : el('span', null, CATEGORY_ICONS[it.category] || '👕'),
        el('span', {
          class: `ownership-badge ${it.owned ? 'owned' : 'tobuy'}`,
          'aria-label': it.owned ? 'Owned' : 'To buy',
          title: it.owned ? 'Owned' : 'To buy'
        }, it.owned ? '✓' : '$')
      ]),
      el('div', { class: 'item-name' }, it.name || '(unnamed)'),
      it.subcategory ? el('div', { class: 'item-sub' }, it.subcategory) : null
    ]));
  });
  root.appendChild(grid);

  return { node: root, cleanup: () => releaseOwner(OWNER) };
}
