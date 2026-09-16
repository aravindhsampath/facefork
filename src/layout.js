import dagre from '@dagrejs/dagre';

export const NODE_W = 220;
export const FOOTER_H = 36;
export const FILM_W = 180;
export const ADDER_H = 300;

export const imageHeight = (d) => Math.round(NODE_W * (d.h / d.w));
export const nodeHeight = (d) => imageHeight(d) + FOOTER_H;

// Edges derive from parent pointers; the prompt is the label on the first-parent edge.
export const edgesOf = (nodes) =>
  nodes.filter((n) => n.type === 'photo').flatMap((n) =>
    n.data.parents.map((p, i) => ({
      id: `${p}->${n.id}`, source: p, target: n.id,
      ...(i === 0 && { label: n.data.prompt }),
    })));

// Top-down DAG layout for photo nodes; the filmstrip sits left of the tree unless the user has dragged it.
export function layout(nodes) {
  const photos = nodes.filter((n) => n.type === 'photo');
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80 });
  const adder = nodes.find((n) => n.type === 'adder');
  for (const n of photos) g.setNode(n.id, { width: NODE_W, height: nodeHeight(n.data) });
  if (adder) g.setNode(adder.id, { width: NODE_W, height: ADDER_H });
  for (const e of edgesOf(photos)) g.setEdge(e.source, e.target);
  // Seeds stay on the top row even when a cross-tree merge would otherwise pull one of them down
  // to its partner's rank: a hidden root above every seed, with heavy edges dagre prefers to keep short.
  g.setNode('__root', { width: 1, height: 1 });
  for (const n of photos) if (!n.data.parents.length) g.setEdge('__root', n.id, { weight: 4 });
  if (adder) g.setEdge('__root', adder.id, { weight: 4 });
  dagre.layout(g);
  const laid = photos.map((n) => {
    const { x, y } = g.node(n.id);
    const height = nodeHeight(n.data);
    return { ...n, width: NODE_W, height, position: { x: x - NODE_W / 2, y: y - height / 2 } };
  });
  if (adder) {
    const { x, y } = g.node(adder.id);
    laid.push({ ...adder, width: NODE_W, height: ADDER_H, position: { x: x - NODE_W / 2, y: y - ADDER_H / 2 } });
  }
  const film = nodes.find((n) => n.type === 'filmstrip');
  if (film) laid.push(film.data.pinned ? film : { ...film, position: filmPosition(laid) });
  return laid;
}

// Where the filmstrip sits: left of everything, level with the top row.
export const filmPosition = (laid) => ({
  x: Math.min(...laid.map((n) => n.position.x)) - FILM_W - 80,
  y: Math.min(...laid.map((n) => n.position.y)),
});

// One faint backdrop per connected group of photos (a seed and everything grown from it; two
// seeds that were merged share one plate), named after the seeds inside it. Derived from the
// current node positions on every render, so plates follow nodes wherever they are dragged.
export const PLATE_PAD = { x: 28, top: 44, bottom: 24 };
export function plates(laid) {
  const photos = laid.filter((n) => n.type === 'photo');
  const byId = new Map(photos.map((n) => [n.id, n]));
  const parent = new Map(photos.map((n) => [n.id, n.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const n of photos) for (const p of n.data.parents) if (byId.has(p)) parent.set(find(n.id), find(p));
  const groups = new Map();
  for (const n of photos) { const g = find(n.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(n); }
  const out = [];
  for (const [g, members] of groups) {
    if (members.length < 2) continue;
    const x0 = Math.min(...members.map((n) => n.position.x)) - PLATE_PAD.x;
    const y0 = Math.min(...members.map((n) => n.position.y)) - PLATE_PAD.top;
    const x1 = Math.max(...members.map((n) => n.position.x + n.width)) + PLATE_PAD.x;
    const y1 = Math.max(...members.map((n) => n.position.y + n.height)) + PLATE_PAD.bottom;
    const seeds = members.filter((n) => !n.data.parents.length).map((n) => n.data.name || 'seed');
    out.push({
      id: `plate-${g}`, type: 'plate', position: { x: x0, y: y0 }, width: x1 - x0, height: y1 - y0,
      selectable: false, draggable: true, dragHandle: '.plate-handle', focusable: false, zIndex: -1,
      data: { name: seeds.join(' + '), count: members.length, members: members.map((n) => n.id) },
    });
  }
  return out;
}
