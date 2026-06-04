import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const studioRoot = fileURLToPath(new URL('.', import.meta.url));
const staticRoots = [
  ['/models/', path.join(repoRoot, 'models')],
  ['/lib/', path.join(repoRoot, 'lib')],
  ['/assets/', path.join(repoRoot, 'assets')]
];
const live2DItemRoot = path.join(repoRoot, 'models', 'tsukimi-yachiyo', 'items');
const live2DItemManifestPath = path.join(repoRoot, 'models', 'tsukimi-yachiyo', 'vts-items.local.json');
const itemAssetExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg']);

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
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

function ensureLive2DItemFolders() {
  mkdirSync(live2DItemRoot, { recursive: true });
  mkdirSync(path.dirname(live2DItemManifestPath), { recursive: true });
}

function live2DItemUrl(relativeFile) {
  return `/models/tsukimi-yachiyo/items/${relativeFile.replace(/\\/g, '/')}`;
}

function listLive2DItemFiles(directory = live2DItemRoot, relativeRoot = '') {
  ensureLive2DItemFolders();
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(relativeRoot, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      files.push(...listLive2DItemFiles(absolutePath, relativePath));
      continue;
    }
    if (!entry.isFile() || !itemAssetExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const fileStat = statSync(absolutePath);
    files.push({
      file: relativePath,
      name: path.basename(entry.name, path.extname(entry.name)),
      url: live2DItemUrl(relativePath),
      sizeBytes: fileStat.size,
      updatedAt: fileStat.mtimeMs
    });
  }
  return files.sort((left, right) => left.file.localeCompare(right.file));
}

function readLive2DItemManifest() {
  ensureLive2DItemFolders();
  if (!existsSync(live2DItemManifestPath)) return { Version: 1, BasePath: 'items', Items: [] };
  try {
    return JSON.parse(readFileSync(live2DItemManifestPath, 'utf8'));
  } catch (_) {
    return { Version: 1, BasePath: 'items', Items: [] };
  }
}

function writeJsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', String(Buffer.byteLength(body)));
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > 40 * 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function safeLive2DItemFileName(fileName) {
  const baseName = path.basename(String(fileName || 'item.png')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  const extension = path.extname(baseName).toLowerCase();
  if (!itemAssetExtensions.has(extension)) throw new Error('Unsupported item file type.');
  return baseName || `item-${Date.now()}${extension || '.png'}`;
}

function decodeImportBase64(value) {
  const text = String(value || '').replace(/^data:[^,]+,/i, '');
  return Buffer.from(text, 'base64');
}

function repoStaticAssetPlugin() {
  return {
    name: 'yachiyo-repo-static-assets',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const method = String(request.method || 'GET').toUpperCase();
        const requestPath = decodeURIComponent(String(request.url || '').split('?')[0]);

        if ((method === 'GET' || method === 'HEAD') && requestPath === '/api/live2d/items') {
          ensureLive2DItemFolders();
          const payload = {
            success: true,
            itemDirectory: live2DItemRoot,
            manifestPath: live2DItemManifestPath,
            files: listLive2DItemFiles(),
            manifest: readLive2DItemManifest()
          };
          writeJsonResponse(response, 200, payload);
          return;
        }

        if (method === 'POST' && requestPath === '/api/live2d/items/manifest') {
          try {
            const payload = await readRequestJson(request);
            const manifest = {
              Version: Number(payload.Version || payload.version || 1),
              BasePath: 'items',
              Items: Array.isArray(payload.Items) ? payload.Items : Array.isArray(payload.items) ? payload.items : []
            };
            ensureLive2DItemFolders();
            writeFileSync(live2DItemManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
            writeJsonResponse(response, 200, { success: true, manifest });
          } catch (error) {
            writeJsonResponse(response, 400, { success: false, message: error.message || 'Unable to save item manifest.' });
          }
          return;
        }

        if (method === 'POST' && requestPath === '/api/live2d/items/import') {
          try {
            const payload = await readRequestJson(request);
            const inputFiles = Array.isArray(payload.files) ? payload.files : [];
            ensureLive2DItemFolders();
            const files = [];
            for (const inputFile of inputFiles) {
              const fileName = safeLive2DItemFileName(inputFile.name || inputFile.fileName);
              const bytes = decodeImportBase64(inputFile.dataBase64 || inputFile.base64 || inputFile.data);
              if (!bytes.length) continue;
              writeFileSync(path.join(live2DItemRoot, fileName), bytes);
              const fileStat = statSync(path.join(live2DItemRoot, fileName));
              files.push({
                file: fileName,
                name: path.basename(fileName, path.extname(fileName)),
                url: live2DItemUrl(fileName),
                sizeBytes: fileStat.size,
                updatedAt: fileStat.mtimeMs
              });
            }
            writeJsonResponse(response, 200, { success: true, files, allFiles: listLive2DItemFiles() });
          } catch (error) {
            writeJsonResponse(response, 400, { success: false, message: error.message || 'Unable to import item files.' });
          }
          return;
        }

        if (method !== 'GET' && method !== 'HEAD') {
          next();
          return;
        }

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

