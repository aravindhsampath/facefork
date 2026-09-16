// Tiny retained-mode canvas renderer. A scene is {w, h, bg, ops[]} in design units;
// render() scales it to whatever output size is wanted, so one layout serves preview,
// social card and print. Every share format in formats/ is just a function returning a scene.

export const SANS = 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
export const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
export const HAND = '"Bradley Hand", "Segoe Script", "Comic Sans MS", cursive';
export const COND = 'Haettenschweiler, "Arial Narrow", Impact, sans-serif';
export const SLAB = 'Rockwell, "Bookman Old Style", Georgia, serif';

const scratch = document.createElement('canvas').getContext('2d');
const fontOf = (o) => `${o.italic ? 'italic ' : ''}${o.weight ?? 400} ${o.size ?? 16}px ${o.family ?? SANS}`;

// ---- op constructors (layouts read better as calls than object literals) ----
export const rect = (x, y, w, h, o = {}) => ({ t: 'rect', x, y, w, h, ...o });
export const img = (x, y, w, h, bmp, o = {}) => (bmp ? { t: 'img', x, y, w, h, bmp, ...o } : null);
export const text = (x, y, s, o = {}) => ({ t: 'text', x, y, s, ...o });
export const line = (x1, y1, x2, y2, o = {}) => ({ t: 'line', x1, y1, x2, y2, ...o });
export const circle = (x, y, r, o = {}) => ({ t: 'circle', x, y, r, ...o });
export const poly = (pts, o = {}) => ({ t: 'poly', pts, ...o });
export const path = (d, o = {}) => ({ t: 'path', d, ...o });
export const noise = (x, y, w, h, o = {}) => ({ t: 'noise', x, y, w, h, ...o });
export const group = (x, y, ops, o = {}) => ({ t: 'group', x, y, ops, ...o });

export const linear = (x0, y0, x1, y1, stops) => ({ g: 'linear', x0, y0, x1, y1, stops });
export const radial = (x, y, r, stops) => ({ g: 'radial', x, y, r, stops });

// ---- text measurement (layouts need it to flow content) ----
export function wrap(s, o = {}) {
  scratch.font = fontOf(o);
  const maxW = o.maxW ?? Infinity;
  const out = [];
  for (const para of String(s ?? '').split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (!cur || scratch.measureText(next).width <= maxW) cur = next;
      else { out.push(cur); cur = word; }
    }
    out.push(cur);
  }
  if (o.maxLines && out.length > o.maxLines) {
    out.length = o.maxLines;
    let last = out[o.maxLines - 1];
    while (last.length > 1 && scratch.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    out[o.maxLines - 1] = `${last}…`;
  }
  return out;
}
export const measure = (s, o = {}) => { scratch.font = fontOf(o); return scratch.measureText(String(s ?? '')).width; };
export const textHeight = (s, o = {}) => wrap(s, o).length * (o.lh ?? (o.size ?? 16) * 1.3);

// Fit `s` to `maxW` by shrinking the size — for one-line headlines that must not wrap.
export function fitSize(s, o, maxW, min = 8) {
  let size = o.size ?? 16;
  while (size > min && measure(s, { ...o, size }) > maxW) size -= 1;
  return size;
}

// ---- deterministic randomness, so a given tree always renders the same card ----
export function rngOf(seedStr) {
  let h = 1779033703 ^ String(seedStr).length;
  for (const c of String(seedStr)) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- renderer ----
function style(ctx, v, box) {
  if (!v || typeof v === 'string') return v;
  const g = v.g === 'radial'
    ? ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r)
    : ctx.createLinearGradient(v.x0, v.y0, v.x1, v.y1);
  for (const [at, col] of v.stops) g.addColorStop(at, col);
  return g;
}

function roundPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (r) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

