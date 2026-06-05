import { el, renderTopbar, iconLink } from '../ui.js';
import { items as itemsStore } from '../store.js';
import { urlFor, releaseOwner, hasBytes } from '../image.js';
import { availableTags, cleanSearchQuery, filterItems, normalizeItemFilter, normalizeTags } from '../search.js';
import { ITEM_CATEGORY_FILTERS, categoryIcon } from '../categories.js';

export async function view() {
  const OWNER = 'items-list';
  releaseOwner(OWNER);

  renderTopbar({
    title: 'Items',
    right: iconLink('#/item/new', 'New item', '+')
  });

  const all = await itemsStore.all();
  const root = el('div', { class: 'items-view' });

  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const state = {
    filter: normalizeItemFilter(params.get('filter') || 'all'),
    q: cleanSearchQuery(params.get('q') || ''),
    tag: normalizeTags([params.get('tag') || ''])[0] || ''
  };

  if (!all.length) {
    root.appendChild(el('div', { class: 'state' }, [
      el('div', { class: 'state-icon' }, '👕'),
      el('h3', null, 'No items yet'),
      el('p', null, 'Add clothing items to start building outfits for your trip.'),
      el('a', { class: 'btn btn-primary', href: '#/item/new' }, 'Add your first item')
    ]));
    return { node: root, cleanup: () => releaseOwner(OWNER) };
  }

  const tags = availableTags(all);
  if (state.tag && !tags.includes(state.tag)) tags.unshift(state.tag);

  const searchInput = el('input', {
    type: 'search',
    value: state.q,
    placeholder: 'Search items',
    'aria-label': 'Search items',
    inputmode: 'search',
    enterkeyhint: 'search',
    onInput: (e) => {
      state.q = cleanSearchQuery(e.target.value);
      if (e.target.value !== state.q) e.target.value = state.q;
      update();
    }
  });
  const clearSearchBtn = el('button', {
    type: 'button',
    class: 'search-clear',
    'aria-label': 'Clear search',
    hidden: !state.q,
    onClick: () => {
      state.q = '';
      searchInput.value = '';
      searchInput.focus();
      update();
    }
  }, '×');
  root.appendChild(el('div', { class: 'search-box' }, [
    el('span', { class: 'search-icon', 'aria-hidden': 'true' }, '🔍'),
    searchInput,
    clearSearchBtn
  ]));

  const filterButtons = new Map();
  const chipRow = el('div', { class: 'chip-row', role: 'group', 'aria-label': 'Item categories' });
  ITEM_CATEGORY_FILTERS.forEach(c => {
    const btn = el('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': state.filter === c.value ? 'true' : 'false',
      onClick: () => {
        state.filter = c.value;
        update();
      }
    }, c.label);
    filterButtons.set(c.value, btn);
    chipRow.appendChild(btn);
  });
  root.appendChild(chipRow);

  const tagButtons = new Map();
  if (tags.length) {
    const tagRow = el('div', { class: 'chip-row tag-chip-row', role: 'group', 'aria-label': 'Item tags' });
    const allTagBtn = el('button', {
      type: 'button',
      class: 'chip tag-chip',
      'aria-pressed': state.tag ? 'false' : 'true',
      onClick: () => {
        state.tag = '';
        update();
      }
    }, 'All tags');
    tagButtons.set('', allTagBtn);
    tagRow.appendChild(allTagBtn);
    tags.forEach(tag => {
      const btn = el('button', {
        type: 'button',
        class: 'chip tag-chip',
        'aria-pressed': state.tag === tag ? 'true' : 'false',
        onClick: () => {
          state.tag = state.tag === tag ? '' : tag;
          update();
        }
      }, `#${tag}`);
      tagButtons.set(tag, btn);
      tagRow.appendChild(btn);
    });
    root.appendChild(tagRow);
  }

  const results = el('div');
  root.appendChild(results);

  function syncUrl() {
    const next = new URLSearchParams();
    if (state.filter !== 'all') next.set('filter', state.filter);
    if (state.q) next.set('q', state.q);
    if (state.tag) next.set('tag', state.tag);
    const qs = next.toString();
    const hash = qs ? `#/items?${qs}` : '#/items';
    if (location.hash !== hash) {
      try { history.replaceState(history.state, '', hash); } catch { location.hash = hash; }
    }
  }

  function renderItemCard(it) {
    const tagEls = normalizeTags(it.tags).slice(0, 3).map(tag => el('span', { class: 'mini-tag' }, `#${tag}`));
    return el('a', {
      class: 'item-card',
      href: `#/item/${it.id}`
    }, [
      el('div', { class: 'thumb-wrap' }, [
        hasBytes(it.imageBlob) ? el('img', { src: urlFor(OWNER, it.imageBlob), alt: it.name || '', loading: 'lazy' }) : el('span', null, categoryIcon(it.category)),
        el('span', {
          class: `ownership-badge ${it.owned ? 'owned' : 'tobuy'}`,
          'aria-label': it.owned ? 'Owned' : 'To buy',
          title: it.owned ? 'Owned' : 'To buy'
        }, it.owned ? '✓' : '$')
      ]),
      el('div', { class: 'item-name' }, it.name || '(unnamed)'),
      it.subcategory ? el('div', { class: 'item-sub' }, it.subcategory) : null,
      tagEls.length ? el('div', { class: 'mini-tags' }, tagEls) : null
    ]);
  }

  function renderResults() {
    const visible = filterItems(all, state).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (!visible.length) {
      const hasActiveSearch = !!(state.q || state.tag || state.filter !== 'all');
      results.replaceChildren(el('div', { class: 'state' }, [
        el('div', { class: 'state-icon' }, '🔍'),
        el('h3', null, hasActiveSearch ? 'No matching items' : 'Nothing here'),
        el('p', null, hasActiveSearch ? 'Try a different search, tag, or category.' : 'No items match this filter.'),
        hasActiveSearch ? el('button', {
          type: 'button',
          class: 'btn btn-secondary',
          onClick: () => {
            state.filter = 'all';
            state.q = '';
            state.tag = '';
            searchInput.value = '';
            update();
          }
        }, 'Clear filters') : null
      ]));
      return;
    }
    results.replaceChildren(el('div', { class: 'item-grid' }, visible.map(renderItemCard)));
  }

  function updateControls() {
    clearSearchBtn.hidden = !state.q;
    filterButtons.forEach((btn, value) => btn.setAttribute('aria-pressed', state.filter === value ? 'true' : 'false'));
    tagButtons.forEach((btn, value) => btn.setAttribute('aria-pressed', state.tag === value ? 'true' : 'false'));
  }

  function update() {
    syncUrl();
    updateControls();
    renderResults();
  }

  update();

  return { node: root, cleanup: () => releaseOwner(OWNER) };
}
