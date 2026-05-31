import { el, sheet } from '../ui.js';
import { urlFor, hasBytes } from '../image.js';
import { items as itemsStore, outfits as outfitsStore } from '../store.js';
import { buildOutfitReuseSummary, reuseSummaryShortText } from '../reuse.js';
import { cleanSearchQuery, itemMatchesQuery, normalizeTags, outfitMatchesQuery } from '../search.js';

const CATEGORY_LABELS = { top: 'Top', pant: 'Pant', shoes: 'Shoes', accessory: 'Accessory', other: 'Other' };
const CATEGORY_ICONS = { top: '👕', pant: '👖', shoes: '👟', accessory: '✨', other: '🎒' };

function mapById(list) {
  return new Map((Array.isArray(list) ? list : []).map(entry => [entry.id, entry]));
}

function isMapLike(value) {
  return !!(value && typeof value.get === 'function');
}

function planOutfitIds(planByDate, date) {
  if (!planByDate || !date) return [];
  const plan = planByDate instanceof Map
    ? planByDate.get(date)
    : Array.isArray(planByDate)
      ? planByDate.find(p => p && p.date === date)
      : planByDate[date];
  if (!plan) return [];
  if (Array.isArray(plan.outfitIds)) return plan.outfitIds;
  return plan.outfitId ? [plan.outfitId] : [];
}

// Pick a single item filtered by category. Returns Promise<itemId|null|undefined>.
// undefined = dismissed without choice; null = explicit "Clear slot"; string = chosen id
export async function pickItem({ category, currentId = null, allowClear = true, ownerKey = 'picker' } = {}) {
  const list = await itemsStore.byCategory(category);
  list.sort((a, b) => (a.owned === b.owned ? (a.name || '').localeCompare(b.name || '') : a.owned ? -1 : 1));

  return sheet({
    title: `Choose ${CATEGORY_LABELS[category] || 'item'}`,
    body: (close) => {
      let q = '';
      let searchInput, clearSearchBtn;
      const grid = el('div', { class: 'item-grid' });
      const wrap = el('div', { class: 'picker-stack' });

      if (list.length) {
        searchInput = el('input', {
          type: 'search',
          placeholder: 'Search items',
          'aria-label': 'Search items',
          inputmode: 'search',
          enterkeyhint: 'search',
          onInput: (e) => {
            setQuery(e.target.value);
            render();
          }
        });
        clearSearchBtn = el('button', {
          type: 'button',
          class: 'search-clear',
          'aria-label': 'Clear search',
          hidden: true,
          onClick: () => {
            setQuery('');
            searchInput.focus();
            render();
          }
        }, '×');
        wrap.appendChild(el('div', { class: 'search-box sheet-search' }, [
          el('span', { class: 'search-icon', 'aria-hidden': 'true' }, '🔍'),
          searchInput,
          clearSearchBtn
        ]));
      }
      wrap.appendChild(grid);

      function setQuery(value) {
        q = cleanSearchQuery(value);
        if (searchInput && searchInput.value !== q) searchInput.value = q;
        if (clearSearchBtn) clearSearchBtn.hidden = !q;
      }

      function render() {
        const children = [];
        if (allowClear && currentId) {
          children.push(el('button', {
            type: 'button',
            class: 'item-card',
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', cursor: 'pointer' },
            onClick: () => close(null)
          }, [
            el('div', { class: 'thumb-wrap', style: { aspectRatio: '1', width: '100%' } }, '🗑️'),
            el('div', { class: 'item-name' }, 'Clear slot')
          ]));
        }
        if (!list.length) {
          children.push(el('div', { class: 'state', style: { gridColumn: '1/-1' } }, [
            el('div', { class: 'state-icon' }, CATEGORY_ICONS[category] || '👕'),
            el('h3', null, `No ${CATEGORY_LABELS[category]?.toLowerCase() || 'items'} yet`),
            el('p', null, 'Add an item to use it in outfits.'),
            el('a', { class: 'btn btn-primary', href: '#/item/new', onClick: () => close(undefined) }, 'Add item')
          ]));
        } else {
          const visible = list.filter(it => itemMatchesQuery(it, q));
          if (!visible.length) {
            children.push(el('div', { class: 'state', style: { gridColumn: '1/-1' } }, [
              el('div', { class: 'state-icon' }, '🔍'),
              el('h3', null, 'No matching items'),
              el('p', null, 'Try a different search.'),
              q ? el('button', {
                type: 'button',
                class: 'btn btn-secondary',
                onClick: () => {
                  setQuery('');
                  searchInput.focus();
                  render();
                }
              }, 'Clear search') : null
            ]));
          } else {
            visible.forEach(it => {
              const tags = normalizeTags(it.tags).slice(0, 2);
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
                it.subcategory ? el('div', { class: 'item-sub' }, it.subcategory) : null,
                tags.length ? el('div', { class: 'mini-tags' }, tags.map(tag => el('span', { class: 'mini-tag' }, `#${tag}`))) : null
              ]);
              children.push(card);
            });
          }
        }
        grid.replaceChildren(...children);
      }

      render();
      return wrap;
    },
    dismissible: true
  });
}

