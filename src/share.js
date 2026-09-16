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

// Returns records with fresh ids (so a tree can be imported into a canvas that already has it).
export async function importTree(file) {
  const zip = unzipSync(await u8(file));
  const graph = JSON.parse(strFromU8(zip['graph.json'] ?? new Uint8Array()));
  if (!['facefork', 'howdoilook'].includes(graph.format)) throw new Error('Not a .facefork file');
  const ids = new Map(graph.nodes.map((n) => [n.id, crypto.randomUUID()]));
  const blobOf = (path) => (path && zip[path] ? new Blob([zip[path]], { type: path.endsWith('.webp') ? 'image/webp' : path.endsWith('.png') ? 'image/png' : 'image/jpeg' }) : undefined);
  return graph.nodes.map(({ image, hq, ...n }) => ({
    ...n,
    id: ids.get(n.id),
    parents: n.parents.map((p) => ids.get(p)).filter(Boolean),
    blob: blobOf(image),
    hqBlob: blobOf(hq),
  }));
}
