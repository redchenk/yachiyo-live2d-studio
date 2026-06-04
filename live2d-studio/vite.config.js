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

function isModel3File(fileName) {
  return /\.model3\.json$/i.test(fileName);
}

function isVTubeFile(fileName) {
  return /\.vtube\.json$/i.test(fileName);
}

function isLive2DModelPackageFile(fileName) {
  return isModel3File(fileName) || isVTubeFile(fileName) || /\.moc3$/i.test(fileName);
}

function itemNameFromFile(fileName) {
  return path.basename(fileName).replace(/\.(?:model3|vtube)\.json$/i, '').replace(/\.[^.]+$/i, '');
}

function imageSequenceKey(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (!itemAssetExtensions.has(extension)) return null;
  const name = path.basename(fileName, extension);
  const match = name.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return `${match[1]}|${extension}`;
}

function imageSequenceNumber(fileName) {
  const name = path.basename(fileName, path.extname(fileName));
  const match = name.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function describeImageAsset(absolutePath, relativePath) {
  const fileStat = statSync(absolutePath);
  return {
    type: 'image',
    itemType: 'image',
    file: relativePath,
    name: path.basename(absolutePath, path.extname(absolutePath)),
    url: live2DItemUrl(relativePath),
    previewUrl: live2DItemUrl(relativePath),
    sizeBytes: fileStat.size,
    updatedAt: fileStat.mtimeMs
  };
}

function describeImageSequenceAsset(directory, relativeRoot, entries) {
  const first = entries[0];
  const frameFiles = entries.map((entry) => path.join(relativeRoot, entry.name).replace(/\\/g, '/'));
  const firstFrame = frameFiles[0];
  const updatedAt = Math.max(...entries.map((entry) => statSync(path.join(directory, entry.name)).mtimeMs));
  const sizeBytes = entries.reduce((sum, entry) => sum + statSync(path.join(directory, entry.name)).size, 0);
  return {
    type: 'sequence',
    itemType: 'sequence',
    file: firstFrame,
    frames: frameFiles,
    fps: 12,
    name: path.basename(directory) || itemNameFromFile(first.name),
    url: live2DItemUrl(firstFrame),
    previewUrl: live2DItemUrl(firstFrame),
    frameCount: frameFiles.length,
    sizeBytes,
    updatedAt
  };
}

function groupImageSequences(directory, relativeRoot, imageEntries) {
  const grouped = new Map();
  const singles = [];
  for (const entry of imageEntries) {
    const key = imageSequenceKey(entry.name);
    if (!key) {
      singles.push(entry);
      continue;
    }
    const group = grouped.get(key) || [];
    group.push(entry);
    grouped.set(key, group);
  }

  const assets = [];
  const groupedNames = new Set();
  for (const group of grouped.values()) {
    if (group.length < 2) {
      singles.push(...group);
      continue;
    }
    group.sort((left, right) => imageSequenceNumber(left.name) - imageSequenceNumber(right.name) || left.name.localeCompare(right.name));
    group.forEach((entry) => groupedNames.add(entry.name));
    assets.push(describeImageSequenceAsset(directory, relativeRoot, group));
  }

  return {
    assets,
    singles: [...singles, ...imageEntries.filter((entry) => !groupedNames.has(entry.name) && !singles.includes(entry))]
  };
}

function readJsonFileMaybe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function describeLive2DModelAsset(directory, relativeRoot, modelFile, vtubeFile = '') {
  const absoluteModelPath = path.join(directory, modelFile);
  const modelStat = statSync(absoluteModelPath);
  const vtubeJson = vtubeFile ? readJsonFileMaybe(path.join(directory, vtubeFile)) : null;
  const references = vtubeJson?.FileReferences || {};
  const iconFile = typeof references.Icon === 'string' ? references.Icon : '';
  const relativeModelFile = path.join(relativeRoot, modelFile).replace(/\\/g, '/');
  const relativeVTubeFile = vtubeFile ? path.join(relativeRoot, vtubeFile).replace(/\\/g, '/') : '';
  const relativeIconFile = iconFile && existsSync(path.join(directory, iconFile))
    ? path.join(relativeRoot, iconFile).replace(/\\/g, '/')
    : '';
  const name = typeof vtubeJson?.Name === 'string' && vtubeJson.Name.trim()
    ? vtubeJson.Name.trim()
    : itemNameFromFile(modelFile);
  return {
    type: 'live2d',
    itemType: 'live2d',
    file: relativeModelFile,
    modelFile: relativeModelFile,
    vtubeFile: relativeVTubeFile,
    iconFile: relativeIconFile,
    name,
    url: live2DItemUrl(relativeModelFile),
    previewUrl: relativeIconFile ? live2DItemUrl(relativeIconFile) : '',
    sizeBytes: modelStat.size,
    updatedAt: modelStat.mtimeMs
  };
}

function discoverLive2DModelAssets(directory, relativeRoot, entries) {
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const assets = [];
  const modelFiles = new Set(files.filter(isModel3File));

  for (const vtubeFile of files.filter(isVTubeFile)) {
    const vtubeJson = readJsonFileMaybe(path.join(directory, vtubeFile));
    const modelFile = vtubeJson?.FileReferences?.Model;
    if (typeof modelFile !== 'string' || !modelFiles.has(modelFile) || !existsSync(path.join(directory, modelFile))) continue;
    assets.push(describeLive2DModelAsset(directory, relativeRoot, modelFile, vtubeFile));
    modelFiles.delete(modelFile);
  }

  for (const modelFile of modelFiles) {
    assets.push(describeLive2DModelAsset(directory, relativeRoot, modelFile));
  }

  return assets;
}

function listLive2DItemFiles(directory = live2DItemRoot, relativeRoot = '') {
  ensureLive2DItemFolders();
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
  const modelAssets = discoverLive2DModelAssets(directory, relativeRoot, entries);
  if (modelAssets.length) return modelAssets.sort((left, right) => left.file.localeCompare(right.file));

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(relativeRoot, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      files.push(...listLive2DItemFiles(absolutePath, relativePath));
      continue;
    }
    if (!entry.isFile() || !itemAssetExtensions.has(path.extname(entry.name).toLowerCase())) continue;
  }
  const imageEntries = entries.filter((entry) => entry.isFile() && itemAssetExtensions.has(path.extname(entry.name).toLowerCase()));
  const { assets: sequenceAssets, singles } = groupImageSequences(directory, relativeRoot, imageEntries);
  files.push(...sequenceAssets);
  for (const entry of singles) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(relativeRoot, entry.name).replace(/\\/g, '/');
    files.push(describeImageAsset(absolutePath, relativePath));
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
  if (!itemAssetExtensions.has(extension) && !isLive2DModelPackageFile(baseName)) throw new Error('Unsupported item file type.');
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
                type: itemAssetExtensions.has(path.extname(fileName).toLowerCase()) ? 'image' : 'live2d',
                itemType: itemAssetExtensions.has(path.extname(fileName).toLowerCase()) ? 'image' : 'live2d',
                file: fileName,
                modelFile: isModel3File(fileName) ? fileName : '',
                name: path.basename(fileName, path.extname(fileName)),
                url: live2DItemUrl(fileName),
                previewUrl: itemAssetExtensions.has(path.extname(fileName).toLowerCase()) ? live2DItemUrl(fileName) : '',
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

