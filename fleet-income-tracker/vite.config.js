import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
