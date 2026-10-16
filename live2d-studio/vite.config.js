import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { studioAssetPlugin } from '../tools/desktop/studio-assets.mjs';
import { createRvcLibrary } from '../tools/desktop/rvc.mjs';
import { studioDataDirectory } from '../tools/runtime/paths.mjs';
import { json } from '../tools/desktop/http.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const studioRoot = fileURLToPath(new URL('.', import.meta.url));
const rvcLibrary = {
  name: 'rvc-song-library',
  configureServer(server) {
    const handle = createRvcLibrary(studioDataDirectory());
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/api/rvc/')) return next();
      try {
        const origin = `http://${req.headers.host}`;
        const url = new URL(req.url, origin);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || (req.headers.origin && req.headers.origin !== origin)) {
          return json(res, 403, { success: false, message: 'Local studio origin required' });
        }
        await handle(req, res, url);
      } catch (error) {
        json(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { success: false, message: error.message });
      }
    });
  }
};

export default defineConfig({
  root: studioRoot,
  base: './',
  publicDir: false,
  plugins: [rvcLibrary, studioAssetPlugin({ repoRoot }), vue()],
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

