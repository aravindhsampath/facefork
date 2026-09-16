import { defineConfig } from 'vite';

// Bundles the real src/share renderer into one IIFE that the published gallery inlines.
export default defineConfig({
  build: {
    lib: { entry: 'demo/entry.js', name: 'HDL', formats: ['iife'], fileName: () => 'demo.js' },
    outDir: 'demo/dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
