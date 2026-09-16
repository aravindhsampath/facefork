import { memo, useContext } from 'react';
import { Ctx } from './ctx.js';

// The "your photo goes here" card, shown beside the demo until the visitor adds a photo of their own.
function Adder() {
  const { pickFile } = useContext(Ctx);
  return (
    <button className="adder nodrag" onClick={pickFile} title="Choose a photo — or drop or paste one anywhere on the canvas">
      <span className="plus">＋</span>
      <b>Add or drop your photo to begin</b>
      <small>or paste one (⌘V)</small>
    </button>
  );
}

export default memo(Adder);
