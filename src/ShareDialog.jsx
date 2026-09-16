import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FORMATS, GROUPS, defaultsFor, resolveOpts, buildTree, REQUIREMENTS, caption, render, toBlob, setWordmark, nodeOr, familyOf } from './share/index.js';
import { downloadBlob } from './image.js';

const SCALES = { '1x': 1, '2x': 2, '3x': 3 };
const IMG_TYPES = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Where people actually post these. None accept an image by URL from a browser, so each button
// copies the image (or downloads the video) and opens the composer with the caption pre-filled.
const PLACES = [
  ['X', (t) => `https://x.com/intent/post?text=${t}`],
  ['Threads', (t) => `https://www.threads.net/intent/post?text=${t}`],
  ['Bluesky', (t) => `https://bsky.app/intent/compose?text=${t}`],
  ['Reddit', (t) => `https://www.reddit.com/submit?title=${t}`],
  ['WhatsApp', (t) => `https://wa.me/?text=${t}`],
  ['Telegram', (t) => `https://t.me/share/url?url=${encodeURIComponent('https://facefork.com')}&text=${t}`],
];
const kb = (b) => (b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const canShareFiles = (file) => { try { return !!navigator.canShare?.({ files: [file] }); } catch { return false; } };
const canEncodeVideo = () => typeof VideoEncoder !== 'undefined';
// ~300 kB of muxer + encoder: only pulled in when someone actually exports motion.
const encoders = () => import('./share/video.js');

export default function ShareDialog({ open, nodes, focusId, model, onClose, onToast }) {
  const ref = useRef(null);
  const preview = useRef(null);
  const [tree, setTree] = useState(null);
  const [subject, setSubject] = useState(focusId);
  const [pick, setPick] = useState('diptych');
  const [allOpts, setAllOpts] = useState(() => Object.fromEntries(FORMATS.map((f) => [f.id, defaultsFor(f)])));
  const [armed, setArmed] = useState(null); // option id waiting for a filmstrip click
  const [imgType, setImgType] = useState('image/jpeg');
  const [scale, setScale] = useState('2x');
  const [vid, setVid] = useState('mp4');
  const [text, setText] = useState('');
  const [textTouched, setTextTouched] = useState(false);
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState(0);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(''); // which button just copied; its label flips to "✓ Copied" for a moment
  const abort = useRef(null);
  const flashCopied = (what) => { setCopied(what); setTimeout(() => setCopied((c) => (c === what ? '' : c)), 1600); };

  const fmt = FORMATS.find((f) => f.id === pick) || FORMATS[0];
  const raw = allOpts[fmt.id] || {};
  const setOpt = (k, v) => setAllOpts((a) => ({ ...a, [fmt.id]: { ...a[fmt.id], [k]: v } }));
  const opts = useMemo(() => (tree ? resolveOpts(fmt, tree, raw) : raw), [tree, fmt, raw]);

  useEffect(() => { const d = ref.current; if (open && !d.open) d.showModal(); else if (!open && d.open) d.close(); }, [open]);
  useEffect(() => { if (open) { setSubject(focusId); setArmed(null); setTextTouched(false); } }, [open, focusId]);

  // Rebuild the bundle whenever the canvas or the chosen subject changes. Bitmaps are cached.
  useEffect(() => {
    if (!open) return;
    let live = true;
    buildTree(nodes, { focusId: subject, model }).then((t) => live && setTree(t));
    return () => { live = false; };
  }, [open, nodes, subject, model]);

  useEffect(() => { setResult(null); }, [pick, JSON.stringify(raw), subject, imgType, scale, vid]);
  useEffect(() => { setArmed(null); }, [pick]);
  // Suggested caption follows the photo until the user edits it.
  useEffect(() => { if (tree && !textTouched) setText(caption(tree, nodeOr(tree, opts.after ?? opts.photo, tree.focus))); }, [tree, opts.after, opts.photo, textTouched]);

  const blocked = tree ? REQUIREMENTS[fmt.needs]?.(tree) || '' : 'Loading…';
  // setWordmark must run before the builders, not in an effect after them, or the preview lags a toggle.
  const scene = useMemo(() => { setWordmark(opts.mark !== false); return tree && fmt.kind === 'still' && !blocked ? fmt.build(tree, opts) : null; }, [tree, fmt, opts, blocked]);
  const spec = useMemo(() => { setWordmark(opts.mark !== false); return tree && fmt.kind === 'motion' && !blocked ? fmt.spec(tree, opts) : null; }, [tree, fmt, opts, blocked]);

  // ---- live preview: stills render once, motion plays the same frame() the encoder will ----
  useEffect(() => {
    const cv = preview.current;
    if (!cv || (!scene && !spec)) return;
    const box = cv.parentElement.getBoundingClientRect();
    const src = scene || spec;
    const s = Math.min((box.width - 24) / src.w, (box.height - 24) / src.h);
    cv.style.width = `${Math.round(src.w * s)}px`;
    cv.style.height = `${Math.round(src.h * s)}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (scene) { render(scene, s * dpr, cv); return; }
    let raf, t0 = performance.now();
    const loop = (now) => {
      const time = ((now - t0) / 1000) % spec.duration;
      render({ w: spec.w, h: spec.h, bg: spec.bg, ops: spec.frame(time) }, s * dpr, cv);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [scene, spec]);

  const produce = useCallback(async () => {
    if (!tree || blocked) return null;
    abort.current = new AbortController();
    const signal = abort.current.signal;
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      setWordmark(opts.mark !== false);
      if (fmt.kind === 'still') {
        setBusy('Rendering…');
        const blob = await toBlob(render(fmt.build(tree, opts), SCALES[scale]), imgType, 0.92);
        return { blob, name: `facefork-${fmt.id}-${stamp}.${EXT[imgType]}` };
      }
      if (fmt.kind === 'motion') {
        const s = fmt.spec(tree, opts);
        setBusy(vid === 'mp4' ? 'Encoding MP4…' : 'Encoding GIF…');
        setProg(0);
        const { encodeMp4, encodeGif } = await encoders();
        const blob = vid === 'mp4'
          ? await encodeMp4(s, { scale: 1, onProgress: setProg, signal })
          : await encodeGif(s, { width: 400, fps: 12, onProgress: setProg, signal });
        return { blob, name: `facefork-${fmt.id}-${stamp}.${vid}` };
      }
      setBusy('Building file…');
      const out = await fmt.make(tree, opts);
      return { blob: out.blob, name: out.name };
    } finally { setBusy(''); setProg(0); abort.current = null; }
  }, [tree, blocked, fmt, opts, imgType, scale, vid]);

  const get = useCallback(async () => {
    const out = result || await produce();
    if (out) setResult(out);
    return out;
  }, [result, produce]);

  // Safari only honours clipboard writes and window.open that happen synchronously inside the
  // click. So: hand ClipboardItem a *promise* of the PNG (allowed by the spec), open the composer
  // before any await, and do the rendering afterwards.
  const pngPromise = useCallback(() => { setWordmark(opts.mark !== false); return toBlob(render(fmt.build(tree, opts), SCALES[scale]), 'image/png'); }, [fmt, tree, opts, scale]);
  const copyImage = useCallback(() => {
    try {
      const item = new ClipboardItem({ 'image/png': pngPromise() });
      return navigator.clipboard.write([item]).then(() => true);
    } catch (e) { return Promise.reject(e); }
  }, [pngPromise]);

  const run = useCallback((what, place) => {
    if (what === 'copy') {
      return copyImage().then(() => { flashCopied('image'); onToast?.('Image copied — paste it anywhere'); }, (e) => onToast?.(`Copy failed: ${e.message}`));
    }
    if (what === 'post') {
      // Composer first, synchronously; then the image onto the clipboard (stills) or as a download (motion / files).
      window.open(place[1](encodeURIComponent(text)), '_blank', 'noopener');
      if (fmt.kind === 'still') return copyImage().then(() => { flashCopied(place[0]); onToast?.(`Image copied — paste it into your ${place[0]} post`, 6000); }, (e) => onToast?.(`Copy failed: ${e.message}`));
      return get().then((out) => { if (out) { downloadBlob(out.blob, out.name); onToast?.(`Downloaded — attach it to your ${place[0]} post`, 6000); } }).catch((e) => { if (e.name !== 'AbortError') onToast?.(`Export failed: ${e.message}`); });
    }
    return (async () => {
      try {
        const out = await get();
        if (!out) return;
        const file = new File([out.blob], out.name, { type: out.blob.type });
        if (what === 'share' && canShareFiles(file)) {
          // Just the image. Captions live in the text box for whoever wants them.
          await navigator.share({ files: [file] }).catch((e) => { if (e.name !== 'AbortError') throw e; });
        } else if (what === 'open') {
          const url = URL.createObjectURL(out.blob);
          window.open(url, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } else {
          downloadBlob(out.blob, out.name);
        }
      } catch (e) {
        if (e.name !== 'AbortError') onToast?.(`Export failed: ${e.message}`);
      }
    })();
  }, [get, copyImage, fmt.kind, text, onToast]);

  const pickOpts = (fmt.options || []).filter((o) => o.type === 'pick');
  const roleOf = (id) => pickOpts.filter((o) => opts[o.id] === id).map((o) => o.label);
  const onFilm = (id) => { if (armed) { setOpt(armed, id); setArmed(null); } else setSubject(id); };

  return (
    <dialog ref={ref} className="sharebox" onClose={onClose} onCancel={() => abort.current?.abort()}>
      <div className="sb-head">
        <h2>Share</h2>
        <div className={`sb-film${armed ? ' armed' : ''}`}>
          {armed && <span className="sb-arm">Click a photo to set <b>{pickOpts.find((o) => o.id === armed)?.label}</b></span>}
          {tree?.nodes.map((n) => {
            const roles = roleOf(n.id);
            return (
              <button key={n.id} className={n.id === subject || (!subject && n.id === tree.focus?.id) ? 'on' : ''} title={n.data.prompt || n.data.name || 'seed'} onClick={() => onFilm(n.id)}>
                <img src={n.data.url} alt="" />
                {roles.length > 0 && <i>{roles.join(' · ')}</i>}
              </button>
            );
          })}
        </div>
        <button className="sb-x" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="sb-body">
        <nav className="sb-list">
          {GROUPS.map((g) => (
            <div key={g}>
              <h3>{g}</h3>
              {FORMATS.filter((f) => f.group === g).map((f) => {
                const why = tree ? REQUIREMENTS[f.needs]?.(tree) : '';
                return (
                  <button key={f.id} className={`sb-item${f.id === pick ? ' on' : ''}${why ? ' off' : ''}`} onClick={() => setPick(f.id)} title={why || f.blurb}>
                    <b>{f.name}</b>
                    <small>{why || f.blurb}</small>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <section className="sb-main">
          <div className="sb-stage">
            {blocked
              ? <p className="sb-empty">{blocked}</p>
              : fmt.kind === 'file'
                ? <FilePreview tree={tree} opts={opts} />
                : <canvas ref={preview} />}
          </div>
          {!blocked && fmt.hint && <p className="sb-note">{fmt.hint}</p>}
          {fmt.kind === 'motion' && !blocked && <p className="sb-note">Playing the real output — {spec?.duration.toFixed(1)}s, {spec?.w}×{spec?.h}, silent by design (add music in the app you post to).</p>}
        </section>

        <aside className="sb-side">
          <h3>Options</h3>
          {(fmt.options || []).map((o) => <Option key={o.id} o={o} value={raw[o.id]} resolved={opts[o.id]} tree={tree} opts={opts} armed={armed === o.id}
            onChange={(v) => setOpt(o.id, v)} onArm={() => setArmed((a) => (a === o.id ? null : o.id))} />)}

          <h3>Output</h3>
          {fmt.kind === 'still' && (
            <>
              <label className="sb-opt"><span>Size</span>
                <select value={scale} onChange={(e) => setScale(e.target.value)}>{Object.keys(SCALES).map((s) => <option key={s} value={s}>{s} · {Math.round((scene?.w || 0) * SCALES[s])}×{Math.round((scene?.h || 0) * SCALES[s])}</option>)}</select>
              </label>
              <label className="sb-opt"><span>File type</span>
                <select value={imgType} onChange={(e) => setImgType(e.target.value)}>{Object.entries(IMG_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
            </>
          )}
          {fmt.kind === 'motion' && (
            <label className="sb-opt"><span>File type</span>
              <select value={vid} onChange={(e) => setVid(e.target.value)}>
                <option value="mp4" disabled={!canEncodeVideo()}>MP4 (Reels / TikTok / X)</option>
                <option value="gif">GIF (posts anywhere, bigger)</option>
              </select>
            </label>
          )}

          <div className="sb-actions">
            <button className="go" disabled={!!blocked || !!busy} onClick={() => run('download')}>{busy || '⬇ Download'}</button>
            {fmt.kind === 'still' && <button className={copied === 'image' ? 'copied' : ''} disabled={!!blocked || !!busy} onClick={() => run('copy')}>{copied === 'image' ? '✓ Copied' : '⧉ Copy image'}</button>}
            {'share' in navigator && <button disabled={!!blocked || !!busy} onClick={() => run('share')} title="Your device’s share sheet — the way into Instagram, TikTok, Messages">⤴ Share…</button>}
            {fmt.id === 'html' && <button disabled={!!busy} onClick={() => run('open')}>↗ Open it</button>}
          </div>
          {busy && prog > 0 && <div className="sb-prog"><i style={{ width: `${prog * 100}%` }} /></div>}
          {result && <p className="sb-size">{result.name} · {kb(result.blob.size)}</p>}

          <label className="sb-opt col"><span>Caption (optional — for you to paste into a post; it is not attached to the image)</span>
            <textarea rows={3} value={text} onChange={(e) => { setText(e.target.value); setTextTouched(true); }} />
          </label>
          <div className="sb-places">
            <span>Post to</span>
            {PLACES.map((p) => <button key={p[0]} className={copied === p[0] ? 'copied' : ''} disabled={!!blocked || !!busy} onClick={() => run('post', p)} title={fmt.kind === 'still' ? `Copies the image, opens ${p[0]} with the caption — paste the image in` : `Downloads the file, opens ${p[0]} with the caption — attach the file`}>{copied === p[0] ? '✓ Copied' : p[0]}</button>)}
            <button className={copied === 'caption' ? 'copied' : ''} onClick={() => { navigator.clipboard.writeText(text).then(() => { flashCopied('caption'); onToast?.('Caption copied'); }, (e) => onToast?.(`Copy failed: ${e.message}`)); }} title="Copy the caption text to paste into a post">{copied === 'caption' ? '✓ Copied' : '⧉ Copy caption'}</button>
          </div>
          <p className="sb-fine">Instagram and TikTok only accept uploads from the phone — use ⤴ Share… there. Everything is made in this browser; nothing is uploaded until you post it.</p>
        </aside>
      </div>
    </dialog>
  );
}

// One option row. `value` is what the user set (undefined = untouched), `resolved` is what the builder sees.
function Option({ o, value, resolved, tree, opts, armed, onChange, onArm }) {
  if (o.type === 'pick') {
    const node = tree && nodeOr(tree, resolved, null);
    return (
      <div className={`sb-opt sb-pick${armed ? ' armed' : ''}`}>
        <span>{o.label}</span>
        <button onClick={onArm} title={armed ? 'Now click a photo in the filmstrip' : `Change ${o.label.toLowerCase()}: click here, then a photo in the filmstrip`}>
          {node ? <img src={node.data.url} alt="" /> : <i>—</i>}
          <small>{armed ? 'pick above ↑' : 'change'}</small>
        </button>
      </div>
    );
  }
  if (o.type === 'bool') return <label className="sb-opt"><span>{o.label}</span><input type="checkbox" checked={resolved !== false && !!resolved} onChange={(e) => onChange(e.target.checked)} /></label>;
  if (o.type === 'select') {
    return (
      <label className="sb-opt"><span>{o.label}</span>
        <select value={String(resolved)} onChange={(e) => onChange(typeof o.def === 'number' ? Number(e.target.value) : e.target.value)}>
          {o.choices.map((c) => <option key={c} value={String(c)}>{o.labels?.[c] ?? c}</option>)}
        </select>
      </label>
    );
  }
  // text / textarea: empty hides it; untouched (undefined) means "auto" for options that declare a suggestion.
  const suggestion = tree && o.fill ? o.fill(tree, opts) : '';
  const isAuto = value === undefined && o.def === undefined;
  const Tag = o.type === 'textarea' ? 'textarea' : 'input';
  return (
    <div className={`sb-opt sb-text${o.type === 'textarea' ? ' col' : ''}`}>
      <span>{o.label}{isAuto && <em> auto</em>}</span>
      <div className="row">
        <Tag type="text" rows={4} value={value ?? ''} placeholder={isAuto ? suggestion : suggestion ? `↙ ${suggestion.split('\n')[0]}` : '—'} onChange={(e) => onChange(e.target.value)} />
        {suggestion && value !== suggestion && <button onClick={() => onChange(suggestion)} title="Use the suggestion">↙</button>}
        {value !== undefined && o.def === undefined && <button onClick={() => onChange(undefined)} title="Back to automatic">↺</button>}
        {value && o.def !== undefined && <button onClick={() => onChange('')} title="Clear (hides it)">✕</button>}
      </div>
    </div>
  );
}

// For the html export the honest preview is a description of the file, not a picture of it.
function FilePreview({ tree, opts }) {
  const n = opts.scope === 'all' ? tree.nodes.length : familyOf(tree, nodeOr(tree, opts.photo, tree.focus)).length;
  return (
    <div className="sb-file">
      <h4>{opts.title || 'facefork'}.html</h4>
      <p>{n} images inlined as data URIs, the tree laid out exactly as on the canvas, a slider to compare each edit against its parent. {opts.theme} theme.</p>
      <p>Opens by double-click with no network, no server and no dependencies. Roughly {Math.round((n * (opts.quality || 1000) ** 2) / 9_000_000)} MB.</p>
      <p className="sb-fine">Press “Open it” to see the real thing in a new tab before you send it.</p>
    </div>
  );
}