// Pick a single outfit. Returns Promise<outfitId|null|undefined>
export async function pickOutfit({ currentId = null, allowClear = true, reuseContext = null } = {}) {
  const list = await outfitsStore.all();
  list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const outfitsById = isMapLike(reuseContext?.outfitsById) ? reuseContext.outfitsById : mapById(list);
  const itemsById = isMapLike(reuseContext?.itemsById) ? reuseContext.itemsById : mapById(await itemsStore.all());
  const targetOutfitIds = planOutfitIds(reuseContext?.planByDate, reuseContext?.date);
  const preventTargetDuplicates = !!reuseContext?.preventTargetDuplicates;

  return sheet({
    title: 'Choose outfit',
    body: (close) => {
      let q = '';
      let searchInput, clearSearchBtn;
      const wrap = el('div', { class: 'list' });
      const outer = el('div', { class: 'picker-stack' });
      if (list.length) {
        searchInput = el('input', {
          type: 'search',
          placeholder: 'Search outfits',
          'aria-label': 'Search outfits',
          inputmode: 'search',
          enterkeyhint: 'search',
          onInput: (e) => {
            setQuery(e.target.value);
            render();
          }
        });
        clearSearchBtn = el('button', {
          type: 'button',
          class: 'search-clear',
          'aria-label': 'Clear search',
          hidden: true,
          onClick: () => {
            setQuery('');
            searchInput.focus();
            render();
          }
        }, '×');
        outer.appendChild(el('div', { class: 'search-box sheet-search' }, [
          el('span', { class: 'search-icon', 'aria-hidden': 'true' }, '🔍'),
          searchInput,
          clearSearchBtn
        ]));
      }
      outer.appendChild(wrap);

      function setQuery(value) {
        q = cleanSearchQuery(value);
        if (searchInput && searchInput.value !== q) searchInput.value = q;
        if (clearSearchBtn) clearSearchBtn.hidden = !q;
      }

      function render() {
        const children = [];
        if (allowClear && currentId) {
          children.push(el('button', {
            type: 'button',
            class: 'list-row',
            style: { borderStyle: 'dashed', color: 'var(--danger)', justifyContent: 'center' },
            onClick: () => close(null)
          }, '🗑️ Remove this outfit'));
        }
        if (!list.length) {
          children.push(el('div', { class: 'state' }, [
            el('div', { class: 'state-icon' }, '👔'),
            el('h3', null, 'No outfits yet'),
            el('p', null, 'Create an outfit to plan your days.'),
            el('a', { class: 'btn btn-primary', href: '#/outfit/new', onClick: () => close(undefined) }, 'Create outfit')
          ]));
        } else {
          const visible = list.filter(o => outfitMatchesQuery(o, itemsById, q));
          if (!visible.length) {
            children.push(el('div', { class: 'state' }, [
              el('div', { class: 'state-icon' }, '🔍'),
              el('h3', null, 'No matching outfits'),
              el('p', null, 'Try a different search.'),
              q ? el('button', {
                type: 'button',
                class: 'btn btn-secondary',
                onClick: () => {
                  setQuery('');
                  searchInput.focus();
                  render();
                }
              }, 'Clear search') : null
            ]));
          } else {
            visible.forEach(o => {
              const alreadyOnTarget = preventTargetDuplicates && targetOutfitIds.includes(o.id) && o.id !== currentId;
              const reuseSummary = reuseContext
                ? buildOutfitReuseSummary({
                  outfit: o,
                  date: reuseContext.date,
                  planByDate: reuseContext.planByDate,
                  outfitsById,
                  itemsById
                })
                : null;
              const reuseText = reuseSummaryShortText(reuseSummary);
              children.push(el('button', {
                type: 'button',
                class: 'list-row' + (alreadyOnTarget ? ' is-disabled' : ''),
                'aria-pressed': o.id === currentId ? 'true' : 'false',
                disabled: alreadyOnTarget,
                onClick: () => close(o.id)
              }, [
                el('div', { class: 'thumb' }, '👔'),
                el('div', { class: 'row-body' }, [
                  el('div', { class: 'row-title' }, o.name || 'Untitled'),
                  el('div', { class: 'row-sub' }, outfitItemSummary(o, itemsById)),
                  alreadyOnTarget ? el('div', { class: 'picker-note' }, 'Already on this day') : null,
                  reuseText ? el('div', { class: `reuse-inline ${reuseSummary.level === 'strong' ? 'reuse-inline-strong' : 'reuse-inline-soft'}` }, reuseText) : null
                ]),
                el('span', { class: 'row-chevron' }, '›')
              ]));
            });
          }
        }
        wrap.replaceChildren(...children);
      }

      render();
      return outer;
    }
  });
}

function outfitItemSummary(outfit, itemsById) {
  const ids = [
    outfit.topId,
    outfit.pantId,
    outfit.shoesId,
    ...(outfit.accessoryIds || []),
    ...(outfit.otherIds || [])
  ].filter(Boolean);
  const names = ids.map(id => isMapLike(itemsById) ? itemsById.get(id)?.name : '').filter(Boolean);
  if (names.length) return names.slice(0, 3).join(' · ') + (names.length > 3 ? ` +${names.length - 3}` : '');
  return [
    (outfit.topId ? '👕 ' : ''),
    (outfit.pantId ? '👖 ' : ''),
    (outfit.shoesId ? '👟 ' : ''),
    (outfit.accessoryIds && outfit.accessoryIds.length ? `+${outfit.accessoryIds.length} acc` : '')
  ].filter(Boolean).join('');
}
