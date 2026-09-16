// The share registry. Delete an entry in stills.js / motion.js / files.js and it disappears
// from the dialog — nothing else references formats by id.

import { STILLS } from './stills.js';
import { MOTION } from './motion.js';
import { FILES } from './files.js';

export const FORMATS = [...STILLS, ...MOTION, ...FILES];
export const GROUPS = [...new Set(FORMATS.map((f) => f.group))];
// Static defaults only; `pick` options and function defaults resolve against the tree at build time.
export const defaultsFor = (f) => Object.fromEntries((f.options || []).filter((o) => typeof o.def !== 'function').map((o) => [o.id, o.def]));
// Fill in unresolved picks / function defaults so builders always see concrete values.
export const resolveOpts = (f, t, o) => {
  const out = { ...o };
  for (const x of f.options || []) if (out[x.id] === undefined && typeof x.def === 'function') out[x.id] = x.def(t, out);
  return out;
};

export { buildTree, REQUIREMENTS, caption, nodeOr, familyOf } from './tree.js';
export { render, toBlob, setWordmark } from './scene.js';
// video.js is imported dynamically by ShareDialog — it carries the muxer and must stay lazy.