// Source rect for cover/contain fitting of a bitmap into a box.
function fitRect(bmp, w, h, fit) {
  const sw = bmp.width, sh = bmp.height;
  if (fit === 'contain') {
    const s = Math.min(w / sw, h / sh);
    return { dx: (w - sw * s) / 2, dy: (h - sh * s) / 2, dw: sw * s, dh: sh * s, sx: 0, sy: 0, sw, sh };
  }
  const s = Math.max(w / sw, h / sh);
  const cw = w / s, ch = h / s;
  return { dx: 0, dy: 0, dw: w, dh: h, sx: (sw - cw) / 2, sy: (sh - ch) * 0.35, sw: cw, sh: ch }; // bias up: faces sit high
}

function paint(ctx, op) {
  ctx.save();
  if (op.alpha != null) ctx.globalAlpha *= op.alpha;
  if (op.filter) ctx.filter = op.filter;
  if (op.shadow) { ctx.shadowColor = op.shadow.color; ctx.shadowBlur = op.shadow.blur ?? 0; ctx.shadowOffsetX = op.shadow.x ?? 0; ctx.shadowOffsetY = op.shadow.y ?? 0; }
  if (op.rotate) {
    const ox = op.ox ?? (op.x ?? 0) + (op.w ?? 0) / 2;
    const oy = op.oy ?? (op.y ?? 0) + (op.h ?? 0) / 2;
    ctx.translate(ox, oy); ctx.rotate((op.rotate * Math.PI) / 180); ctx.translate(-ox, -oy);
  }
  switch (op.t) {
    case 'group': {
      ctx.translate(op.x || 0, op.y || 0);
      if (op.scale) ctx.scale(op.scale, op.scale);
      if (op.clip) { roundPath(ctx, op.clip.x, op.clip.y, op.clip.w, op.clip.h, op.clip.r); ctx.clip(); }
      for (const o of op.ops) if (o) paint(ctx, o);
      break;
    }
    case 'rect': {
      roundPath(ctx, op.x, op.y, op.w, op.h, op.r);
      if (op.fill) { ctx.fillStyle = style(ctx, op.fill); ctx.fill(); }
      if (op.stroke) { ctx.strokeStyle = style(ctx, op.stroke); ctx.lineWidth = op.lw ?? 1; if (op.dash) ctx.setLineDash(op.dash); ctx.stroke(); }
      break;
    }
    case 'img': {
      roundPath(ctx, op.x, op.y, op.w, op.h, op.r);
      ctx.clip();
      ctx.imageSmoothingQuality = 'high';
      // A dead source (closed bitmap, zero-size canvas) must not take the rest of the scene with it.
      try {
        if (!op.bmp.width || !op.bmp.height) throw new Error('empty image source');
        const f = fitRect(op.bmp, op.w, op.h, op.fit || 'cover');
        ctx.drawImage(op.bmp, f.sx, f.sy, f.sw, f.sh, op.x + f.dx, op.y + f.dy, f.dw, f.dh);
      } catch (e) {
        console.warn('share: image failed to draw', e);
        ctx.fillStyle = '#555'; ctx.fillRect(op.x, op.y, op.w, op.h);
      }
      break;
    }
    case 'text': {
      ctx.font = fontOf(op);
      ctx.textAlign = op.align || 'left';
      ctx.textBaseline = op.baseline || 'top';
      if (op.tracking != null && 'letterSpacing' in ctx) ctx.letterSpacing = `${op.tracking}px`;
      const lines = op.maxW ? wrap(op.s, op) : String(op.s ?? '').split('\n');
      const lh = op.lh ?? (op.size ?? 16) * 1.3;
      lines.forEach((ln, i) => {
        const y = op.y + i * lh;
        if (op.stroke) { ctx.strokeStyle = style(ctx, op.stroke); ctx.lineWidth = op.lw ?? 2; ctx.lineJoin = 'round'; ctx.strokeText(ln, op.x, y); }
        if (op.fill !== false) { ctx.fillStyle = style(ctx, op.fill || '#000'); ctx.fillText(ln, op.x, y); }
      });
      break;
    }
    case 'line': {
      ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2);
      ctx.strokeStyle = style(ctx, op.stroke || '#000'); ctx.lineWidth = op.lw ?? 1;
      if (op.dash) ctx.setLineDash(op.dash);
      ctx.lineCap = op.cap || 'butt';
      ctx.stroke();
      break;
    }
    case 'circle': {
      ctx.beginPath(); ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
      if (op.fill) { ctx.fillStyle = style(ctx, op.fill); ctx.fill(); }
      if (op.stroke) { ctx.strokeStyle = style(ctx, op.stroke); ctx.lineWidth = op.lw ?? 1; ctx.stroke(); }
      break;
    }
    case 'poly': {
      ctx.beginPath();
      op.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (op.close !== false) ctx.closePath();
      if (op.fill) { ctx.fillStyle = style(ctx, op.fill); ctx.fill(); }
      if (op.stroke) { ctx.strokeStyle = style(ctx, op.stroke); ctx.lineWidth = op.lw ?? 1; ctx.lineCap = op.cap || 'butt'; ctx.stroke(); }
      break;
    }
    case 'path': {
      const p = new Path2D(op.d);
      if (op.fill) { ctx.fillStyle = style(ctx, op.fill); ctx.fill(p); }
      if (op.stroke) { ctx.strokeStyle = style(ctx, op.stroke); ctx.lineWidth = op.lw ?? 1; ctx.lineCap = op.cap || 'round'; ctx.stroke(p); }
      break;
    }
    case 'noise': {
      // Speckle for aged paper / film grain. Rendered at design resolution and stretched.
      const n = document.createElement('canvas');
      n.width = Math.max(1, Math.round(op.w / (op.grain || 1)));
      n.height = Math.max(1, Math.round(op.h / (op.grain || 1)));
      const nx = n.getContext('2d');
      const d = nx.createImageData(n.width, n.height);
      const rnd = rngOf(op.seed ?? 'grain');
      for (let i = 0; i < d.data.length; i += 4) {
        const v = rnd() * 255;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = rnd() * 255 * (op.density ?? 1);
      }
      nx.putImageData(d, 0, 0);
      ctx.globalAlpha *= op.alpha ?? 0.08;
      ctx.drawImage(n, op.x, op.y, op.w, op.h);
      break;
    }
    default: break;
  }
  ctx.restore();
}

