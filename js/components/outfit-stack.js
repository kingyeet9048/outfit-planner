import { el } from '../ui.js';
import { urlFor } from '../image.js';

const CATEGORY_ICONS = { top: '👕', pant: '👖', shoes: '👟', accessory: '✨', other: '🎒' };

function ownershipBadge(item, size = 'sm') {
  if (!item) return null;
  return el('span', {
    class: `ownership-badge ${size} ${item.owned ? 'owned' : 'tobuy'}`,
    'aria-label': item.owned ? 'Owned' : 'To buy',
    title: item.owned ? 'Owned' : 'To buy'
  }, item.owned ? '✓' : '$');
}

function thumbInner(item, ownerKey) {
  if (item && item.imageBlob) {
    return el('img', { src: urlFor(ownerKey, item.imageBlob), alt: '', loading: 'lazy' });
  }
  return el('span', { 'aria-hidden': 'true' }, CATEGORY_ICONS[item ? item.category : 'top'] || '👕');
}

export function renderStack({ outfit, itemsById, size = 'md', ownerKey = 'stack' }) {
  if (!outfit) {
    return el('div', { class: `outfit-stack ${size}` }, [
      el('div', { class: 'stack-accessories' }),
      el('div', { class: 'stack-slot empty' }, '?')
    ]);
  }
  const accIds = outfit.accessoryIds || [];
  const otherIds = outfit.otherIds || [];
  const miniRow = (ids) => ids.map(id => {
    const it = itemsById.get(id);
    return el('div', { class: 'stack-mini', title: it ? it.name : '' }, [
      thumbInner(it, ownerKey),
      ownershipBadge(it, 'sm')
    ]);
  });

  const buildSlot = (id, cat) => {
    const it = itemsById.get(id);
    if (!it) return el('div', { class: 'stack-slot empty', title: cat }, CATEGORY_ICONS[cat] || '?');
    return el('div', { class: 'stack-slot', title: it.name }, [
      thumbInner(it, ownerKey),
      ownershipBadge(it, size === 'sm' ? 'sm' : (size === 'lg' ? 'lg' : 'sm'))
    ]);
  };

  return el('div', { class: `outfit-stack ${size}` }, [
    el('div', { class: 'stack-accessories' }, accIds.length ? miniRow(accIds) : null),
    buildSlot(outfit.topId, 'top'),
    buildSlot(outfit.pantId, 'pant'),
    buildSlot(outfit.shoesId, 'shoes'),
    otherIds.length ? el('div', { class: 'stack-accessories stack-others' }, miniRow(otherIds)) : null
  ]);
}

export function outfitRollup({ outfit, itemsById }) {
  if (!outfit) return { total: 0, owned: 0, toBuy: 0 };
  const ids = [outfit.topId, outfit.pantId, outfit.shoesId, ...(outfit.accessoryIds || []), ...(outfit.otherIds || [])].filter(Boolean);
  let owned = 0, toBuy = 0;
  for (const id of ids) {
    const it = itemsById.get(id);
    if (!it) continue;
    if (it.owned) owned++; else toBuy++;
  }
  return { total: ids.length, owned, toBuy };
}
