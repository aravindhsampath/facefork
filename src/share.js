// .facefork files (formerly .howdoilook): a zip of graph.json + img/<id>.jpg (+ img/<id>-hq.jpg). Built with fflate.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { extOf } from './image.js';

const u8 = async (blob) => new Uint8Array(await blob.arrayBuffer());

export async function exportTree(records) {
  const files = {};
  const nodes = [];
  for (const { blob, hqBlob, inline, url, hqUrl, ...r } of records) {
    const img = blob && `img/${r.id}.${extOf(blob)}`, hq = hqBlob && `img/${r.id}-hq.${extOf(hqBlob)}`;
    if (blob) files[img] = [await u8(blob), { level: 0 }];
    if (hqBlob) files[hq] = [await u8(hqBlob), { level: 0 }];
    nodes.push({ ...r, image: img || undefined, hq: hq || undefined });
  }
  files['graph.json'] = strToU8(JSON.stringify({ format: 'facefork', version: 1, exported: new Date().toISOString(), nodes }, null, 1));
  return new Blob([zipSync(files)], { type: 'application/zip' });
}

// Import limits. A .facefork is a file someone may have been handed, so nothing in it is trusted
// until checked: the archive is bounded before it is inflated, the graph must be a DAG of known
// shapes, and only listed fields survive. Failure leaves the canvas untouched.
const MAX_NODES = 400;
const MAX_ENTRY = 64 << 20; // one image
const MAX_TOTAL = 512 << 20; // inflated archive
const MAX_EDGE = 16384;
const STATUSES = new Set(['ready', 'error', 'pending']);
const fail = (why) => { throw new Error(`Not a usable .facefork file: ${why}`); };

// Image type from the bytes, not the file name.
const mimeOf = (u) => (u[0] === 0xff && u[1] === 0xd8 ? 'image/jpeg'
  : u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47 ? 'image/png'
    : u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50 ? 'image/webp'
      : null);

// Returns records with fresh ids (so a tree can be imported into a canvas that already has it).
export async function importTree(file) {
  let total = 0;
  const zip = unzipSync(await u8(file), {
    filter: (f) => { if (f.originalSize > MAX_ENTRY) fail(`${f.name} is over ${MAX_ENTRY >> 20} MB`); if ((total += f.originalSize) > MAX_TOTAL) fail('archive too large'); return true; },
  });
  if (!zip['graph.json']) fail('no graph.json inside');
  let graph;
  try { graph = JSON.parse(strFromU8(zip['graph.json'])); } catch { fail('graph.json is not valid JSON'); }
  if (!['facefork', 'howdoilook'].includes(graph?.format)) fail('not a facefork export');
  if (graph.version != null && !(Number.isInteger(graph.version) && graph.version <= 1)) fail(`version ${graph.version} is newer than this app`);
  if (!Array.isArray(graph.nodes) || graph.nodes.length > MAX_NODES) fail(`expected up to ${MAX_NODES} images`);

  const seen = new Set();
  const ids = new Map();
  for (const n of graph.nodes) {
    if (typeof n?.id !== 'string' || !n.id) fail('an image has no id');
    if (seen.has(n.id)) fail(`duplicate id ${n.id}`);
    seen.add(n.id); ids.set(n.id, crypto.randomUUID());
  }
  const okInt = (v) => Number.isInteger(v) && v > 0 && v <= MAX_EDGE;
  const blobOf = (path) => {
    if (path == null) return undefined;
    const bytes = typeof path === 'string' && path.startsWith('img/') && zip[path];
    const mime = bytes && mimeOf(bytes);
    if (!mime) fail(`${path} is missing or not a JPEG, PNG or WebP`);
    return new Blob([bytes], { type: mime });
  };
  const recs = graph.nodes.map((n) => {
    if (!okInt(n.w) || !okInt(n.h)) fail(`${n.id} has no usable size`);
    if (!STATUSES.has(n.status)) fail(`${n.id} has status ${JSON.stringify(n.status)}`);
    if (!Array.isArray(n.parents) || n.parents.some((p) => typeof p !== 'string')) fail(`${n.id} has malformed parents`);
    for (const p of n.parents) if (!ids.has(p)) fail(`${n.id} points at a photo that is not in the file`);
    const blob = blobOf(n.image);
    if (n.status === 'ready' && !blob) fail(`${n.id} is marked ready but has no image`);
    return {
      id: ids.get(n.id), parents: [...new Set(n.parents)].map((p) => ids.get(p)),
      prompt: String(n.prompt ?? '').slice(0, 2000), name: n.name == null ? undefined : String(n.name).slice(0, 200),
      w: n.w, h: n.h, status: n.status, error: n.error == null ? undefined : String(n.error).slice(0, 500),
      star: !!n.star, seed: Number.isFinite(n.seed) ? n.seed : undefined, cost: Number.isFinite(n.cost) && n.cost >= 0 ? n.cost : undefined,
      blob, hqBlob: blobOf(n.hq),
    };
  });

  // A cycle would send every ancestor walk in the app round for ever.
  const parentsOf = new Map(recs.map((r) => [r.id, r.parents]));
  const state = new Map(); // 1 = on the current path, 2 = done
  const visit = (id) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) fail('the tree loops back on itself');
    state.set(id, 1);
    for (const p of parentsOf.get(id)) visit(p);
    state.set(id, 2);
  };
  for (const r of recs) visit(r.id);
  return recs;
}
