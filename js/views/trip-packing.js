import { el, renderTopbar, toast, backControl } from '../ui.js';
import { uuid } from '../db.js';
import { items as itemsStore, outfits as outfitsStore, trips as tripsStore, dayPlans } from '../store.js';
import { urlFor, releaseOwner, hasBytes } from '../image.js';
import {
  addCustomPackingItem,
  deriveTripPacking,
  normalizePackingState,
  removeCustomPackingItem,
  setCustomPackingItemChecked,
  setPackingItemChecked
} from '../packing.js';
import { categoryIcon, categoryLabel } from '../categories.js';

const OWNER = 'trip-packing';
const nowIso = () => new Date().toISOString();

function itemMeta(item) {
  return [categoryLabel(item.category), item.subcategory].filter(Boolean).join(' · ');
}

function itemIcon(item) {
  return categoryIcon(item?.category);
}

function usesText(uses = []) {
  const labels = [];
  const seen = new Set();
  for (const use of uses || []) {
    if (!use?.date || seen.has(use.date)) continue;
    seen.add(use.date);
    labels.push(use.label || use.date);
  }
  if (!labels.length) return '';
  const shown = labels.slice(0, 2).join(', ');
  const extra = labels.length - 2;
  return `Used ${shown}${extra > 0 ? ` +${extra} more` : ''}`;
}

function thumb(item) {
  return el('div', { class: 'packing-thumb' }, hasBytes(item.imageBlob)
    ? el('img', { src: urlFor(OWNER, item.imageBlob), alt: '' })
    : el('span', { 'aria-hidden': 'true' }, itemIcon(item)));
}

