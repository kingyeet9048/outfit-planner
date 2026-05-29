// Render one or more outfits to a high-quality PNG and hand it off via
// navigator.share() (iOS Share Sheet, Android intent) or fall back to download.
//
// Items are drawn at their stored resolution (≤1024px) so the recipient sees
// each garment full-length without thumbnail cropping. The final PNG is lossless.

import { hasBytes } from './image.js';

const CATEGORY_LABELS = { top: 'Top', pant: 'Pant', shoes: 'Shoes', accessory: 'Accessory', other: 'Other' };
const CATEGORY_ICONS = { top: '👕', pant: '👖', shoes: '👟', accessory: '✨', other: '🎒' };

const W = 1080;
const PAD = 40;
const TITLE_BLOCK_H = 130;
const ITEM_GAP = 28;
const ITEM_LABEL_H = 96;
const ITEM_MAX_IMG_H = 760;
const FOOTER_H = 64;
const CARD_RADIUS = 18;

const PALETTE = {
  bg: '#fafafa',
  surface: '#ffffff',
  border: '#e5e7eb',
  text: '#111111',
  textMuted: '#6b7280',
  accent: '#2563eb',
  owned: '#16a34a',
  toBuy: '#d97706',
  white: '#ffffff'
};

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

function topDownItemSlots(outfit, itemsById) {
  const out = [];
  for (const id of (outfit.accessoryIds || [])) {
    const it = itemsById.get(id);
    if (it) out.push({ item: it, slotLabel: 'Accessory' });
  }
  if (outfit.topId) {
    const it = itemsById.get(outfit.topId);
    if (it) out.push({ item: it, slotLabel: 'Top' });
  }
  if (outfit.pantId) {
    const it = itemsById.get(outfit.pantId);
    if (it) out.push({ item: it, slotLabel: 'Pant' });
  }
  if (outfit.shoesId) {
    const it = itemsById.get(outfit.shoesId);
    if (it) out.push({ item: it, slotLabel: 'Shoes' });
  }
  for (const id of (outfit.otherIds || [])) {
    const it = itemsById.get(id);
    if (it) out.push({ item: it, slotLabel: 'Other' });
  }
  return out;
}

