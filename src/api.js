// OpenRouter unified Image API — one request shape for every image model.
// https://openrouter.ai/docs/features/multimodal/image-generation
const BASE = 'https://openrouter.ai/api/v1';
const APP_HEADERS = { 'HTTP-Referer': 'https://facefork.com', 'X-Title': 'facefork' };
export const RES_TIERS = ['512', '1K', '2K', '4K'];

// Every failure carries a `kind` the UI can act on: key | credits | rate | request | provider | network | timeout | cancelled.
export class ApiError extends Error {
  constructor(message, kind, status) { super(message); this.kind = kind; this.status = status; }
}
const kindOf = (status) => (status === 401 || status === 403 ? 'key' : status === 402 ? 'credits' : status === 429 ? 'rate' : status >= 500 ? 'provider' : 'request');
async function httpError(r) {
  const body = await r.text().catch(() => '');
  let msg; try { msg = JSON.parse(body).error?.message; } catch { /* not JSON */ }
  return new ApiError(msg || `${r.status} ${body.slice(0, 200)}`.trim(), kindOf(r.status), r.status);
}
// No progress for this long and the request is abandoned; a lost response is not proof the provider did no work.
const STALL_MS = 240_000;

// Public catalog (no key needed). Only models that accept reference images are useful here.
export async function listModels() {
  const r = await fetch(`${BASE}/images/models`);
  if (!r.ok) throw await httpError(r);
  const { data = [] } = await r.json();
  return data
    .filter((m) => m.supported_parameters?.input_references)
    .map((m) => ({
      id: m.id,
      name: m.name,
      created: m.created,
      maxRefs: m.supported_parameters.input_references.max ?? 1,
      ratios: m.supported_parameters.aspect_ratio?.values ?? [],
      resolutions: m.supported_parameters.resolution?.values ?? [],
      seed: !!m.supported_parameters.seed,
      stream: !!m.supports_streaming,
    }))
    .sort((a, b) => b.created - a.created);
}

// Closest supported aspect ratio to w/h, or undefined to let the provider decide.
export function pickRatio(ratios, w, h) {
  if (!ratios?.length) return undefined;
  const target = w / h;
  return ratios
    .map((r) => { const [a, b] = r.split(':').map(Number); return { r, d: Math.abs(Math.log(a / b / target)) }; })
    .sort((x, y) => x.d - y.d)[0].r;
}

// Snap a wanted tier ('512'|'1K'|'2K'|'4K') to what the model supports; undefined if the model has no knob.
export function snapResolution(supported, wanted) {
  if (!supported?.length) return undefined;
  const want = RES_TIERS.indexOf(wanted);
  return supported
    .map((r) => ({ r, d: Math.abs(RES_TIERS.indexOf(r) - want) }))
    .sort((a, b) => a.d - b.d)[0].r;
}

const sniffMime = (b64) => (b64.startsWith('/9j/') ? 'image/jpeg' : b64.startsWith('UklGR') ? 'image/webp' : 'image/png');

// One SSE event's data (lines joined with \n, per the spec) → application event, or null for [DONE]/comments.
// Exported for tests; line endings may be \n or \r\n.
export function parseSSE(text) {
  const events = [];
  let rest = text;
  for (;;) {
    const m = /\r?\n\r?\n/.exec(rest);
    if (!m) break;
    const block = rest.slice(0, m.index);
    rest = rest.slice(m.index + m[0].length);
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (data && data !== '[DONE]') events.push(JSON.parse(data));
  }
  return { events, rest };
}

