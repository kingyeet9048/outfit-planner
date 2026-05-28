import { el, renderTopbar, iconButton, toast, confirm, sheet } from '../ui.js';
import { items as itemsStore, outfits as outfitsStore } from '../store.js';
import { renderStack, outfitRollup } from '../components/outfit-stack.js';
import { urlFor, releaseOwner, hasBytes } from '../image.js';

const CATEGORY_LABELS = { top: 'Top', pant: 'Pant', shoes: 'Shoes', accessory: 'Accessory', other: 'Other' };
const CATEGORY_ICONS = { top: '👕', pant: '👖', shoes: '👟', accessory: '✨', other: '🎒' };

// Order items appear in the section list — top-down anatomical
const SECTION_ORDER = [
  { key: 'accessoryIds', label: 'Accessories', icon: '✨' },
  { key: 'topId', label: 'Top', icon: '👕', single: true },
  { key: 'pantId', label: 'Pant', icon: '👖', single: true },
  { key: 'shoesId', label: 'Shoes', icon: '👟', single: true },
  { key: 'otherIds', label: 'Other', icon: '🎒' }
];

export async function view({ id }) {
  const OWNER = 'outfit-view';
  releaseOwner(OWNER);

  const outfit = await outfitsStore.get(id);
  if (!outfit) {
    renderTopbar({ title: 'Not found', left: el('a', { class: 'icon-btn', href: '#/outfits' }, '◀') });
    return { node: el('div', { class: 'state' }, [el('h3', null, 'Outfit not found')]) };
  }

  const allItems = await itemsStore.all();
  const itemsById = new Map(allItems.map(i => [i.id, i]));
  const rollup = outfitRollup({ outfit, itemsById });

  const menuBtn = iconButton('More', '⋯', openMenu);
  renderTopbar({
    title: 'Outfit',
    left: el('a', { class: 'icon-btn', href: '#/outfits', 'aria-label': 'Back' }, '◀'),
    right: menuBtn
  });

  const root = el('div', { class: 'detail-view outfit-detail' });

  // Hero — large anatomical stack
  root.appendChild(el('div', { class: 'detail-hero outfit-hero' }, [
    renderStack({ outfit, itemsById, size: 'lg', ownerKey: OWNER })
  ]));

  // Name + rollup
  root.appendChild(el('h2', { class: 'detail-title' }, [
    outfit.aiGenerated ? el('span', { class: 'ai-spark inline', 'aria-hidden': 'true', title: 'AI-suggested' }, '✨ ') : null,
    outfit.name || 'Untitled'
  ]));
  root.appendChild(el('div', { class: 'detail-pills' }, [
    outfit.aiGenerated ? el('span', { class: 'badge badge-accent' }, '✨ AI-suggested') : null,
    rollup.total === 0
      ? el('span', { class: 'badge' }, 'Empty')
      : rollup.toBuy === 0
        ? el('span', { class: 'badge badge-success' }, '✓ Complete')
        : el('span', { class: 'badge badge-warn' }, `$ ${rollup.toBuy} to buy`),
    el('span', { class: 'badge' }, `${rollup.total} item${rollup.total === 1 ? '' : 's'}`)
  ]));

  // AI rationale (if present)
  if (outfit.aiGenerated && outfit.aiRationale && outfit.aiRationale.trim()) {
    root.appendChild(el('section', { class: 'detail-section' }, [
      el('h3', { class: 'detail-section-title' }, "Stylist's note"),
      el('p', { class: 'detail-body' }, outfit.aiRationale),
      outfit.aiPrompt ? el('p', { class: 'meta', style: { marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' } }, `Prompted by: "${outfit.aiPrompt}"`) : null
    ]));
  }

  // Per-slot item list — tap to drill into item detail
  const slotsBody = el('div', { class: 'list' });
  let anySlotFilled = false;
  for (const section of SECTION_ORDER) {
    const ids = section.single
      ? (outfit[section.key] ? [outfit[section.key]] : [])
      : (outfit[section.key] || []);
    ids.forEach(itemId => {
      const it = itemsById.get(itemId);
      if (!it) return;
      anySlotFilled = true;
      slotsBody.appendChild(el('a', { class: 'list-row', href: `#/item/${it.id}` }, [
        el('div', { class: 'thumb' }, hasBytes(it.imageBlob)
          ? el('img', { src: urlFor(OWNER, it.imageBlob), alt: '' })
          : el('span', null, CATEGORY_ICONS[it.category] || section.icon)),
        el('div', { class: 'row-body' }, [
          el('div', { class: 'row-title' }, it.name || '(unnamed)'),
          el('div', { class: 'row-sub' }, [
            CATEGORY_LABELS[it.category] || it.category,
            it.subcategory ? ` · ${it.subcategory}` : ''
          ].join(''))
        ]),
        el('span', { class: `ownership-badge ${it.owned ? 'owned' : 'tobuy'}`, title: it.owned ? 'Owned' : 'To buy', style: { position: 'static', marginRight: '4px' } }, it.owned ? '✓' : '$'),
        el('span', { class: 'row-chevron' }, '›')
      ]));
    });
  }
  if (anySlotFilled) {
    root.appendChild(el('section', { class: 'detail-section' }, [
      el('h3', { class: 'detail-section-title' }, 'Items'),
      slotsBody
    ]));
  } else {
    root.appendChild(el('div', { class: 'state', style: { padding: '24px' } }, [
      el('div', { class: 'state-icon' }, '👔'),
      el('p', null, 'No items added yet.')
    ]));
  }

  // Notes
  if (outfit.notes && outfit.notes.trim()) {
    root.appendChild(el('section', { class: 'detail-section' }, [
      el('h3', { class: 'detail-section-title' }, 'Notes'),
      el('p', { class: 'detail-body' }, outfit.notes)
    ]));
  }

  // Primary action
  root.appendChild(el('div', { class: 'detail-actions' }, [
    el('a', { class: 'btn btn-primary btn-block', href: `#/outfit/${outfit.id}/edit` }, '✏️ Edit outfit')
  ]));

  async function openMenu() {
    await sheet({
      title: outfit.name || 'Outfit',
      body: (close) => el('div', { class: 'list' }, [
        el('a', {
          class: 'list-row',
          href: `#/outfit/${outfit.id}/edit`,
          onClick: () => close()
        }, [
          el('div', { class: 'thumb' }, '✏️'),
          el('div', { class: 'row-body' }, [el('div', { class: 'row-title' }, 'Edit outfit')])
        ]),
        el('button', {
          type: 'button',
          class: 'list-row',
          style: { color: 'var(--danger)' },
          onClick: async () => {
            close();
            const ok = await confirm({ title: 'Delete outfit?', message: 'Days that use this outfit will be cleared. Items are not deleted.', confirmLabel: 'Delete', danger: true });
            if (!ok) return;
            await outfitsStore.remove(outfit.id);
            toast('Outfit deleted');
            location.hash = '#/outfits';
          }
        }, [
          el('div', { class: 'thumb' }, '🗑️'),
          el('div', { class: 'row-body' }, [el('div', { class: 'row-title' }, 'Delete outfit')])
        ])
      ])
    });
  }

  return { node: root, cleanup: () => releaseOwner(OWNER) };
}
