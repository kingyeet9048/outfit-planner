import { el, renderTopbar, iconLink } from '../ui.js';
import { items as itemsStore, outfits as outfitsStore } from '../store.js';
import { renderStack, outfitRollup } from '../components/outfit-stack.js';
import { releaseOwner } from '../image.js';

export async function view() {
  const OWNER = 'outfits-list';
  releaseOwner(OWNER);

  renderTopbar({ title: 'Outfits', right: iconLink('#/outfit/new', 'New outfit', '+') });

  const [list, allItems] = await Promise.all([outfitsStore.all(), itemsStore.all()]);
  const itemsById = new Map(allItems.map(i => [i.id, i]));
  const root = el('div', { class: 'outfits-view' });

  if (!list.length) {
    root.appendChild(el('div', { class: 'state' }, [
      el('div', { class: 'state-icon' }, '👔'),
      el('h3', null, 'No outfits yet'),
      el('p', null, 'Combine your items into reusable outfits — then assign them to trip days.'),
      el('a', { class: 'btn btn-primary', href: '#/outfit/new' }, 'Create your first outfit')
    ]));
    return { node: root, cleanup: () => releaseOwner(OWNER) };
  }

  const grid = el('div', { class: 'outfit-grid' });
  list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  list.forEach(o => {
    const stack = renderStack({ outfit: o, itemsById, size: 'md', ownerKey: OWNER });
    const r = outfitRollup({ outfit: o, itemsById });
    const rollupBadge = r.total === 0
      ? el('span', { class: 'badge' }, 'Empty')
      : r.toBuy === 0
        ? el('span', { class: 'badge badge-success' }, '✓ Complete')
        : el('span', { class: 'badge badge-warn' }, `$ ${r.toBuy} to buy`);

    grid.appendChild(el('a', { class: 'outfit-card', href: `#/outfit/${o.id}` }, [
      stack,
      el('div', { class: 'outfit-name' }, o.name || 'Untitled'),
      el('div', { class: 'outfit-rollup' }, rollupBadge)
    ]));
  });
  root.appendChild(grid);
  return { node: root, cleanup: () => releaseOwner(OWNER) };
}
