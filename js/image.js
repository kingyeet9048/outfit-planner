// Image pipeline: File → resized JPEG Blob. Plus object URL lifecycle helpers.

const MAX_DIM = 1024;
const JPEG_QUALITY = 0.82;

export async function resizeFile(file, { maxDim = MAX_DIM, quality = JPEG_QUALITY } = {}) {
  if (!file) throw new Error('No file provided');
  if (!file.type || !file.type.startsWith('image/')) throw new Error('File must be an image');

  let source, srcW, srcH;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      source = bitmap;
      srcW = bitmap.width;
      srcH = bitmap.height;
    } catch {
      const img = await loadViaImg(file);
      source = img;
      srcW = img.naturalWidth;
      srcH = img.naturalHeight;
    }
  } else {
    const img = await loadViaImg(file);
    source = img;
    srcW = img.naturalWidth;
    srcH = img.naturalHeight;
  }

  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, w, h);
  if (source.close) source.close();

  return await new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Failed to encode image')), 'image/jpeg', quality);
  });
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

// ---- Object URL cache (per owner key) ----
const cache = new Map(); // ownerKey -> Map(blob -> url)

export function urlFor(ownerKey, blob) {
  if (!blob) return '';
  let bucket = cache.get(ownerKey);
  if (!bucket) { bucket = new Map(); cache.set(ownerKey, bucket); }
  if (bucket.has(blob)) return bucket.get(blob);
  const url = URL.createObjectURL(blob);
  bucket.set(blob, url);
  return url;
}

export function releaseOwner(ownerKey) {
  const bucket = cache.get(ownerKey);
  if (!bucket) return;
  for (const url of bucket.values()) URL.revokeObjectURL(url);
  cache.delete(ownerKey);
}

export function releaseAll() {
  for (const bucket of cache.values()) for (const url of bucket.values()) URL.revokeObjectURL(url);
  cache.clear();
}
