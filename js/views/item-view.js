import { el, renderTopbar, iconButton, toast, confirm, sheet, backControl } from '../ui.js';
import { items as itemsStore, outfits as outfitsStore } from '../store.js';
import { urlFor, releaseOwner, hasBytes } from '../image.js';
import { normalizeTags } from '../search.js';

const CATEGORY_LABELS = { top: 'Top', pant: 'Pant', shoes: 'Shoes', accessory: 'Accessory', other: 'Other' };
const CATEGORY_ICONS = { top: '👕', pant: '👖', shoes: '👟', accessory: '✨', other: '🎒' };

export async function view({ id }) {
  const OWNER = 'item-view';
  releaseOwner(OWNER);

  const item = await itemsStore.get(id);
  if (!item) {
    renderTopbar({ title: 'Not found', left: backControl('#/items') });
    return { node: el('div', { class: 'state' }, [el('h3', null, 'Item not found')]) };
  }

  const usedBy = await outfitsStore.all().then(all => all.filter(o =>
    o.topId === id || o.pantId === id || o.shoesId === id ||
    (o.accessoryIds || []).includes(id) || (o.otherIds || []).includes(id)
  ));

  const menuBtn = iconButton('More', '⋯', openMenu);
  renderTopbar({
    title: 'Item',
    left: backControl('#/items'),
    right: menuBtn
  });

  const root = el('div', { class: 'detail-view item-detail' });

  // Big centered image / category icon
  root.appendChild(el('div', { class: 'detail-hero' }, [
    hasBytes(item.imageBlob)
      ? el('img', { class: 'detail-hero-img', src: urlFor(OWNER, item.imageBlob), alt: item.name })
      : el('div', { class: 'detail-hero-fallback', 'aria-hidden': 'true' }, CATEGORY_ICONS[item.category] || '👕')
  ]));

  // Name + status pills
  root.appendChild(el('h2', { class: 'detail-title' }, item.name || '(unnamed)'));
  root.appendChild(el('div', { class: 'detail-pills' }, [
    el('span', { class: 'badge badge-accent' }, [
      CATEGORY_LABELS[item.category] || item.category,
      item.subcategory ? ` · ${item.subcategory}` : ''
    ].join('')),
    el('span', { class: `badge ${item.owned ? 'badge-success' : 'badge-warn'}` }, item.owned ? '✓ Owned' : '$ To buy')
  ]));

  const tags = normalizeTags(item.tags);
  if (tags.length) {
    root.appendChild(el('div', { class: 'detail-tags' }, tags.map(tag =>
      el('a', { class: 'badge tag-link', href: `#/items?tag=${encodeURIComponent(tag)}` }, `#${tag}`)
    )));
  }

  // Description
  if (item.description && item.description.trim()) {
    root.appendChild(el('section', { class: 'detail-section' }, [
      el('h3', { class: 'detail-section-title' }, 'Description'),
      el('p', { class: 'detail-body' }, item.description)
    ]));
  }

  // Purchase link
  if (item.purchaseUrl && item.purchaseUrl.trim()) {
    root.appendChild(el('section', { class: 'detail-section' }, [
      el('a', {
        class: 'btn btn-secondary btn-block',
        href: item.purchaseUrl,
        target: '_blank',
        rel: 'noopener noreferrer'
      }, [item.owned ? '🔗 Visit product page' : '🛒 Buy now', ' →'])
    ]));
  }

  // Used by outfits
  if (usedBy.length) {
    const list = el('div', { class: 'list' });
    usedBy.forEach(o => {
      list.appendChild(el('a', { class: 'list-row', href: `#/outfit/${o.id}` }, [
        el('div', { class: 'thumb' }, '👔'),
        el('div', { class: 'row-body' }, [
          el('div', { class: 'row-title' }, o.name || 'Untitled'),
        ]),
        el('span', { class: 'row-chevron' }, '›')
      ]));
    });
    root.appendChild(el('section', { class: 'detail-section' }, [
      el('h3', { class: 'detail-section-title' }, `Used in ${usedBy.length} outfit${usedBy.length === 1 ? '' : 's'}`),
      list
    ]));
  }

  // Primary actions
  root.appendChild(el('div', { class: 'detail-actions' }, [
    el('a', { class: 'btn btn-primary btn-block', href: `#/item/${item.id}/edit` }, '✏️ Edit item')
  ]));

  // ---- Menu ----
  async function openMenu() {
    await sheet({
      title: item.name || 'Item',
      body: (close) => el('div', { class: 'list' }, [
        el('a', {
          class: 'list-row',
          href: `#/item/${item.id}/edit`,
          onClick: () => close()
        }, [
          el('div', { class: 'thumb' }, '✏️'),
          el('div', { class: 'row-body' }, [el('div', { class: 'row-title' }, 'Edit item')])
        ]),
        el('button', {
          type: 'button',
          class: 'list-row',
          style: { color: 'var(--danger)' },
          onClick: async () => {
            close();
            const message = usedBy.length
              ? `This item is used in ${usedBy.length} outfit${usedBy.length === 1 ? '' : 's'}. It will be removed from those outfits.`
              : 'This will permanently delete the item.';
            const ok = await confirm({ title: 'Delete item?', message, confirmLabel: 'Delete', danger: true });
            if (!ok) return;
            await itemsStore.remove(item.id);
            toast('Item deleted');
            location.hash = '#/items';
          }
        }, [
          el('div', { class: 'thumb' }, '🗑️'),
          el('div', { class: 'row-body' }, [el('div', { class: 'row-title' }, 'Delete item')])
        ])
      ])
    });
  }

  return { node: root, cleanup: () => releaseOwner(OWNER) };
}
