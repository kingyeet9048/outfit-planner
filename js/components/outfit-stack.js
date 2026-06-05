import { el } from '../ui.js';
import { urlFor, hasBytes } from '../image.js';
import { categoryIcon } from '../categories.js';

function ownershipBadge(item, size = 'sm', visible = true) {
  if (!item || !visible) return null;
  return el('span', {
    class: `ownership-badge ${size} ${item.owned ? 'owned' : 'tobuy'}`,
    'aria-label': item.owned ? 'Owned' : 'To buy',
    title: item.owned ? 'Owned' : 'To buy'
  }, item.owned ? '✓' : '$');
}

function thumbInner(item, ownerKey) {
  if (item && hasBytes(item.imageBlob)) {
    return el('img', { src: urlFor(ownerKey, item.imageBlob), alt: '', loading: 'lazy' });
  }
  return el('span', { 'aria-hidden': 'true' }, categoryIcon(item ? item.category : 'top'));
}

export function renderStack({ outfit, itemsById, size = 'md', ownerKey = 'stack', showOwnership = true, showEmptySlots = true } = {}) {
  if (!outfit) {
    return el('div', { class: `outfit-stack ${size}` }, [
      el('div', { class: 'stack-accessories' }),
      el('div', { class: 'stack-slot empty' }, '?')
    ]);
  }
  const accIds = outfit.accessoryIds || [];
  const otherIds = outfit.otherIds || [];
  const dressIds = otherIds.filter(id => itemsById.get(id)?.category === 'dress');
  const remainingOtherIds = otherIds.filter(id => !dressIds.includes(id));
  const miniRow = (ids) => ids.map(id => {
    const it = itemsById.get(id);
    return el('div', { class: 'stack-mini', title: it ? it.name : '' }, [
      thumbInner(it, ownerKey),
      ownershipBadge(it, 'sm', showOwnership)
    ]);
  });

  const buildSlot = (id, cat) => {
    const it = itemsById.get(id);
    if (!it) return showEmptySlots ? el('div', { class: 'stack-slot empty', title: cat }, categoryIcon(cat, '?')) : null;
    return el('div', { class: 'stack-slot', title: it.name }, [
      thumbInner(it, ownerKey),
      ownershipBadge(it, size === 'sm' ? 'sm' : (size === 'lg' ? 'lg' : 'sm'), showOwnership)
    ]);
  };

  const hasDress = dressIds.length > 0;
  const bodySlots = hasDress
    ? [
        buildSlot(dressIds[0], 'dress'),
        outfit.topId ? buildSlot(outfit.topId, 'top') : null,
        outfit.pantId ? buildSlot(outfit.pantId, 'pant') : null,
        buildSlot(outfit.shoesId, 'shoes')
      ]
    : [
        buildSlot(outfit.topId, 'top'),
        buildSlot(outfit.pantId, 'pant'),
        buildSlot(outfit.shoesId, 'shoes')
      ];
  const lowerMiniIds = [...dressIds.slice(1), ...remainingOtherIds];
  const visibleAccIds = showEmptySlots ? accIds : accIds.filter(id => itemsById.get(id));
  const visibleLowerMiniIds = showEmptySlots ? lowerMiniIds : lowerMiniIds.filter(id => itemsById.get(id));
  const visibleIds = [...visibleAccIds, ...dressIds, outfit.topId, outfit.pantId, outfit.shoesId, ...visibleLowerMiniIds]
    .filter((id, index, all) => id && all.indexOf(id) === index && itemsById.get(id));

  const children = [
    el('div', { class: 'stack-accessories' }, visibleAccIds.length ? miniRow(visibleAccIds) : null),
    ...bodySlots,
    visibleLowerMiniIds.length ? el('div', { class: 'stack-accessories stack-others' }, miniRow(visibleLowerMiniIds)) : null
  ].filter(Boolean);

  if (!showEmptySlots && !visibleIds.length) {
    children.push(el('div', { class: 'stack-slot empty' }, '?'));
  }

  const singleClass = !showEmptySlots && visibleIds.length === 1 ? ' is-single-item' : '';
  return el('div', { class: `outfit-stack ${size}${singleClass}` }, children);
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
