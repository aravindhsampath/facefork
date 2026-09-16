import { useEffect, useState } from 'react';
import { listModels, priceOf, speedOf, RES_TIERS, snapResolution } from './api.js';

export default function Settings({ open, settings, onChange, onClose, onExport, onImport, onDemo, onClearDemo, hq, narrow }) {
  const [status, setStatus] = useState('');
  const [price, setPrice] = useState(null);
  const models = settings.models || [];
  const current = models.find((m) => m.id === settings.model);

  const refresh = async () => {
    setStatus('Fetching models…');
    try {
      const ms = await listModels();
      const patch = { models: ms };
      if (!ms.some((m) => m.id === settings.model)) patch.model = ms.find((m) => /gemini-3.1-flash-image$/.test(m.id))?.id || ms[0]?.id || '';
      onChange(patch);
      setStatus(`${ms.length} image-editing models available`);
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
  };

  useEffect(() => { if (open && !models[0]?.resolutions) refresh(); }, [open]); // stale cache from older versions lacks fields
  // Priced only while the drawer is open: nothing contacts OpenRouter just because the page loaded.
  useEffect(() => { let live = true; setPrice(null); if (open && settings.model) priceOf(settings.model).then((v) => live && setPrice(v)); return () => { live = false; }; }, [open, settings.model]); // eslint-disable-line

  const resSelect = (key) => (
    <select value={settings[key]} onChange={(e) => onChange({ [key]: e.target.value })}>
      {RES_TIERS.map((r) => <option key={r} value={r}>{r}{current?.resolutions?.length ? ` → ${snapResolution(current.resolutions, r)}` : ''}</option>)}
    </select>
  );

  return (
    <aside className={`drawer${open ? ' open' : ''}`} inert={!open} aria-label="Settings">
      <header><h2>Settings</h2><button onClick={onClose}>✕</button></header>
      <h3>Account</h3>
      <label>
        OpenRouter API key
        <input type="password" value={settings.key || ''} placeholder="sk-or-v1-…" onChange={(e) => onChange({ key: e.target.value.trim() })} />
        <small>Kept in this browser, sent only to OpenRouter. A dedicated key with a spending limit is wise. <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">Get a key</a></small>
      </label>
      <label>
        Model
        <div className="row">
          <select value={settings.model || ''} onChange={(e) => onChange({ model: e.target.value })}>
            {!models.length && settings.model && <option value={settings.model}>{settings.model}</option>}
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button onClick={refresh} title="Refresh model list from OpenRouter">↻</button>
        </div>
        <small>
          {current && <><b>{current.name.replace(/^[^:]+:\s*/, '')}</b> · {speedOf(current.name)} · {price == null ? '…' : `≈ $${price.toFixed(3)}/img`}
            {' '}· up to {current.maxRefs} input photo{current.maxRefs > 1 ? 's' : ''}{current.stream ? ' · streams previews' : ''}{current.seed ? ' · repeatable seeds' : ''}
            {' '}<a href={`https://openrouter.ai/${current.id}`} target="_blank" rel="noreferrer">details ↗</a></>}
          {!current && (status || 'Live from OpenRouter — every model that accepts reference images.')}
        </small>
      </label>
      <h3>Quality</h3>
      <div className="row2">
        <label>Explore resolution {resSelect('exploreRes')}</label>
        <label>Download resolution {resSelect('downloadRes')}</label>
      </div>
      <small>Explore cheap. ⬇ Download always saves the image as it is; ↑ re-renders one at download resolution — a fresh generation (same seed where the model supports it), so it may differ. Snapped to what the model offers.</small>
      {hq && (
        <div className="row">
          <button disabled={!hq.differs || !hq.pending} onClick={hq.run} title="Walks the tree seed → leaves, re-rendering each image from its re-rendered parent">
            Re-render every image at {settings.downloadRes}
          </button>
          <small>{!hq.differs ? 'same as explore resolution' : hq.pending ? `${hq.pending} image${hq.pending > 1 ? 's' : ''} · ≈ $${hq.estimate.toFixed(2)}` : 'everything already rendered'}</small>
        </div>
      )}
      <h3>Appearance & data</h3>
      <label>
        Theme
        <div className="seg">
          {['system', 'light', 'dark'].map((t) => (
            <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => onChange({ theme: t })}>{t}</button>
          ))}
        </div>
      </label>
      <label>
        Tree
        <div className="row">
          <button onClick={onExport} title="Save the whole canvas as a .facefork file (zip of JPEGs + graph)">⇩ Export</button>
          <button onClick={onImport} title="Merge a .facefork file into this canvas (or just drop it on the canvas)">⇧ Import</button>
          {onClearDemo
            ? <button onClick={onClearDemo} title="Remove the demo images (and anything grown from them) — undoable">🧹 Clear demo</button>
            : <button onClick={onDemo} title="Add the demo tree">🖼 Demo</button>}
        </div>
      </label>
      <h3>Privacy</h3>
      <small className="privacy">
        Photos stay in this browser until you ask for an edit. Then the prompt and the reference photos go
        straight to OpenRouter and the model provider you picked (<a href="https://openrouter.ai/docs/guides/privacy/provider-logging" target="_blank" rel="noreferrer">their logging policies</a>,
        <a href="https://openrouter.ai/settings/privacy" target="_blank" rel="noreferrer"> your OpenRouter privacy settings</a>). facefork.com’s server only serves
        this page; the browser is told it may not talk to anything but OpenRouter (Content-Security-Policy). Uploads are
        re-encoded, which drops EXIF such as location. Your tree and key live in this browser’s storage: clear the site
        data to remove them, or ⇩ Export first to keep the tree.
      </small>
      {narrow && <p className="drawer-credit">Made by <a href="https://aravindh.net" target="_blank" rel="noreferrer">Aravindh</a> with Claude · <a href="https://github.com/aravindhsampath/facefork" target="_blank" rel="noreferrer">code on GitHub</a></p>}
      <h3>Shortcuts</h3>
      <small className="keys">
        <span><kbd>Enter</kbd> prompt</span><span><kbd>↑↓←→</kbd> walk the tree</span><span><kbd>Space</kbd> hold to compare</span>
        <span><kbd>⌘V</kbd> paste a photo</span><span><kbd>⇧</kbd>+drag box-select</span><span><kbd>⌫</kbd> delete</span>
      </small>
    </aside>
  );
}
