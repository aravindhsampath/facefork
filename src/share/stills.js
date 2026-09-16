// Still share formats. Each is an entry in STILLS at the bottom of this file — to drop one,
// delete its builder and its entry. Every builder returns a scene (see scene.js).
//
// Options are declared, not hand-wired: the dialog renders them from the `options` array.
//   text   — free text; empty means "not shown". `fill(t, o)` suggests a value (the ↙ button).
//   bool / select — as you'd expect. `labels` gives select values a friendlier name.
//   pick   — a node id chosen by clicking the filmstrip; `def(t, o)` resolves the default.

import {
  SANS, MONO, SERIF, HAND, COND, SLAB,
  rect, img, text, line, poly, path, noise, group, linear, radial,
  wrap, measure, fitSize, mark, rngOf,
} from './scene.js';
import { promptOf, money, nodeOr, newest, rootOf, familyOf, lineageOf } from './tree.js';

const SHAPES = { '4:5': { w: 1080, h: 1350 }, '1:1': { w: 1080, h: 1080 }, '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 } };
const SHAPE_LABELS = { '4:5': '4:5 · Instagram post', '1:1': '1:1 · square', '16:9': '16:9 · X / Threads', '9:16': '9:16 · Story / Reels / TikTok' };
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const s = (v) => String(v ?? '').trim();
// A text option left untouched (undefined) shows its suggestion; cleared ('') hides it.
const auto = (o, key, suggestion) => (o[key] === undefined ? suggestion : s(o[key]));

// ---- option declarations shared across formats ----
const subject = (t, o) => nodeOr(t, o.photo, t.focus);
const opt = {
  photo: { id: 'photo', label: 'Photo', type: 'pick', def: (t) => t.focus?.id },
  title: { id: 'title', label: 'Title', type: 'text', def: '' },
  quote: { id: 'quote', label: 'Quote', type: 'text', def: '' },
  prompt: (fill) => ({ id: 'prompt', label: 'Prompt', type: 'text', def: '', fill }),
  mark: { id: 'mark', label: 'facefork.com watermark', type: 'bool', def: true },
  cost: { id: 'cost', label: 'Show cost', type: 'bool', def: false },
  shape: (def = '4:5', choices = Object.keys(SHAPES)) => ({ id: 'shape', label: 'Shape', type: 'select', def, choices, labels: SHAPE_LABELS }),
};

// Shared text furniture: title on top; quote, then prompt, then the wordmark/cost footer at the
// bottom. Returns the ops and how much vertical room they took, so a layout can fill the middle.
function furnish(w, h, o, { ink = '#e6e8ee', dim = '#5d6577', pad = 44, cost = 0 } = {}) {
  const ops = [];
  let top = pad, bottom = pad;
  const title = s(o.title), quote = s(o.quote), prompt = s(o.prompt);
  if (title) {
    const size = fitSize(title, { size: 54, weight: 800 }, (w - pad * 2) * 1.6);
    const st = { size, weight: 800, fill: ink, align: 'center', maxW: w - pad * 2, maxLines: 2, lh: size * 1.15, tracking: 1 };
    ops.push(text(w / 2, top, title, st));
    top += wrap(title, st).length * st.lh + 26;
  }
  if (o.mark !== false || o.cost) {
    ops.push(mark(pad, h - pad + 6, { size: 24, fill: dim }));
    if (o.cost) ops.push(text(w - pad, h - pad + 6, money(cost), { size: 24, weight: 600, fill: dim, align: 'right', baseline: 'alphabetic' }));
    bottom += 36;
  }
  const blocks = [];
  if (quote) blocks.push({ s: quote, st: { size: 44, weight: 600, family: SERIF, italic: true, fill: ink, align: 'center', maxW: w - pad * 2, maxLines: 3, lh: 52 } });
  if (prompt) blocks.push({ s: `“${prompt}”`, st: { size: 30, weight: 500, fill: dim, align: 'center', maxW: w - pad * 2, maxLines: 3, lh: 38 } });
  const heights = blocks.map((b) => wrap(b.s, b.st).length * b.st.lh);
  const total = heights.reduce((a, b) => a + b + 14, 0);
  let y = h - bottom - total + 6;
  blocks.forEach((b, i) => { ops.push(text(w / 2, y, b.s, b.st)); y += heights[i] + 14; });
  if (blocks.length) bottom += total + 12;
  return { ops, top, bottom };
}

// ────────────────────────────────────────────────────────── 1. Before / After
function diptych(t, o) {
  const after = nodeOr(t, o.after, newest);
  const before = nodeOr(t, o.before, () => rootOf(t, after));
  const { w, h } = SHAPES[o.shape] || SHAPES['4:5'];
  const pad = 44, gap = 14;
  const fx = furnish(w, h, o, { pad, cost: after?.data.cost });
  const bw = w - pad * 2, bh = h - fx.top - fx.bottom;
  const stacked = bh > bw * 1.25; // 9:16: images on top of each other
  const [cw, ch] = stacked ? [bw, (bh - gap) / 2] : [(bw - gap) / 2, bh];
  const r = 14;
  return {
    w, h, bg: '#0d0f14',
    ops: [
      img(pad, fx.top, cw, ch, t.bmp.get(before?.id), { r }),
      img(stacked ? pad : pad + cw + gap, stacked ? fx.top + ch + gap : fx.top, cw, ch, t.bmp.get(after?.id), { r }),
      ...fx.ops,
    ],
  };
}

// ────────────────────────────────────────────────────────── 2. Evolution Strip
function strip(t, o) {
  const chain = t.lineage.slice(-(o.steps || 5));
  const n = chain.length;
  const { w, h } = SHAPES['16:9'];
  const pad = 64, gap = 30;
  const fx = furnish(w, h, o, { pad, cost: chain.at(-1)?.data.cost });
  const cw = (w - pad * 2 - gap * (n - 1)) / n;
  const labelH = o.prompts === false ? 0 : 96;
  const ch = Math.min(Math.round(cw * 1.25), h - fx.top - fx.bottom - labelH);
  const top = fx.top + (h - fx.top - fx.bottom - ch - labelH) / 2;
  const ops = [...fx.ops];
  chain.forEach((node, i) => {
    const x = pad + i * (cw + gap);
    ops.push(img(x, top, cw, ch, t.bmp.get(node.id), { r: 12 }));
    if (node.data.star) ops.push(rect(x - 4, top - 4, cw + 8, ch + 8, { stroke: '#f5b301', lw: 4, r: 16 }));
    if (o.prompts !== false) ops.push(text(x, top + ch + 20, i === 0 ? 'the original' : promptOf(node), {
      size: 24, weight: i === 0 ? 400 : 600, italic: i === 0, fill: i === 0 ? '#6b7488' : '#c9cfdd', maxW: cw, lh: 30, maxLines: 2,
    }));
    if (i) {
      const ax = x - gap / 2;
      ops.push(
        line(ax - 11, top + ch / 2, ax + 9, top + ch / 2, { stroke: '#3b82f6', lw: 4, cap: 'round' }),
        poly([[ax + 11, top + ch / 2], [ax + 2, top + ch / 2 - 8], [ax + 2, top + ch / 2 + 8]], { fill: '#3b82f6' }),
      );
    }
  });
  return { w, h, bg: '#0d0f14', ops };
}

// ────────────────────────────────────────────────────────── 3. The Tree
function poster(t, o) {
  const family = familyOf(t, subject(t, o));
  const ids = new Set(family.map((n) => n.id));
  const nodesL = t.layout.filter((n) => ids.has(n.id));
  const box = nodesL.reduce((a, n) => ({
    x0: Math.min(a.x0, n.x), y0: Math.min(a.y0, n.y), x1: Math.max(a.x1, n.x + n.w), y1: Math.max(a.y1, n.y + n.h),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const tw = box.x1 - box.x0, th = box.y1 - box.y0;
  const W = 1500, pad = 70;
  const dark = o.paper !== 'light';
  const ink = dark ? '#e6e8ee' : '#171a21';
  const dim = dark ? '#6b7488' : '#7b8496';
  const sc = Math.min((W - pad * 2) / tw, 2.4);
  const probe = furnish(W, 1000, o, { ink, dim, pad, cost: family.reduce((a, n) => a + (n.data.cost || 0), 0) });
  const H = Math.min(2800, Math.round(th * sc) + probe.top + probe.bottom + 60);
  const fx = furnish(W, H, o, { ink, dim, pad, cost: family.reduce((a, n) => a + (n.data.cost || 0), 0) });
  const at = (n) => ({ x: pad + (n.x - box.x0) * sc, y: fx.top + 30 + (n.y - box.y0) * sc, w: n.w * sc, h: n.h * sc });
  const pos = new Map(nodesL.map((n) => [n.id, at(n)]));
  const ops = [];
  for (const n of family) {
    const c = pos.get(n.id);
    for (const pid of n.data.parents) {
      const p = pos.get(pid);
      if (!p) continue;
      const [x1, y1, x2, y2] = [p.x + p.w / 2, p.y + p.h, c.x + c.w / 2, c.y];
      ops.push(path(`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`, { stroke: dim, lw: 2.5 }));
    }
  }
  for (const n of family) {
    const c = pos.get(n.id);
    const ih = c.h - 12 * sc;
    if (n.data.parents.length && o.prompts !== false) {
      const lines = wrap(promptOf(n), { size: 17, maxW: c.w + 40, maxLines: 2 });
      const lw = Math.max(...lines.map((l) => measure(l, { size: 17 }))) + 20;
      ops.push(rect(c.x + c.w / 2 - lw / 2, c.y - 16 - lines.length * 21, lw, lines.length * 21 + 8, { fill: dark ? '#181b22' : '#fff', stroke: dark ? '#2a2f3a' : '#d7dbe3', lw: 1, r: 6 }));
      ops.push(text(c.x + c.w / 2, c.y - 12 - lines.length * 21, lines.join('\n'), { size: 17, fill: ink, align: 'center', lh: 21 }));
    }
    ops.push(img(c.x, c.y, c.w, ih, t.bmp.get(n.id), { r: 8 }));
    if (n.data.star) ops.push(rect(c.x - 3, c.y - 3, c.w + 6, ih + 6, { stroke: '#f5b301', lw: 4, r: 11 }));
    if (!n.data.parents.length && o.seedName !== false) ops.push(text(c.x + c.w / 2, c.y + ih + 6, (n.data.name || 'seed').toUpperCase(), { size: 16, weight: 700, fill: dim, align: 'center', tracking: 1.2 }));
  }
  return { w: W, h: H, bg: dark ? '#0d0f14' : '#f7f7f4', ops: [...ops, ...fx.ops] };
}

// ────────────────────────────────────────────────────────── 4. Polaroid
function polaroid(t, o) {
  const node = subject(t, o);
  const parent = t.byId.get(node?.data.parents[0]);
  const { w, h } = SHAPES['4:5'];
  const cardW = 740, inset = 42, imgH = 700;
  const cardH = inset + imgH + 210;
  const x = (w - cardW) / 2, y = (h - cardH) / 2 - 10;
  const tilt = o.tilt === false ? 0 : -3 + t.rng() * 6;
  const behind = o.stack !== false && parent;
  const face = (n, dx, dy, rot, alpha) => group(0, 0, [
    rect(x + dx, y + dy, cardW, cardH, { fill: '#fbfbf7', r: 4, shadow: { color: 'rgba(0,0,0,.45)', blur: 40, y: 14 } }),
    img(x + dx + inset, y + dy + inset, cardW - inset * 2, imgH, t.bmp.get(n.id)),
  ], { rotate: rot, ox: w / 2, oy: h / 2, alpha });
  const cap = auto(o, 'caption', promptOf(node));
  const sub = s(o.subline);
  return {
    w, h, bg: linear(0, 0, 0, h, [[0, '#2b2f3a'], [1, '#14161c']]),
    ops: [
      s(o.title) ? text(w / 2, 44, s(o.title), { size: 40, weight: 800, fill: '#e6e8ee', align: 'center', maxW: w - 120, maxLines: 1 }) : null,
      behind ? face(parent, -26, 10, tilt - 7, 0.85) : null,
      face(node, 0, 0, tilt, 1),
      group(0, 0, [
        cap ? text(w / 2, y + inset + imgH + 60, cap, { size: fitSize(cap, { size: 46, family: HAND }, cardW - 120), family: HAND, fill: '#2b2b33', align: 'center', maxW: cardW - 110, lh: 52, maxLines: 2 }) : null,
        sub ? text(w / 2, y + cardH - 56, sub, { size: 24, family: HAND, fill: '#9a9a96', align: 'center', maxW: cardW - 110, maxLines: 1 }) : null,
      ], { rotate: tilt, ox: w / 2, oy: h / 2 }),
      o.mark !== false ? mark(w / 2, h - 44, { size: 22, align: 'center', fill: 'rgba(255,255,255,.35)' }) : null,
      o.cost ? text(w - 44, h - 38, money(node?.data.cost), { size: 22, fill: 'rgba(255,255,255,.35)', align: 'right', baseline: 'alphabetic' }) : null,
    ],
  };
}

// ────────────────────────────────────────────────────────── 5. Museum Placard
function placard(t, o) {
  const node = subject(t, o);
  const { w, h } = SHAPES['4:5'];
  const fw = 700, fh = 880, fx = (w - fw) / 2, fy = 120;
  const matt = 54;
  const gold = o.frame !== 'black';
  const artist = s(o.artist) || rootOf(t, node)?.data.name || 'Unknown';
  const title = s(o.title) || promptOf(node);
  const year = s(o.year) || String(t.date.getFullYear());
  const medium = s(o.medium);
  const coll = s(o.collection);
  const lx = 150, ly = fy + fh + 96;
  return {
    w, h, bg: '#d9d5cc',
    ops: [
      rect(0, 0, w, h, { fill: radial(w / 2, fy + fh / 2, w * 0.9, [[0, '#e6e2d8'], [1, '#c6c2b8']]) }),
      rect(fx - 22, fy - 22, fw + 44, fh + 44, {
        fill: gold ? linear(fx, fy, fx + fw, fy + fh, [[0, '#b08d3f'], [0.5, '#e9d9a3'], [1, '#8c6d2a']]) : '#16171a',
        r: 4, shadow: { color: 'rgba(0,0,0,.35)', blur: 34, y: 16 },
      }),
      rect(fx, fy, fw, fh, { fill: '#efece4' }),
      img(fx + matt, fy + matt, fw - matt * 2, fh - matt * 2, t.bmp.get(node?.id)),
      rect(fx + matt, fy + matt, fw - matt * 2, fh - matt * 2, { stroke: 'rgba(0,0,0,.25)', lw: 2 }),
      line(lx, ly - 34, lx + 340, ly - 34, { stroke: '#6a655c', lw: 2 }),
      text(lx, ly, artist, { size: 32, weight: 700, family: SERIF, fill: '#23211d', maxW: w - lx * 2, maxLines: 1 }),
      text(lx, ly + 46, title, { size: 30, italic: true, family: SERIF, fill: '#3a3630', maxW: w - lx * 2, lh: 40, maxLines: 2 }),
      text(lx, ly + 132, year, { size: 26, family: SERIF, fill: '#5a554c' }),
      medium ? text(lx, ly + 170, medium, { size: 26, family: SERIF, fill: '#5a554c', maxW: w - lx * 2, maxLines: 1 }) : null,
      coll ? text(lx, ly + 208, coll, { size: 22, family: SERIF, fill: '#7a746a', maxW: w - lx * 2, maxLines: 1 }) : null,
      o.cost ? text(w - lx, ly + 132, money(node?.data.cost), { size: 22, family: SERIF, fill: '#7a746a', align: 'right' }) : null,
      o.mark !== false ? mark(w - 60, h - 44, { size: 20, align: 'right', fill: 'rgba(0,0,0,.3)' }) : null,
    ],
  };
}

// ────────────────────────────────────────────────────────── 6. Magazine Cover
const COVER_LINES = [
  'THE “WHAT IF” ISSUE', '12 WAYS TO BE SOMEONE ELSE BY FRIDAY', 'IS THIS EVEN ME? A DEEP DIVE',
  'EXCLUSIVE: MY CHIN HAS OPINIONS', 'QUIZ: WHICH VERSION OF YOU ARE YOU?', 'THE MUSTACHE THAT DIVIDED A FAMILY',
  'A FACE, A PROMPT, A PROBLEM', 'INSIDE: THE HAT NOBODY ASKED FOR', 'EXPERTS AGREE: THAT’S A LOOK',
  'THE RE-ROLL DIARIES', 'FROM SEED TO LEAF IN ONE AFTERNOON', 'SPECIAL: THE VERSION MY MOTHER PREFERS',
];
export const coverLinesFor = (t, node) => {
  const own = t.edits.filter((n) => n.id !== node?.id).map((n) => promptOf(n).toUpperCase()).slice(0, 2);
  const rnd = rngOf(t.seedKey + (node?.id || ''));
  const pool = [...COVER_LINES].sort(() => rnd() - 0.5);
  return [...own, ...pool].slice(0, 4).join('\n');
};
function magazine(t, o) {
  const node = subject(t, o);
  const { w, h } = SHAPES['4:5'];
  const mast = s(o.masthead) || 'LOOKS';
  const head = (s(o.headline) || promptOf(node)).toUpperCase();
  const lines = auto(o, 'lines', coverLinesFor(t, node)).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5);
  const dateLine = s(o.dateline) || `${MONTHS[t.date.getMonth()]} ${t.date.getFullYear()}`;
  const ops = [
    img(0, 0, w, h, t.bmp.get(node?.id)),
    rect(0, 0, w, 330, { fill: linear(0, 0, 0, 330, [[0, 'rgba(0,0,0,.65)'], [1, 'rgba(0,0,0,0)']]) }),
    rect(0, h - 340, w, 340, { fill: linear(0, h - 340, 0, h, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.75)']]) }),
    text(w / 2, 40, mast, { size: fitSize(mast, { size: 200, weight: 800, family: COND }, w - 70), weight: 800, family: COND, fill: '#fff', align: 'center', tracking: -2 }),
    text(w / 2, 236, `${dateLine}${o.cost ? ` · ${money(node?.data.cost)}` : ''}`, { size: 24, weight: 600, fill: '#fff', align: 'center', tracking: 5 }),
    head ? text(56, 380, head, { size: fitSize(head, { size: 74, weight: 800, family: COND }, w - 460), weight: 800, family: COND, fill: s(o.accent) || '#ffe14d', maxW: w - 470, lh: 74, maxLines: 3 }) : null,
  ];
  lines.forEach((ln, i) => {
    const y = 700 + i * 112;
    ops.push(text(w - 56, y, ln.toUpperCase(), { size: 34, weight: 800, family: COND, fill: '#fff', align: 'right', maxW: 520, lh: 38, maxLines: 2 }));
    ops.push(line(w - 56 - 90, y - 16, w - 56, y - 16, { stroke: s(o.accent) || '#ffe14d', lw: 4 }));
  });
  if (s(o.quote)) ops.push(text(56, h - 130, s(o.quote), { size: 30, italic: true, family: SERIF, fill: '#fff', maxW: w - 112, lh: 38, maxLines: 2 }));
  if (o.mark !== false) ops.push(mark(w - 56, h - 62, { size: 22, align: 'right' }));
  return { w, h, ops };
}

// ────────────────────────────────────────────────────────── 7. Wanted Poster
function wanted(t, o) {
  const node = subject(t, o);
  const { w, h } = SHAPES['4:5'];
  const rnd = rngOf(t.seedKey);
  const stains = Array.from({ length: 7 }, () => rect(rnd() * w, rnd() * h, 90 + rnd() * 200, 90 + rnd() * 200, { fill: `rgba(120,80,30,${0.03 + rnd() * 0.04})`, r: 200 }));
  const iw = 600, ih = 600, ix = (w - iw) / 2, iy = 355;
  const head = s(o.headline) || 'WANTED';
  const sub = auto(o, 'subtitle', 'FOR CRIMES AGAINST LIKENESS');
  const quote = auto(o, 'quote', promptOf(node));
  const reward = s(o.reward) || `$${Math.max(50, Math.round(((node?.data.cost || 0.05) * 20000) / 50) * 50).toLocaleString()}`;
  const seen = s(o.lastseen) || `LAST SEEN ${t.date.toISOString().slice(0, 10)}`;
  return {
    w, h, bg: '#cbb289',
    ops: [
      rect(0, 0, w, h, { fill: linear(0, 0, w, h, [[0, '#e3d3b0'], [0.5, '#d8c49c'], [1, '#cab389']]) }),
      ...stains,
      noise(0, 0, w, h, { alpha: 0.12, seed: t.seedKey, grain: 1.5 }),
      rect(34, 34, w - 68, h - 68, { stroke: '#3a2a15', lw: 5 }),
      rect(48, 48, w - 96, h - 96, { stroke: '#3a2a15', lw: 2 }),
      text(w / 2, 96, head, { size: fitSize(head, { size: 150, weight: 800, family: SLAB, tracking: 8 }, w - 140), weight: 800, family: SLAB, fill: '#2d1f0e', align: 'center', tracking: 8 }),
      sub ? text(w / 2, 268, sub, { size: fitSize(sub, { size: 32, weight: 700, family: SLAB }, w - 160), weight: 700, family: SLAB, fill: '#4a3418', align: 'center', tracking: 2, maxW: w - 140, maxLines: 1 }) : null,
      line(140, 330, w - 140, 330, { stroke: '#4a3418', lw: 3 }),
      rect(ix - 12, iy - 12, iw + 24, ih + 24, { fill: '#3a2a15' }),
      img(ix, iy, iw, ih, t.bmp.get(node?.id), { filter: o.sepia === false ? undefined : 'sepia(.75) contrast(1.08) brightness(.97)' }),
      quote ? text(w / 2, iy + ih + 44, `“${quote}”`, { size: fitSize(`“${quote}”`, { size: 46, weight: 700, family: SLAB }, w - 180), weight: 700, family: SLAB, fill: '#2d1f0e', align: 'center', maxW: w - 160, lh: 52, maxLines: 2 }) : null,
      reward ? text(w / 2, h - 210, 'REWARD', { size: 34, weight: 700, family: SLAB, fill: '#4a3418', align: 'center', tracking: 6 }) : null,
      reward ? text(w / 2, h - 168, reward, { size: fitSize(reward, { size: 84, weight: 800, family: SLAB }, w - 200), weight: 800, family: SLAB, fill: '#2d1f0e', align: 'center' }) : null,
      seen ? text(w / 2, h - 70, seen, { size: 22, family: SLAB, fill: '#5c4526', align: 'center', maxW: w - 160, maxLines: 1 }) : null,
      o.mark !== false ? mark(w - 60, h - 46, { size: 20, align: 'right', fill: 'rgba(60,40,20,.5)' }) : null,
      o.cost ? text(60, h - 40, money(node?.data.cost), { size: 20, family: SLAB, fill: 'rgba(60,40,20,.5)', baseline: 'alphabetic' }) : null,
    ],
  };
}

// ────────────────────────────────────────────────────────── registry
export const STILLS = [
  { id: 'diptych', name: 'Before / After', blurb: 'Two photos side by side. Before defaults to the seed, After to your newest image — click a slot, then a photo in the filmstrip to change either.', needs: 'pair', build: diptych,
    options: [
      { id: 'before', label: 'Before', type: 'pick', def: (t, o) => rootOf(t, nodeOr(t, o.after, newest))?.id },
      { id: 'after', label: 'After', type: 'pick', def: (t) => newest(t)?.id },
      opt.title, opt.quote, opt.prompt((t, o) => promptOf(nodeOr(t, o.after, newest))),
      opt.mark, opt.cost, opt.shape('4:5'),
    ] },
  { id: 'strip', name: 'Evolution Strip', blurb: 'The lineage of the selected photo, left to right with arrows. Click any photo in the filmstrip to show its evolution.', needs: 'lineage', build: strip,
    hint: 'Showing the evolution of the highlighted photo — click another in the filmstrip to change it.',
    options: [
      { id: 'steps', label: 'Steps shown', type: 'select', def: 5, choices: [3, 4, 5, 6] },
      { id: 'prompts', label: 'Prompt under each step', type: 'bool', def: true },
      opt.title, opt.quote, opt.prompt((t) => promptOf(t.focus)), opt.mark, opt.cost,
    ] },
  { id: 'poster', name: 'The Tree', blurb: 'One seed and everything that grew from it, as a poster. Click any photo in the filmstrip to pick which seed’s tree.', needs: 'tree', build: poster,
    hint: 'Showing the tree of the highlighted photo’s seed — click another in the filmstrip to change it.',
    options: [
      { id: 'paper', label: 'Paper', type: 'select', def: 'dark', choices: ['dark', 'light'] },
      { id: 'prompts', label: 'Prompts on the edges', type: 'bool', def: true },
      { id: 'seedName', label: 'Name under the seed', type: 'bool', def: true },
      opt.title, opt.quote, opt.prompt((t) => promptOf(t.focus)), opt.mark, opt.cost,
    ] },
  { id: 'polaroid', name: 'Polaroid', blurb: 'One shot in a white frame, a handwritten line on the tongue, the parent peeking out behind.', needs: 'one', build: polaroid,
    options: [
      opt.photo,
      { id: 'caption', label: 'Handwritten line', type: 'text', def: undefined, fill: (t, o) => promptOf(subject(t, o)) },
      { id: 'subline', label: 'Small line', type: 'text', def: '', fill: (t) => t.date.toISOString().slice(0, 10) },
      { id: 'stack', label: 'Parent behind', type: 'bool', def: true },
      { id: 'tilt', label: 'Slight tilt', type: 'bool', def: true },
      opt.title, opt.mark, opt.cost,
    ] },
  { id: 'placard', name: 'Museum Placard', blurb: 'Matted, framed and hung on a gallery wall with a proper wall label.', needs: 'one', build: placard,
    options: [
      opt.photo,
      { id: 'artist', label: 'Artist', type: 'text', def: '', fill: (t, o) => rootOf(t, subject(t, o))?.data.name || 'Unknown' },
      { id: 'title', label: 'Work title', type: 'text', def: '', fill: (t, o) => promptOf(subject(t, o)) },
      { id: 'year', label: 'Year', type: 'text', def: '', fill: (t) => String(t.date.getFullYear()) },
      { id: 'medium', label: 'Medium', type: 'text', def: 'Latent diffusion on photograph' },
      { id: 'collection', label: 'Collection line', type: 'text', def: 'Collection of the sitter' },
      { id: 'frame', label: 'Frame', type: 'select', def: 'gold', choices: ['gold', 'black'] },
      opt.mark, opt.cost,
    ] },
  { id: 'magazine', name: 'Magazine Cover', blurb: 'Masthead, a headline, cover lines down the side. Every word is yours to change.', needs: 'one', build: magazine,
    options: [
      opt.photo,
      { id: 'masthead', label: 'Masthead', type: 'text', def: 'LOOKS' },
      { id: 'headline', label: 'Headline', type: 'text', def: '', fill: (t, o) => promptOf(subject(t, o)) },
      { id: 'lines', label: 'Cover lines (one per line)', type: 'textarea', def: undefined, fill: (t, o) => coverLinesFor(t, subject(t, o)) },
      { id: 'dateline', label: 'Date line', type: 'text', def: '', fill: (t) => `${MONTHS[t.date.getMonth()]} ${t.date.getFullYear()}` },
      { id: 'quote', label: 'Bottom quote', type: 'text', def: '' },
      { id: 'accent', label: 'Accent colour', type: 'select', def: '#ffe14d', choices: ['#ffe14d', '#ff4d6d', '#5ad1ff', '#ffffff'], labels: { '#ffe14d': 'yellow', '#ff4d6d': 'pink', '#5ad1ff': 'blue', '#ffffff': 'white' } },
      opt.mark, opt.cost,
    ] },
  { id: 'wanted', name: 'Wanted Poster', blurb: 'Aged paper, sepia mugshot, a reward. Rewrite the charge sheet as you like.', needs: 'one', build: wanted,
    options: [
      opt.photo,
      { id: 'headline', label: 'Headline', type: 'text', def: 'WANTED' },
      { id: 'subtitle', label: 'Charge', type: 'text', def: undefined, fill: () => 'FOR CRIMES AGAINST LIKENESS' },
      { id: 'quote', label: 'Quote', type: 'text', def: undefined, fill: (t, o) => promptOf(subject(t, o)) },
      { id: 'reward', label: 'Reward', type: 'text', def: '', fill: (t, o) => `$${Math.max(50, Math.round(((subject(t, o)?.data.cost || 0.05) * 20000) / 50) * 50).toLocaleString()}` },
      { id: 'lastseen', label: 'Last seen line', type: 'text', def: '', fill: (t) => `LAST SEEN ${t.date.toISOString().slice(0, 10)}` },
      { id: 'sepia', label: 'Sepia', type: 'bool', def: true },
      opt.mark, opt.cost,
    ] },
].map((f) => ({ group: 'Stills', kind: 'still', options: [], ...f }));
