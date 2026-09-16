// Generates the bundled demo tree once, with a real key, so visitors never need one to see results.
//   node scripts/make-demo.mjs            (reads OPEN_ROUTER_KEY from .env; skips images that already exist)
// Keeps the full-quality masters in scripts/masters/<id>.jpg (source paintings + raw generations,
// never served) and writes what the site serves: src/demo-assets/<id>.webp (≤900px, q80) + tree.json,
// which Vite fingerprints into assets/ at build time.
// Uses the same prompt wrapper and request shape as the app (src/api.js).
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateImage, buildPrompt, pickRatio, listModels } from '../src/api.js';

const MODEL = 'google/gemini-3.1-flash-image';
const OUT = 'src/demo-assets';
const MASTERS = 'scripts/masters';
const EDGE = 900; // served size: the canvas shows cards at ≤ 220px, the lightbox at most ~900px tall
const key = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=').map((s) => s.trim()))).OPEN_ROUTER_KEY;
if (!key) throw new Error('OPEN_ROUTER_KEY missing from .env');

// The plan: one photoreal, AI-generated person with everyday what-ifs (the point of the tool), the
// Mona Lisa with the Duchamp joke (small), one pending invitation, and a single cross-tree merge.
const PLAN = [
  { id: 'sam', name: 'Sam', ratio: '3:4', generate: 'Photorealistic head-and-shoulders portrait photo of a man in his early thirties, short dark hair, clean-shaven, friendly half-smile, plain warm grey studio background, soft window light, 85mm lens, looking straight at the camera' },
  { id: 'mona', file: 'mona-lisa.jpg', name: 'Mona Lisa' },
  { id: 'glasses', parents: ['sam'], prompt: 'What if I had round tortoiseshell glasses?' },
  { id: 'beard', parents: ['sam'], prompt: 'Give me a full beard' },
  { id: 'blonde', parents: ['sam'], prompt: 'What if I went blonde?' },
  { id: 'beanie', parents: ['sam'], prompt: 'A red beanie and a denim jacket' },
  { id: 'glasses-beard', parents: ['glasses'], prompt: 'Now add a short beard too' },
  { id: 'older', parents: ['sam'], prompt: 'Make me 20 years older', status: 'pending' },
  { id: 'mustache', parents: ['mona'], prompt: 'Give me a mustache and a little goatee, like Duchamp did' },
  { id: 'passport', parents: ['mustache'], prompt: 'Now make it a passport photo, neutral background' },
  { id: 'cafe2', parents: ['beanie', 'mona'], prompt: 'Put us in the same photo, at a café in Amsterdam', star: true },
];

const tmp = mkdtempSync(join(tmpdir(), 'hdil-'));
const sips = (...a) => execFileSync('sips', a, { stdio: ['ignore', 'ignore', 'inherit'] });
const dims = (f) => { const o = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', f]).toString(); return { w: +o.match(/pixelWidth: (\d+)/)[1], h: +o.match(/pixelHeight: (\d+)/)[1] }; };
// ≤1024px JPEG data URL — what the app sends as a reference.
const inline = (f) => { const o = join(tmp, `${Math.random().toString(36).slice(2)}.jpg`); sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', '1024', f, '--out', o); return `data:image/jpeg;base64,${readFileSync(o).toString('base64')}`; };

const model = (await listModels()).find((m) => m.id === MODEL);
const previous = existsSync(`${OUT}/tree.json`) ? JSON.parse(readFileSync(`${OUT}/tree.json`, 'utf8')).nodes : [];
const nodes = [];
for (const step of PLAN) {
  const file = step.file ? `${MASTERS}/${step.file}` : `${MASTERS}/${step.id}.jpg`; // master
  const served = `${OUT}/${step.id}.webp`;
  const rec = { id: step.id, name: step.name, prompt: step.prompt || '', parents: step.parents || [], star: !!step.star, status: step.status || 'ready' };
  if (rec.status === 'pending') { nodes.push(rec); continue; }
  if (step.generate && !existsSync(file)) {
    // A seed made from text alone — no reference image, no edit wrapper.
    process.stdout.write(`${step.id}: seed portrait … `);
    const res = await generateImage({ key, model: MODEL, images: [], prompt: step.generate, ratio: step.ratio, resolution: '1K' });
    const raw = join(tmp, `${step.id}.${res.mime.includes('png') ? 'png' : 'jpg'}`);
    writeFileSync(raw, Buffer.from(res.data, 'base64'));
    sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '88', '-Z', '1024', raw, '--out', file);
    process.stdout.write(`$${(res.cost || 0).toFixed(3)}\n`);
  } else if (!step.file && !existsSync(file)) {
    const parents = step.parents.map((p) => nodes.find((n) => n.id === p));
    const people = new Set(parents.map((p) => p.root)).size;
    const seed = Math.floor(Math.random() * 2 ** 31);
    process.stdout.write(`${step.id}: "${step.prompt}" (${parents.length} ref${parents.length > 1 ? 's' : ''}, ${people} people) … `);
    let res;
    try {
      res = await generateImage({
        key, model: MODEL, images: parents.map((p) => inline(p.file)),
        prompt: buildPrompt(step.prompt, parents.length, people),
        ratio: pickRatio(model?.ratios, parents[0].w, parents[0].h), resolution: '1K', seed: model?.seed ? seed : undefined,
      });
    } catch (e) {
      // Ship it as a pending node rather than failing the whole demo; re-run later to fill it in.
      process.stdout.write(`FAILED (${e.message}) — left pending\n`);
      rec.status = 'pending'; nodes.push(rec); continue;
    }
    const raw = join(tmp, `${step.id}.${res.mime.includes('png') ? 'png' : 'jpg'}`);
    writeFileSync(raw, Buffer.from(res.data, 'base64'));
    sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '88', '-Z', '1024', raw, '--out', file);
    rec.cost = res.cost; rec.seed = seed;
    process.stdout.write(`$${(res.cost || 0).toFixed(3)}\n`);
  }
  const prev = previous.find((n) => n.id === step.id);
  if (prev && rec.cost == null) { rec.cost = prev.cost; rec.seed = prev.seed; }
  execFileSync('magick', [file, '-auto-orient', '-resize', `${EDGE}x${EDGE}>`, '-strip', '-quality', '80', '-define', 'webp:method=6', served]);
  Object.assign(rec, dims(served), { image: `${step.id}.webp`, file });
  rec.root = rec.parents.length ? nodes.find((n) => n.id === rec.parents[0]).root : rec.id;
  nodes.push(rec);
}
writeFileSync(`${OUT}/tree.json`, JSON.stringify({ model: MODEL, generated: new Date().toISOString().slice(0, 10), nodes: nodes.map(({ file, root, ...n }) => n) }, null, 1));
process.stdout.write(`wrote ${OUT}/tree.json with ${nodes.length} nodes\n`);
