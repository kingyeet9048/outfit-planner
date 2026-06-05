// Outfit generation engine. Pure functions over an items array + intent.
// Color theory + formality matching + variety, with deterministic-with-seed
// rolls so the same prompt twice doesn't return identical outfits.

import { extractDominantColor, rgbToHsv, colorTone, harmonyScore, classifyHarmony, isNeutral } from './color.js';

const FORMALITY_TAGS = {
  athletic: ['gym', 'sport', 'athletic', 'sweat', 'running', 'jogger', 'track', 'jersey'],
  beach: ['linen', 'short', 'sandal', 'flip', 'swim', 'tank'],
  casual: ['casual', 't-shirt', 'tee', 'jeans', 'sneaker', 'hoodie', 'cardigan', 'henley'],
  smart: ['button', 'chino', 'loafer', 'oxford', 'polo', 'blouse', 'blazer'],
  formal: ['suit', 'tie', 'dress', 'tuxedo', 'gown', 'heels', 'pump']
};

const FORMALITY_RANK = ['athletic', 'beach', 'casual', 'smart', 'formal'];

function rankFormality(name) { return FORMALITY_RANK.indexOf(name); }

function detectFormality(item) {
  const text = `${item.name || ''} ${item.subcategory || ''} ${item.description || ''}`.toLowerCase();
  for (const [tag, words] of Object.entries(FORMALITY_TAGS)) {
    if (words.some(w => text.includes(w))) return tag;
  }
  return 'casual';
}

// Pre-compute color + formality for every item.
// Returns a parallel array of "enriched" item objects.
export async function buildItemContext(items) {
  const out = [];
  for (const item of items) {
    const rgb = await extractDominantColor(item.imageBlob).catch(() => null);
    const hsv = rgb ? rgbToHsv(rgb) : null;
    out.push({
      ...item,
      _color: hsv,
      _tone: colorTone(hsv),
      _formality: detectFormality(item)
    });
  }
  return out;
}

// Bucket items by category for quick lookup.
function bucket(items) {
  return {
    top: items.filter(i => i.category === 'top'),
    dress: items.filter(i => i.category === 'dress'),
    pant: items.filter(i => i.category === 'pant' || i.category === 'skirt'),
    shoes: items.filter(i => i.category === 'shoes'),
    accessory: items.filter(i => i.category === 'accessory' || i.category === 'purse'),
    other: items.filter(i => i.category === 'other')
  };
}

// Cheap deterministic RNG so the same seed produces the same picks.
function makeRng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function pickRandom(arr, rng) {
  if (!arr.length) return null;
  return arr[Math.floor(rng() * arr.length)];
}

// Score one candidate item against a chosen anchor for harmony + formality.
function scoreCandidate(anchor, candidate, intent) {
  if (!candidate) return 0;
  let score = 0;
  // Color harmony
  score += harmonyScore(anchor._color, candidate._color) * 4;
  // Formality cohesion
  const dF = Math.abs(rankFormality(anchor._formality) - rankFormality(candidate._formality));
  score += Math.max(0, 3 - dF) * 1.2;
  // Preferred colors boost
  if (intent.preferredColors && intent.preferredColors.includes(candidate._tone)) score += 1.5;
  return score;
}

function pickBest(pool, anchor, intent, used, rng) {
  const candidates = pool.filter(i => !used.has(i.id));
  if (!candidates.length) return null;
  // Score every candidate, then pick from the top quartile with rng so we get variety
  const scored = candidates.map(c => ({ c, s: scoreCandidate(anchor, c, intent) }));
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, Math.max(1, Math.ceil(scored.length / 4)));
  return top[Math.floor(rng() * top.length)].c;
}

function pickFirstByFormality(pool, intent, used, rng) {
  let candidates = pool.filter(i => !used.has(i.id));
  if (intent.formality) {
    const ranked = candidates
      .map(c => ({ c, d: Math.abs(rankFormality(c._formality) - rankFormality(intent.formality)) }))
      .sort((a, b) => a.d - b.d);
    if (ranked.length) {
      const minD = ranked[0].d;
      candidates = ranked.filter(r => r.d <= minD + 1).map(r => r.c);
    }
  }
  if (intent.preferredColors && intent.preferredColors.length) {
    const colored = candidates.filter(c => intent.preferredColors.includes(c._tone));
    if (colored.length) candidates = colored;
  }
  return pickRandom(candidates, rng);
}

function pickAccessoryCount(rng, intent) {
  if (intent.formality === 'formal') return 1 + Math.floor(rng() * 2);     // 1-2
  if (intent.formality === 'athletic') return Math.floor(rng() * 2);        // 0-1
  if (intent.formality === 'beach') return Math.floor(rng() * 2);           // 0-1
  return Math.floor(rng() * 3);                                              // 0-2
}

