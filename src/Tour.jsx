import { ViewportPortal } from '@xyflow/react';
import { NODE_W, FILM_W } from './layout.js';

// First-visit spotlight: three faded callouts pinned to demo nodes in canvas space, so they pan
// and zoom with the tree. Dismissed by the first click or key anywhere (see App).
export default function Tour({ nodes }) {
  const photos = nodes.filter((n) => n.type === 'photo');
  const seed = photos.find((n) => !n.data.parents.length && n.data.name === 'Sam') || photos.find((n) => !n.data.parents.length);
  const branch = photos.find((n) => /short beard too/i.test(n.data.prompt)) || photos.find((n) => /passport/i.test(n.data.prompt));
  const film = nodes.find((n) => n.type === 'filmstrip');
  const items = [
    seed && { key: 'ask', x: seed.position.x + NODE_W / 2, y: seed.position.y - 78, side: 'bottom', text: 'Click any photo and type a what-if' },
    branch && { key: 'branch', x: branch.position.x + NODE_W + 16, y: branch.position.y + 28, side: 'left', text: 'This one grew from the one above — every answer becomes a branch' },
    film && { key: 'star', x: film.position.x + FILM_W / 2, y: film.position.y + (film.measured?.height ?? 320) + 18, side: 'top', text: '⭐ on any photo builds this filmstrip' },
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <ViewportPortal>
      {items.map((c, i) => (
        <div key={c.key} className={`callout ${c.side}`} style={{ transform: `translate(${c.x}px, ${c.y}px)`, animationDelay: `${0.25 + i * 0.35}s` }}>
          <i />
          <span>{c.text}</span>
        </div>
      ))}
    </ViewportPortal>
  );
}
