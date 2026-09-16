// Turns the live canvas into the plain, framework-free bundle every share format consumes.
// Formats never touch React or xyflow — they get bitmaps, prompts, costs and positions.

import { rngOf } from './scene.js';

// Decoded images, bounded three ways so a big tree cannot exhaust canvas memory (Safari then
// silently draws nothing): each is resampled to ≤ MAX_EDGE, the whole build stays under a pixel
// budget (a 100-image tree decodes at ~800 px rather than 1600), and a small LRU is kept across
// builds. A plain canvas is the most portable CanvasImageSource; the ImageBitmap is closed at once.
const MAX_EDGE = 1600;
const BUDGET_PX = 64e6; // ≈ 256 MiB of RGBA for one built tree
const LRU_SIZE = 24;
const decoded = new Map(); // blob -> HTMLCanvasElement, insertion order = age

async function bitmapOf(blob, maxEdge = MAX_EDGE) {
  const hit = decoded.get(blob);
  if (hit) { decoded.delete(blob); decoded.set(blob, hit); return hit; }
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  decoded.set(blob, c);
  // Evicted entries are only dropped from the cache — a tree built earlier may still be drawing them.
  if (decoded.size > LRU_SIZE) decoded.delete(decoded.keys().next().value);
  return c;
}

export const depthOf = (byId, id) => { let d = 0, n = byId.get(id); while (n?.data.parents[0]) { d++; n = byId.get(n.data.parents[0]); } return d; };

// [root … node] following first parents.
export function lineageOf(byId, id) {
  const out = [];
  let n = byId.get(id);
  while (n) { out.unshift(n); n = byId.get(n.data.parents[0]); }
  return out;
}

// The deepest lineage in the tree — the best "story" when the user has not picked a node.
function longestLineage(nodes, byId) {
  let best = [];
  for (const n of nodes) { const l = lineageOf(byId, n.id); if (l.length > best.length) best = l; }
  return best;
}

export const shortId = (id) => String(id).replace(/-/g, '').slice(0, 7);
export const promptOf = (n) => n.data.prompt || n.data.name || 'seed';
export const money = (n) => `$${(n || 0).toFixed(3)}`;

// The node an option points at, or a sensible default when unset / gone.
export const nodeOr = (t, id, fallback) => t.byId.get(id) || (typeof fallback === 'function' ? fallback(t) : fallback);
// Default "after": the newest generated image. Default "before": the seed it grew from.
export const newest = (t) => [...t.nodes].reverse().find((n) => n.data.parents.length) || t.nodes[0];
export const rootOf = (t, n) => (n ? lineageOf(t.byId, n.id)[0] : t.seeds[0]);
// The subtree that hangs off one seed (the seed of `n`), in canvas order.
export const familyOf = (t, n) => {
  const root = rootOf(t, n);
  const keep = new Set(root ? [root.id] : []);
  let grew = true;
  while (grew) { grew = false; for (const x of t.nodes) if (!keep.has(x.id) && x.data.parents.some((p) => keep.has(p))) { keep.add(x.id); grew = true; } }
  return t.nodes.filter((x) => keep.has(x.id));
};

// Build the bundle. `nodes` are xyflow photo nodes; `focusId` is the selected node, if any.
export async function buildTree(nodes, { focusId, model = '', settings = {} } = {}) {
  const candidates = nodes.filter((n) => n.type === 'photo' && n.data.status === 'ready' && n.data.blob);
  const bmp = new Map();
  const maxEdge = Math.min(MAX_EDGE, Math.floor(Math.sqrt(BUDGET_PX / Math.max(1, candidates.length))));
  // One undecodable image drops that node, not the whole dialog. Four at a time keeps peak memory flat.
  const queue = [...candidates];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let n = queue.shift(); n; n = queue.shift()) {
      try { bmp.set(n.id, await bitmapOf(n.data.hqBlob || n.data.blob, maxEdge)); } catch (e) { console.warn('share: could not decode', n.id, e); }
    }
  }));
  const ready = candidates.filter((n) => bmp.has(n.id));
  const byId = new Map(ready.map((n) => [n.id, n]));

  const focus = byId.get(focusId)
    || ready.find((n) => n.data.star && n.data.parents.length)
    || [...ready].reverse().find((n) => n.data.parents.length)
    || ready[0];

  const lineage = focus ? lineageOf(byId, focus.id) : [];
  const best = longestLineage(ready, byId);
  const parent = focus && byId.get(focus.data.parents[0]);
  const siblings = focus ? ready.filter((n) => n.data.parents[0] && n.data.parents[0] === focus.data.parents[0]) : [];
  const seeds = ready.filter((n) => !n.data.parents.length);
  const edits = ready.filter((n) => n.data.parents.length);

  const key = ready.map((n) => n.id).join('|');
  return {
    nodes: ready, byId, bmp, focus, parent, lineage: lineage.length > 1 ? lineage : best, siblings, seeds, edits,
    favourites: ready.filter((n) => n.data.star),
    totalCost: ready.reduce((s, n) => s + (n.data.cost || 0), 0),
    model, settings,
    date: new Date(),
    rng: rngOf(key),
    seedKey: key,
    depth: (id) => depthOf(byId, id),
    // Canvas positions already computed by dagre — the poster and flythrough reuse them.
    layout: ready.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.width, h: n.height })),
  };
}

// What each format minimally needs, so the picker can explain why one is unavailable.
export const REQUIREMENTS = {
  one: (t) => (t.nodes.length ? '' : 'Needs at least one image'),
  pair: (t) => (t.nodes.length > 1 ? '' : 'Needs at least two images'),
  lineage: (t) => (t.lineage.length > 1 ? '' : 'Pick a generated image in the filmstrip — it needs a parent to evolve from'),
  siblings: (t) => (t.siblings.length > 1 ? '' : 'Needs two or more images sharing a parent'),
  many: (t) => (t.nodes.length > 2 ? '' : 'Needs at least three images'),
  tree: (t) => (t.nodes.length > 1 ? '' : 'Needs at least two images'),
  edits: (t) => (t.edits.length ? '' : 'Needs at least one generated image'),
};

// Suggested post text. Copyable next to the image, since no platform lets us attach it.
export function caption(t, node = t.focus) {
  const p = node && node.data.prompt;
  const n = t.edits.length;
  return [
    p ? `"${p}"` : 'Ran my face through a tree of what-ifs.',
    n > 1 ? `${n} versions of me, one afternoon.` : '',
    'Made with facefork.com',
  ].filter(Boolean).join('\n');
}
