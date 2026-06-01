import { el, renderTopbar, toast, confirm, sheet, backControl } from '../ui.js';
import { items as itemsStore, outfits as outfitsStore, trips as tripsStore, dayPlans, formatDateRange, formatDayLabel, daysBetween, tripShoppingList, groupShoppingByRetailer } from '../store.js';
import { renderStack, outfitRollup } from '../components/outfit-stack.js';
import { pickOutfit } from '../components/picker.js';
import { urlFor, releaseOwner, hasBytes } from '../image.js';
import { buildOutfitReuseSummary, formatDateShort, mergeOutfitIds, reuseSummaryCopy, reuseSummaryShortText } from '../reuse.js';
import { deriveTripPacking } from '../packing.js';
import { trackActivation, trackActivationOnce } from '../activation.js';
import { queueFeedbackPrompt, showQueuedFeedbackPrompt } from '../feedback.js';

const CATEGORY_ICONS = { top: '👕', pant: '👖', shoes: '👟', accessory: '✨', other: '🎒' };

// Deterministic, recognizable color for a store avatar (same store → same hue
// across renders). Mid-tone lightness so white text stays legible in both themes.
function storeColor(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  // Lower lightness keeps the white monogram legible across all hues.
  return `hsl(${h}, 55%, 36%)`;
}

function itemIcon(item) {
  return CATEGORY_ICONS[item?.category] || '👕';
}

