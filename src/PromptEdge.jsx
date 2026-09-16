import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow } from '@xyflow/react';

// Smoothstep edge whose label (the prompt) sits just above the child it produced, so fanned-out
// siblings never collide. Hovering the label shows the full prompt and lights up that child.
function PromptEdge({ id, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, style, markerEnd }) {
  const rf = useReactFlow();
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8 });
  const lit = (on) => rf.updateNode(target, (n) => ({ className: on ? 'hi' : (n.className || '').replace('hi', '').trim() }));
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ transform: `translate(-50%, -100%) translate(${targetX}px, ${targetY - 6}px)` }}
            onMouseEnter={() => lit(true)} onMouseLeave={() => lit(false)}>{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(PromptEdge);
