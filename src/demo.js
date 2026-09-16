// Demo tree: "Sam", an AI-generated (so nobody's) photoreal portrait with everyday what-ifs, the
// Mona Lisa with the Duchamp joke, one pending invitation and one cross-tree merge. Every node
// carries demo: true so the app can clear them out once someone brings their own photo.
// Generated once by scripts/make-demo.mjs and bundled under public/demo — no key needed to see it.

import tree from './demo-assets/tree.json';

// Vite fingerprints these (assets/sam-<hash>.webp), so they can be cached forever at the CDN and
// a regenerated demo can never be served stale.
const urls = import.meta.glob('./demo-assets/*.webp', { eager: true, query: '?url', import: 'default' });
const urlOf = (name) => urls[`./demo-assets/${name}`];

export async function demoRecords() {
  const { nodes } = tree;
  const ids = new Map(nodes.map((n) => [n.id, crypto.randomUUID()]));
  const blobs = await Promise.all(nodes.map(async (n) => {
    if (!n.image) return undefined;
    const r = await fetch(urlOf(n.image));
    if (!r.ok) throw new Error(`demo image missing: ${n.image}`);
    return r.blob();
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((n, i) => {
    const size = n.w ? n : byId.get(n.parents[0]); // pending nodes borrow their parent's shape
    return {
      id: ids.get(n.id), prompt: n.prompt, parents: n.parents.map((p) => ids.get(p)),
      blob: blobs[i], w: size.w, h: size.h, status: n.status, name: n.name, star: n.star, seed: n.seed, demo: true, // no cost: it wasn't the visitor's money
    };
  });
}
