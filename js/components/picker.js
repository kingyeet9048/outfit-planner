import { el, sheet } from '../ui.js';
import { urlFor, hasBytes } from '../image.js';
import { items as itemsStore, outfits as outfitsStore } from '../store.js';

const CATEGORY_LABELS = { top: 'Top', pant: 'Pant', shoes: 'Shoes', accessory: 'Accessory', other: 'Other' };
const CATEGORY_ICONS = { top: '👕', pant: '👖', shoes: '👟', accessory: '✨', other: '🎒' };

// Pick a single item filtered by category. Returns Promise<itemId|null|undefined>.
// undefined = dismissed without choice; null = explicit "Clear slot"; string = chosen id
export async function pickItem({ category, currentId = null, allowClear = true, ownerKey = 'picker' } = {}) {
  const list = await itemsStore.byCategory(category);
  list.sort((a, b) => (a.owned === b.owned ? a.name.localeCompare(b.name) : a.owned ? -1 : 1));

  return sheet({
    title: `Choose ${CATEGORY_LABELS[category] || 'item'}`,
    body: (close) => {
      const grid = el('div', { class: 'item-grid' });
      if (allowClear && currentId) {
        const clearBtn = el('button', {
          type: 'button',
          class: 'item-card',
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', cursor: 'pointer' },
          onClick: () => close(null)
        }, [
          el('div', { class: 'thumb-wrap', style: { aspectRatio: '1', width: '100%' } }, '🗑️'),
          el('div', { class: 'item-name' }, 'Clear slot')
        ]);
        grid.appendChild(clearBtn);
      }
      if (!list.length) {
        const noItems = el('div', { class: 'state', style: { gridColumn: '1/-1' } }, [
          el('div', { class: 'state-icon' }, CATEGORY_ICONS[category] || '👕'),
          el('h3', null, `No ${CATEGORY_LABELS[category]?.toLowerCase() || 'items'} yet`),
          el('p', null, 'Add an item to use it in outfits.'),
          el('a', { class: 'btn btn-primary', href: '#/item/new', onClick: () => close(undefined) }, 'Add item')
        ]);
        grid.appendChild(noItems);
      } else {
        list.forEach(it => {
          const card = el('button', {
            type: 'button',
            class: 'item-card',
            'aria-pressed': it.id === currentId ? 'true' : 'false',
            style: { textAlign: 'left' },
            onClick: () => close(it.id)
          }, [
            el('div', { class: 'thumb-wrap' }, [
              hasBytes(it.imageBlob) ? el('img', { src: urlFor(ownerKey, it.imageBlob), alt: '', loading: 'lazy' }) : el('span', null, CATEGORY_ICONS[it.category]),
              el('span', { class: `ownership-badge ${it.owned ? 'owned' : 'tobuy'}`, title: it.owned ? 'Owned' : 'To buy' }, it.owned ? '✓' : '$')
            ]),
            el('div', { class: 'item-name' }, it.name || '(unnamed)'),
            it.subcategory ? el('div', { class: 'item-sub' }, it.subcategory) : null
          ]);
          grid.appendChild(card);
        });
      }
      return grid;
    },
    dismissible: true
  });
}

// Pick a single outfit. Returns Promise<outfitId|null|undefined>
export async function pickOutfit({ currentId = null, allowClear = true } = {}) {
  const list = await outfitsStore.all();
  list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return sheet({
    title: 'Choose outfit',
    body: (close) => {
      const wrap = el('div', { class: 'list' });
      if (allowClear && currentId) {
        wrap.appendChild(el('button', {
          type: 'button',
          class: 'list-row',
          style: { borderStyle: 'dashed', color: 'var(--danger)', justifyContent: 'center' },
          onClick: () => close(null)
        }, '🗑️ Clear this day'));
      }
      if (!list.length) {
        wrap.appendChild(el('div', { class: 'state' }, [
          el('div', { class: 'state-icon' }, '👔'),
          el('h3', null, 'No outfits yet'),
          el('p', null, 'Create an outfit to plan your days.'),
          el('a', { class: 'btn btn-primary', href: '#/outfit/new', onClick: () => close(undefined) }, 'Create outfit')
        ]));
      } else {
        list.forEach(o => {
          wrap.appendChild(el('button', {
            type: 'button',
            class: 'list-row',
            'aria-pressed': o.id === currentId ? 'true' : 'false',
            onClick: () => close(o.id)
          }, [
            el('div', { class: 'thumb' }, '👔'),
            el('div', { class: 'row-body' }, [
              el('div', { class: 'row-title' }, o.name || 'Untitled'),
              el('div', { class: 'row-sub' }, [
                (o.topId ? '👕 ' : ''),
                (o.pantId ? '👖 ' : ''),
                (o.shoesId ? '👟 ' : ''),
                (o.accessoryIds && o.accessoryIds.length ? `+${o.accessoryIds.length} acc` : '')
              ].filter(Boolean).join(''))
            ]),
            el('span', { class: 'row-chevron' }, '›')
          ]));
        });
      }
      return wrap;
    }
  });
}
