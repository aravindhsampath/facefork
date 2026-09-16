// Image utilities: downscale/encode for storage and for cheap vision-model input.

async function drawScaled(blob, max) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s);
  const h = Math.round(bmp.height * s);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { canvas, w, h };
}

// Uploads are re-encoded as JPEG ≤ max px: bounded storage, and EXIF (location, device) stripped
// before the bytes go anywhere. Returns {blob, w, h}.
export async function normalize(blob, max = 2048) {
  const { canvas, w, h } = await drawScaled(blob, max);
  return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }), w, h };
}

// Cheap model input: JPEG ≤ max px as a data URL. Computed once per node and cached on it.
export async function toInline(blob, max = 1024) {
  const { canvas } = await drawScaled(blob, max);
  const small = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(small);
  });
}

// Pixel size without re-encoding: generated images are stored exactly as the model returned them.
export async function dims(blob) {
  const bmp = await createImageBitmap(blob);
  const d = { w: bmp.width, h: bmp.height };
  bmp.close();
  return d;
}

export function base64ToBlob({ mime, data }) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const extOf = (blob) => ({ 'image/webp': 'webp', 'image/png': 'png', 'image/gif': 'gif', 'video/mp4': 'mp4', 'text/html': 'html', 'application/zip': 'facefork' }[blob?.type] || 'jpg');

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
