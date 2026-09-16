import { useContext, useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Ctx } from './ctx.js';

const short = (s, n = 22) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export default function Lightbox({ node, onClose }) {
  const ref = useRef(null);
  const rf = useReactFlow();
  const { compare, setCompare, download } = useContext(Ctx);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (node && !d.open) d.showModal();
    else if (!node && d.open) d.close();
  }, [node]);
  const parentNode = node && node.data.parents[0] ? rf.getNode(node.data.parents[0]) : null;
  const parent = compare && parentNode ? parentNode.data : null;
  const shown = parent || node?.data;
  const src = shown && (shown.hqUrl || shown.url);
  // Seed › … › this image, following first parents.
  const trail = [];
  for (let n = node; n; n = rf.getNode(n.data.parents[0])) trail.unshift(n.data.parents.length ? n.data.prompt : (n.data.name || 'seed'));
  const hold = { onPointerDown: (e) => { e.preventDefault(); setCompare(true); }, onPointerUp: () => setCompare(false), onPointerLeave: () => setCompare(false), onPointerCancel: () => setCompare(false) };
  return (
    <dialog ref={ref} className="lightbox" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {node && (
        <figure>
          <nav className="crumbs" title={trail.join(' › ')}>{trail.map((t, i) => <span key={i} className={i === trail.length - 1 ? 'here' : ''}>{short(t)}</span>)}</nav>
          <img src={src} alt="" />
          {parent && <div className="lb-badge">before</div>}
          <figcaption>
            <span>{node.data.parents.length ? node.data.prompt : (node.data.name || 'seed')}{node.data.hqUrl ? ' · HQ' : ''}</span>
            {parentNode && <button className="hold" {...hold} title="Press and hold (or hold Space) to see the photo this was made from">👁 Hold to compare</button>}
            <button disabled={busy} onClick={async () => { setBusy(true); try { await download(node.id); } finally { setBusy(false); } }}>
              {busy ? 'Rendering HQ…' : '⬇ Download'}
            </button>
            <button onClick={onClose} title="Close (Esc)">✕</button>
          </figcaption>
          <small className="lb-hint">← → siblings · ↑ parent · ↓ child</small>
        </figure>
      )}
    </dialog>
  );
}
