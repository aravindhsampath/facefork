import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Panel, useNodesState, useReactFlow } from '@xyflow/react';
import { Ctx } from './ctx.js';
import PhotoNode from './PhotoNode.jsx';
import Filmstrip from './Filmstrip.jsx';
import Plate from './Plate.jsx';
import Adder from './Adder.jsx';
import Tour from './Tour.jsx';
import PromptEdge from './PromptEdge.jsx';
import PromptBox from './PromptBox.jsx';
import Lightbox from './Lightbox.jsx';
import Settings from './Settings.jsx';
import ShareDialog from './ShareDialog.jsx';
import { SAME_SEED, CROSS_SEED, chipsFor } from './chips.js';
import { layout, plates, edgesOf, nodeHeight, NODE_W } from './layout.js';
import { normalize, dims, toInline, base64ToBlob, downloadBlob, extOf } from './image.js';
import { generateImage, buildPrompt, pickRatio, snapResolution } from './api.js';
import { loadGraph, saveGraph, loadSettings, saveSettings } from './store.js';
import { exportTree, importTree } from './share.js';
import { demoRecords } from './demo.js';

const nodeTypes = { photo: PhotoNode, filmstrip: Filmstrip, plate: Plate, adder: Adder };
const edgeTypes = { prompt: PromptEdge };
const DEFAULTS = { model: 'google/gemini-3.1-flash-image', exploreRes: '1K', downloadRes: '2K', theme: 'system' };
const FILM = { id: 'film', type: 'filmstrip', position: { x: 0, y: 0 }, selectable: false, data: { pinned: false } };
const ADDER = { id: 'adder', type: 'adder', position: { x: 0, y: 0 }, selectable: false, draggable: false, focusable: false, data: {} };
// Storage keys keep the old prefix on purpose: renaming them would drop everyone's saved tree and key.
// Narrow screens get a bottom-sheet prompt instead of the one hanging under the card.
const NARROW = '(max-width: 720px)';
function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const on = () => setM(mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }, [q]);
  return m;
}

const COMBINED = 'howdoilook.combined';
const MAP_KEY = 'howdoilook.minimap';
const TOUR_SEEN = 'howdoilook.tourSeen';

const toNode = (r) => ({
  id: r.id, type: 'photo', position: { x: 0, y: 0 },
  data: { ...r, url: r.blob ? URL.createObjectURL(r.blob) : null, hqUrl: r.hqBlob ? URL.createObjectURL(r.hqBlob) : null },
});
const toRecord = ({ id, data: { prompt, parents, blob, hqBlob, inline, w, h, status, error, errorKind, cost, star, seed, name, demo } }) =>
  ({ id, prompt, parents, blob, hqBlob, inline, w, h, status, error, errorKind, cost, star, seed, name, demo });
// A generation caught by a reload is saved as a retryable error rather than dropped: the prompt and parents survive.
const interrupted = (r) => (r.status === 'loading' ? { ...r, status: 'error', error: 'Interrupted — the page was reloaded while this was generating', blob: undefined } : r);
const photosOf = (nodes) => nodes.filter((n) => n.type === 'photo');
const isImage = (f) => f?.type.startsWith('image/');
const isTree = (f) => /\.(facefork|howdoilook)$/i.test(f?.name || '');

// Keep the filmstrip node iff something is starred.
// Keep the filmstrip node iff something is starred, and the "add your photo" card while the
// canvas holds only the demo.
function withFilm(nodes) {
  const photos = photosOf(nodes);
  const film = nodes.find((n) => n.type === 'filmstrip');
  const out = photos.some((n) => n.data.star) ? [...photos, film || FILM] : [...photos];
  if (photos.length && !photos.some((n) => !n.data.demo && !n.data.parents.length)) out.push(ADDER);
  return out;
}

// All descendants of `ids` (inclusive) in the parent-pointer DAG.
function subtree(nodes, ids) {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (!out.has(n.id) && n.data.parents.some((p) => out.has(p))) { out.add(n.id); grew = true; }
  }
  return out;
}

// Follow first parents up to the seed.
function rootOf(byId, id) {
  let n = byId.get(id);
  while (n?.data.parents[0]) n = byId.get(n.data.parents[0]);
  return n?.id ?? id;
}

// Photo nodes ordered so parents precede children.
function topo(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map();
  const d = (id) => depth.get(id) ?? (depth.set(id, 1 + Math.max(-1, ...byId.get(id).data.parents.map(d))), depth.get(id));
  return [...nodes].sort((a, b) => d(a.id) - d(b.id));
}

