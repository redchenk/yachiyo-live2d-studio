import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { studioAssetPlugin } from '../tools/desktop/studio-assets.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const studioRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: studioRoot,
  base: './',
  publicDir: false,
  plugins: [studioAssetPlugin({ repoRoot }), vue()],
  resolve: {
    alias: {
      '@frontend': fileURLToPath(new URL('../src/frontend', import.meta.url))
    }
  },
  server: {
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))]
    }
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/live2d-studio', import.meta.url)),
    emptyOutDir: true
  }
});

