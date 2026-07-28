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
import {
  extractBilibiliWbiKey,
  signBilibiliWbiParams
} from '../tools/live2d-studio/bilibili-wbi.mjs';

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

function bilibiliRequestHeaders(roomId, cookie = '') {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    Referer: `https://live.bilibili.com/${roomId}`,
    Accept: 'application/json, text/plain, */*'
  };
  if (String(cookie || '').trim()) headers.Cookie = String(cookie).trim();
  return headers;
}

async function readBilibiliJson(url, headers) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw new Error(`B站返回了无法识别的数据（HTTP ${response.status}）`);
  }
  if (!response.ok || Number(payload?.code || 0) !== 0) {
    const error = new Error(payload?.message || payload?.msg || `B站请求失败（HTTP ${response.status}）`);
    error.bilibiliCode = Number(payload?.code || 0) || 0;
    throw error;
  }
  return payload;
}

function cookieValue(cookie, name) {
  const prefix = `${name}=`;
  const part = String(cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return part ? part.slice(prefix.length) : '';
}

async function resolveBilibiliConnectionInfo(input = {}) {
  const requestedRoomId = Math.round(Number(input.roomId));
  if (!Number.isFinite(requestedRoomId) || requestedRoomId <= 0) {
    throw new Error('请填写有效的 B站直播间 ID');
  }

  const cookie = String(input.cookie || '').trim();
  const headers = bilibiliRequestHeaders(requestedRoomId, cookie);
  const room = await readBilibiliJson(
    `https://api.live.bilibili.com/room/v1/Room/room_init?id=${requestedRoomId}`,
    headers
  );
  const actualRoomId = Math.round(Number(room?.data?.room_id || 0));
  if (!actualRoomId) throw new Error('B站没有返回有效的真实直播间 ID');

  const actualHeaders = bilibiliRequestHeaders(actualRoomId, cookie);
  const authenticatedUid = Number(cookieValue(cookie, 'DedeUserID') || 0) || 0;
  const canAuthenticate = Boolean(authenticatedUid && cookieValue(cookie, 'SESSDATA'));
  let authMode = 'anonymous';
  let authWarning = '';
  let authFailureStage = '';
  let authFailureCode = 0;
  let danmaku = null;
  if (canAuthenticate) {
    let authProbeStage = 'nav';
    try {
      const nav = await readBilibiliJson(
        'https://api.bilibili.com/x/web-interface/nav',
        actualHeaders
      );
      authProbeStage = 'wbi-sign';
      const signedQuery = signBilibiliWbiParams(
        { id: actualRoomId, type: 0 },
        {
          imgKey: extractBilibiliWbiKey(nav?.data?.wbi_img?.img_url),
          subKey: extractBilibiliWbiKey(nav?.data?.wbi_img?.sub_url)
        }
      );
      authProbeStage = 'danmaku-info';
      danmaku = await readBilibiliJson(
        `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${signedQuery}`,
        actualHeaders
      );
      authMode = 'authenticated';
    } catch (error) {
      authFailureStage = authProbeStage;
      authFailureCode = Number(error?.bilibiliCode || 0) || 0;
      authWarning = '登录态已失效或认证接口暂不可用，已自动使用匿名模式；用户名可能被隐藏。';
    }
  } else if (cookie) {
    authWarning = 'Cookie 缺少有效的 SESSDATA 或 DedeUserID，已使用匿名模式；用户名可能被隐藏。';
  }
  if (!danmaku) {
    danmaku = await readBilibiliJson(
      `https://api.live.bilibili.com/room/v1/Danmu/getConf?room_id=${actualRoomId}&platform=pc&player=web`,
      actualHeaders
    );
  }
  const fingerprint = cookieValue(cookie, 'buvid3')
    ? null
    : await readBilibiliJson('https://api.bilibili.com/x/frontend/finger/spi', actualHeaders);
  const connection = danmaku?.data || {};
  const hosts = Array.isArray(connection.host_server_list)
    ? connection.host_server_list
    : Array.isArray(connection.host_list) ? connection.host_list : [];
  const selectedHost = hosts.find((item) => item?.host && Number(item?.wss_port || 0) > 0)
    || hosts.find((item) => item?.host)
    || {};
  const token = String(connection.token || '').trim();
  const host = String(selectedHost.host || connection.host || '').trim();
  if (!token || !host) throw new Error('B站没有返回可用的弹幕服务器或临时 Key');

  return {
    success: true,
    roomId: requestedRoomId,
    actualRoomId,
    liveStatus: Number(room?.data?.live_status || 0) || 0,
    uid: authMode === 'authenticated' ? authenticatedUid : 0,
    token,
    buvid: cookieValue(cookie, 'buvid3') || String(fingerprint?.data?.b_3 || '').trim(),
    host,
    port: Number(selectedHost.wss_port || 443) || 443,
    authMode,
    userNamesComplete: authMode === 'authenticated',
    authWarning,
    authFailureStage,
    authFailureCode
  };
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

        if (method === 'POST' && requestPath === '/api/bilibili/connect-info') {
          try {
            const payload = await readRequestJson(request);
            writeJsonResponse(response, 200, await resolveBilibiliConnectionInfo(payload));
          } catch (error) {
            writeJsonResponse(response, 502, {
              success: false,
              message: error.message || '无法获取 B站弹幕连接信息'
            });
          }
          return;
        }

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