export default function App() {
  const rf = useReactFlow();
  if (import.meta.env.DEV) window.__rf = rf; // dev-only handle for in-browser debugging
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [settings, setSettings] = useState(() => ({ ...DEFAULTS, ...loadSettings() }));
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const [keyGate, setKeyGate] = useState(null); // {parentIds, prompt, reuseId} waiting for an API key
  const [draft, setDraft] = useState(''); // prompt handed back to the composer when the gate is dismissed
  const [drawer, setDrawer] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [notes, setNotes] = useState([]); // stacked status pills: {id, kind, text, action}
  const [lastAdded, setLastAdded] = useState(null); // newest node id — its parent edge pulses briefly
  const [compare, setCompare] = useState(false);
  const [combineHint, setCombineHint] = useState(() => !localStorage.getItem(COMBINED));
  const narrow = useMedia(NARROW);
  const touch = useMedia('(hover: none) and (pointer: coarse)');
  const [showMap, setShowMap] = useState(() => (localStorage.getItem(MAP_KEY) ?? (window.matchMedia(NARROW).matches ? '0' : '1')) !== '0');
  const [dropTarget, setDropTarget] = useState(null); // photo node under a card being dragged
  const clearDemoRef = useRef(null); // set once clearDemo exists (it is declared after addSeed)
  const plateDrag = useRef(null); // {origin, starts: Map<id, position>} while a plate handle is being dragged
  const [tour, setTour] = useState(false); // first-visit callouts on the demo
  const [dropping, setDropping] = useState(false);
  const fileRef = useRef(null);
  const loaded = useRef(false);

  // Plates are derived, never state — but React Flow re-observes a node whose object identity
  // changes (WebKit's ResizeObserver then fires every frame and the app re-renders in a loop), so
  // an unchanged plate keeps its previous object.
  const plateCache = useRef(new Map());
  const shown = useMemo(() => {
    const next = new Map();
    const stable = plates(nodes).map((p0) => {
      const p = touch ? { ...p0, draggable: false } : p0; // on touch, a finger on the handle pans like everywhere else
      const key = JSON.stringify([p.position, p.width, p.height, p.data, touch]);
      const prev = plateCache.current.get(p.id);
      const node = prev && prev.key === key ? prev.node : p;
      next.set(p.id, { key, node });
      return node;
    });
    plateCache.current = next;
    return [...stable, ...nodes];
  }, [nodes, touch]);
  const edges = useMemo(() => edgesOf(nodes).map((e) => (e.target === lastAdded ? { ...e, className: 'pulse' } : e)), [nodes, lastAdded]);
  const selected = useMemo(() => nodes.filter((n) => n.selected && n.type === 'photo'), [nodes]);
  const favourites = useMemo(() => photosOf(nodes).filter((n) => n.data.star && n.data.status === 'ready').map((n) => ({ id: n.id, url: n.data.url, prompt: n.data.prompt })), [nodes]);
  const total = useMemo(() => nodes.reduce((s, n) => s + (n.data.cost || 0), 0), [nodes]);
  const generating = useMemo(() => nodes.filter((n) => n.data.status === 'loading' || n.data.hqBusy).length, [nodes]);
  const edits = useMemo(() => photosOf(nodes).filter((n) => n.data.status === 'ready' && n.data.parents.length), [nodes]);
  const hqPending = useMemo(() => edits.filter((n) => !n.data.hqBlob).length, [edits]);
  const demoIds = useMemo(() => photosOf(nodes).filter((n) => n.data.demo).map((n) => n.id), [nodes]);
  const avgCost = useMemo(() => { const c = edits.map((n) => n.data.cost).filter(Boolean); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0.04; }, [edits]);
  const model = settings.models?.find((m) => m.id === settings.model);

  // `next` may be a function of the current nodes so concurrent updates (two generations finishing together) never clobber each other.
  const setGraph = useCallback((next, focusId) => {
    setNodes((cur) => {
      const laid = layout(withFilm(typeof next === 'function' ? next(cur) : next));
      const n = focusId && laid.find((x) => x.id === focusId);
      if (n) requestAnimationFrame(() => rf.setCenter(n.position.x + NODE_W / 2, n.position.y + n.height / 2, { zoom: rf.getZoom(), duration: 300 }));
      return laid;
    });
  }, [rf, setNodes]);
  // Fit from the sizes we already know (layout sets width/height on every node), so it works
  // before React Flow has measured anything — e.g. in a background tab, where measurement stalls.
  const fitAll = useCallback((padding = 0.2, duration = 300) => {
    const ns = rf.getNodes().filter((n) => n.type !== 'plate' && n.width && n.height);
    const box = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (!ns.length || !box) return;
    const x0 = Math.min(...ns.map((n) => n.position.x)), y0 = Math.min(...ns.map((n) => n.position.y));
    const x1 = Math.max(...ns.map((n) => n.position.x + n.width)), y1 = Math.max(...ns.map((n) => n.position.y + n.height));
    const bw = x1 - x0, bh = y1 - y0;
    const zoom = Math.max(0.05, Math.min(1, box.width / (bw * (1 + padding * 2)), box.height / (bh * (1 + padding * 2))));
    rf.setViewport({ x: (box.width - bw * zoom) / 2 - x0 * zoom, y: (box.height - bh * zoom) / 2 - y0 * zoom, zoom }, { duration });
  }, [rf]);
  const patch = useCallback((id, data) =>
    setGraph((cur) => cur.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n))), [setGraph]);
  // Merge records into the canvas (ids already present are skipped), or replace it entirely.
  const addRecords = useCallback((recs, { replace = false } = {}) => {
    setGraph((cur) => {
      const have = new Set(replace ? [] : cur.map((n) => n.id));
      return [...(replace ? [] : cur.map((n) => ({ ...n, selected: false }))), ...recs.filter((r) => !have.has(r.id)).map(toNode)];
    });
    setTimeout(() => fitAll(), 60);
  }, [setGraph, fitAll]);

  const updateSettings = (p) => setSettings((s) => { const n = { ...s, ...p }; saveSettings(n); return n; });
  const dismiss = (id) => setNotes((ns) => ns.filter((n) => n.id !== id));
  // kind: info | ok | error. action: {label, run}. ms 0 = sticky until replaced/dismissed.
  const notify = useCallback((text, { kind = 'info', action = null, ms = 4000, id = crypto.randomUUID() } = {}) => {
    setNotes((ns) => [...ns.filter((n) => n.id !== id), { id, kind, text, action }]);
    if (ms) setTimeout(() => dismiss(id), ms);
    return id;
  }, []);
  const flash = (msg, ms = 4000) => notify(msg, { kind: /fail|could not|error|not ready/i.test(msg) ? 'error' : /✓|imported|copied/i.test(msg) ? 'ok' : 'info', ms });

  // ---- persistence, demo, theme, title ----
  useEffect(() => {
    // Nothing stored yet (or storage unreadable) means a first visit: bring the demo. An emptied
    // canvas is stored as [] and stays empty. No separate "seen" flag, so a browser that cannot
    // keep the tree between reloads gets the demo again rather than a blank page.
    loadGraph().then(async (recs) => {
      if (recs?.length) addRecords(recs, { replace: true });
      else if (!recs) {
        try { addRecords(await demoRecords()); if (!localStorage.getItem(TOUR_SEEN)) setTour(true); } catch { /* offline: empty canvas */ }
      }
      loaded.current = true;
    }, (e) => {
      // Unreadable is not the same as empty: keep autosave off so nothing overwrites what may still be recoverable.
      console.error(e);
      notify('Couldn’t read the tree saved in this browser. Reload to try again; nothing has been overwritten.', { kind: 'error', ms: 0, id: 'noload' });
    });
  }, []); // eslint-disable-line
  const structural = nodes.map((n) => n.id + n.data.status + (n.data.star ? '*' : '') + (n.data.hqBlob ? 'H' : '') + (n.data.cost ?? '')).join();
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => saveGraph(photosOf(nodes).map(toRecord).map(interrupted)).catch((e) => {
      console.error(e);
      notify('This browser isn’t keeping your tree between reloads. Export it from Settings to keep it.', { kind: 'error', ms: 12000, id: 'nosave' });
    }), 300);
    return () => clearTimeout(t);
  }, [structural]); // eslint-disable-line
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  useEffect(() => { document.title = generating ? `facefork · ${generating} generating…` : 'facefork'; }, [generating]);

  // ---- core generation: refs are data URLs; returns the model's bytes untouched + dims + cost ----
  const run = useCallback(async ({ refs, prompt, people, ratioFrom, tier, seed, onPartial, signal }) => {
    // Settings as they are now, not as they were when this closure was rendered: the key gate
    // saves a key and generates in the same tick, before React has re-rendered anything.
    const s = settingsRef.current;
    if (!s.key) throw new Error('Add your OpenRouter API key first');
    const model = s.models?.find((m) => m.id === s.model);
    if (model && refs.length > model.maxRefs) throw new Error(`${model.name} accepts at most ${model.maxRefs} reference image${model.maxRefs > 1 ? 's' : ''}`);
    const res = await generateImage({
      key: s.key, model: s.model, images: refs,
      prompt: buildPrompt(prompt, refs.length, people),
      ratio: pickRatio(model?.ratios, ratioFrom.w, ratioFrom.h),
      resolution: snapResolution(model?.resolutions, tier),
      seed: model?.seed ? seed : undefined,
      stream: !!model?.stream && !!onPartial,
      onPartial,
      signal,
    });
    const blob = base64ToBlob(res);
    return { blob, ...(await dims(blob)), cost: res.cost || 0 };
  }, []);

  const addSeed = useCallback(async (file) => {
    if (!file) return;
    try {
      const { blob, w, h } = await normalize(file);
      const node = toNode({ id: crypto.randomUUID(), prompt: '', parents: [], blob, inline: await toInline(blob), w, h, status: 'ready', name: file.name.replace(/\.[^.]+$/, '') });
      setGraph((cur) => [...cur.map((n) => ({ ...n, selected: false })), { ...node, selected: true }], node.id);
      // First own photo while the demo is still around: offer to clear it so exports and shares stay theirs.
      if (photosOf(rf.getNodes()).some((n) => n.data.demo) && !photosOf(rf.getNodes()).some((n) => !n.data.demo && !n.data.parents.length)) {
        notify('Your photo is in. Clear the demo so it doesn’t mix into your tree and exports?', { ms: 15000, id: 'clear-demo', action: { label: 'Clear demo', run: () => { clearDemoRef.current?.(); dismiss('clear-demo'); } } });
      }
    } catch (e) { flash(`Could not read image: ${e.message}`); }
  }, [setGraph, rf, notify]);

  const importFile = useCallback(async (file) => {
    try { const recs = await importTree(file); addRecords(recs); flash(`Imported ${recs.length} images`); } catch (e) { flash(`Import failed: ${e.message}`); }
  }, [addRecords]);

  const takeFiles = useCallback((files) => {
    for (const f of files) { if (isTree(f)) importFile(f); else if (isImage(f)) addSeed(f); }
  }, [addSeed, importFile]);

  // In-flight generations by node id, so deleting a card (or leaving the page) stops waiting for it.
  const jobs = useRef(new Map());
  // Generate a child of `parentIds`; with `reuseId` the existing (error/pending) node is re-rendered in place.
  const startGeneration = useCallback(async (parentIds, prompt, reuseId) => {
    const byId = new Map(rf.getNodes().map((n) => [n.id, n]));
    const parents = parentIds.map((id) => byId.get(id)).filter((n) => n?.data.status === 'ready');
    if (!parents.length) return flash('Parent image is not ready yet');
    const people = new Set(parents.map((p) => rootOf(byId, p.id))).size;
    if (parents.length > 1 && combineHint) { localStorage.setItem(COMBINED, '1'); setCombineHint(false); }
    const id = reuseId || crypto.randomUUID();
    const first = parents[0].data;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const data = { prompt, parents: parents.map((p) => p.id), w: first.w, h: first.h, url: first.url, ghost: true, status: 'loading', seed, error: undefined, startedAt: Date.now() };
    if (reuseId) patch(id, data);
    else {
      // Enter animation: mount at the parent's position, then let the relayout (CSS transition) carry it to its slot.
      const p0 = parents[0];
      setNodes((cur) => [...cur.map((n) => ({ ...n, selected: false })), { id, type: 'photo', className: 'enter', position: { ...p0.position }, width: NODE_W, height: nodeHeight(data), data }]);
      requestAnimationFrame(() => setGraph((cur) => cur, id));
      setLastAdded(id); setTimeout(() => setLastAdded((x) => (x === id ? null : x)), 1600);
    }
    const ctl = new AbortController();
    jobs.current.set(id, ctl);
    try {
      // Pre-encoded refs are cached on the node; older records get encoded once here.
      const refs = await Promise.all(parents.map(async (p) => {
        const inline = p.data.inline || await toInline(p.data.blob);
        if (!p.data.inline) rf.updateNodeData(p.id, { inline });
        return inline;
      }));
      const out = await run({
        refs, prompt, people, ratioFrom: first, tier: settings.exploreRes, seed, signal: ctl.signal,
        onPartial: (url) => rf.updateNodeData(id, { url, ghost: false }),
      });
      if (ctl.signal.aborted) return; // the card is gone; nothing to show it on
      patch(id, { status: 'ready', ghost: false, ...out, inline: await toInline(out.blob), url: URL.createObjectURL(out.blob) });
      updateSettings({ spent: (settingsRef.current.spent || 0) + out.cost });
    } catch (e) {
      if (ctl.signal.aborted) return;
      console.error(e);
      patch(id, { status: 'error', ghost: false, url: null, error: e.message, errorKind: e.kind });
    } finally {
      jobs.current.delete(id);
    }
  }, [rf, run, setGraph, setNodes, patch, settings.exploreRes, combineHint]);
  // Returns false when nothing started (no key yet: the request waits in the gate and the prompt box keeps its text).
  const generate = useCallback((parentIds, prompt, reuseId) => {
    if (!settingsRef.current.key) { setKeyGate({ parentIds, prompt, reuseId }); return false; }
    setDraft('');
    startGeneration(parentIds, prompt, reuseId);
    return true;
  }, [startGeneration]);

  // Re-render one node at download resolution from its parents' best images. This is a fresh
  // generation (same seed where the model supports it), so the picture can change; it is never
  // implied by Download. One in-flight job per node: a second click joins the first.
  const hqJobs = useRef(new Map());
  const rerender = useCallback((id) => {
    if (hqJobs.current.has(id)) return hqJobs.current.get(id);
    const job = (async () => {
      const byId = new Map(rf.getNodes().map((n) => [n.id, n]));
      const n = byId.get(id);
      if (!n || !n.data.parents.length || n.data.hqBlob) return;
      const parents = n.data.parents.map((p) => byId.get(p)).filter(Boolean);
      const people = new Set(parents.map((p) => rootOf(byId, p.id))).size;
      rf.updateNodeData(id, { hqBusy: true });
      try {
        const refs = await Promise.all(parents.map((p) => toInline(p.data.hqBlob || p.data.blob, 2048)));
        const out = await run({ refs, prompt: n.data.prompt, people, ratioFrom: parents[0].data, tier: settingsRef.current.downloadRes, seed: n.data.seed });
        const cost = (rf.getNode(id)?.data.cost || 0) + out.cost;
        rf.updateNodeData(id, { hqBusy: false, hqBlob: out.blob, hqUrl: URL.createObjectURL(out.blob), cost });
        updateSettings({ spent: (settingsRef.current.spent || 0) + out.cost });
      } catch (e) {
        rf.updateNodeData(id, { hqBusy: false });
        throw e;
      }
    })().finally(() => hqJobs.current.delete(id));
    hqJobs.current.set(id, job);
    return job;
  }, [rf, run]);

  // Only a click spends: a key typed under ⚙ while the card waits turns its button into "Generate".
  const saveKeyAndGo = (key) => {
    settingsRef.current = { ...settingsRef.current, key };
    if (key !== settings.key) updateSettings({ key });
    const g = keyGate; setKeyGate(null);
    if (g) generate(g.parentIds, g.prompt, g.reuseId);
  };

  const hqDiffers = model?.resolutions?.length > 0 && snapResolution(model.resolutions, settings.exploreRes) !== snapResolution(model.resolutions, settings.downloadRes);

  // Saves exactly what is on the card (the HQ version if one was made): no request, no charge.
  const download = useCallback((id) => {
    const n = rf.getNode(id);
    const out = n.data.hqBlob || n.data.blob;
    downloadBlob(out, `facefork-${id.slice(0, 8)}${n.data.hqBlob ? '-hq' : ''}.${extOf(out)}`);
  }, [rf]);

  // Walk the whole tree seed→leaves, re-rendering each node in HQ from HQ parents.
  const reprocessAll = useCallback(async () => {
    if (!hqDiffers) return flash('Download resolution equals explore resolution for this model — nothing to do');
    const todo = topo(photosOf(rf.getNodes())).filter((n) => n.data.parents.length && n.data.status === 'ready' && !n.data.hqBlob);
    if (!todo.length) return flash('Everything is already HQ');
    if (!confirm(`Re-render ${todo.length} image${todo.length > 1 ? 's' : ''} at ${settings.downloadRes}? Each one costs a generation.`)) return;
    let i = 0;
    for (const n of todo) {
      notify(`Re-rendering ${++i} of ${todo.length}…`, { ms: 0, id: 'hq-progress' });
      try { await rerender(n.id); } catch (e) { notify(`HQ failed on “${n.data.prompt}”: ${e.message}`, { kind: 'error', ms: 8000, action: { label: 'Retry', run: () => reprocessAll() } }); return; }
    }
    notify('Every image re-rendered ✓', { kind: 'ok', id: 'hq-progress' });
  }, [rf, rerender, hqDiffers, settings.downloadRes]);

  const exportAll = useCallback(async () => {
    const recs = photosOf(rf.getNodes()).filter((n) => n.data.status !== 'loading').map(toRecord);
    if (!recs.length) return flash('Nothing to export');
    downloadBlob(await exportTree(recs), `facefork-${new Date().toISOString().slice(0, 10)}.facefork`);
  }, [rf]);

  const loadDemo = useCallback(async () => {
    if (photosOf(rf.getNodes()).some((n) => n.data.demo)) return notify('The demo is already on the canvas', { kind: 'info' });
    try { addRecords(await demoRecords()); } catch (e) { notify(`Demo failed: ${e.message}`, { kind: 'error' }); }
  }, [addRecords, rf, notify]);

  // Delete is immediate and undoable for 8 s; object URLs are only revoked once the undo window closes.
  // The ready photo card under the centre of a card being dragged, if any.
  const dropHit = useCallback((n) => {
    const h = n.measured?.height ?? n.height ?? 0;
    const cx = n.position.x + NODE_W / 2, cy = n.position.y + h / 2;
    return photosOf(rf.getNodes()).find((o) => o.id !== n.id && o.data.status === 'ready'
      && cx > o.position.x && cx < o.position.x + NODE_W && cy > o.position.y && cy < o.position.y + (o.measured?.height ?? o.height ?? 0));
  }, [rf]);

  const removeMany = useCallback((ids) => {
    const cur = rf.getNodes();
    const gone = subtree(photosOf(cur), ids);
    // Stop waiting on anything deleted mid-generation; an undo brings it back as a retryable card.
    for (const id of gone) jobs.current.get(id)?.abort();
    const removed = cur.filter((n) => gone.has(n.id)).map((n) => (n.data.status === 'loading' ? { ...n, data: { ...n.data, status: 'error', ghost: false, url: null, error: 'Cancelled' } } : n));
    setGraph((now) => now.filter((n) => !gone.has(n.id)));
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      for (const n of removed) [n.data.url, n.data.hqUrl].forEach((u) => u?.startsWith('blob:') && URL.revokeObjectURL(u));
    }, 8500);
    notify(`Deleted ${removed.length} image${removed.length > 1 ? 's' : ''}`, {
      id, ms: 8000,
      action: { label: 'Undo', run: () => { clearTimeout(timer); setGraph((now) => [...now, ...removed.map((n) => ({ ...n, selected: false }))]); dismiss(id); } },
    });
  }, [rf, setGraph, notify]);

  const remove = useCallback((id) => removeMany([id]), [removeMany]);
  // Removes the bundled demo and anything grown from it (undoable like any delete).
  const clearDemo = useCallback(() => { const ids = photosOf(rf.getNodes()).filter((n) => n.data.demo).map((n) => n.id); if (ids.length) removeMany(ids); }, [rf, removeMany]);
  clearDemoRef.current = clearDemo;
  const open = useCallback((id) => setLightbox(id), []);
  const toggleStar = useCallback((id) => setGraph((cur) => cur.map((n) => (n.id === id ? { ...n, data: { ...n.data, star: !n.data.star } } : n))), [setGraph]);

  // Keyboard tree navigation: ↑ parent, ↓ first child, ←→ siblings (by x), Enter focuses the prompt.
  const navigate = useCallback((dir) => {
    const photos = photosOf(rf.getNodes());
    const sel = photos.filter((n) => n.selected);
    if (sel.length !== 1) return;
    const cur = sel[0];
    const byX = (a, b) => a.position.x - b.position.x;
    const p = cur.data.parents[0];
    let target;
    if (dir === 'up') target = photos.find((n) => n.id === p);
    else if (dir === 'down') target = photos.filter((n) => n.data.parents[0] === cur.id).sort(byX)[0];
    else {
      const sibs = photos.filter((n) => n.data.parents[0] === p).sort(byX);
      target = sibs[sibs.indexOf(sibs.find((n) => n.id === cur.id)) + (dir === 'left' ? -1 : 1)];
    }
    if (!target) return;
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === target.id })));
    setLightbox((l) => (l ? target.id : l));
    rf.setCenter(target.position.x + NODE_W / 2, target.position.y + target.height / 2, { zoom: rf.getZoom(), duration: 250 });
  }, [rf, setNodes]);

  // The spotlight goes away on the first click or keypress anywhere, and never comes back.
  useEffect(() => {
    if (!tour) return;
    const end = (e) => {
      if (e.target.closest?.('.react-flow__controls, .react-flow__minimap, .maptoggle')) return; // zooming around isn't "getting started"
      setTour(false); localStorage.setItem(TOUR_SEEN, '1');
    };
    window.addEventListener('pointerdown', end, { capture: true });
    window.addEventListener('keydown', end, { capture: true });
    return () => { window.removeEventListener('pointerdown', end, { capture: true }); window.removeEventListener('keydown', end, { capture: true }); };
  }, [tour]);

  // The settings drawer closes on Esc or on any click outside it (the ⚙ button toggles it itself).
  useEffect(() => {
    if (!drawer) return;
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setDrawer(false); } };
    const click = (e) => { if (!e.target.closest?.('.drawer, .status')) setDrawer(false); };
    window.addEventListener('keydown', key, { capture: true });
    window.addEventListener('pointerdown', click, { capture: true });
    return () => { window.removeEventListener('keydown', key, { capture: true }); window.removeEventListener('pointerdown', click, { capture: true }); };
  }, [drawer]);

  // Keys: Delete/Backspace removes selection; Space (held) = compare with parent; arrows navigate; Enter/Esc focus/blur prompt.
  useEffect(() => {
    const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const down = (e) => {
      const t = e.target;
      const arrow = ARROWS[e.key];
      const inText = t.closest?.('input,textarea,select');
      if (inText && !(arrow && t.tagName === 'TEXTAREA' && !t.value)) { if (e.key === 'Escape') t.blur(); return; }
      if (arrow) { e.preventDefault(); return navigate(arrow); }
      if (e.key === 'Enter') { const ta = document.querySelector('.react-flow__node.selected textarea'); if (ta) { e.preventDefault(); ta.focus(); } return; }
      if (e.code === 'Space') { e.preventDefault(); setCompare(true); }
      if (['Delete', 'Backspace'].includes(e.key)) {
        const ids = rf.getNodes().filter((n) => n.selected && n.type === 'photo').map((n) => n.id);
        if (ids.length) { e.preventDefault(); removeMany(ids); }
      }
    };
    const up = (e) => { if (e.code === 'Space') setCompare(false); };
    const blur = () => setCompare(false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [rf, removeMany, navigate]);

  // Drop or paste an image anywhere → seed; drop a .facefork → import.
  useEffect(() => {
    let depth = 0;
    const enter = (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); depth++; setDropping(true); } };
    const over = (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const leave = () => { if (--depth <= 0) { depth = 0; setDropping(false); } };
    const drop = (e) => { e.preventDefault(); depth = 0; setDropping(false); takeFiles([...e.dataTransfer.files]); };
    const paste = (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.some(isImage)) { e.preventDefault(); takeFiles(files); } };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop); window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop); window.removeEventListener('paste', paste);
    };
  }, [takeFiles]);

  const pickFile = useCallback(() => fileRef.current.click(), []);
  // hq: whether a higher-resolution re-render is on offer, at what tier and rough price.
  const hq = useMemo(() => ({ differs: hqDiffers, res: settings.downloadRes, price: avgCost * 1.5 }), [hqDiffers, settings.downloadRes, avgCost]);
  const openSettings = useCallback(() => setDrawer(true), []);
  const ctx = useMemo(() => ({ selectedCount: selected.length, compare, setCompare, favourites, generate, remove, open, toggleStar, download, rerender, hq, combineHint, pickFile, openSettings, narrow, touch }),
    [selected.length, compare, favourites, generate, remove, open, toggleStar, download, rerender, hq, combineHint, pickFile, openSettings, narrow, touch]);
  const lightboxNode = lightbox ? nodes.find((n) => n.id === lightbox) : null;
  const soloId = selected.length === 1 ? selected[0].id : null;
  useEffect(() => {
    if (!narrow || !soloId) return;
    const n = rf.getNode(soloId);
    if (!n) return;
    const zoom = Math.max(rf.getZoom(), 0.8);
    // Centre the card in the upper part of the screen; the prompt sheet takes the bottom ~40%.
    const box = document.querySelector('.react-flow')?.getBoundingClientRect();
    const lift = box ? (box.height * 0.12) / zoom : 0;
    rf.setCenter(n.position.x + NODE_W / 2, n.position.y + (n.height || 300) / 2 + lift, { zoom, duration: 250 });
  }, [narrow, soloId]); // eslint-disable-line

  // Multi-select composer: cross-seed selections get "swap our outfits" style prompts.
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const crossSeed = selected.length > 1 && new Set(selected.map((n) => rootOf(byId, n.id))).size > 1;

  return (
    <Ctx.Provider value={ctx}>
      <ReactFlow
        nodes={shown}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={(_, n) => {
          if (n.type === 'plate') plateDrag.current = { origin: { ...n.position }, starts: new Map(rf.getNodes().filter((x) => n.data.members.includes(x.id)).map((x) => [x.id, { ...x.position }])) };
        }}
        onNodeDrag={(_, n) => {
          if (n.type === 'plate' && plateDrag.current) {
            // Move every member by the plate's displacement from where the drag began; the plate itself is re-derived from them.
            const { origin, starts } = plateDrag.current;
            const dx = n.position.x - origin.x, dy = n.position.y - origin.y;
            setNodes((ns) => ns.map((x) => (starts.has(x.id) ? { ...x, position: { x: starts.get(x.id).x + dx, y: starts.get(x.id).y + dy } } : x)));
            return;
          }
          if (n.type !== 'photo') return;
          const id = dropHit(n)?.id || null;
          if (id !== dropTarget) { setDropTarget(id); rf.setNodes((ns) => ns.map((x) => ({ ...x, className: x.id === id ? 'target' : (x.className || '').replace('target', '').trim() }))); }
        }}
        onNodeDragStop={(_, n) => {
          if (n.type === 'plate') { plateDrag.current = null; return; }
          if (n.type === 'filmstrip') rf.updateNodeData(n.id, { pinned: true });
          if (n.type !== 'photo') return;
          const b = dropTarget || dropHit(n)?.id;
          setDropTarget(null);
          // Dropped on another card: snap back into the layout and open the composer with both selected.
          if (b) setGraph((cur) => cur.map((x) => ({ ...x, className: '', selected: x.id === n.id || x.id === b })));
        }}
        nodesConnectable={false}
        nodesDraggable={!touch}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        selectionKeyCode="Shift"
        minZoom={0.05}
        maxZoom={4}
        defaultEdgeOptions={{ type: 'prompt' }}
        colorMode={settings.theme}
        fitView
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        {showMap && <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'photo' ? '#3b82f6' : 'transparent')} nodeStrokeWidth={0} />}
        <Panel position="bottom-left" className="credit">
          <span>Made by <a href="https://aravindh.net" target="_blank" rel="noreferrer">Aravindh</a> with</span>
          <a href="https://claude.ai" target="_blank" rel="noreferrer" title="Claude" aria-label="Claude">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#d97757" aria-hidden="true"><path d="M12 2.2l1.2 5.6 4.1-4 -2.6 5.1 5.6-.7-5 2.8 5 2.8-5.6-.7 2.6 5.1-4.1-4L12 21.8l-1.2-5.6-4.1 4 2.6-5.1-5.6.7 5-2.8-5-2.8 5.6.7-2.6-5.1 4.1 4z" /></svg>
          </a>
          <i />
          <span>Code</span>
          <a href="https://github.com/aravindhsampath/facefork" target="_blank" rel="noreferrer" title="Source on GitHub" aria-label="Source on GitHub">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
          </a>
        </Panel>
        <Panel position="bottom-right" className="maptoggle">
          <button onClick={() => setShowMap((v) => { localStorage.setItem(MAP_KEY, v ? '0' : '1'); return !v; })} title={showMap ? 'Hide the minimap' : 'Show the minimap'}>{showMap ? '▭ hide map' : '▭ map'}</button>
        </Panel>
        <Panel position="top-left" className="top">
          <div className="brand">
            <b>
              <svg className="mark" width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#3b82f6" /><path d="M32 22v8M32 30Q32 40 20 44M32 30Q32 40 44 44" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" /><circle cx="32" cy="16" r="7.5" fill="#fff" /><circle cx="18" cy="49" r="7" fill="#fff" /><circle cx="46" cy="49" r="7" fill="#fff" /></svg>
              <span>face<em>fork</em></span>
            </b>
            <span>Upload a photo, ask “what if…”, every answer becomes a branch.</span>
          </div>
          <div className="toolbar">
            <button onClick={() => fileRef.current.click()} title={photosOf(nodes).length ? 'Add another person to compare or combine' : 'Upload a photo — or drop / paste one anywhere'}>＋ New photo</button>
            <button onClick={() => { setGraph((cur) => cur); setTimeout(() => fitAll(), 30); }} title="Lay the tree out neatly again">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="5" y="1" width="4" height="3" rx=".8" /><rect x="1" y="10" width="4" height="3" rx=".8" /><rect x="9" y="10" width="4" height="3" rx=".8" /><path d="M7 4v3M7 7H3v3M7 7h4v3" /></svg>
              Auto-arrange
            </button>
            <button className={edits.length ? 'share' : ''} disabled={!photosOf(nodes).some((n) => n.data.status === 'ready')} onClick={() => setShareOpen(true)} title="Turn this tree into something you can post">✦ Share</button>
          </div>
        </Panel>
        <Panel position="top-right">
          <button className={`status${settings.key ? '' : ' nokey'}`} onClick={() => setDrawer((d) => !d)} title="Settings — key, model, quality, theme">
            <i />
            <span>{settings.key ? (model?.name || settings.model || 'model').replace(/^[^:]+:\s*/, '').replace(/\s*\(.*\)$/, '') : 'Add your OpenRouter key'}</span>
            {settings.key && total > 0 && <em title="from OpenRouter’s usage report">${total.toFixed(2)}</em>}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
          </button>
        </Panel>
        {!nodes.length && (
          <div className="empty">
            <div className="drop-zone" onClick={() => fileRef.current.click()}>
              <p>Drop a photo, paste one, or <button onClick={(e) => { e.stopPropagation(); fileRef.current.click(); }}>＋</button></p>
              <small>A face works best. It never leaves this browser until you ask for an edit.</small>
            </div>
            <button className="link" onClick={loadDemo}>Bring the demo back</button>
          </div>
        )}
        {tour && <Tour nodes={nodes} />}
        {keyGate && (
          <Panel position="bottom-center" className="keygate">
            <KeyGate savedKey={settings.key} onSave={saveKeyAndGo} onCancel={() => { setDraft(keyGate.prompt); setKeyGate(null); }} />
          </Panel>
        )}
        {narrow && !keyGate && selected.length === 1 && selected[0].data.status === 'ready' && (
          <Panel position="bottom-center" className="composer sheet">
            <div className="thumbs"><img src={selected[0].data.url} alt="" /></div>
            <PromptBox key={selected[0].id} autoFocus={false} initial={draft} chips={chipsFor(selected[0].id)} onSubmit={(t) => generate([selected[0].id], t)} />
          </Panel>
        )}
        {selected.length > 1 && !keyGate && (
          <Panel position="bottom-center" className="composer">
            {crossSeed ? (
              <div className="pair" title="Photos of different people — ask for something that involves both">
                {[...new Map(selected.map((n) => [rootOf(byId, n.id), n])).values()].slice(0, 2).map((n, i) => (
                  <span key={n.id}>{i > 0 && <b>⇄</b>}<img src={n.data.url} alt="" /></span>
                ))}
                <em>{new Set(selected.map((n) => rootOf(byId, n.id))).size} people</em>
              </div>
            ) : (
              <div className="thumbs">{selected.map((n) => <img key={n.id} src={n.data.url} alt="" />)}</div>
            )}
            <PromptBox
              initial={draft}
              chips={crossSeed ? CROSS_SEED : SAME_SEED}
              placeholder={crossSeed ? 'Swap our outfits' : `Combine these ${selected.length} photos… e.g. "Give me the fedora AND the mustache"`}
              onSubmit={(t) => generate(selected.map((n) => n.id), t)}
            />
          </Panel>
        )}
        <div className={`toasts${selected.length > 1 || keyGate ? ' lifted' : ''}`}>
          {notes.map((n) => (
            <div key={n.id} className={`pill ${n.kind}`}>
              <i>{n.kind === 'ok' ? '✓' : n.kind === 'error' ? '✕' : 'ℹ'}</i>
              <span>{n.text}</span>
              {n.action && <button onClick={() => n.action.run()}>{n.action.label}</button>}
              <button className="dis" onClick={() => dismiss(n.id)} title="Dismiss">×</button>
            </div>
          ))}
        </div>
      </ReactFlow>
      {dropping && <div className="drop">Drop to add a seed (or import a .facefork)</div>}
      <input ref={fileRef} type="file" accept="image/*,.facefork,.howdoilook" multiple hidden onChange={(e) => { takeFiles([...e.target.files]); e.target.value = ''; }} />
      <Settings open={drawer} settings={settings} onChange={updateSettings} onClose={() => setDrawer(false)}
        onExport={exportAll} onImport={() => fileRef.current.click()} onDemo={loadDemo} onClearDemo={demoIds.length ? clearDemo : null} narrow={narrow}
        hq={{ pending: hqPending, estimate: hqPending * avgCost * 1.5, differs: hqDiffers, run: reprocessAll }} />
      <Lightbox node={lightboxNode} onClose={() => setLightbox(null)} />
      <ShareDialog open={shareOpen} nodes={nodes} focusId={selected[0]?.id} model={settings.model}
        onClose={() => setShareOpen(false)} onToast={flash} />
    </Ctx.Provider>
  );
}

// Asked at the moment of intent: keeps the prompt, takes the key, continues.
function KeyGate({ savedKey, onSave, onCancel }) {
  const [key, setKey] = useState('');
  const ok = /^sk-or-/.test(key.trim()) || key.trim().length > 20;
  return (
    <div className="keygate-card">
      <p><b>One thing first.</b> Edits run on your own OpenRouter key — about $0.02–0.10 per image. The key goes straight to OpenRouter and nowhere else; a dedicated key with a spending limit is a good idea.</p>
      <div className="row">
        {savedKey
          ? <button className="go" autoFocus onClick={() => onSave(savedKey)}>Key saved — Generate</button>
          : <>
            <input type="password" autoFocus placeholder="sk-or-v1-…" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) onSave(key.trim()); if (e.key === 'Escape') onCancel(); }} />
            <button className="go" disabled={!ok} onClick={() => onSave(key.trim())}>Save & generate</button>
          </>}
        <button onClick={onCancel} title="Keep the prompt, skip for now">Not now</button>
      </div>
      <small><a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">Get a key ↗</a> · also under ⚙ Settings</small>
    </div>
  );
}
