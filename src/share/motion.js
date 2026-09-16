// Motion share formats. Each returns a spec {w, h, duration, fps, bg, frame(time) -> ops[]}.
// video.js turns a spec into MP4 (WebCodecs) or GIF; the dialog plays the same frame() live,
// so the preview is literally the output. Options follow the same declarations as stills.js.

import { SERIF, rect, img, text, group, linear, mark, fitSize } from './scene.js';
import { promptOf, money, nodeOr, newest, rootOf, familyOf } from './tree.js';

const SHAPES = { '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 }, '16:9': { w: 1920, h: 1080 } };
const SHAPE_LABELS = { '9:16': '9:16 · Reels / TikTok / Story', '1:1': '1:1 · square', '16:9': '16:9 · X / YouTube' };
const s = (v) => String(v ?? '').trim();
const auto = (o, key, suggestion) => (o[key] === undefined ? suggestion : s(o[key]));

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { const c = clamp01(x); return c * c * (3 - 2 * c); };

const subject = (t, o) => nodeOr(t, o.photo, t.focus);
const opt = {
  shape: (def = '9:16') => ({ id: 'shape', label: 'Shape', type: 'select', def, choices: Object.keys(SHAPES), labels: SHAPE_LABELS }),
  title: { id: 'title', label: 'Title (top)', type: 'text', def: '' },
  quote: { id: 'quote', label: 'Quote (bottom)', type: 'text', def: '' },
  mark: { id: 'mark', label: 'facefork.com watermark', type: 'bool', def: true },
  cost: { id: 'cost', label: 'Show cost', type: 'bool', def: false },
  bar: { id: 'bar', label: 'Progress bar', type: 'bool', def: true },
};

// Image area: full-bleed on 1:1 / 16:9, a letterboxed band on 9:16 so captions have room.
const frameOf = (o) => {
  const { w, h } = SHAPES[o.shape] || SHAPES['9:16'];
  const tall = h > w;
  return { w, h, iy: tall ? 240 : 0, ih: tall ? 1320 : h };
};

// Caption furniture drawn over every frame: title up top, a label band + quote near the bottom,
// wordmark and cost in the last few pixels. `label` is the per-frame text (prompt / before / after).
function furnish(f, o, { label = '', prog = null, cost = 0, alpha = 1 } = {}) {
  const { w, h, iy, ih } = f;
  const tall = h > w;
  const ops = [];
  const title = s(o.title), quote = s(o.quote);
  if (title) ops.push(text(w / 2, tall ? 90 : 48, title, { size: fitSize(title, { size: 56, weight: 800 }, w - 160), weight: 800, fill: '#fff', align: 'center', maxW: w - 160, maxLines: 1, tracking: 1 }));
  if (!tall) ops.push(rect(0, h - 360, w, 360, { fill: linear(0, h - 360, 0, h, [[0, 'rgba(7,8,12,0)'], [1, 'rgba(7,8,12,.85)']]) }));
  let y = tall ? iy + ih + 70 : h - 250;
  if (label && o.labels !== false) {
    const size = fitSize(label, { size: 48, weight: 600 }, w - 200);
    ops.push(text(w / 2, y, label, { size, weight: 600, fill: '#fff', align: 'center', maxW: w - 160, lh: size * 1.2, maxLines: 2 }));
    y += size * 1.2 * 2 + 12;
  }
  if (quote) ops.push(text(w / 2, y, quote, { size: 34, weight: 600, family: SERIF, italic: true, fill: 'rgba(255,255,255,.8)', align: 'center', maxW: w - 200, lh: 42, maxLines: 2 }));
  if (prog != null && o.bar !== false) {
    ops.push(rect(120, h - 130, w - 240, 6, { fill: 'rgba(255,255,255,.2)', r: 3 }));
    ops.push(rect(120, h - 130, (w - 240) * clamp01(prog), 6, { fill: '#3b82f6', r: 3 }));
  }
  if (o.mark !== false) ops.push(mark(w / 2, h - 72, { size: 26, align: 'center', fill: 'rgba(255,255,255,.5)' }));
  if (o.cost) ops.push(text(w - 60, h - 72, money(cost), { size: 24, weight: 600, fill: 'rgba(255,255,255,.5)', align: 'right', baseline: 'alphabetic' }));
  return group(0, 0, ops, { alpha });
}

// ────────────────────────────────────────────────────────── 1. The Morph
// Works because buildPrompt() tells the model to keep pose and lighting — consecutive
// frames are near-registered, so a plain crossfade reads as a morph, not a slideshow.
function morph(t, o) {
  const chain = t.lineage.slice(-(o.steps || 5));
  const f = frameOf(o);
  const { w, h, iy, ih } = f;
  const per = Number(o.hold || 1.6);
  const xf = Math.min(0.7, per * 0.45);
  const dur = chain.length * per + (o.loop ? per * 0.6 : 0);
  return {
    w, h, bg: '#07080c', duration: dur, fps: 30,
    frame(time) {
      // With `loop` on, the last step fades back to the first so the video seams cleanly.
      const seq = o.loop ? [...chain, chain[0]] : chain;
      const i = Math.min(seq.length - 1, Math.floor(time / per));
      const local = time - i * per;
      const k = smooth((local - (per - xf)) / xf);
      const cur = seq[i], next = seq[i + 1];
      const nameOf = (n) => (n === chain[0] ? auto(o, 'first', n.data.name || 'the original') : promptOf(n));
      const label = k > 0.5 && next ? nameOf(next) : nameOf(cur);
      return [
        img(0, iy, w, ih, t.bmp.get(cur.id)),
        k > 0 && next ? img(0, iy, w, ih, t.bmp.get(next.id), { alpha: k }) : null,
        rect(0, iy + ih - 420, w, 420, { fill: linear(0, iy + ih - 420, 0, iy + ih, [[0, 'rgba(7,8,12,0)'], [1, 'rgba(7,8,12,.92)']]) }),
        furnish(f, o, { label, prog: time / dur, cost: chain.at(-1)?.data.cost }),
      ];
    },
  };
}

// ────────────────────────────────────────────────────────── 2. Loop
function loop(t, o) {
  const after = nodeOr(t, o.after, newest);
  const before = nodeOr(t, o.before, () => rootOf(t, after));
  const f = frameOf(o);
  const { w, h, iy, ih } = f;
  const dur = Number(o.speed || 1.8);
  const a = auto(o, 'labelA', 'BEFORE'), b = auto(o, 'labelB', 'AFTER');
  return {
    w, h, bg: '#07080c', duration: dur, fps: 30,
    frame(time) {
      const p = time / dur;
      const tri = p < 0.5 ? p * 2 : (1 - p) * 2;
      const k = smooth(clamp01((tri - 0.2) / 0.6));
      const lab = k > 0.5 ? b : a;
      return [
        img(0, iy, w, ih, t.bmp.get(before?.id)),
        img(0, iy, w, ih, t.bmp.get(after?.id), { alpha: k }),
        lab ? rect(60, iy + 60, 60 + lab.length * 16, 58, { fill: k > 0.5 ? '#3b82f6' : 'rgba(0,0,0,.65)', r: 29 }) : null,
        lab ? text(90 + lab.length * 8, iy + 76, lab, { size: 24, weight: 700, fill: '#fff', align: 'center', tracking: 1.5 }) : null,
        furnish(f, o, { label: o.prompt === undefined ? '' : s(o.prompt), cost: after?.data.cost }),
      ];
    },
  };
}

// ────────────────────────────────────────────────────────── 3. The Reveal
// Replays what using the app feels like: prompt types, parent blurs, result resolves.
function reveal(t, o) {
  const node = subject(t, o);
  const parent = t.byId.get(node?.data.parents[0]);
  const f = frameOf(o);
  const { w, h, iy, ih } = f;
  const prompt = auto(o, 'prompt', promptOf(node));
  const type = Math.max(0.6, Math.min(2.4, prompt.length / 22)), blurT = 1.0, hold = Number(o.hold || 1.8);
  const dur = type + blurT + hold;
  const boxY = h > w ? h - 620 : h - 330;
  return {
    w, h, bg: '#07080c', duration: dur, fps: 30,
    frame(time) {
      const typed = clamp01(time / type);
      const shown = prompt.slice(0, Math.ceil(typed * prompt.length));
      const g = smooth((time - type) / blurT);
      const blur = (1 - g) * 26;
      const caret = time < type && Math.floor(time * 2.5) % 2 === 0 ? '▌' : '';
      const size = fitSize(prompt, { size: 54, weight: 600 }, w - 180);
      const typing = time < type + blurT * 0.6;
      return [
        img(0, iy, w, ih, t.bmp.get(parent?.id ?? node?.id), { filter: blur > 0.5 ? `blur(${blur}px) saturate(.45) brightness(.6)` : undefined }),
        g > 0 ? img(0, iy, w, ih, t.bmp.get(node?.id), { alpha: g }) : null,
        typing
          ? group(0, 0, [
            rect(90, boxY, w - 180, 200, { fill: 'rgba(10,12,18,.82)', stroke: '#3b82f6', lw: 3, r: 20 }),
            text(120, boxY + 30, shown + caret, { size, weight: 600, fill: '#fff', maxW: w - 240, lh: size * 1.2, maxLines: 3 }),
          ], { alpha: 1 - smooth((time - type - blurT * 0.3) / (blurT * 0.3)) })
          : null,
        furnish(f, o, { label: typing ? '' : prompt, cost: node?.data.cost, alpha: typing ? 1 : smooth((time - type - blurT * 0.6) / 0.4) }),
      ];
    },
  };
}

// ────────────────────────────────────────────────────────── 4. Tree Flythrough
function flythrough(t, o) {
  const family = familyOf(t, subject(t, o));
  const ids = new Set(family.map((n) => n.id));
  const f = frameOf(o);
  const { w, h } = f;
  const layout = t.layout.filter((n) => ids.has(n.id));
  const box = layout.reduce((a, n) => ({
    x0: Math.min(a.x0, n.x), y0: Math.min(a.y0, n.y), x1: Math.max(a.x1, n.x + n.w), y1: Math.max(a.y1, n.y + n.h),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const pos = new Map(layout.map((n) => [n.id, n]));
  const lineage = t.lineage.filter((n) => ids.has(n.id));
  const order = [...lineage, ...family.filter((n) => !lineage.includes(n))].slice(0, Number(o.stops || 8));
  const per = Number(o.hold || 1.3);
  const wide = Math.min(w / (box.x1 - box.x0 + 120), h / (box.y1 - box.y0 + 120));
  const near = wide * 3.4;
  const ops = [];
  for (const n of family) {
    const c = pos.get(n.id);
    for (const pid of n.data.parents) {
      const p = pos.get(pid);
      if (p) ops.push({ t: 'path', d: `M${p.x + p.w / 2},${p.y + p.h} C${p.x + p.w / 2},${(p.y + p.h + c.y) / 2} ${c.x + c.w / 2},${(p.y + p.h + c.y) / 2} ${c.x + c.w / 2},${c.y}`, stroke: '#39405280', lw: 3 });
    }
  }
  for (const n of family) {
    const c = pos.get(n.id);
    ops.push(img(c.x, c.y, c.w, c.h - 12, t.bmp.get(n.id), { r: 6 }));
    if (n.data.star) ops.push(rect(c.x - 2, c.y - 2, c.w + 4, c.h - 8, { stroke: '#f5b301', lw: 3, r: 8 }));
  }
  const openT = 1.0;
  const dur = order.length * per + 1.2;
  const opening = auto(o, 'opening', `${family.length} versions of one face`);
  return {
    w, h, bg: '#07080c', duration: dur, fps: 30,
    frame(time) {
      const i = Math.min(order.length - 1, Math.floor(Math.max(0, time - openT) / per));
      const local = clamp01((Math.max(0, time - openT) - i * per) / per);
      const a = pos.get(order[i].id);
      const b = pos.get(order[Math.min(order.length - 1, i + 1)].id);
      const k = smooth((local - 0.55) / 0.45);
      const cx = (a.x + a.w / 2) + ((b.x + b.w / 2) - (a.x + a.w / 2)) * k;
      const cy = (a.y + a.h / 2) + ((b.y + b.h / 2) - (a.y + a.h / 2)) * k;
      const open = smooth(time / openT);
      const z = wide + (near - wide) * open;
      const wx = (box.x0 + box.x1) / 2 + (cx - (box.x0 + box.x1) / 2) * open;
      const wy = (box.y0 + box.y1) / 2 + (cy - (box.y0 + box.y1) / 2) * open;
      const label = time > openT * 0.7 ? promptOf(order[i]) : opening;
      return [
        group(w / 2 - wx * z, h / 2 - wy * z, ops, { scale: z }),
        rect(0, h - 460, w, 460, { fill: linear(0, h - 460, 0, h, [[0, 'rgba(7,8,12,0)'], [1, 'rgba(7,8,12,.95)']]) }),
        furnish(f, o, { label, prog: time / dur, cost: family.reduce((x, n) => x + (n.data.cost || 0), 0) }),
      ];
    },
  };
}

export const MOTION = [
  { id: 'morph', name: 'The Morph', blurb: 'Crossfade down the selected photo’s lineage. Pose stays put between steps, so it reads as a morph.', needs: 'lineage', spec: morph,
    hint: 'Morphing along the highlighted photo’s lineage — click another in the filmstrip to change it.',
    options: [
      { id: 'steps', label: 'Steps', type: 'select', def: 5, choices: [3, 4, 5, 6] },
      { id: 'hold', label: 'Seconds per step', type: 'select', def: 1.6, choices: [1, 1.6, 2.4] },
      { id: 'loop', label: 'Fade back to the start (seamless loop)', type: 'bool', def: false },
      { id: 'labels', label: 'Prompt under each step', type: 'bool', def: true },
      { id: 'first', label: 'Label for the original', type: 'text', def: undefined, fill: (t) => t.lineage[0]?.data.name || 'the original' },
      opt.title, opt.quote, opt.bar, opt.mark, opt.cost, opt.shape('9:16'),
    ] },
  { id: 'loop', name: 'Loop', blurb: 'Before and After bouncing back and forth. Two seconds, loops forever, very hard to scroll past.', needs: 'pair', spec: loop,
    options: [
      { id: 'before', label: 'Before', type: 'pick', def: (t, o) => rootOf(t, nodeOr(t, o.after, newest))?.id },
      { id: 'after', label: 'After', type: 'pick', def: (t) => newest(t)?.id },
      { id: 'speed', label: 'Loop length (s)', type: 'select', def: 1.8, choices: [1.2, 1.8, 2.6] },
      { id: 'labelA', label: 'Badge on the first', type: 'text', def: undefined, fill: () => 'BEFORE' },
      { id: 'labelB', label: 'Badge on the second', type: 'text', def: undefined, fill: () => 'AFTER' },
      { id: 'prompt', label: 'Caption', type: 'text', def: '', fill: (t, o) => promptOf(nodeOr(t, o.after, newest)) },
      opt.title, opt.quote, opt.mark, opt.cost, opt.shape('1:1'),
    ] },
  { id: 'reveal', name: 'The Reveal', blurb: 'The prompt types itself, the parent blurs out, the result resolves. Shows what the app does.', needs: 'edits', spec: reveal,
    options: [
      { id: 'photo', label: 'Photo', type: 'pick', def: (t) => (t.focus?.data.parents.length ? t.focus.id : newest(t)?.id) },
      { id: 'prompt', label: 'Text that gets typed', type: 'text', def: undefined, fill: (t, o) => promptOf(subject(t, o)) },
      { id: 'hold', label: 'Hold on result (s)', type: 'select', def: 1.8, choices: [1.2, 1.8, 2.6] },
      opt.title, opt.quote, opt.mark, opt.cost, opt.shape('9:16'),
    ] },
  { id: 'flythrough', name: 'Tree Flythrough', blurb: 'Camera opens on the whole tree of the selected seed, then dives node to node.', needs: 'tree', spec: flythrough,
    hint: 'Flying through the tree of the highlighted photo’s seed — click another in the filmstrip to change it.',
    options: [
      { id: 'opening', label: 'Opening line', type: 'text', def: undefined, fill: (t, o) => `${familyOf(t, subject(t, o)).length} versions of one face` },
      { id: 'stops', label: 'Nodes visited', type: 'select', def: 8, choices: [4, 6, 8, 12] },
      { id: 'hold', label: 'Seconds per node', type: 'select', def: 1.3, choices: [0.9, 1.3, 2] },
      { id: 'labels', label: 'Prompt while visiting', type: 'bool', def: true },
      opt.title, opt.quote, opt.bar, opt.mark, opt.cost, opt.shape('9:16'),
    ] },
].map((f) => ({ group: 'Motion', kind: 'motion', options: [], ...f }));
