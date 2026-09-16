import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site-wide headers from public/_headers (the `/*` block), so dev and preview run under the
// same Content-Security-Policy as production and a violation shows up before a deploy does.
function siteHeaders({ dev = false } = {}) {
  const text = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8');
  const block = text.split(/^\/\*\n/m)[1] ?? '';
  const headers = Object.fromEntries(block.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/:\s(.*)/).slice(0, 2)));
  if (dev && headers['Content-Security-Policy']) headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace("connect-src 'self'", "connect-src 'self' ws: wss:"); // HMR socket
  return headers;
}

export default defineConfig({
  plugins: [react()],
  server: { headers: siteHeaders({ dev: true }) },
  preview: { headers: siteHeaders() },
});
