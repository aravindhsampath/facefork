// File export that is not a picture: one self-contained interactive page of the tree.

import { toInline } from '../image.js';
import { promptOf, familyOf, nodeOr } from './tree.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// ── 1. One HTML file, no network, opens by double-click, survives email and AirDrop ──
export async function exportHtml(t, o = {}) {
  const px = Number(o.quality || 1000);
  const family = o.scope === 'all' ? t.nodes : familyOf(t, nodeOr(t, o.photo, t.focus));
  const ids = new Set(family.map((n) => n.id));
  const imgs = {};
  await Promise.all(family.map(async (n) => { imgs[n.id] = await toInline(n.data.hqBlob || n.data.blob, px); }));
  const box = t.layout.filter((n) => ids.has(n.id)).reduce((a, n) => ({
    x0: Math.min(a.x0, n.x), y0: Math.min(a.y0, n.y), x1: Math.max(a.x1, n.x + n.w), y1: Math.max(a.y1, n.y + n.h),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const pos = new Map(t.layout.map((n) => [n.id, n]));
  const theme = o.theme || 'system';
  const data = {
    title: o.title || 'facefork',
    subtitle: o.subtitle ?? '',
    w: box.x1 - box.x0 + 80, h: box.y1 - box.y0 + 80,
    cost: o.cost ? family.reduce((a, n) => a + (n.data.cost || 0), 0) : null,
    date: o.date === false ? '' : t.date.toISOString().slice(0, 10),
    prompts: o.prompts !== false, mark: o.mark !== false,
    nodes: family.map((n) => {
      const p = pos.get(n.id);
      return {
        id: n.id, prompt: promptOf(n), parents: n.data.parents.filter((x) => pos.has(x)), star: !!n.data.star,
        root: !n.data.parents.length, x: p.x - box.x0 + 40, y: p.y - box.y0 + 40, w: p.w, h: p.h - 12, src: imgs[n.id],
      };
    }),
  };

  const html = `<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(data.title)}</title>
<style>
:root{--bg:#0f1115;--panel:#181b22;--line:#2a2f3a;--fg:#e6e8ee;--dim:#8b93a7;--gold:#f5b301;color-scheme:dark}
[data-theme=light]{--bg:#f3f4f7;--panel:#fff;--line:#d7dbe3;--fg:#171a21;--dim:#626c80;color-scheme:light}
@media(prefers-color-scheme:light){[data-theme=system]{--bg:#f3f4f7;--panel:#fff;--line:#d7dbe3;--fg:#171a21;--dim:#626c80;color-scheme:light}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif;overflow:hidden}
header{position:fixed;inset:0 0 auto 0;z-index:5;display:flex;gap:14px;align-items:baseline;padding:14px 18px;background:linear-gradient(var(--bg),transparent);pointer-events:none}
header b{font-size:16px}header span{color:var(--dim);font-size:13px}
#stage{position:absolute;inset:0;cursor:grab;overflow:hidden}#stage.drag{cursor:grabbing}
#world{position:absolute;transform-origin:0 0}
svg{position:absolute;inset:0;overflow:visible;pointer-events:none}
path{fill:none;stroke:var(--dim);stroke-width:2;opacity:.65}
.n{position:absolute;border:2px solid var(--line);border-radius:10px;background:var(--panel);overflow:hidden;cursor:zoom-in;box-shadow:0 4px 16px rgba(0,0,0,.35)}
.n.star{border-color:var(--gold)}.n img{display:block;width:100%;height:100%;object-fit:cover}
.lab{position:absolute;transform:translate(-50%,-100%);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:11px;max-width:210px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
dialog{border:none;background:transparent;max-width:96vw;max-height:96vh;padding:0}dialog::backdrop{background:rgba(0,0,0,.88)}
figure{margin:0;display:flex;flex-direction:column;gap:10px;align-items:center}
.wrap{position:relative;line-height:0}.wrap img{max-width:92vw;max-height:78vh;border-radius:10px}
.wrap img.top{position:absolute;inset:0;width:100%;height:100%;clip-path:inset(0 calc(100% - var(--p,0%)) 0 0)}
.bar{position:absolute;top:0;bottom:0;left:var(--p,0%);width:2px;background:#fff;box-shadow:0 0 8px rgba(0,0,0,.6);pointer-events:none}
figcaption{display:flex;gap:12px;align-items:center;color:var(--dim);width:100%;max-width:92vw}
figcaption p{flex:1;margin:0;color:var(--fg)}
input[type=range]{width:180px;accent-color:#3b82f6}
button{background:var(--panel);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit}
footer{position:fixed;right:14px;bottom:12px;color:var(--dim);font-size:12px;z-index:5}
</style></head><body>
<header><b>${esc(data.title)}</b><span>${[esc(data.subtitle), `${data.nodes.length} images`, data.cost != null ? `$${data.cost.toFixed(3)}` : '', esc(data.date)].filter(Boolean).join(' · ')}</span></header>
<div id="stage"><div id="world"><svg id="edges"></svg></div></div>
${data.mark ? '<footer>facefork.com</footer>' : ''}
<dialog id="lb"><figure>
  <div class="wrap"><img id="after"><img id="before" class="top"><div class="bar" id="bar"></div></div>
  <figcaption><p id="cap"></p><input type="range" id="sl" min="0" max="100" value="0" title="Wipe back to the parent image"><button id="x">Close</button></figcaption>
</figure></dialog>
<script>
var D=${json(data)};
var world=document.getElementById('world'),stage=document.getElementById('stage'),svg=document.getElementById('edges');
world.style.width=D.w+'px';world.style.height=D.h+'px';
var by={};D.nodes.forEach(function(n){by[n.id]=n});
var d='';D.nodes.forEach(function(n){n.parents.forEach(function(p){var a=by[p];if(!a)return;
 var x1=a.x+a.w/2,y1=a.y+a.h,x2=n.x+n.w/2,y2=n.y,m=(y1+y2)/2;
 d+='<path d="M'+x1+','+y1+' C'+x1+','+m+' '+x2+','+m+' '+x2+','+y2+'"/>'});});
svg.innerHTML=d;
D.nodes.forEach(function(n){
 var e=document.createElement('div');e.className='n'+(n.star?' star':'');
 e.style.cssText='left:'+n.x+'px;top:'+n.y+'px;width:'+n.w+'px;height:'+n.h+'px';
 e.innerHTML='<img src="'+n.src+'" alt="">';e.onclick=function(){show(n)};world.appendChild(e);
 if(!n.root&&D.prompts){var l=document.createElement('div');l.className='lab';l.textContent=n.prompt;
  l.style.cssText='left:'+(n.x+n.w/2)+'px;top:'+(n.y-6)+'px';l.title=n.prompt;world.appendChild(l)}
});
var z=1,ox=0,oy=0;
function apply(){world.style.transform='translate('+ox+'px,'+oy+'px) scale('+z+')'}
(function fit(){var s=Math.min(stage.clientWidth/D.w,stage.clientHeight/D.h)*.88;z=Math.min(s,1);
 ox=(stage.clientWidth-D.w*z)/2;oy=(stage.clientHeight-D.h*z)/2;apply()})();
stage.addEventListener('wheel',function(e){e.preventDefault();var r=stage.getBoundingClientRect(),
 mx=e.clientX-r.left,my=e.clientY-r.top,k=Math.exp(-e.deltaY*.0015),nz=Math.max(.05,Math.min(4,z*k));
 ox=mx-(mx-ox)*(nz/z);oy=my-(my-oy)*(nz/z);z=nz;apply()},{passive:false});
var dx,dy,down=false;
stage.addEventListener('pointerdown',function(e){down=true;dx=e.clientX-ox;dy=e.clientY-oy;stage.classList.add('drag');stage.setPointerCapture(e.pointerId)});
stage.addEventListener('pointermove',function(e){if(!down)return;ox=e.clientX-dx;oy=e.clientY-dy;apply()});
stage.addEventListener('pointerup',function(){down=false;stage.classList.remove('drag')});
var lb=document.getElementById('lb'),sl=document.getElementById('sl'),wrapEl=document.querySelector('.wrap');
function show(n){var p=by[n.parents[0]];
 document.getElementById('after').src=n.src;
 document.getElementById('before').src=p?p.src:n.src;
 document.getElementById('cap').textContent=n.root?(n.prompt||'the original'):n.prompt;
 sl.style.display=p?'':'none';sl.value=0;wrapEl.style.setProperty('--p','0%');
 document.getElementById('bar').style.display='none';
 lb.showModal()}
sl.oninput=function(){wrapEl.style.setProperty('--p',sl.value+'%');
 document.getElementById('bar').style.display=sl.value>0?'':'none'};
document.getElementById('x').onclick=function(){lb.close()};
lb.onclick=function(e){if(e.target===lb)lb.close()};
</script></body></html>`;
  return new Blob([html], { type: 'text/html' });
}

export const FILES = [
  {
    id: 'html', name: 'Interactive Page', group: 'Files', kind: 'file', needs: 'tree',
    blurb: 'One .html file with the tree of the selected seed, every image inlined. Opens offline by double-click; drag the slider to compare.',
    hint: 'Bundling the tree of the highlighted photo’s seed — click another in the filmstrip to change it, or set scope to all.',
    options: [
      { id: 'title', label: 'Title', type: 'text', def: 'facefork' },
      { id: 'subtitle', label: 'Subtitle', type: 'text', def: '' },
      { id: 'scope', label: 'Include', type: 'select', def: 'tree', choices: ['tree', 'all'], labels: { tree: 'this seed’s tree', all: 'every photo on the canvas' } },
      { id: 'theme', label: 'Theme', type: 'select', def: 'system', choices: ['system', 'dark', 'light'] },
      { id: 'quality', label: 'Image size (px)', type: 'select', def: 1000, choices: [700, 1000, 1400] },
      { id: 'prompts', label: 'Prompt captions', type: 'bool', def: true },
      { id: 'date', label: 'Date in header', type: 'bool', def: true },
      { id: 'cost', label: 'Show cost', type: 'bool', def: false },
      { id: 'mark', label: 'facefork.com footer', type: 'bool', def: true },
    ],
    make: async (t, o) => ({ blob: await exportHtml(t, o), name: `${(o.title || 'facefork').replace(/\W+/g, '-').toLowerCase()}.html` }),
  },
];