// images: data URLs. Returns {mime, data(base64), cost}. onPartial(dataUrl) fires for streamed previews.
// `signal` cancels; a request that shows no progress for STALL_MS is abandoned as a timeout.
export async function generateImage({ key, model, images, prompt, ratio, resolution, seed, stream, onPartial, signal }) {
  const ctl = new AbortController();
  let why = null;
  const stop = (kind, message) => { why ??= new ApiError(message, kind); ctl.abort(); };
  const onAbort = () => stop('cancelled', 'Cancelled');
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  let timer;
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => stop('timeout', `No answer from the model for ${STALL_MS / 60_000} minutes`), STALL_MS); };
  kick();
  try {
    let r;
    try {
      r = await fetch(`${BASE}/images`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...APP_HEADERS },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          ...(ratio && { aspect_ratio: ratio }),
          ...(resolution && { resolution }),
          ...(seed != null && { seed }),
          ...(stream && { stream: true }),
          ...(images.length && { input_references: images.map((url) => ({ type: 'image_url', image_url: { url } })) }),
        }),
      });
    } catch (e) {
      throw why || new ApiError(navigator.onLine === false ? 'You appear to be offline' : `Could not reach OpenRouter (${e.message})`, 'network');
    }
    if (!r.ok) throw await httpError(r);

    if (!stream) {
      const out = await r.json().catch(() => { throw why || new ApiError('The reply was cut short', 'network'); });
      const img = out.data?.[0];
      if (!img?.b64_json) throw new ApiError('The model returned no image', 'provider');
      return { mime: img.media_type || sniffMime(img.b64_json), data: img.b64_json, cost: out.usage?.cost };
    }

    // SSE: image_generation.partial_image | image_generation.completed | error, then [DONE]
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let done;
    try {
      for (;;) {
        const { value, done: end } = await reader.read().catch(() => { throw why || new ApiError('The stream was cut short', 'network'); });
        if (end) break;
        kick();
        buf += dec.decode(value, { stream: true });
        const { events, rest } = parseSSE(buf);
        buf = rest;
        for (const ev of events) {
          if (ev.type === 'image_generation.partial_image') onPartial?.(`data:${sniffMime(ev.b64_json)};base64,${ev.b64_json}`);
          else if (ev.type === 'image_generation.completed') done = { mime: ev.media_type || sniffMime(ev.b64_json), data: ev.b64_json, cost: ev.usage?.cost };
          else if (ev.type === 'error') throw new ApiError(ev.error?.message || 'Generation failed', 'provider');
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    if (!done) throw new ApiError('The stream ended without an image', 'provider');
    return done;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function buildPrompt(userPrompt, n, people = 1) {
  const ref = people > 1
    ? `The ${n} reference photos show ${people} different people.`
    : n > 1
      ? `The ${n} reference photos are all of the same person, possibly with different edits applied.`
      : 'The reference photo is of a person.';
  const keep = people > 1
    ? 'Keep each person\'s face and identity recognisable.'
    : 'Keep their face, identity, pose, lighting and everything else unchanged unless the change requires otherwise.';
  return `${ref} Produce one edited photo that applies the following change: ${userPrompt}. ${keep}`;
}

// Rough price of one ~1K image for a model, from its endpoints' pricing lines. Units differ per
// provider (per image, per megapixel, per output token), so this is an estimate, and cached.
const priceCache = new Map();
export async function priceOf(id) {
  if (priceCache.has(id)) return priceCache.get(id);
  const p = (async () => {
    const r = await fetch(`${BASE}/images/models/${id}/endpoints`);
    if (!r.ok) return null;
    const j = await r.json();
    const eps = j.data?.endpoints || j.endpoints || [];
    const costs = eps.flatMap((e) => (e.pricing || []).filter((x) => x.billable === 'output_image' && !x.variant).map((x) =>
      x.unit === 'image' ? x.cost_usd : x.unit === 'megapixel' ? x.cost_usd * 1.05 : x.unit === 'token' ? x.cost_usd * 1120 : null)).filter((x) => x != null);
    return costs.length ? Math.min(...costs) : null;
  })().catch(() => null);
  priceCache.set(id, p);
  return p;
}
// One-word character from the name: what a newcomer wants to know before the price.
export const speedOf = (name = '') => (/lite|flash|turbo|fast|mini|klein|schnell/i.test(name) ? 'fast' : /pro|max|hd|quality/i.test(name) ? 'top quality' : 'balanced');
