import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { json, serveFile } from './http.mjs';

const extensions = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a']);
const idPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });

// Only imported copies are served; the API never accepts a filesystem path.
export function createRvcLibrary(dataDir, { maxBytes = 512 * 1024 * 1024 } = {}) {
  const root = path.join(dataDir, 'rvc-songs');
  async function readTrack(id) {
    if (!idPattern.test(id)) throw fail(404, '歌曲不存在');
    const meta = path.join(root, `${id}.json`);
    if ((await fs.lstat(meta)).isSymbolicLink()) throw fail(404, '歌曲不存在');
    const track = JSON.parse(await fs.readFile(meta, 'utf8'));
    if (track.id !== id || !extensions.has(track.extension)) throw fail(404, '歌曲不存在');
    const file = path.join(root, id + track.extension);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw fail(404, '歌曲不存在');
    return { track: { id, name: String(track.name), size: stat.size, importedAt: track.importedAt }, file, meta };
  }
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/rvc/')) return false;
    await fs.mkdir(root, { recursive: true });
    const route = url.pathname;
    if (route === '/api/rvc/tracks' && req.method === 'GET') {
      const tracks = [];
      for (const name of await fs.readdir(root)) {
        if (!name.endsWith('.json')) continue;
        try { tracks.push((await readTrack(name.slice(0, -5))).track); } catch { /* Ignore incomplete imports. */ }
      }
      tracks.sort((a, b) => a.importedAt - b.importedAt || a.name.localeCompare(b.name));
      json(res, 200, { success: true, tracks });
      return true;
    }
    if (route === '/api/rvc/tracks' && req.method === 'POST') {
      if (req.headers['content-type'] !== 'application/octet-stream') throw fail(415, '请以音频文件导入');
      const name = (url.searchParams.get('name') || '').split(/[\\/]/).at(-1).replace(/[\x00-\x1f]/g, '').slice(0, 240);
      const extension = path.extname(name).toLowerCase();
      if (!extensions.has(extension)) throw fail(415, '支持 WAV、MP3、FLAC、OGG 和 M4A');
      if (Number(req.headers['content-length']) > maxBytes) throw fail(413, '单首歌曲不能超过 512 MB');
      const id = randomUUID();
      const file = path.join(root, id + extension);
      const partial = `${file}.part`;
      let size = 0;
      try {
        const handle = await fs.open(partial, 'wx');
        try {
          for await (const chunk of req) {
            size += chunk.length;
            if (size > maxBytes) throw fail(413, '单首歌曲不能超过 512 MB');
            // FileHandle.write is allowed to write fewer bytes than requested.
            let offset = 0;
            while (offset < chunk.length) offset += (await handle.write(chunk, offset)).bytesWritten;
          }
        } finally { await handle.close(); }
        if (!size) throw fail(400, '音频文件为空');
        await fs.rename(partial, file);
        const track = { id, name, extension, size, importedAt: Date.now() };
        await fs.writeFile(path.join(root, `${id}.json`), JSON.stringify(track), { flag: 'wx' });
        json(res, 201, { success: true, track: (await readTrack(id)).track });
      } catch (error) {
        await Promise.allSettled([partial, file, path.join(root, `${id}.json`)].map(item => fs.rm(item, { force: true })));
        throw error;
      }
      return true;
    }
    const match = /^\/api\/rvc\/tracks\/([^/]+)(\/audio)?$/.exec(route);
    if (match && ((match[2] && ['GET', 'HEAD'].includes(req.method)) || (!match[2] && req.method === 'DELETE'))) {
      const { file, meta } = await readTrack(match[1]);
      if (req.method === 'DELETE') {
        await fs.unlink(file);
        await fs.unlink(meta);
        json(res, 200, { success: true });
      } else serveFile(req, res, file);
      return true;
    }
    json(res, 404, { success: false, message: '歌曲接口不存在' });
    return true;
  };
}