export function render(scene, scale = 1, canvas) {
  const c = canvas || document.createElement('canvas');
  c.width = Math.max(1, Math.round(scene.w * scale));
  c.height = Math.max(1, Math.round(scene.h * scale));
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.scale(scale, scale);
  if (scene.bg) { ctx.fillStyle = style(ctx, scene.bg); ctx.fillRect(0, 0, scene.w, scene.h); }
  for (const op of scene.ops) if (op) paint(ctx, op);
  ctx.restore();
  return c;
}

// Rejects instead of resolving null (the browser's answer when the canvas is too large or tainted).
export const toBlob = (canvas, type = 'image/png', quality = 0.92) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(`Could not encode a ${canvas.width}×${canvas.height} image — try a smaller size`))), type, quality));

// ---- shared furniture ----
export const WORDMARK = 'facefork.com';

let wordmarkOn = true;
export const setWordmark = (on) => { wordmarkOn = on; };

// Small corner attribution. Survives re-encoding, unlike metadata — so it is the part that
// actually carries attribution to a viewer. Off is a real choice; forced marks just get cropped.
export function mark(x, y, o = {}) {
  if (!wordmarkOn) return null;
  const size = o.size ?? 20;
  return text(x, y, WORDMARK, {
    size, weight: 600, family: SANS, fill: o.fill ?? 'rgba(255,255,255,.55)',
    align: o.align || 'left', baseline: o.baseline || 'alphabetic', tracking: size * 0.06,
  });
}

// Barcode-ish bars from any string. Decorative, not scannable — see docs/sharing-options.md.
export function barcode(x, y, w, h, seed, fill = '#000') {
  const rnd = rngOf(seed);
  const ops = [];
  let at = x;
  while (at < x + w) {
    const bw = 1 + Math.floor(rnd() * 4);
    if (rnd() > 0.35) ops.push(rect(at, y, bw, h, { fill }));
    at += bw + 1 + Math.floor(rnd() * 3);
  }
  return group(0, 0, ops, { clip: { x, y, w, h } });
}
