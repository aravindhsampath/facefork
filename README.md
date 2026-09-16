# facefork

Upload a photo, ask “what if…”, every answer becomes a branch.

An infinite canvas for playing with your own face: each prompt (“what if I had a beard?”) grows a
new node under the photo you asked it of. Select two photos — even of different people — and
combine them. Star the keepers, compare any node with its parent, export the tree, or turn it into
something postable (before/after, polaroid, magazine cover, a looping clip, …).

Everything runs in your browser. Images go straight from your machine to the model on
**your own [OpenRouter](https://openrouter.ai) key** — nothing is uploaded to us, and there is
no backend at all.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Paste an OpenRouter key when the app asks (or under ⚙). Pick any image-editing model OpenRouter
offers; the default is Nano Banana 2 at about $0.07 per image.

## How it is built

- React + [React Flow](https://reactflow.dev) for the canvas, dagre for layout, Vite to build.
- Generation through OpenRouter’s image API, called directly from the browser.
- Your tree lives in IndexedDB; `⇩ Export` writes a `.facefork` file (zip of JPEGs + graph).
- Share formats are rendered on a canvas in the browser; clips are encoded with WebCodecs.
- Fully static: `npm run build` → `dist/`, deployable to any static host (it runs on
  Cloudflare Workers static assets; see `wrangler.jsonc`).

The bundled demo tree was generated once with `make demo` (needs `OPEN_ROUTER_KEY` in `.env`);
“Sam” is an AI-generated portrait, the other sitter is Leonardo’s.

## License

[0BSD](LICENSE) — do whatever you want with it; no attribution required. The demo portrait of
“Sam” is AI-generated; the Mona Lisa is public domain.