async function loadBitmap(blob) {
  if (!hasBytes(blob)) return null;
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch {}
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

async function planOutfit(outfit, itemsById) {
  const slots = topDownItemSlots(outfit, itemsById);
  const items = [];
  const maxImgW = W - PAD * 2 - 32; // inset within card padding
  for (const { item, slotLabel } of slots) {
    const bitmap = await loadBitmap(item.imageBlob);
    let imgW, imgH;
    if (bitmap) {
      // Never upscale beyond original — preserves "minimal quality loss"
      const scale = Math.min(maxImgW / bitmap.width, ITEM_MAX_IMG_H / bitmap.height, 1);
      imgW = Math.round(bitmap.width * scale);
      imgH = Math.round(bitmap.height * scale);
    } else {
      imgW = 480;
      imgH = 360;
    }
    items.push({ item, slotLabel, bitmap, imgW, imgH });
  }
  let owned = 0, toBuy = 0;
  for (const x of items) { if (x.item.owned) owned++; else toBuy++; }
  const itemsHeight = items.reduce((s, p) => s + p.imgH + ITEM_LABEL_H + ITEM_GAP, 0);
  const sectionH = PAD + TITLE_BLOCK_H + Math.max(itemsHeight, 0) + FOOTER_H + PAD;
  return { items, owned, toBuy, sectionH };
}

function drawSection(ctx, outfit, plan, originY, index, total) {
  let y = originY + PAD;

  // Title
  ctx.fillStyle = PALETTE.text;
  ctx.font = `700 44px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(outfit.name || 'Untitled outfit', PAD, y, W - PAD * 2);
  y += 56;

  // Subtitle
  const subtitleParts = [];
  if (total > 1) subtitleParts.push(`Outfit ${index + 1} of ${total}`);
  subtitleParts.push(`${plan.items.length} item${plan.items.length === 1 ? '' : 's'}`);
  if (plan.items.length > 0) {
    subtitleParts.push(plan.toBuy === 0 ? '✓ Complete' : `${plan.toBuy} to buy`);
  }
  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `400 22px ${FONT}`;
  ctx.fillText(subtitleParts.join('  ·  '), PAD, y);
  y += 40;

  // Divider
  ctx.fillStyle = PALETTE.border;
  ctx.fillRect(PAD, y, W - PAD * 2, 1);
  y += 24;

  if (plan.items.length === 0) {
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = `400 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('No items in this outfit.', W / 2, y + 40);
    ctx.textAlign = 'left';
  }

  // Items
  for (const slot of plan.items) {
    const cardX = PAD;
    const cardY = y;
    const cardW = W - PAD * 2;
    const cardH = slot.imgH + ITEM_LABEL_H;

    // Card background + subtle border
    ctx.fillStyle = PALETTE.surface;
    roundedRect(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
    ctx.fill();
    ctx.strokeStyle = PALETTE.border;
    ctx.lineWidth = 1;
    roundedRect(ctx, cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1, CARD_RADIUS);
    ctx.stroke();

    // Image — centered horizontally, clipped to a rounded top inset
    const imgX = Math.round((W - slot.imgW) / 2);
    const imgY = cardY + 16;
    if (slot.bitmap) {
      ctx.save();
      roundedRect(ctx, imgX, imgY, slot.imgW, slot.imgH, 12);
      ctx.clip();
      ctx.drawImage(slot.bitmap, imgX, imgY, slot.imgW, slot.imgH);
      ctx.restore();
    } else {
      ctx.fillStyle = '#eeeeee';
      roundedRect(ctx, imgX, imgY, slot.imgW, slot.imgH, 12);
      ctx.fill();
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = `64px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CATEGORY_ICONS[slot.item.category] || '👕', imgX + slot.imgW / 2, imgY + slot.imgH / 2);
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
    }

    // Label area below image
    const labelY = imgY + slot.imgH + 14;
    // Name (truncate visually via maxWidth)
    ctx.fillStyle = PALETTE.text;
    ctx.font = `700 26px ${FONT}`;
    const nameMaxW = cardW - 48 - 180; // leave room for pill
    ctx.fillText(slot.item.name || '(unnamed)', cardX + 24, labelY, nameMaxW);

    // Subtitle: slot · subcategory
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = `400 20px ${FONT}`;
    const catLabel = CATEGORY_LABELS[slot.item.category] || slot.item.category || slot.slotLabel;
    const sub = slot.item.subcategory ? `${catLabel} · ${slot.item.subcategory}` : catLabel;
    ctx.fillText(sub, cardX + 24, labelY + 34, nameMaxW);

    // Ownership pill (right-aligned)
    const pillText = slot.item.owned ? '✓ Owned' : '$ To buy';
    ctx.font = `700 20px ${FONT}`;
    const pillTextW = ctx.measureText(pillText).width;
    const pillW = pillTextW + 28;
    const pillH = 36;
    const pillX = cardX + cardW - 24 - pillW;
    const pillY = labelY + 8;
    ctx.fillStyle = slot.item.owned ? PALETTE.owned : PALETTE.toBuy;
    roundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pillText, pillX + pillW / 2, pillY + pillH / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    y += cardH + ITEM_GAP;
  }

  // Footer
  const footerY = originY + plan.sectionH - PAD - 24;
  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `400 18px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('Made with Outfit Planner', W / 2, footerY);
  ctx.textAlign = 'left';
}

export async function renderOutfitsCanvas(outfits, itemsById) {
  const plans = [];
  for (const o of outfits) plans.push(await planOutfit(o, itemsById));

  const totalH = plans.reduce((s, p) => s + p.sectionH, 0);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, W, totalH);

  let y = 0;
  for (let i = 0; i < outfits.length; i++) {
    drawSection(ctx, outfits[i], plans[i], y, i, outfits.length);
    // Separator between outfit sections (not after the last)
    if (i < outfits.length - 1) {
      ctx.fillStyle = PALETTE.border;
      ctx.fillRect(0, y + plans[i].sectionH - 1, W, 1);
    }
    y += plans[i].sectionH;
    for (const p of plans[i].items) {
      if (p.bitmap && typeof p.bitmap.close === 'function') p.bitmap.close();
    }
  }
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed to encode image')), type, quality);
  });
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'outfit';
}

function buildFilename(outfits) {
  const date = new Date().toISOString().slice(0, 10);
  if (outfits.length === 1) return `outfit-${slugify(outfits[0].name)}-${date}.png`;
  return `outfits-${outfits.length}-${date}.png`;
}

// Share via Web Share API with files; fall back to a download.
// Returns { method: 'share' | 'download' | 'cancelled' }.
export async function shareOutfits(outfits, itemsById) {
  if (!Array.isArray(outfits)) outfits = [outfits];
  if (!outfits.length) throw new Error('No outfits to share');

  const canvas = await renderOutfitsCanvas(outfits, itemsById);
  const blob = await canvasToBlob(canvas, 'image/png');
  const filename = buildFilename(outfits);
  const file = new File([blob], filename, { type: 'image/png' });
  const title = outfits.length === 1 ? (outfits[0].name || 'Outfit') : `${outfits.length} outfits`;
  const text = outfits.length === 1
    ? `Outfit: ${outfits[0].name || ''}`.trim()
    : `${outfits.length} outfits from Outfit Planner`;

  if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title, text });
      return { method: 'share' };
    } catch (err) {
      if (err && err.name === 'AbortError') return { method: 'cancelled' };
      // else fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300);
  return { method: 'download' };
}
