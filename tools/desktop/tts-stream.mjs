import { randomUUID } from 'node:crypto';
import { json, readJson, requestSignal, streamResponse } from './http.mjs';

// Same-origin streaming keeps Web Audio readable even when GPT-SoVITS has no CORS.
// Only a JSON POST from the local app can mint a short-lived, single-use audio URL.
export function createTtsStreamRelay(fetchImpl = fetch) {
  const pending = new Map();
  return async (req, res, url) => {
    if (!['/api/tts/prepare', '/api/tts/stream'].includes(url.pathname)) return false;
    let cancellation;
    try {
      const origin = url.origin;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
        json(res, 403, { message: 'Local studio origin required' }); return true;
      }
      for (const [key, value] of pending) if (value.expires < Date.now()) pending.delete(key);
      if (url.pathname.endsWith('/prepare') && req.method === 'POST') {
        if (!String(req.headers['content-type']).startsWith('application/json')) { json(res, 415, { message: 'JSON required' }); return true; }
        const input = await readJson(req, 64 * 1024);
        const target = new URL(input.url);
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash ||
            !target.pathname.endsWith('/tts') || !target.searchParams.get('text') || target.href.length > 32000) {
          json(res, 400, { message: 'Invalid GPT-SoVITS audio URL' }); return true;
        }
        if (pending.size >= 32) { json(res, 429, { message: 'Too many prepared speech clips' }); return true; }
        const token = randomUUID();
        pending.set(token, { url: target.href, expires: Date.now() + 90_000 });
        json(res, 200, { url: `/api/tts/stream?token=${token}` }); return true;
      }
      if (url.pathname.endsWith('/stream') && req.method === 'GET') {
        const token = url.searchParams.get('token'), entry = pending.get(token);
        pending.delete(token);
        if (!entry) { json(res, 404, { message: 'Speech URL expired' }); return true; }
        cancellation = requestSignal(req, res, 180_000);
        const upstream = await fetchImpl(entry.url, { signal: cancellation.signal, redirect: 'error' });
        if (!upstream.ok) { json(res, 502, { message: `GPT-SoVITS returned HTTP ${upstream.status}` }); return true; }
        await streamResponse(upstream, res); return true;
      }
      json(res, 405, { message: 'Method not allowed' }); return true;
    } catch (error) {
      if (res.headersSent) res.destroy();
      else json(res, error.status || 502, { message: 'GPT-SoVITS streaming request failed' });
      return true;
    } finally { cancellation?.dispose(); }
  };
}
