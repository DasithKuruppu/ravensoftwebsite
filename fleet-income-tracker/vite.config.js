import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Stamp the build's id into the service worker.
 *
 * `public/` is copied verbatim, so without this every deploy ships a
 * byte-identical worker — and a byte-identical worker is not an update as far
 * as the browser is concerned. It would never activate, never clear the old
 * caches, and an installed tracker would sit on whatever it first downloaded.
 */
function stampServiceWorker() {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const file = path.resolve('dist/sw.js');
      try {
        const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
        writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_ID__', id));
        console.log(`  service worker stamped ${id}`);
      } catch (err) {
        console.warn('  could not stamp service worker:', err.message);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  server: {
    port: 5173,
    // Dev-only: the SPA calls /api/* and Vite forwards to the local Lambda wrapper.
    // In production VITE_API_URL points straight at the API Gateway HTTP API.
    proxy: {
      '/api': {
        target: process.env.LOCAL_API_URL || 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    // `.test.jsx` too: a couple of assertions are about what a component actually
    // renders — no decimals anywhere in the driver's cash card, for instance —
    // which is not a claim the helpers alone can make. Those render to a string
    // through react-dom/server, so no browser environment is needed.
    include: [
      'shared/**/*.test.mjs',
      'api/**/*.test.mjs',
      'jobs/**/*.test.mjs',
      'src/**/*.test.mjs',
      'src/**/*.test.jsx',
    ],
  },
});
