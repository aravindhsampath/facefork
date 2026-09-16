import { memo } from 'react';

// Backdrop behind one group of photos. Not selectable; only its label is a drag handle, so
// dragging the empty space inside still pans the canvas, while dragging the label moves the group.
function Plate({ data }) {
  return (
    <div className="plate">
      <span className="plate-handle" title="Drag to move the whole tree">⠿ {data.name} · {data.count} images</span>
    </div>
  );
}

export default memo(Plate);