export async function view({ id }) {
  releaseOwner(OWNER);
  let trip = await tripsStore.get(id);
  if (!trip) {
    renderTopbar({ title: 'Packing', left: backControl('#/trips') });
    return { node: el('div', { class: 'state' }, [el('h3', null, 'Trip not found')]) };
  }

  renderTopbar({ title: 'Packing', left: backControl(`#/trip/${id}`) });
  const root = el('div', { class: 'packing-view' });
  let currentData = null;
  let progressCountEl = null;
  let progressBarEl = null;
  let progressFillEl = null;
  let progressMetaEl = null;

  async function loadData() {
    const [allItems, allOutfits, plans] = await Promise.all([
      itemsStore.all(),
      outfitsStore.all(),
      dayPlans.byTrip(id)
    ]);
    const itemsById = new Map(allItems.map(item => [item.id, item]));
    const outfitsById = new Map(allOutfits.map(outfit => [outfit.id, outfit]));
    return { itemsById, outfitsById, plans };
  }

  function derive(data = currentData) {
    return deriveTripPacking({
      plans: data.plans,
      outfitsById: data.outfitsById,
      itemsById: data.itemsById,
      packing: trip.packing
    });
  }

  function updateProgress() {
    if (!currentData || !progressCountEl || !progressBarEl || !progressFillEl || !progressMetaEl) return;
    const summary = derive();
    const pct = Math.round(summary.progress * 100);
    progressCountEl.textContent = `${summary.checkedCount}/${summary.totalCount}`;
    progressBarEl.setAttribute('aria-valuemax', String(summary.totalCount));
    progressBarEl.setAttribute('aria-valuenow', String(summary.checkedCount));
    progressFillEl.style.width = `${pct}%`;
    progressMetaEl.textContent = summary.totalCount
      ? `${pct}% packed`
      : 'Add outfits or custom items to start';
  }

  async function savePacking(nextPacking) {
    const previous = trip.packing;
    trip.packing = normalizePackingState(nextPacking);
    updateProgress();
    try {
      await tripsStore.setPacking(id, trip.packing);
    } catch (err) {
      trip.packing = previous;
      updateProgress();
      throw err;
    }
  }

  async function renderAll() {
    releaseOwner(OWNER);
    trip = await tripsStore.get(id);
    currentData = await loadData();
    const summary = derive();
    const sections = [
      renderHeader(summary),
      renderPackSection(summary),
      renderCustomSection(summary)
    ];
    if (summary.toBuyItems.length) sections.splice(2, 0, renderToBuySection(summary));
    root.replaceChildren(...sections);
    updateProgress();
  }

  function renderHeader(summary) {
    const pct = Math.round(summary.progress * 100);
    progressCountEl = el('div', { class: 'packing-progress-count' }, `${summary.checkedCount}/${summary.totalCount}`);
    progressFillEl = el('span', { style: { width: `${pct}%` } });
    progressMetaEl = el('div', { class: 'meta' }, summary.totalCount ? `${pct}% packed` : 'Add outfits or custom items to start');
    progressBarEl = el('div', { class: 'packing-progress-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(summary.totalCount), 'aria-valuenow': String(summary.checkedCount) }, progressFillEl);
    return el('div', { class: 'packing-progress' }, [
      el('div', { class: 'packing-progress-top' }, [
        el('div', null, [
          el('h2', null, trip.name || 'Trip'),
          progressMetaEl
        ]),
        progressCountEl
      ]),
      progressBarEl
    ]);
  }

  function renderSection(title, count, children) {
    return el('section', { class: 'packing-section' }, [
      el('div', { class: 'packing-section-head' }, [
        el('h3', null, title),
        count != null ? el('span', { class: 'badge' }, String(count)) : null
      ]),
      ...children
    ]);
  }

  function renderPackSection(summary) {
    const children = summary.packableItems.length
      ? summary.packableItems.map(renderPackableItem)
      : [renderPackEmpty(summary)];
    return renderSection('Pack', summary.packableItems.length, children);
  }

  function renderPackEmpty(summary) {
    const message = summary.toBuyItems.length
      ? 'Owned outfit items will appear here after they are marked owned.'
      : 'Assign outfits to this trip, then owned pieces will appear here.';
    return el('div', { class: 'packing-empty' }, [
      el('span', null, message),
      summary.toBuyItems.length ? null : el('a', { class: 'btn btn-ghost btn-sm', href: `#/trip/${id}` }, 'Plan outfits')
    ]);
  }

  function renderPackableItem(row) {
    const item = row.item;
    return el('label', { class: 'packing-row' }, [
      el('input', {
        type: 'checkbox',
        class: 'packing-check-input',
        checked: row.checked,
        dataset: { packItemId: item.id },
        onChange: async (event) => {
          try {
            await savePacking(setPackingItemChecked(trip.packing, item.id, event.target.checked));
          } catch (err) {
            event.target.checked = !event.target.checked;
            toast('Could not save packing progress: ' + err.message, { kind: 'danger' });
          }
        }
      }),
      thumb(item),
      el('span', { class: 'packing-row-body' }, [
        el('span', { class: 'packing-row-title' }, item.name || '(unnamed)'),
        el('span', { class: 'packing-row-sub' }, itemMeta(item)),
        usesText(row.uses) ? el('span', { class: 'packing-row-use' }, usesText(row.uses)) : null
      ])
    ]);
  }

  function renderToBuySection(summary) {
    const rows = summary.itemRows.filter(row => !row.packable);
    return renderSection('To buy', rows.length, rows.map(row => {
      const item = row.item;
      return el('div', { class: 'packing-row packing-row-tobuy' }, [
      thumb(item),
      el('span', { class: 'packing-row-body' }, [
        el('span', { class: 'packing-row-title' }, item.name || '(unnamed)'),
        el('span', { class: 'packing-row-sub' }, itemMeta(item)),
        usesText(row.uses) ? el('span', { class: 'packing-row-use' }, usesText(row.uses)) : null
      ]),
      el('div', { class: 'packing-row-actions' }, [
        item.purchaseUrl ? el('a', { class: 'buy-link', href: item.purchaseUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Buy') : null,
        el('button', {
          type: 'button',
          class: 'packing-owned-btn',
          'aria-label': `Mark ${item.name || 'item'} as owned`,
          onClick: async () => {
            try {
              await itemsStore.setOwned(item.id, true);
              toast(`Marked "${item.name || 'item'}" as owned`, { kind: 'success' });
              await renderAll();
            } catch (err) {
              toast('Could not mark owned: ' + err.message, { kind: 'danger' });
            }
          }
        }, '✓ Owned')
      ])
    ]);
    }));
  }

  function renderCustomSection(summary) {
    const input = el('input', {
      type: 'text',
      name: 'customPackingItem',
      placeholder: 'Add custom item',
      'aria-label': 'Add custom packing item',
      autocomplete: 'off'
    });
    const form = el('form', {
      class: 'packing-add-form',
      onSubmit: async (event) => {
        event.preventDefault();
        const label = input.value.trim();
        if (!label) return;
        try {
          await savePacking(addCustomPackingItem(trip.packing, { id: uuid(), label, nowIso: nowIso() }));
          input.value = '';
          await renderAll();
        } catch (err) {
          toast('Could not add item: ' + err.message, { kind: 'danger' });
        }
      }
    }, [
      input,
      el('button', { type: 'submit', class: 'btn btn-primary', 'aria-label': 'Add custom item to packing list' }, '+')
    ]);

    const rows = summary.customItems.map(renderCustomItem);
    return renderSection('Custom', summary.customItems.length, [
      form,
      rows.length ? el('div', { class: 'packing-custom-list' }, rows) : null
    ]);
  }

  function renderCustomItem(row) {
    const custom = row.custom;
    const inputId = `packing-custom-${custom.id}`;
    return el('div', { class: 'packing-row packing-row-custom' }, [
      el('input', {
        id: inputId,
        type: 'checkbox',
        class: 'packing-check-input',
        checked: row.checked,
        dataset: { packCustomId: custom.id },
        onChange: async (event) => {
          try {
            await savePacking(setCustomPackingItemChecked(trip.packing, custom.id, event.target.checked, nowIso()));
          } catch (err) {
            event.target.checked = !event.target.checked;
            toast('Could not save packing progress: ' + err.message, { kind: 'danger' });
          }
        }
      }),
      el('label', { class: 'packing-row-body', for: inputId }, [
        el('span', { class: 'packing-row-title' }, custom.label)
      ]),
      el('button', {
        type: 'button',
        class: 'icon-btn packing-remove-btn',
        'aria-label': `Remove ${custom.label}`,
        onClick: async () => {
          try {
            await savePacking(removeCustomPackingItem(trip.packing, custom.id));
            await renderAll();
          } catch (err) {
            toast('Could not remove item: ' + err.message, { kind: 'danger' });
          }
        }
      }, '×')
    ]);
  }

  await renderAll();
  return { node: root, cleanup: () => releaseOwner(OWNER) };
}
