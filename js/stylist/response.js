// Generate the stylist's natural-language reply for a suggested outfit.
// Templates with randomized variants so multiple suggestions don't read identical.

const FORMALITY_PHRASE = {
  athletic: 'high-energy, sporty',
  beach: 'easy, sun-ready',
  casual: 'relaxed everyday',
  smart: 'smart-casual',
  formal: 'sharp evening'
};

const WEATHER_PHRASE = {
  hot: 'warm-weather',
  cold: 'cold-weather',
  rainy: 'rain-ready'
};

const COLOR_DESCRIPTOR = {
  red: 'bold red',
  orange: 'warm orange',
  yellow: 'sunny yellow',
  green: 'earthy green',
  cyan: 'cool teal',
  blue: 'cool blue',
  purple: 'rich purple',
  pink: 'soft pink',
  black: 'sharp black',
  white: 'crisp white',
  gray: 'soft gray',
  brown: 'warm brown',
  neutral: 'neutral'
};

function describe(item) {
  if (!item) return null;
  const tone = item._tone || 'neutral';
  const desc = COLOR_DESCRIPTOR[tone] || tone;
  return `${desc} ${(item.subcategory || item.name || '').toString().trim() || item.category}`;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function harmonySentence(label, top, pant) {
  switch (label) {
    case 'monochromatic':
      return pick([
        `I leaned into a monochromatic palette so the whole look reads cohesive.`,
        `Tones live in the same family — clean, intentional, never busy.`,
        `Monochromatic styling: same tone across the look for a polished read.`
      ]);
    case 'analogous':
      return pick([
        `The colors sit close on the wheel — analogous, calm, and harmonious.`,
        `Analogous palette: neighboring hues that feel naturally coordinated.`
      ]);
    case 'complementary':
      return pick([
        `Complementary contrast — opposite hues give the outfit visual energy without clashing.`,
        `Opposite-side-of-the-wheel pairing for a confident, intentional contrast.`
      ]);
    case 'triadic':
      return pick([
        `Triadic balance — three hues spaced evenly so no single piece dominates.`,
        `Three-color triangle: vibrant but balanced.`
      ]);
    case 'neutral palette':
      return pick([
        `Pure neutrals — timeless and trip-friendly; pairs with almost anything.`,
        `An all-neutral palette: low-risk, high-versatility.`
      ]);
    case 'neutral with a single accent':
      return pick([
        `Neutrals as a base with one accent color leading the look.`,
        `Neutral grounding with a single tone of personality.`
      ]);
    case 'bold, multi-hue':
      return pick([
        `A bold multi-color statement — wear it confidently.`,
        `Multiple hues for an expressive, attention-catching look.`
      ]);
    default:
      return `The palette is intentionally mixed for visual interest.`;
  }
}

function formalitySentence(intent, top, pant) {
  const f = intent.formality;
  if (!f) return null;
  return `Anchored on a ${FORMALITY_PHRASE[f] || 'cohesive'} tone.`;
}

function weatherSentence(intent) {
  const w = intent.weather;
  if (!w) return null;
  return pick([
    `Built with a ${WEATHER_PHRASE[w]} mood in mind.`,
    `Cut for ${WEATHER_PHRASE[w]} conditions.`
  ]);
}

function pieceSentence(top, pant, shoe, accs, others) {
  const parts = [];
  if (top) parts.push(`the ${describe(top)}`);
  if (pant) parts.push(`paired with ${describe(pant)}`);
  if (shoe) parts.push(`grounded by ${describe(shoe)}`);
  if (accs && accs.length) {
    const accDesc = accs.map(a => a.subcategory || a.name || 'accessory').slice(0, 2).join(' and ');
    parts.push(`finished with ${accDesc}`);
  }
  if (others && others.length) {
    const oDesc = others.map(o => o.subcategory || o.name || 'piece').join(' and ');
    parts.push(`layered with ${oDesc}`);
  }
  return parts.length ? `Start with ${parts.join(', ')}.` : '';
}

export function generateRationale(meta) {
  if (!meta) return '';
  const { top, pant, shoe, accs, others, harmonyLabel, intent } = meta;
  const sentences = [
    pieceSentence(top, pant, shoe, accs, others),
    formalitySentence(intent, top, pant),
    harmonySentence(harmonyLabel, top, pant),
    weatherSentence(intent)
  ].filter(Boolean);
  return sentences.join(' ');
}

export function generateOutfitName(meta) {
  if (!meta) return 'New look';
  const { top, intent, harmonyLabel } = meta;
  const tone = top?._tone || 'neutral';
  const toneWord = {
    red: 'Crimson', orange: 'Sunset', yellow: 'Sunlit', green: 'Olive', cyan: 'Teal',
    blue: 'Indigo', purple: 'Plum', pink: 'Rose', black: 'Onyx', white: 'Ivory',
    gray: 'Slate', brown: 'Cocoa', neutral: 'Quiet'
  }[tone] || 'Quiet';

  const formalityWord = {
    athletic: 'Run', beach: 'Coast', casual: 'Drift', smart: 'Bureau', formal: 'Soirée'
  }[intent?.formality] || pick(['Drift', 'Stroll', 'Lookbook']);

  const weatherWord = {
    hot: 'Sunshine', cold: 'Frost', rainy: 'Cloudburst'
  }[intent?.weather] || '';

  const parts = [toneWord, weatherWord, formalityWord].filter(Boolean);
  return parts.slice(0, 2).join(' ');
}

// Greeting / clarifier replies for misc states
export function greetingMessage(itemCount, outfitCount) {
  if (itemCount === 0) {
    return `Hey — I'm your local stylist, running entirely in your browser. Add a few items first (tops or dresses, bottoms, shoes, accessories) and I'll pull together outfits using color theory, formality matching, and category rules. Tap **Items → +** to start.`;
  }
  return `I'm your local stylist — I work entirely in your browser, with no cloud. I'll combine your **${itemCount}** items into outfits using color theory and formality matching. Try a prompt like "casual weekend look", "3 outfits for warm weather", or "something formal for an evening dinner". Each suggestion I make is saveable and clearly badged as AI-suggested.`;
}

export function unableMessage(reason) {
  switch (reason) {
    case 'no-main-piece':
      return `I can't build a complete outfit without at least one **top or dress** in your library. Add one and try again.`;
    case 'no-shoes':
      return `I need at least one pair of **shoes** to anchor an outfit. Add some and ping me back.`;
    case 'no-items':
      return `Your closet is empty — add some items first and I'll start styling.`;
    default:
      return `I couldn't put a look together with what's available. Try loosening the prompt (e.g. drop "formal") or add more items.`;
  }
}

export function summaryForGroup(outfits, intent) {
  if (outfits.length === 0) return unableMessage('default');
  if (outfits.length === 1) {
    return `Here's a ${intent.formality ? intent.formality + ' ' : ''}look I put together for you:`;
  }
  return `Here are ${outfits.length} ${intent.formality ? intent.formality + ' ' : ''}options for you to compare:`;
}
