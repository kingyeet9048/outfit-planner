import { el, renderTopbar, iconLink, iconButton, sheet, toast } from '../ui.js';
import { items as itemsStore, outfits as outfitsStore } from '../store.js';
import { renderStack, outfitRollup } from '../components/outfit-stack.js';
import { releaseOwner } from '../image.js';
import { shareOutfits } from '../share.js';
import { cleanSearchQuery, outfitMatchesQuery } from '../search.js';

export async function view() {
  const OWNER = 'outfits-list';
  releaseOwner(OWNER);

  const [list, allItems] = await Promise.all([outfitsStore.all(), itemsStore.all()]);
  const itemsById = new Map(allItems.map(i => [i.id, i]));
  list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const topbarRight = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
    list.length ? iconButton('Share outfits', '📤', () => openShareSheet(list, itemsById)) : null,
    iconLink('#/outfit/new', 'New outfit', '+')
  ]);
  renderTopbar({ title: 'Outfits', right: topbarRight });

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

  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const state = { q: cleanSearchQuery(params.get('q') || '') };
  const searchInput = el('input', {
    type: 'search',
    value: state.q,
    placeholder: 'Search outfits',
    'aria-label': 'Search outfits',
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

  const results = el('div');
  root.appendChild(results);

  function syncUrl() {
    const qs = state.q ? `?q=${encodeURIComponent(state.q)}` : '';
    const hash = `#/outfits${qs}`;
    if (location.hash !== hash) {
      try { history.replaceState(history.state, '', hash); } catch { location.hash = hash; }
    }
  }

  function renderOutfitCard(o) {
    const stack = renderStack({ outfit: o, itemsById, size: 'md', ownerKey: OWNER });
    const r = outfitRollup({ outfit: o, itemsById });
    const rollupBadge = r.total === 0
      ? el('span', { class: 'badge' }, 'Empty')
      : r.toBuy === 0
        ? el('span', { class: 'badge badge-success' }, '✓ Complete')
        : el('span', { class: 'badge badge-warn' }, `$ ${r.toBuy} to buy`);

    return el('a', { class: 'outfit-card' + (o.aiGenerated ? ' is-ai' : ''), href: `#/outfit/${o.id}` }, [
      o.aiGenerated ? el('span', { class: 'ai-corner-badge', 'aria-label': 'AI-suggested', title: 'AI-suggested' }, '✨') : null,
      stack,
      el('div', { class: 'outfit-name' }, o.name || 'Untitled'),
      el('div', { class: 'outfit-rollup' }, rollupBadge)
    ]);
  }

  function renderResults() {
    const visible = list.filter(o => outfitMatchesQuery(o, itemsById, state.q));
    if (!visible.length) {
      results.replaceChildren(el('div', { class: 'state' }, [
        el('div', { class: 'state-icon' }, '🔍'),
        el('h3', null, 'No matching outfits'),
        el('p', null, 'Try a different search.'),
        el('button', {
          type: 'button',
          class: 'btn btn-secondary',
          onClick: () => {
            state.q = '';
            searchInput.value = '';
            update();
          }
        }, 'Clear search')
      ]));
      return;
    }
    results.replaceChildren(el('div', { class: 'outfit-grid' }, visible.map(renderOutfitCard)));
  }

  function update() {
    clearSearchBtn.hidden = !state.q;
    syncUrl();
    renderResults();
  }

  update();
  return { node: root, cleanup: () => releaseOwner(OWNER) };
}

function openShareSheet(outfits, itemsById) {
  const selected = new Set();
  let countEl, shareBtn;

  const updateCount = () => {
    countEl.textContent = selected.size
      ? `${selected.size} selected`
      : 'Pick outfits to share';
    shareBtn.disabled = selected.size === 0;
    shareBtn.style.opacity = selected.size === 0 ? '0.5' : '1';
  };

  sheet({
    title: 'Share outfits',
    body: (close) => {
      countEl = el('p', { class: 'meta', style: { marginBottom: '12px' } }, 'Pick outfits to share');
      const list = el('div', { class: 'list share-pick-list' });
      outfits.forEach(o => {
        const r = outfitRollup({ outfit: o, itemsById });
        const row = el('label', { class: 'list-row share-pick-row' }, [
          el('input', {
            type: 'checkbox',
            class: 'share-pick-cb',
            onChange: (e) => {
              if (e.target.checked) selected.add(o.id);
              else selected.delete(o.id);
              updateCount();
            }
          }),
          el('div', { class: 'thumb' }, '👔'),
          el('div', { class: 'row-body' }, [
            el('div', { class: 'row-title' }, o.name || 'Untitled'),
            el('div', { class: 'row-sub' }, `${r.total} item${r.total === 1 ? '' : 's'}${r.toBuy ? ` · ${r.toBuy} to buy` : ''}`)
          ])
        ]);
        list.appendChild(row);
      });

      shareBtn = el('button', {
        type: 'button',
        class: 'btn btn-primary btn-block',
        disabled: true,
        style: { marginTop: '16px', opacity: '0.5' },
        onClick: async () => {
          if (!selected.size) return;
          const picked = outfits.filter(o => selected.has(o.id));
          close();
          try {
            const result = await shareOutfits(picked, itemsById);
            if (result.method === 'download') {
              toast(picked.length === 1 ? 'Outfit image downloaded' : 'Outfits image downloaded');
            }
          } catch (err) {
            toast('Share failed: ' + err.message, { kind: 'danger' });
          }
        }
      }, 'Share');

      const wrap = el('div', null, [countEl, list, shareBtn]);
      // Initialise label after children attached so refs are valid
      updateCount();
      return wrap;
    }
  });
}
