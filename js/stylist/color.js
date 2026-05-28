// Color utilities for the Stylist engine.
// We sample item images down to 24×24, average the non-transparent pixels,
// convert to HSV, and classify into tones / harmony families.

export async function extractDominantColor(blob) {
  if (!blob || blob.size === 0) return null;
  const img = await loadBitmap(blob);
  if (!img) return null;
  const W = 24, H = 24;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  if (img.close) img.close();
  const { data } = ctx.getImageData(0, 0, W, H);
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;
    // Skip near-white border pixels — many item photos sit on a white background
    const px = data[i], py = data[i + 1], pz = data[i + 2];
    if (px > 235 && py > 235 && pz > 235) continue;
    r += px; g += py; b += pz; count++;
  }
  if (!count) {
    // Fall back to including background — at least we get *something*
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
  }
  if (!count) return null;
  return { r: r / count, g: g / count, b: b / count };
}

async function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch {}
  }
  return await new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

export function rgbToHsv({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

// Map an HSV color to a human-readable tone.
// Neutrals (low saturation OR near-black/white) all collapse to 'neutral'.
export function colorTone(hsv) {
  if (!hsv) return 'neutral';
  const { h, s, v } = hsv;
  if (v < 0.18) return 'black';
  if (v > 0.92 && s < 0.12) return 'white';
  if (s < 0.15) return 'gray';
  // Browns: warm hue, mid value, mid-high saturation
  if (h < 40 && v < 0.55 && s > 0.25) return 'brown';
  if (h < 20 || h >= 340) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 95) return 'lime';
  if (h < 155) return 'green';
  if (h < 200) return 'cyan';
  if (h < 250) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

export function isNeutral(tone) {
  return tone === 'neutral' || tone === 'black' || tone === 'white' || tone === 'gray' || tone === 'brown';
}

// Hue distance considering wraparound at 360°.
function hueDist(a, b) {
  if (a == null || b == null) return Infinity;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Decide which color-theory family a given pair of HSV colors fits.
// Returns a score [0..1] where higher = more harmonious.
export function harmonyScore(colorA, colorB) {
  // Either neutral → always harmonious
  if (!colorA || !colorB) return 0.6;
  const sA = colorA.s, sB = colorB.s;
  const isNeutralA = sA < 0.15 || colorA.v < 0.18 || (colorA.v > 0.92 && sA < 0.12);
  const isNeutralB = sB < 0.15 || colorB.v < 0.18 || (colorB.v > 0.92 && sB < 0.12);
  if (isNeutralA || isNeutralB) return 0.85;
  const dh = hueDist(colorA.h, colorB.h);
  // Monochromatic
  if (dh < 15) return 1.0;
  // Analogous (within 30°)
  if (dh < 45) return 0.9;
  // Triadic (~120°)
  if (Math.abs(dh - 120) < 15) return 0.8;
  // Complementary (~180°)
  if (Math.abs(dh - 180) < 15) return 0.85;
  // Anything else — colors clash
  return 0.4;
}

// Classify the overall harmony of an outfit's color set.
export function classifyHarmony(colors) {
  const nonNeutral = colors.filter(c => {
    if (!c) return false;
    const isN = c.s < 0.15 || c.v < 0.18 || (c.v > 0.92 && c.s < 0.12);
    return !isN;
  });
  if (nonNeutral.length === 0) return 'neutral palette';
  if (nonNeutral.length === 1) return 'neutral with a single accent';
  const hues = nonNeutral.map(c => c.h);
  const spread = hueSpread(hues);
  if (spread < 15) return 'monochromatic';
  if (spread < 45) return 'analogous';
  // Check complementary
  if (nonNeutral.length === 2) {
    const dh = hueDist(hues[0], hues[1]);
    if (Math.abs(dh - 180) < 15) return 'complementary';
  }
  // Check triadic-ish for 3+
  if (nonNeutral.length >= 3 && spread > 100 && spread < 140) return 'triadic';
  if (spread > 90) return 'bold, multi-hue';
  return 'mixed';
}

function hueSpread(hues) {
  // Wrap-aware spread — try every rotation, take the smallest.
  if (hues.length <= 1) return 0;
  const sorted = [...hues].sort((a, b) => a - b);
  let bestSpread = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const rotated = sorted.map((h, j) => (h - sorted[i] + 360) % 360);
    rotated.sort((a, b) => a - b);
    bestSpread = Math.min(bestSpread, rotated[rotated.length - 1] - rotated[0]);
  }
  return bestSpread;
}