export async function view({ id }) {
  const OWNER = 'trip-detail';
  releaseOwner(OWNER);
  const trip = await tripsStore.get(id);
  if (!trip) {
    renderTopbar({ title: 'Trip', left: backControl('#/trips') });
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
    root.appendChild(renderPackingCta(data));
    if (data.shopping.length) {
      trackActivationOnce('shopping_list_viewed', 'shopping_list_viewed', { toBuyCount: data.shopping.length });
    }
    root.appendChild(renderShoppingList(data));
    root.appendChild(renderDays(data));
  };

  // Top bar
  const editBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Trip menu', onClick: openTripMenu }, '⋯');
  renderTopbar({ title: trip.name || 'Trip', left: backControl('#/trips'), right: editBtn });

  function renderHeader(data) {
    const dates = daysBetween(trip.startDate, trip.endDate);
    const planned = [...data.planByDate.values()].filter(p => (p.outfitIds || []).length > 0).length;
    return el('div', { class: 'page-head', style: { flexDirection: 'column', alignItems: 'flex-start', gap: '4px' } }, [
      el('div', { class: 'meta' }, formatDateRange(trip.startDate, trip.endDate)),
      el('div', { class: 'meta' }, `${dates.length} day${dates.length === 1 ? '' : 's'} · ${planned} planned`)
    ]);
  }

  function renderPackingCta(data) {
    const summary = deriveTripPacking({
      plans: [...data.planByDate.values()],
      outfitsById: data.outfitsById,
      itemsById: data.itemsById,
      packing: trip.packing
    });
    const sub = summary.totalCount
      ? `${summary.checkedCount}/${summary.totalCount} packed`
      : (summary.toBuyItems.length ? `${summary.toBuyItems.length} to buy before packing` : 'Build from assigned outfits');
    return el('a', { class: 'list-row trip-packing-cta', href: `#/trip/${id}/packing` }, [
      el('div', { class: 'thumb' }, '✓'),
      el('div', { class: 'row-body' }, [
        el('div', { class: 'row-title' }, 'Packing checklist'),
        el('div', { class: 'row-sub' }, sub)
      ]),
      el('span', { class: 'row-chevron' }, '›')
    ]);
  }

  function renderShoppingList(data) {
    const { shopping } = data;
    if (shopping.length === 0) {
      const plannedOutfitCount = [...data.planByDate.values()].reduce((sum, plan) => sum + ((plan.outfitIds || []).length), 0);
      return el('div', { class: 'shopping-list shopping-list-empty' }, [
        el('div', { class: 'shopping-empty-row' }, [
          el('div', { class: 'thumb shopping-empty-icon' }, plannedOutfitCount ? '✓' : '🛒'),
          el('div', { class: 'row-body' }, [
            el('div', { class: 'row-title' }, plannedOutfitCount ? 'Everything assigned is owned' : 'No shopping yet'),
            el('div', { class: 'row-sub' }, plannedOutfitCount
              ? 'To-buy items from planned outfits will appear here.'
              : 'Choose outfits for trip days to build the list.')
          ])
        ])
      ]);
    }
    const groups = groupShoppingByRetailer(shopping);
    // Headers add clarity only when there's something to distinguish — skip them
    // when every item is in the single "no store link" bucket.
    const showHeaders = !(groups.length === 1 && groups[0].key === '');
    const storeCount = groups.filter(g => g.key !== '').length;

    const summaryParts = [`${shopping.length} ${shopping.length === 1 ? 'item' : 'items'} to buy`];
    if (showHeaders && storeCount > 1) summaryParts.push(`${storeCount} stores`);

    const details = el('details', { class: 'shopping-list', open: true });
    details.appendChild(el('summary', null, [
      el('span', null, '🛒'),
      el('span', null, `Shopping list · ${summaryParts.join(' · ')}`)
    ]));
    const body = el('div', { class: 'shopping-body' });

    if (showHeaders) {
      groups.forEach(group => {
        const groupEl = el('div', { class: 'shopping-group' }, [
          el('div', { class: 'shopping-group-head' }, [
            el('span', { class: 'store-avatar', 'aria-hidden': 'true', style: { background: storeColor(group.key || group.label) } }, group.label.charAt(0).toUpperCase()),
            el('span', { class: 'store-name' }, group.label),
            el('span', { class: 'store-count' }, String(group.items.length))
          ]),
          ...group.items.map(renderShoppingItem)
        ]);
        body.appendChild(groupEl);
      });
    } else {
      groups[0].items.forEach(it => body.appendChild(renderShoppingItem(it)));
    }
    details.appendChild(body);
    return details;
  }

  // A single shopping-list row. Shared by the grouped and flat layouts.
  function renderShoppingItem(it) {
    return el('div', { class: 'shopping-item' }, [
      el('div', { class: 'thumb' }, hasBytes(it.imageBlob) ? el('img', { src: urlFor(OWNER, it.imageBlob), alt: '' }) : el('span', { 'aria-hidden': 'true' }, itemIcon(it))),
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
    ]);
  }

  function renderDays(data) {
    const dates = daysBetween(trip.startDate, trip.endDate);
    const wrap = el('div', { class: 'days' });
    dates.forEach(dateIso => {
      const plan = data.planByDate.get(dateIso);
      const outfitIds = (plan && plan.outfitIds) || [];
      const label = formatDayLabel(dateIso);
      const section = el('div', { class: 'day-section' });
      section.appendChild(el('div', { class: 'day-header' }, [
        el('span', null, `${label.weekday} ${label.short}`),
        el('button', {
          type: 'button',
          class: 'day-menu-btn',
          'aria-label': `${label.weekday} ${label.short} actions`,
          onClick: () => openDayActions(dateIso, data)
        }, '⋯')
      ]));

      if (outfitIds.length === 0) {
        section.appendChild(el('button', {
          type: 'button',
          class: 'day-row empty',
          onClick: () => addOutfitToDay(dateIso, data)
        }, '+ Choose outfit'));
      } else {
        outfitIds.forEach((oid, idx) => {
          const outfit = data.outfitsById.get(oid);
          if (!outfit) return;
          const rollup = outfitRollup({ outfit, itemsById: data.itemsById });
          const reuseSummary = buildOutfitReuseSummary({
            outfit,
            date: dateIso,
            planByDate: data.planByDate,
            outfitsById: data.outfitsById,
            itemsById: data.itemsById
          });
          const reuseText = reuseSummaryShortText(reuseSummary);
          section.appendChild(el('button', {
            type: 'button',
            class: 'day-row',
            onClick: () => openOutfitDayActions(dateIso, idx, oid, data)
          }, [
            renderStack({ outfit, itemsById: data.itemsById, size: 'sm', ownerKey: OWNER }),
            el('div', { class: 'day-body' }, [
              el('div', { class: 'day-title' }, outfit.name || 'Untitled'),
              el('div', { class: 'day-sub' }, `${rollup.total} item${rollup.total === 1 ? '' : 's'} · ${rollup.owned} owned${rollup.toBuy ? ` · ${rollup.toBuy} to buy` : ''}`),
              reuseText ? el('div', { class: `reuse-inline ${reuseSummary.level === 'strong' ? 'reuse-inline-strong' : 'reuse-inline-soft'}` }, reuseText) : null
            ]),
            el('span', { class: 'row-chevron' }, '›')
          ]));
        });
        // "Add another outfit" — slim CTA below assigned outfits
        section.appendChild(el('button', {
          type: 'button',
          class: 'day-row empty add-another',
          style: { padding: '12px', fontSize: '14px' },
          onClick: () => addOutfitToDay(dateIso, data)
        }, '+ Add another outfit'));
      }
      wrap.appendChild(section);
    });
    return wrap;
  }

  function pickerReuseContext(dateIso, data, currentId = null) {
    return {
      date: dateIso,
      planByDate: data.planByDate,
      outfitsById: data.outfitsById,
      itemsById: data.itemsById,
      currentId,
      preventTargetDuplicates: true
    };
  }

  function targetOutfitIds(data, dateIso) {
    return [...((data.planByDate.get(dateIso)?.outfitIds) || [])];
  }

  function sameIds(a, b) {
    return JSON.stringify(a || []) === JSON.stringify(b || []);
  }

  // Pick an outfit and ADD it to the day (extra entry).
  async function addOutfitToDay(dateIso, data) {
    const result = await pickOutfit({
      currentId: null,
      allowClear: false,
      reuseContext: pickerReuseContext(dateIso, data)
    });
    if (typeof result !== 'string') { await renderAll(); return; }
    if (targetOutfitIds(data, dateIso).includes(result)) {
      toast('That day already has this outfit');
      await renderAll();
      return;
    }
    await dayPlans.addOutfit(id, dateIso, result);
    toast('Outfit added', { kind: 'success' });
    trackActivation('day_planned', { source: 'trip_detail' });
    queueFeedbackPrompt('day_planned');
    await renderAll();
    setTimeout(() => { showQueuedFeedbackPrompt(); }, 500);
  }

  // Tap an existing outfit on a day to replace or remove it.
  async function replaceOutfitOnDay(dateIso, idx, currentId, data) {
    const result = await pickOutfit({
      currentId,
      reuseContext: pickerReuseContext(dateIso, data, currentId)
    });
    if (result === undefined) { await renderAll(); return; }
    const existing = await dayPlans.get(id, dateIso);
    const list = existing ? [...(existing.outfitIds || [])] : [];
    if (result === null) {
      // Remove this entry
      list.splice(idx, 1);
    } else {
      if (list.some((oid, i) => i !== idx && oid === result)) {
        toast('That day already has this outfit');
        await renderAll();
        return;
      }
      list[idx] = result;
    }
    await dayPlans.setOutfits(id, dateIso, list, existing ? existing.notes : '');
    toast(result === null ? 'Outfit removed' : 'Outfit updated');
    await renderAll();
  }

  function renderReuseCallout(summary) {
    const copy = reuseSummaryCopy(summary);
    if (!copy) return null;
    return el('div', { class: `reuse-callout ${summary.level === 'strong' ? 'reuse-callout-strong' : 'reuse-callout-soft'}` }, [
      el('div', { class: 'reuse-callout-title' }, copy.title),
      el('div', { class: 'reuse-callout-detail' }, copy.detail)
    ]);
  }

  function actionRow({ icon, title, sub, danger = false, onClick, href }) {
    const attrs = href
      ? { class: 'list-row', href, onClick }
      : { type: 'button', class: 'list-row', onClick };
    if (danger) attrs.style = { color: 'var(--danger)' };
    return el(href ? 'a' : 'button', attrs, [
      el('div', { class: 'thumb' }, icon),
      el('div', { class: 'row-body' }, [
        el('div', { class: 'row-title' }, title),
        sub ? el('div', { class: 'row-sub' }, sub) : null
      ])
    ]);
  }

  async function openDayActions(dateIso, data) {
    const outfitIds = targetOutfitIds(data, dateIso);
    const label = formatDayLabel(dateIso);
    await sheet({
      title: `${label.weekday} ${label.short}`,
      body: (close) => el('div', { class: 'list' }, [
        actionRow({
          icon: '👔',
          title: outfitIds.length ? 'Add another outfit' : 'Choose outfit',
          sub: outfitIds.length ? 'Keep what is planned and add one more' : 'Pick an outfit for this day',
          onClick: async () => { close(); await addOutfitToDay(dateIso, data); }
        }),
        outfitIds.length ? actionRow({
          icon: '↪',
          title: 'Copy day to another date',
          sub: 'Add to or replace a different trip day',
          onClick: async () => { close(); await copyDayToAnotherDate(dateIso, data); }
        }) : null,
        outfitIds.length ? actionRow({
          icon: '🗑️',
          title: 'Clear this day',
          danger: true,
          onClick: async () => {
            close();
            const ok = await confirm({ title: 'Clear this day?', message: 'This removes the planned outfits from this date. Outfits and items are kept.', confirmLabel: 'Clear', danger: true });
            if (!ok) return;
            await dayPlans.clear(id, dateIso);
            toast('Day cleared');
            await renderAll();
          }
        }) : null
      ])
    });
  }

  async function openOutfitDayActions(dateIso, idx, outfitId, data) {
    const outfit = data.outfitsById.get(outfitId);
    if (!outfit) return;
    const label = formatDayLabel(dateIso);
    const reuseSummary = buildOutfitReuseSummary({
      outfit,
      date: dateIso,
      planByDate: data.planByDate,
      outfitsById: data.outfitsById,
      itemsById: data.itemsById
    });

    await sheet({
      title: outfit.name || `${label.weekday} ${label.short}`,
      body: (close) => el('div', { class: 'day-action-sheet' }, [
        renderReuseCallout(reuseSummary),
        el('div', { class: 'list' }, [
          actionRow({
            icon: '👁',
            title: 'View outfit',
            sub: 'Open the outfit details',
            href: `#/outfit/${outfit.id}`,
            onClick: () => close()
          }),
          actionRow({
            icon: '🔁',
            title: 'Replace outfit',
            sub: 'Choose a different outfit for this spot',
            onClick: async () => { close(); await replaceOutfitOnDay(dateIso, idx, outfitId, data); }
          }),
          actionRow({
            icon: '⧉',
            title: 'Duplicate for this day',
            sub: 'Make an editable copy and keep the original unchanged',
            onClick: async () => { close(); await duplicateOutfitForDay(dateIso, idx, outfitId); }
          }),
          actionRow({
            icon: '↪',
            title: 'Copy to another date',
            sub: 'Reuse this outfit on a different trip day',
            onClick: async () => { close(); await copyOutfitToAnotherDate(dateIso, outfitId, data); }
          }),
          actionRow({
            icon: '🗑️',
            title: 'Remove from this day',
            danger: true,
            onClick: async () => {
              close();
              const existing = await dayPlans.get(id, dateIso);
              const list = existing ? [...(existing.outfitIds || [])] : [];
              list.splice(idx, 1);
              await dayPlans.setOutfits(id, dateIso, list, existing ? existing.notes : '');
              toast('Outfit removed');
              await renderAll();
            }
          })
        ])
      ])
    });
  }

  async function duplicateOutfitForDay(dateIso, idx, outfitId) {
    try {
      const copy = await outfitsStore.duplicate(outfitId);
      const existing = await dayPlans.get(id, dateIso);
      const list = existing ? [...(existing.outfitIds || [])] : [];
      list[idx] = copy.id;
      await dayPlans.setOutfits(id, dateIso, list, existing ? existing.notes : '');
      toast('Outfit duplicated', { kind: 'success' });
      location.hash = `#/outfit/${copy.id}/edit`;
    } catch (err) {
      toast('Duplicate failed: ' + err.message, { kind: 'danger' });
      await renderAll();
    }
  }

  async function copyOutfitToAnotherDate(sourceDate, outfitId, data) {
    const targetDate = await pickTargetDate(sourceDate, data, {
      title: 'Copy outfit to',
      preventOutfitId: outfitId
    });
    if (!targetDate) { await renderAll(); return; }
    const existing = await dayPlans.get(id, targetDate);
    const current = existing ? [...(existing.outfitIds || [])] : [];
    if (current.includes(outfitId)) {
      toast('That day already has this outfit');
      await renderAll();
      return;
    }
    await dayPlans.setOutfits(id, targetDate, [...current, outfitId], existing ? existing.notes : '');
    toast(`Copied to ${formatDateShort(targetDate)}`, { kind: 'success' });
    await renderAll();
  }

  async function copyDayToAnotherDate(sourceDate, data) {
    const sourceIds = targetOutfitIds(data, sourceDate);
    if (!sourceIds.length) {
      toast('Choose an outfit first');
      await renderAll();
      return;
    }
    const targetDate = await pickTargetDate(sourceDate, data, { title: 'Copy day to' });
    if (!targetDate) { await renderAll(); return; }
    const existing = await dayPlans.get(id, targetDate);
    const current = existing ? [...(existing.outfitIds || [])] : [];
    const mode = current.length ? await pickCopyMode(targetDate, current.length) : 'add';
    if (!mode) { await renderAll(); return; }
    const next = mergeOutfitIds(current, sourceIds, { mode });
    if (mode === 'add' && sameIds(next, current)) {
      toast('That day already has those outfits');
      await renderAll();
      return;
    }
    if (mode === 'replace' && sameIds(next, current)) {
      toast('That day already matches');
      await renderAll();
      return;
    }
    await dayPlans.setOutfits(id, targetDate, next, existing ? existing.notes : '');
    toast(mode === 'replace' ? 'Day replaced' : 'Day copied', { kind: 'success' });
    await renderAll();
  }

  async function pickTargetDate(sourceDate, data, { title, preventOutfitId = null } = {}) {
    const dates = daysBetween(trip.startDate, trip.endDate).filter(date => date !== sourceDate);
    if (!dates.length) {
      toast('This trip has no other days');
      return null;
    }
    return sheet({
      title: title || 'Choose date',
      body: (close) => el('div', { class: 'list target-date-list' }, dates.map(dateIso => {
        const label = formatDayLabel(dateIso);
        const ids = targetOutfitIds(data, dateIso);
        const hasDuplicate = preventOutfitId && ids.includes(preventOutfitId);
        return el('button', {
          type: 'button',
          class: 'list-row' + (hasDuplicate ? ' is-disabled' : ''),
          disabled: !!hasDuplicate,
          onClick: () => close(dateIso)
        }, [
          el('div', { class: 'thumb' }, label.day),
          el('div', { class: 'row-body' }, [
            el('div', { class: 'row-title' }, `${label.weekday} ${label.short}`),
            el('div', { class: 'row-sub' }, hasDuplicate
              ? 'Already has this outfit'
              : ids.length
                ? `${ids.length} outfit${ids.length === 1 ? '' : 's'} planned`
                : 'No outfits planned')
          ]),
          hasDuplicate ? null : el('span', { class: 'row-chevron' }, '›')
        ]);
      }))
    });
  }

  async function pickCopyMode(targetDate, targetCount) {
    return sheet({
      title: `Copy to ${formatDateShort(targetDate)}`,
      body: (close) => el('div', { class: 'list' }, [
        actionRow({
          icon: '+',
          title: 'Add missing outfits',
          sub: `Keep the ${targetCount} already planned and add anything new`,
          onClick: () => close('add')
        }),
        actionRow({
          icon: '↺',
          title: 'Replace day',
          sub: 'Use the copied day instead',
          onClick: () => close('replace')
        })
      ])
    });
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
            renderTopbar({ title: trip.name, left: backControl('#/trips'), right: editBtn });
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
