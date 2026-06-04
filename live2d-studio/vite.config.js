import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const studioRoot = fileURLToPath(new URL('.', import.meta.url));
const staticRoots = [
  ['/models/', path.join(repoRoot, 'models')],
  ['/lib/', path.join(repoRoot, 'lib')],
  ['/assets/', path.join(repoRoot, 'assets')]
];

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.moc3':
    case '.bin':
      return 'application/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

function repoStaticAssetPlugin() {
  return {
    name: 'yachiyo-repo-static-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const method = String(request.method || 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
          next();
          return;
        }

        const requestPath = decodeURIComponent(String(request.url || '').split('?')[0]);
        const match = staticRoots.find(([prefix]) => requestPath.startsWith(prefix));
        if (!match) {
          next();
          return;
        }

        const [prefix, root] = match;
        const relativePath = requestPath.slice(prefix.length).replace(/\//g, path.sep);
        const filePath = path.resolve(root, relativePath);
        const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
        if (!filePath.startsWith(rootWithSeparator)) {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }

        if (!existsSync(filePath)) {
          next();
          return;
        }

        const fileStat = statSync(filePath);
        if (!fileStat.isFile()) {
          next();
          return;
        }

        response.setHeader('Content-Type', contentType(filePath));
        response.setHeader('Content-Length', String(fileStat.size));
        response.setHeader('Cache-Control', 'no-store');
        if (method === 'HEAD') {
          response.end();
          return;
        }
        createReadStream(filePath).pipe(response);
      });
    }
  };
}

export default defineConfig({
  root: studioRoot,
  base: './',
  publicDir: false,
  plugins: [repoStaticAssetPlugin(), vue()],
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