function generateOne(buckets, intent, used, rng) {
  if ((!buckets.top.length && !buckets.dress.length) || !buckets.shoes.length) return null;

  // Anchor on the main piece: either a top or a dress.
  const main = pickFirstByFormality([...buckets.top, ...buckets.dress], intent, used, rng);
  if (!main) return null;
  const dress = main.category === 'dress' ? main : null;
  const top = dress ? null : main;
  used.add(main.id);

  const pant = dress ? null : pickBest(buckets.pant, main, intent, used, rng);
  if (pant) used.add(pant.id);

  const shoesAnchor = pant || main;
  const shoe = pickBest(buckets.shoes, shoesAnchor, intent, used, rng);
  if (shoe) used.add(shoe.id);

  const numAcc = pickAccessoryCount(rng, intent);
  const accessoryIds = [];
  const accs = [];
  for (let i = 0; i < numAcc; i++) {
    const a = pickBest(buckets.accessory, main, intent, used, rng);
    if (!a) break;
    used.add(a.id);
    accs.push(a);
    accessoryIds.push(a.id);
  }

  // Weather-driven "other" (jacket/bag) if cold or rainy
  const otherIds = dress ? [dress.id] : [];
  const others = [];
  if (intent.weather === 'rainy' || intent.weather === 'cold') {
    const o = pickBest(buckets.other, main, intent, used, rng);
    if (o) { used.add(o.id); others.push(o); otherIds.push(o.id); }
  }

  const slots = [main, pant, shoe, ...accs, ...others].filter(Boolean);
  const colors = slots.map(s => s._color).filter(Boolean);
  const harmonyLabel = classifyHarmony(colors);

  return {
    topId: top ? top.id : null,
    pantId: pant ? pant.id : null,
    shoesId: shoe ? shoe.id : null,
    accessoryIds,
    otherIds,
    _meta: { top: main, pant, shoe, accs, others, harmonyLabel, intent }
  };
}

export function generateOutfits(itemContext, intent, options = {}) {
  const seed = options.seed != null ? options.seed : Date.now();
  const rng = makeRng(seed);
  const buckets = bucket(itemContext);
  const out = [];
  const used = new Set();
  for (let i = 0; i < (intent.count || 1); i++) {
    const o = generateOne(buckets, intent, used, rng);
    if (!o) break;
    out.push(o);
  }
  return out;
}

// Refine the most-recent suggestion in-place: swap one slot for a fresh pick.
export function refineOutfit(itemContext, intent, baseOutfit, options = {}) {
  const seed = options.seed != null ? options.seed : Date.now();
  const rng = makeRng(seed);
  const buckets = bucket(itemContext);
  const used = new Set([
    baseOutfit.topId, baseOutfit.pantId, baseOutfit.shoesId,
    ...(baseOutfit.accessoryIds || []), ...(baseOutfit.otherIds || [])
  ].filter(Boolean));

  const newOutfit = { ...baseOutfit, accessoryIds: [...(baseOutfit.accessoryIds || [])], otherIds: [...(baseOutfit.otherIds || [])] };
  const dressIds = newOutfit.otherIds.filter(id => itemContext.find(i => i.id === id)?.category === 'dress');
  const anchorId = newOutfit.topId || dressIds[0] || newOutfit.pantId;
  const anchor = anchorId ? itemContext.find(i => i.id === anchorId) : null;
  const swap = intent.refine;
  if (swap.swapTop && anchor) {
    used.delete(newOutfit.topId);
    dressIds.forEach(id => used.delete(id));
    const t = pickBest([...buckets.top, ...buckets.dress], anchor, intent, used, rng);
    if (t) {
      newOutfit.otherIds = newOutfit.otherIds.filter(id => !dressIds.includes(id));
      if (t.category === 'dress') {
        newOutfit.topId = null;
        newOutfit.pantId = null;
        newOutfit.otherIds.unshift(t.id);
      } else {
        newOutfit.topId = t.id;
      }
      used.add(t.id);
    }
  } else if (swap.swapPant && anchor) {
    used.delete(newOutfit.pantId);
    const p = pickBest(buckets.pant, anchor, intent, used, rng);
    if (p) { newOutfit.pantId = p.id; used.add(p.id); }
  } else if (swap.swapShoes && anchor) {
    used.delete(newOutfit.shoesId);
    const s = pickBest(buckets.shoes, anchor, intent, used, rng);
    if (s) { newOutfit.shoesId = s.id; used.add(s.id); }
  } else {
    // Plain "another" — regenerate from scratch but avoid the previous top
    return generateOutfits(itemContext, intent, { seed });
  }

  // Recompute meta
  const dress = (newOutfit.otherIds || []).map(id => itemContext.find(i => i.id === id)).find(i => i?.category === 'dress') || null;
  const top = itemContext.find(i => i.id === newOutfit.topId) || dress;
  const pant = itemContext.find(i => i.id === newOutfit.pantId);
  const shoe = itemContext.find(i => i.id === newOutfit.shoesId);
  const accs = (newOutfit.accessoryIds || []).map(id => itemContext.find(i => i.id === id)).filter(Boolean);
  const others = (newOutfit.otherIds || []).map(id => itemContext.find(i => i.id === id)).filter(i => i && i.category !== 'dress');
  const colors = [top, pant, shoe, ...accs, ...others].filter(Boolean).map(s => s._color).filter(Boolean);
  newOutfit._meta = { top, pant, shoe, accs, others, harmonyLabel: classifyHarmony(colors), intent };
  return [newOutfit];
}
