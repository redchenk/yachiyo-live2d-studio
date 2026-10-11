import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function readJson(req, limit = 32 * 1024 * 1024) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw Object.assign(new Error('Request is too large'), { status: 413 });
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
}

export function requestSignal(req, res, timeoutMs = 60_000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  req.once('aborted', abort);
  res.once('close', abort);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); req.off('aborted', abort); res.off('close', abort); }
  };
}

export async function streamResponse(upstream, res) {
  const headers = {};
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    if (key === 'content-length' && upstream.headers.has('content-encoding')) continue;
    if (upstream.headers.has(key)) headers[key] = upstream.headers.get(key);
  }
  res.writeHead(upstream.status, { ...headers, 'Cache-Control': 'no-store' });
  if (!upstream.body) return res.end();
  await pipeline(Readable.fromWeb(upstream.body), res);
}

export function serveFile(req, res, filename) {
  const stat = fs.statSync(filename);
  if (!stat.isFile()) throw Object.assign(new Error('Not found'), { status: 404 });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4' };
  const headers = { 'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  let start = 0, end = stat.size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  res.writeHead(status, { ...headers, 'Content-Length': Math.max(0, end - start + 1) });
  if (req.method === 'HEAD' || stat.size === 0) return res.end();
  const stream = fs.createReadStream(filename, { start, end });
  res.once('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
