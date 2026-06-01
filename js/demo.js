import { items, outfits, trips, dayPlans, daysBetween } from './store.js';

export const DEMO_TRIP_KEY = 'outfit-planner:demoTripId';
export const DEMO_TAG = 'demo';

export function buildDemoDates(baseDate = new Date()) {
  const start = new Date(Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate() + 21
  ));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 2);
  return {
    startDate: toIsoDate(start),
    endDate: toIsoDate(end)
  };
}

export async function seedDemoTrip({ baseDate = new Date() } = {}) {
  const existing = await findExistingDemoTrip();
  if (existing) {
    rememberDemoTrip(existing.id);
    return { trip: existing, created: false };
  }

  const { startDate, endDate } = buildDemoDates(baseDate);
  const [tee, pants, sneakers, hoops, jacket, dinnerTop] = await Promise.all([
    items.put({
      name: 'Demo white travel tee',
      category: 'top',
      subcategory: 'tee',
      description: 'Owned sample item for the demo trip.',
      tags: [DEMO_TAG],
      owned: true
    }),
    items.put({
      name: 'Demo black travel pants',
      category: 'pant',
      subcategory: 'pants',
      tags: [DEMO_TAG],
      owned: true
    }),
    items.put({
      name: 'Demo walking sneakers',
      category: 'shoes',
      subcategory: 'sneakers',
      tags: [DEMO_TAG],
      owned: true
    }),
    items.put({
      name: 'Demo gold hoops',
      category: 'accessory',
      subcategory: 'jewelry',
      tags: [DEMO_TAG],
      owned: true
    }),
    items.put({
      name: 'Demo rain jacket',
      category: 'other',
      subcategory: 'outerwear',
      description: 'Marked to buy so the trip shopping list has something useful to show.',
      purchaseUrl: 'https://example.com/demo-rain-jacket',
      tags: [DEMO_TAG],
      owned: false
    }),
    items.put({
      name: 'Demo dinner blouse',
      category: 'top',
      subcategory: 'blouse',
      tags: [DEMO_TAG],
      owned: true
    })
  ]);

  const [travelOutfit, dinnerOutfit] = await Promise.all([
    outfits.put({
      name: 'Demo travel day',
      topId: tee.id,
      pantId: pants.id,
      shoesId: sneakers.id,
      accessoryIds: [hoops.id],
      notes: 'Comfortable flight and walking look.'
    }),
    outfits.put({
      name: 'Demo dinner walk',
      topId: dinnerTop.id,
      pantId: pants.id,
      shoesId: sneakers.id,
      accessoryIds: [hoops.id],
      otherIds: [jacket.id],
      notes: 'Shows how to-buy items feed the shopping list.'
    })
  ]);

  const trip = await trips.put({
    name: 'Demo: Long Weekend',
    startDate,
    endDate,
    notes: 'Sample trip created by Outfit Planner.'
  });

  const dates = daysBetween(startDate, endDate);
  await Promise.all([
    dayPlans.setOutfits(trip.id, dates[0], [travelOutfit.id], 'Travel day'),
    dayPlans.setOutfits(trip.id, dates[1], [dinnerOutfit.id], 'Dinner and exploring'),
    dayPlans.setOutfits(trip.id, dates[2], [travelOutfit.id], 'Repeat the travel outfit')
  ]);

  rememberDemoTrip(trip.id);
  return {
    trip,
    created: true,
    items: [tee, pants, sneakers, hoops, jacket, dinnerTop],
    outfits: [travelOutfit, dinnerOutfit]
  };
}

async function findExistingDemoTrip() {
  let remembered = '';
  try { remembered = localStorage.getItem(DEMO_TRIP_KEY) || ''; } catch {}
  if (remembered) {
    const trip = await trips.get(remembered);
    if (trip) return trip;
  }
  const all = await trips.all();
  return all.find(trip => trip.name === 'Demo: Long Weekend') || null;
}

function rememberDemoTrip(id) {
  try { localStorage.setItem(DEMO_TRIP_KEY, id); } catch {}
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}
