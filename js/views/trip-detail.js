import { el, renderTopbar, toast, confirm, sheet } from '../ui.js';
import { items as itemsStore, outfits as outfitsStore, trips as tripsStore, dayPlans, formatDateRange, formatDayLabel, daysBetween, tripShoppingList } from '../store.js';
import { renderStack, outfitRollup } from '../components/outfit-stack.js';
import { pickOutfit } from '../components/picker.js';
import { urlFor, releaseOwner, hasBytes } from '../image.js';

export async function view({ id }) {
  const OWNER = 'trip-detail';
  releaseOwner(OWNER);
  const trip = await tripsStore.get(id);
  if (!trip) {
    renderTopbar({ title: 'Trip', left: el('a', { class: 'icon-btn', href: '#/trips' }, '◀') });
    return { node: el('div', { class: 'state' }, [el('h3', null, 'Trip not found')]) };
  }

  const root = el('div', { class: 'trip-detail' });

  // State + helpers we'll reuse
  const refresh = async () => {
    const [allItems, allOutfits, plans] = await Promise.all([itemsStore.all(), outfitsStore.all(), dayPlans.byTrip(id)]);
    const itemsById = new Map(allItems.map(i => [i.id, i]));
    const outfitsById = new Map(allOutfits.map(o => [o.id, o]));
    const planByDate = new Map(plans.map(p => [p.date, p]));
    const shopping = await tripShoppingList(id);
    return { itemsById, outfitsById, planByDate, shopping };
  };

  const renderAll = async () => {
    releaseOwner(OWNER);
    const data = await refresh();
    root.replaceChildren();
    root.appendChild(renderHeader(data));
    root.appendChild(renderShoppingList(data));
    root.appendChild(renderDays(data));
  };

  // Top bar
  const editBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Trip menu', onClick: openTripMenu }, '⋯');
  renderTopbar({ title: trip.name || 'Trip', left: el('a', { class: 'icon-btn', href: '#/trips' }, '◀'), right: editBtn });

  function renderHeader(data) {
    const dates = daysBetween(trip.startDate, trip.endDate);
    const planned = [...data.planByDate.values()].filter(p => (p.outfitIds || []).length > 0).length;
    return el('div', { class: 'page-head', style: { flexDirection: 'column', alignItems: 'flex-start', gap: '4px' } }, [
      el('div', { class: 'meta' }, formatDateRange(trip.startDate, trip.endDate)),
      el('div', { class: 'meta' }, `${dates.length} day${dates.length === 1 ? '' : 's'} · ${planned} planned`)
    ]);
  }

  function renderShoppingList(data) {
    const { shopping } = data;
    if (shopping.length === 0) {
      return el('div', { class: 'shopping-list' }, [
        el('summary', { style: { listStyle: 'none', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600' } }, [
          el('span', null, '🎉'),
          el('span', null, "You're all set — everything is owned")
        ])
      ]);
    }
    const details = el('details', { class: 'shopping-list', open: true });
    details.appendChild(el('summary', null, [
      el('span', null, '🛒'),
      el('span', null, `Shopping list · ${shopping.length} ${shopping.length === 1 ? 'item' : 'items'} to buy`)
    ]));
    const body = el('div', { class: 'shopping-body' });
    shopping.forEach(it => {
      body.appendChild(el('div', { class: 'shopping-item' }, [
        el('div', { class: 'thumb' }, hasBytes(it.imageBlob) ? el('img', { src: urlFor(OWNER, it.imageBlob), alt: '' }) : el('span', null, '👕')),
        el('div', { class: 'si-body' }, [
          el('div', { class: 'si-name' }, it.name || '(unnamed)'),
          el('div', { class: 'si-cat' }, [
            it.category,
            it.subcategory ? ` · ${it.subcategory}` : ''
          ].join(''))
        ]),
        el('div', { class: 'si-actions' }, [
          it.purchaseUrl ? el('a', { class: 'buy-link', href: it.purchaseUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Buy →') : null,
          el('button', {
            type: 'button',
            class: 'mark-owned-btn',
            onClick: async () => {
              await itemsStore.setOwned(it.id, true);
              toast(`Marked "${it.name}" as owned`, { kind: 'success' });
              renderAll();
            }
          }, '✓ Owned')
        ])
      ]));
    });
    details.appendChild(body);
    return details;
  }

  function renderDays(data) {
    const dates = daysBetween(trip.startDate, trip.endDate);
    const wrap = el('div', { class: 'days' });
    dates.forEach(dateIso => {
      const plan = data.planByDate.get(dateIso);
      const outfitIds = (plan && plan.outfitIds) || [];
      const label = formatDayLabel(dateIso);
      const section = el('div', { class: 'day-section' });
      section.appendChild(el('div', { class: 'day-header' }, `${label.weekday} ${label.short}`));

      if (outfitIds.length === 0) {
        section.appendChild(el('button', {
          type: 'button',
          class: 'day-row empty',
          onClick: () => addOutfitToDay(dateIso)
        }, '+ Choose outfit'));
      } else {
        outfitIds.forEach((oid, idx) => {
          const outfit = data.outfitsById.get(oid);
          if (!outfit) return;
          const rollup = outfitRollup({ outfit, itemsById: data.itemsById });
          section.appendChild(el('button', {
            type: 'button',
            class: 'day-row',
            onClick: () => replaceOutfitOnDay(dateIso, idx, oid)
          }, [
            renderStack({ outfit, itemsById: data.itemsById, size: 'sm', ownerKey: OWNER }),
            el('div', { class: 'day-body' }, [
              el('div', { class: 'day-title' }, outfit.name || 'Untitled'),
              el('div', { class: 'day-sub' }, `${rollup.total} item${rollup.total === 1 ? '' : 's'} · ${rollup.owned} owned${rollup.toBuy ? ` · ${rollup.toBuy} to buy` : ''}`)
            ]),
            el('span', { class: 'row-chevron' }, '›')
          ]));
        });
        // "Add another outfit" — slim CTA below assigned outfits
        section.appendChild(el('button', {
          type: 'button',
          class: 'day-row empty add-another',
          style: { padding: '12px', fontSize: '14px' },
          onClick: () => addOutfitToDay(dateIso)
        }, '+ Add another outfit'));
      }
      wrap.appendChild(section);
    });
    return wrap;
  }

  // Pick an outfit and ADD it to the day (extra entry).
  async function addOutfitToDay(dateIso) {
    const result = await pickOutfit({ currentId: null, allowClear: false });
    if (typeof result !== 'string') { await renderAll(); return; }
    await dayPlans.addOutfit(id, dateIso, result);
    toast('Outfit added', { kind: 'success' });
    await renderAll();
  }

  // Tap an existing outfit on a day to replace or remove it.
  async function replaceOutfitOnDay(dateIso, idx, currentId) {
    const result = await pickOutfit({ currentId });
    if (result === undefined) { await renderAll(); return; }
    const existing = await dayPlans.get(id, dateIso);
    const list = existing ? [...(existing.outfitIds || [])] : [];
    if (result === null) {
      // Remove this entry
      list.splice(idx, 1);
    } else {
      list[idx] = result;
    }
    await dayPlans.setOutfits(id, dateIso, list, existing ? existing.notes : '');
    toast(result === null ? 'Outfit removed' : 'Outfit updated');
    await renderAll();
  }

  async function openTripMenu() {
    await sheet({
      title: trip.name,
      body: (close) => el('div', { class: 'list' }, [
        el('button', {
          type: 'button',
          class: 'list-row',
          onClick: async () => { close(); await editTrip(); }
        }, [
          el('div', { class: 'thumb' }, '✏️'),
          el('div', { class: 'row-body' }, [el('div', { class: 'row-title' }, 'Edit trip')])
        ]),
        el('button', {
          type: 'button',
          class: 'list-row',
          style: { color: 'var(--danger)' },
          onClick: async () => {
            close();
            const ok = await confirm({ title: 'Delete trip?', message: 'This deletes the trip and all assigned days. Outfits and items are kept.', confirmLabel: 'Delete', danger: true });
            if (!ok) return;
            await tripsStore.remove(trip.id);
            toast('Trip deleted');
            location.hash = '#/trips';
          }
        }, [
          el('div', { class: 'thumb' }, '🗑️'),
          el('div', { class: 'row-body' }, [el('div', { class: 'row-title' }, 'Delete trip')])
        ])
      ])
    });
  }

  async function editTrip() {
    const state = { name: trip.name, startDate: trip.startDate, endDate: trip.endDate };
    await sheet({
      title: 'Edit trip',
      body: (close) => {
        const err = el('div', { class: 'error-text', style: { display: 'none' } });
        return el('form', {
          onSubmit: async (e) => {
            e.preventDefault();
            if (!state.name.trim()) { err.textContent = 'Please enter a name'; err.style.display = ''; return; }
            if (state.endDate < state.startDate) { err.textContent = 'End date must be on or after start date'; err.style.display = ''; return; }
            await tripsStore.put({ id: trip.id, name: state.name.trim(), startDate: state.startDate, endDate: state.endDate });
            toast('Trip updated', { kind: 'success' });
            close('saved');
            trip.name = state.name.trim();
            trip.startDate = state.startDate;
            trip.endDate = state.endDate;
            renderTopbar({ title: trip.name, left: el('a', { class: 'icon-btn', href: '#/trips' }, '◀'), right: editBtn });
            await renderAll();
          }
        }, [
          el('div', { class: 'field' }, [el('label', null, 'Name'), el('input', { type: 'text', value: state.name, required: true, onInput: (e) => { state.name = e.target.value; } })]),
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [el('label', null, 'Start date'), el('input', { type: 'date', value: state.startDate, required: true, onInput: (e) => { state.startDate = e.target.value; } })]),
            el('div', { class: 'field' }, [el('label', null, 'End date'), el('input', { type: 'date', value: state.endDate, required: true, onInput: (e) => { state.endDate = e.target.value; } })])
          ]),
          err,
          el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Save changes')
        ]);
      }
    });
  }

  await renderAll();
  return { node: root, cleanup: () => releaseOwner(OWNER) };
}
