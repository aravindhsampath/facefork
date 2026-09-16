import { get, set, del, setMany, getMany, delMany, keys } from 'idb-keyval';

const KEY = 'howdoilook.graph.v2';
const OLD_KEY = 'howdoilook.graph';
const SETTINGS = 'howdoilook.settings.v2';

// Blobs are content-addressed (blob:<sha256>) so siblings/reloads never duplicate bytes. They are
// stored as {type, bytes} rather than Blob: WebKit keeps IDB Blobs as files on disk, which an
// ephemeral session (Safari Private Browsing) has none of, so every Blob put fails with UnknownError
// while plain ArrayBuffers go through fine.
const hashes = new WeakMap();
const known = new Set();
async function hashOf(blob, bytes) {
  let h = hashes.get(blob);
  if (!h) {
    const d = await crypto.subtle.digest('SHA-256', bytes ?? await blob.arrayBuffer());
    h = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    hashes.set(blob, h);
  }
  return h;
}
const thaw = (v) => (v instanceof Blob || !v ? v : new Blob([v.bytes], { type: v.type })); // older saves hold real Blobs

// records: [{id, prompt, parents, blob, hqBlob, inline, w, h, status, error, cost, star, seed}]
export async function loadGraph() {
  const recs = (await get(KEY)) ?? (await get(OLD_KEY));
  if (!recs) return recs;
  const hs = [...new Set(recs.flatMap((r) => [r.hash, r.hqHash].filter(Boolean)))];
  const blobs = await getMany(hs.map((h) => `blob:${h}`));
  const byHash = new Map(hs.map((h, i) => [h, thaw(blobs[i])]));
  hs.forEach((h) => byHash.get(h) && known.add(h)); // only what is really there counts as stored
  const seen = new Set();
  return recs
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .map(({ hash, hqHash, ...r }) => {
      const blob = byHash.get(hash) ?? thaw(r.blob); // pre-hash records carried the blob inline
      const missing = r.status === 'ready' && !blob;
      return { ...r, blob, hqBlob: byHash.get(hqHash) ?? thaw(r.hqBlob), ...(missing && { status: 'error', error: 'Image data missing' }) };
    });
}

// Saves run one at a time; the returned promise rejects when the browser refused to store, so the
// app can say so, while the queue itself keeps going for the next attempt.
let queue = Promise.resolve();
export const saveGraph = (records) => { const p = queue.then(() => doSave(records)); queue = p.catch(() => {}); return p; };

async function doSave(records) {
  const out = [];
  const fresh = new Map(); // hash -> stored value; becomes `known` only once the write has succeeded
  const put = async (blob) => {
    if (!blob) return undefined;
    const bytes = hashes.has(blob) ? undefined : await blob.arrayBuffer();
    const h = await hashOf(blob, bytes);
    if (!known.has(h) && !fresh.has(h)) fresh.set(h, { type: blob.type, bytes: bytes ?? await blob.arrayBuffer() });
    return h;
  };
  for (const { blob, hqBlob, ...rest } of records) out.push({ ...rest, hash: await put(blob), hqHash: await put(hqBlob) });
  if (fresh.size) await setMany([...fresh].map(([h, v]) => [`blob:${h}`, v]));
  fresh.forEach((_, h) => known.add(h));
  await set(KEY, out);
  await del(OLD_KEY);
  const live = new Set(out.flatMap((r) => [r.hash, r.hqHash].filter(Boolean)));
  const orphans = (await keys()).filter((k) => typeof k === 'string' && k.startsWith('blob:') && !live.has(k.slice(5)));
  if (orphans.length) { await delMany(orphans); orphans.forEach((k) => known.delete(k.slice(5))); }
}

export const loadSettings = () => {
  try { return JSON.parse(localStorage.getItem(SETTINGS)) || {}; } catch { return {}; }
};
export const saveSettings = (s) => localStorage.setItem(SETTINGS, JSON.stringify(s));
