import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Frontend PoC budowany do dist-web (ładowany przez Tauri). Strona startowa okna: selftest.html.
export default defineConfig({
  root: 'web',
  base: './',
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { index: resolve(__dirname, 'web/index.html'), selftest: resolve(__dirname, 'web/selftest.html'), editor: resolve(__dirname, 'web/editor.html') } },
  },
  server: { fs: { allow: ['.'] } },
  // Testy jednostkowe leżą w test/, a nie w web/ (root Vite).
  test: { root: __dirname, include: ['test/**/*.test.ts'] },
});
