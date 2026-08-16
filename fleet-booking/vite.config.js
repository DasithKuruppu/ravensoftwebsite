import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Stamp the build's id into the service worker.
 *
 * `publicDir` copies sw.js verbatim, so without this every deploy ships a
 * byte-identical worker — and a byte-identical worker is not an update as far
 * as the browser is concerned. It would never activate, never clear the old
 * caches, and the installed app would sit on whatever it first downloaded.
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
        // A missing sw.js means the site simply is not installable; it must not
        // fail the build that produces the working site.
        console.warn('  could not stamp service worker:', err.message);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  // The brand assets live here rather than in a top-level `public/`, so the
  // logo sits beside the code that uses it. Everything in this folder is served
  // from the site root in dev and copied verbatim into dist on build — which is
  // what a favicon needs, since index.html references it by path before any
  // JavaScript has run.
  publicDir: 'src/static',
  server: {
    port: 5174, // 5173 belongs to fleet-income-tracker; both can run at once.
    proxy: {
      '/api': {
        target: process.env.LOCAL_API_URL || 'http://localhost:3002',
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
    include: ['shared/**/*.test.mjs', 'api/**/*.test.mjs', 'src/**/*.test.mjs'],
  },
});
