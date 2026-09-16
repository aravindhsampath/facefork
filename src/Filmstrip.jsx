import { memo, useContext } from 'react';
import { Ctx } from './ctx.js';
import { FILM_W } from './layout.js';

// Favourites as a strip of film; lives on the canvas, draggable, click a frame to open it.
function Filmstrip() {
  const { favourites, open } = useContext(Ctx);
  return (
    <div className="film" style={{ width: FILM_W }}>
      <div className="film-title">★ favourites</div>
      {favourites.map((f) => (
        <div key={f.id} className="frame" title={f.prompt} onClick={() => open(f.id)}>
          <img src={f.url} alt="" draggable={false} />
        </div>
      ))}
    </div>
  );
}

export default memo(Filmstrip);
