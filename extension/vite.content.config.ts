import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Dedicated self-contained IIFE build for the Chrome MV3 content script
 * so dist/content.js has zero external ES module imports.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@ghostlayer/core': resolve(import.meta.dirname, '../packages/core/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content.ts'),
      name: 'GhostLayerContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
