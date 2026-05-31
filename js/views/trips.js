import { el, renderTopbar, sheet, toast } from '../ui.js';
import { trips as tripsStore, tripStats, formatDateRange } from '../store.js';
import { releaseOwner } from '../image.js';
import {
  dismissSetup, loadSetupStatus, renderSetupCard, shouldShowSetupCard
} from '../setup.js';

export async function view() {
  releaseOwner('trips-list');
  renderTopbar({ title: 'My Trips', right: el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'New trip', onClick: openNewTripSheet }, '+') });

  const [list, setupStatus] = await Promise.all([
    tripsStore.all(),
    loadSetupStatus().catch(() => null)
  ]);
  const root = el('div', { class: 'trips-view' });
  const setupVisible = shouldShowSetupCard(setupStatus);
  if (setupVisible) {
    let setupCard;
    setupCard = renderSetupCard(setupStatus, {
      onCreateTrip: openNewTripSheet,
      onDismiss: () => {
        dismissSetup();
        if (setupCard && setupCard.parentNode) setupCard.remove();
        toast('Setup guide hidden');
      }
    });
    root.appendChild(setupCard);
  }

  if (!list.length) {
    const emptyChildren = [
      el('div', { class: 'state-icon' }, '🧳'),
      el('h3', null, setupVisible ? 'No trips yet' : 'Plan your first trip'),
      el('p', null, setupVisible
        ? 'Create a trip when you are ready. It will appear here.'
        : 'Set the dates and assemble outfits day-by-day.')
    ];
    if (!setupVisible) {
      emptyChildren.push(el('button', { type: 'button', class: 'btn btn-primary', onClick: openNewTripSheet }, 'Create trip'));
    }
    root.appendChild(el('div', { class: 'state' }, [
      ...emptyChildren
    ]));
    return { node: root };
  }

  const listWrap = el('div', { class: 'list' });
  for (const t of list) {
    const stats = await tripStats(t.id);
    listWrap.appendChild(el('a', { class: 'list-row', href: `#/trip/${t.id}` }, [
      el('div', { class: 'thumb' }, '🧳'),
      el('div', { class: 'row-body' }, [
        el('div', { class: 'row-title' }, t.name || 'Untitled trip'),
        el('div', { class: 'row-sub' }, formatDateRange(t.startDate, t.endDate) || 'Dates not set'),
        el('div', { class: 'row-badges' }, [
          el('span', { class: 'badge badge-accent' }, `${stats.plannedDays}/${stats.totalDays} days planned`),
          stats.toBuy > 0 ? el('span', { class: 'badge badge-warn' }, `🛒 ${stats.toBuy} to buy`) : null
        ])
      ]),
      el('span', { class: 'row-chevron' }, '›')
    ]));
  }
  root.appendChild(listWrap);
  return { node: root };
}

async function openNewTripSheet() {
  const state = { name: '', startDate: '', endDate: '' };
  await sheet({
    title: 'New trip',
    body: (close) => {
      const errLine = el('div', { class: 'error-text', style: { display: 'none', marginBottom: '12px' } });
      const form = el('form', {
        onSubmit: async (e) => {
          e.preventDefault();
          if (!state.name.trim()) { errLine.textContent = 'Please enter a name'; errLine.style.display = ''; return; }
          if (!state.startDate || !state.endDate) { errLine.textContent = 'Please choose both dates'; errLine.style.display = ''; return; }
          if (state.endDate < state.startDate) { errLine.textContent = 'End date must be on or after start date'; errLine.style.display = ''; return; }
          try {
            const trip = await tripsStore.put({ name: state.name.trim(), startDate: state.startDate, endDate: state.endDate });
            toast('Trip created', { kind: 'success' });
            close('saved');
            location.hash = `#/trip/${trip.id}`;
          } catch (err) {
            errLine.textContent = err.message;
            errLine.style.display = '';
          }
        }
      }, [
        el('div', { class: 'field' }, [
          el('label', null, 'Trip name'),
          el('input', { type: 'text', placeholder: 'e.g., Europe Summer', required: true, onInput: (e) => { state.name = e.target.value; } })
        ]),
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [
            el('label', null, 'Start date'),
            el('input', { type: 'date', required: true, onInput: (e) => { state.startDate = e.target.value; } })
          ]),
          el('div', { class: 'field' }, [
            el('label', null, 'End date'),
            el('input', { type: 'date', required: true, onInput: (e) => { state.endDate = e.target.value; } })
          ])
        ]),
        errLine,
        el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Create trip')
      ]);
      return form;
    }
  });
}
