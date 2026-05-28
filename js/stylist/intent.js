// Parse a free-text user prompt into structured outfit constraints.
// Keyword-based, deliberately simple — it's the only "NLU" layer we ship.

const FORMALITY_KEYWORDS = {
  athletic: ['gym', 'workout', 'work out', 'run', 'running', 'hike', 'hiking', 'athletic', 'sport', 'sporty', 'jog'],
  beach: ['beach', 'pool', 'poolside', 'swim', 'seaside', 'tropical'],
  casual: ['casual', 'chill', 'relaxed', 'weekend', 'lounge', 'errand', 'errands', 'coffee', 'brunch', 'day off'],
  smart: ['smart', 'smart casual', 'business', 'work', 'office', 'meeting', 'interview', 'presentation'],
  formal: ['formal', 'fancy', 'evening', 'dinner', 'date night', 'date', 'gala', 'wedding', 'cocktail', 'black tie', 'opera']
};

const WEATHER_KEYWORDS = {
  hot: ['hot', 'warm', 'sunny', 'summer', 'beach', 'heat', 'humid'],
  cold: ['cold', 'cool', 'chilly', 'winter', 'snowy', 'snow', 'freezing'],
  rainy: ['rain', 'rainy', 'wet', 'drizzle', 'pouring', 'showers']
};

const REFINE_KEYWORDS = {
  swapTop: ['swap the top', 'change the top', 'different top', 'another top', 'new top'],
  swapPant: ['swap the pant', 'change the pant', 'different pant', 'change pants', 'change bottom', 'swap the bottom'],
  swapShoes: ['swap the shoes', 'change shoes', 'different shoes', 'new shoes'],
  moreColor: ['more colorful', 'add color', 'less neutral', 'pop of color'],
  lessColor: ['more neutral', 'less colorful', 'tone it down', 'tone down'],
  again: ['another', 'one more', 'try again', 'something else', 'different', 'redo']
};

const COLOR_KEYWORDS = {
  red: ['red', 'crimson', 'burgundy'],
  orange: ['orange'],
  yellow: ['yellow', 'mustard'],
  green: ['green', 'olive', 'forest'],
  cyan: ['cyan', 'teal'],
  blue: ['blue', 'navy'],
  purple: ['purple', 'violet'],
  pink: ['pink'],
  black: ['black'],
  white: ['white', 'cream', 'ivory'],
  gray: ['gray', 'grey', 'charcoal'],
  brown: ['brown', 'tan', 'beige', 'khaki']
};

const HARMONY_KEYWORDS = {
  mono: ['monochrome', 'monochromatic'],
  analogous: ['analogous'],
  complementary: ['complementary', 'contrast', 'contrasting'],
  triadic: ['triadic']
};

const COUNT_PATTERN = /(\d+)\s*(?:outfits?|looks?|options?|set\s*ups?)/i;
const WEEK_PATTERN = /\b(week|7\s*days?|seven\s*days?)\b/i;
const WEEKEND_PATTERN = /\b(weekend|2\s*days?|two\s*days?)\b/i;

export function parseIntent(prompt, context = {}) {
  const text = (prompt || '').toLowerCase();

  // Formality
  let formality = null;
  for (const [k, words] of Object.entries(FORMALITY_KEYWORDS)) {
    if (words.some(w => text.includes(w))) { formality = k; break; }
  }

  // Weather
  let weather = null;
  for (const [k, words] of Object.entries(WEATHER_KEYWORDS)) {
    if (words.some(w => text.includes(w))) { weather = k; break; }
  }

  // Color preference
  const preferredColors = [];
  for (const [k, words] of Object.entries(COLOR_KEYWORDS)) {
    if (words.some(w => text.includes(w))) preferredColors.push(k);
  }

  // Color-harmony preference
  let harmony = null;
  for (const [k, words] of Object.entries(HARMONY_KEYWORDS)) {
    if (words.some(w => text.includes(w))) { harmony = k; break; }
  }

  // Count
  let count = 1;
  const countMatch = text.match(COUNT_PATTERN);
  if (countMatch) count = clamp(parseInt(countMatch[1], 10), 1, 7);
  else if (WEEK_PATTERN.test(text)) count = 5;
  else if (WEEKEND_PATTERN.test(text)) count = 2;

  // Refinement / multi-turn directives
  const refine = {};
  for (const [k, words] of Object.entries(REFINE_KEYWORDS)) {
    if (words.some(w => text.includes(w))) refine[k] = true;
  }

  return {
    raw: prompt || '',
    formality,
    weather,
    preferredColors,
    harmony,
    count,
    refine,
    // pass through context (e.g. previously suggested outfit for refinement)
    previousOutfit: context.previousOutfit || null
  };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
