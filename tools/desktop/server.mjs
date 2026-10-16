import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { studioAssetPlugin } from './studio-assets.mjs';
import { buildChatRequest, chatReply } from './chat.mjs';
import { json, readJson, requestSignal, serveFile, streamResponse } from './http.mjs';
import { createMusicAdapter } from './music.mjs';
import { createRvcLibrary } from './rvc.mjs';
import { buildTtsRequest, audioBase64 } from './tts.mjs';

export async function startDesktopServer({ resourceRoot, dataDir, services, port = 3289, vision = async () => ({ success: true, enabled: false }), fetchImpl = fetch }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const modelData = path.join(dataDir, 'model');
  const itemRoot = path.join(modelData, 'items');
  if (!fs.existsSync(itemRoot)) {
    const bundled = path.join(resourceRoot, 'models', 'tsukimi-yachiyo', 'items');
    fs.mkdirSync(modelData, { recursive: true });
    if (fs.existsSync(bundled)) fs.cpSync(bundled, itemRoot, { recursive: true });
    else fs.mkdirSync(itemRoot, { recursive: true });
  }
  const manifest = path.join(modelData, 'vts-items.local.json');
  const bundledManifest = path.join(resourceRoot, 'models', 'tsukimi-yachiyo', 'vts-items.local.json');
  if (!fs.existsSync(manifest) && fs.existsSync(bundledManifest)) fs.copyFileSync(bundledManifest, manifest);
  let assets;
  studioAssetPlugin({ repoRoot: resourceRoot, itemRoot }).configureServer({ middlewares: { use(fn) { assets = fn; } } });
  const music = createMusicAdapter(dataDir);
  const rvc = createRvcLibrary(dataDir);
  let origin;
  const server = http.createServer(async (req, res) => {
    let cancellation;
    try {
      // A foreign website must not be able to invoke local files, model APIs or tools.
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
        return json(res, 403, { success: false, message: 'Local studio origin required' });
      }
      const url = new URL(req.url, origin);
      const route = decodeURIComponent(url.pathname);
      if (route === '/healthz') return json(res, 200, { success: true, service: 'yachiyo-desktop', memory: 'embedded-sqlite', platform: process.platform });
      if (await rvc(req, res, url)) return;
      if (route.startsWith('/api/') && req.method !== 'GET' && !String(req.headers['content-type']).startsWith('application/json')) {
        return json(res, 415, { success: false, message: 'JSON is required' });
      }
      if (route.startsWith('/api/live2d/') || route.startsWith('/api/bilibili/') || !route.startsWith('/api/')) {
        let next = false;
        await assets(req, res, () => { next = true; });
        if (!next) return;
      }
      if (req.method === 'GET' && route === '/api/music/local/file') {
        const file = music.localFile(url.searchParams.get('path'));
        if (!file) return json(res, 404, { success: false, message: 'Search the local library before playing this file' });
        return serveFile(req, res, file);
      }
      if (req.method === 'GET' && route === '/api/music/netease/stream') {
        const upstream = music.streamUrl(url.searchParams.get('token'));
        if (!upstream) return json(res, 404, { success: false, message: 'Audio URL expired; resolve the track again' });
        cancellation = requestSignal(req, res, 30 * 60_000);
        return await streamResponse(await fetchImpl(upstream, { headers: req.headers.range ? { Range: req.headers.range } : {}, signal: cancellation.signal }), res);
      }
      if (route.startsWith('/api/') && req.method === 'POST') {
        const input = await readJson(req);
        cancellation = requestSignal(req, res);
        if (route === '/api/chat' || route === '/api/chat/stream') {
          const stream = route.endsWith('/stream');
          const request = buildChatRequest(input, stream);
          const result = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: cancellation.signal });
          if (!result.ok) return json(res, result.status, { success: false, message: `Chat provider returned HTTP ${result.status}` });
          if (stream) return await streamResponse(result, res);
          return json(res, 200, { success: true, data: { reply: chatReply(await result.json()) } });
        }
        if (/^\/api\/memory\//.test(route)) {
          if (/\/(shutdown|managed-milvus\/start)$/.test(route)) return json(res, 400, { success: false, message: 'Desktop memory is built in; no managed Docker service is needed' });
          const base = await services.ensure('memory');
          // Desktop memory always retains vectors and records in its SQLite database.
          const settings = { ...input, provider: 'sqlite', milvusEnabled: false, milvusManaged: false, ...(input.settings ? { settings: { ...input.settings, provider: 'sqlite', milvusEnabled: false, milvusManaged: false } } : {}) };
          return await streamResponse(await fetchImpl(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings), signal: cancellation.signal }), res);
        }
        if (/^\/api\/minecraft\/(status|task|configure|action|disconnect)$/.test(route)) {
          const base = await services.ensure('minecraft');
          return await streamResponse(await fetchImpl(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: cancellation.signal }), res);
        }
        if (route.startsWith('/api/music/')) return json(res, 200, await music.handle(route, input));
        if (route === '/api/vision/context') return json(res, 200, await vision(input));
        if (route === '/api/live-reply/telemetry') return json(res, 200, { success: true });
        if (route === '/api/tts') {
          const request = buildTtsRequest(input);
          const result = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: cancellation.signal });
          if (result.ok && input.provider === 'mimo' && !result.headers.get('content-type')?.startsWith('audio/')) {
            const audio = audioBase64(await result.json());
            res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length });
            return res.end(audio);
          }
          return await streamResponse(result, res);
        }
        if (route === '/api/asr') {
          const endpoint = process.env.YACHIYO_ASR_URL;
          if (!endpoint) return json(res, 503, { success: false, message: '请在 ASR 设置中填写语音识别服务地址，或设置 YACHIYO_ASR_URL。桌面包不包含 Vosk 模型。' });
          return await streamResponse(await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: cancellation.signal }), res);
        }
        return json(res, 404, { success: false, message: 'Unknown API route' });
      }
      if (route.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method)) return json(res, 404, { success: false, message: 'Not found' });
      const dist = path.resolve(resourceRoot, 'dist', 'live2d-studio');
      const relative = route.replace(/^\/live2d-studio\/?/, '').replace(/^\//, '');
      let file = path.resolve(dist, relative || 'index.html');
      if (file !== dist && !file.startsWith(dist + path.sep)) return json(res, 403, { success: false });
      if (!fs.existsSync(file) && !path.extname(relative)) file = path.join(dist, 'index.html');
      return serveFile(req, res, file);
    } catch (error) {
      if (res.headersSent) res.destroy();
      else json(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { success: false, message: error.message || 'Desktop request failed' });
    } finally { cancellation?.dispose(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
