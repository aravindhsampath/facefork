import { memo, useContext, useEffect, useState } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Ctx } from './ctx.js';
import PromptBox from './PromptBox.jsx';
import { chipsFor } from './chips.js';
import { NODE_W, imageHeight } from './layout.js';

// Seconds since a generation started, ticking once a second while it runs.
function useElapsed(since, running) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  return since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
}

function PhotoNode({ id, data, selected }) {
  const { selectedCount, compare, generate, remove, open, toggleStar, download, combineHint, narrow, touch } = useContext(Ctx);
  const rf = useReactFlow();
  const ready = data.status === 'ready';
  const loading = data.status === 'loading';
  const elapsed = useElapsed(data.startedAt, loading);
  const stop = (e) => e.stopPropagation();
  // Hold Space on a selected node to see its first parent underneath.
  const parentUrl = compare && selected && data.parents[0] ? rf.getNode(data.parents[0])?.data.url : null;
  const src = parentUrl || data.url;
  const act = (fn) => (e) => { stop(e); fn(); };
  return (
    <div className={`photo ${data.status}${selected ? ' selected' : ''}${data.star ? ' star' : ''}`} style={{ width: NODE_W }}>
      <div className="img" style={{ height: imageHeight(data) }} onDoubleClick={() => ready && open(id)}>
        {src && <img src={src} alt="" draggable={false} className={loading && data.ghost ? 'ghost' : ''} />}
        {loading && <div className="spinner" />}
        {data.status === 'error' && (
          <div className="err" title={data.error}>
            <div>⚠ {data.error}</div>
            <button className="nodrag" onClick={act(() => generate(data.parents, data.prompt, id))}>↻ Retry</button>
          </div>
        )}
        {data.status === 'pending' && (
          <div className="pend">
            <div className="pend-prompt">“{data.prompt}”</div>
            <button className="nodrag" onClick={act(() => generate(data.parents, data.prompt, id))}>▶ Generate</button>
          </div>
        )}
        {parentUrl && <div className="badge">before</div>}
        {data.hqBusy && <div className="badge hq">HQ…</div>}
        <label className="chk nodrag" title="Select several to combine them" onClick={stop}>
          <input type="checkbox" checked={!!selected} onChange={() => rf.updateNode(id, (n) => ({ selected: !n.selected }))} />
        </label>
        <button className="x nodrag" title="Delete" onClick={act(() => remove(id))}>×</button>
        {ready && (
          <div className="acts nodrag">
            <button onClick={act(() => toggleStar(id))}><i>{data.star ? '⭐' : '☆'}</i>favourite</button>
            {data.parents.length > 0 && <button onClick={act(() => generate(data.parents, data.prompt))}><i>🎲</i>again</button>}
            <button onClick={act(() => open(id))}><i>⤢</i>view</button>
            <button onClick={act(() => download(id))}><i>↓</i>download</button>
          </div>
        )}
      </div>
      <div className="foot" title={data.prompt || 'seed'}>
        {loading ? (
          <>
            <span className="gen">generating… {elapsed ? `${elapsed} s` : ''}</span>
            <div className="bar" />
          </>
        ) : (
          <>
            <span>{data.parents.length ? '' : `🌱 ${data.name || 'seed'}`}{data.star ? ' ⭐' : ''}</span>
            {data.cost != null && <em title="Cost so far (incl. HQ)">${data.cost.toFixed(3)}</em>}
          </>
        )}
      </div>
      {!narrow && selected && selectedCount === 1 && ready && (
        <PromptBox chips={chipsFor(id)} onSubmit={(t) => generate([id], t)}
          hint={combineHint ? (touch ? 'Tick ☑ another photo to combine them (even from another person).' : 'Tick ☑ another photo to combine them (even from another person), or drag one onto this card.') : ''} />
      )}
      {!narrow && !selected && ready && <div className="prompt mini"><span>What if…</span><b>➤</b></div>}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(PhotoNode);
