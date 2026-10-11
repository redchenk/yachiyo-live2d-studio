import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

export function createMusicAdapter(dataDir, { client } = {}) {
  const cookieFile = path.join(dataDir, 'netease-cookie.txt');
  const streams = new Map();
  const localFiles = new Map();
  let api = client;
  let cookie = fs.existsSync(cookieFile) ? fs.readFileSync(cookieFile, 'utf8') : '';
  const call = async (name, params = {}) => {
    api ||= createRequire(import.meta.url)('@neteasecloudmusicapienhanced/api');
    const result = await api[name]({ ...params, cookie, timestamp: Date.now() });
    return result.body;
  };
  const account = async () => {
    if (!cookie) return { success: true, loggedIn: false, source: 'desktop' };
    const result = await call('login_status');
    const profile = result.data?.profile || result.profile;
    return { success: true, loggedIn: Boolean(profile), source: 'desktop', account: profile ? { userId: String(profile.userId), displayName: profile.nickname, avatarUrl: profile.avatarUrl } : null };
  };
  async function handle(route, input) {
    if (route.endsWith('/local/search')) {
      const roots = String(input.localLibraryPaths || '').split(/[\n;]/).map(x => x.trim()).filter(Boolean);
      const candidates = [];
      const terms = String(input.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      let visited = 0;
      async function walk(dir) {
        for (const item of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
          if (++visited > 20_000 || candidates.length >= Math.min(50, input.limit || 12)) return;
          if (item.name.startsWith('.') || item.isSymbolicLink()) continue;
          const file = path.join(dir, item.name);
          if (item.isDirectory()) { await walk(file); continue; }
          if (!/\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(item.name) || !terms.every(t => item.name.toLowerCase().includes(t))) continue;
          const id = crypto.createHash('sha256').update(file).digest('hex');
          localFiles.set(id, file);
          candidates.push({ id, songId: id, title: path.basename(file, path.extname(file)), artist: '', url: `/api/music/local/file?path=${id}` });
        }
      }
      for (const dir of roots) await walk(path.resolve(dir));
      return { success: true, candidates };
    }
    if (route.endsWith('/managed/status')) return { success: true, managed: true, ready: true, provider: 'netease-cloud' };
    if (route.endsWith('/account')) return account();
    if (route.endsWith('/logout')) {
      cookie = ''; fs.rmSync(cookieFile, { force: true }); return { success: true, loggedIn: false };
    }
    if (route.endsWith('/login/qr/create')) {
      const key = (await call('login_qr_key')).data?.unikey;
      if (!key) throw new Error('NetEase did not return a login key');
      const qr = await call('login_qr_create', { key, qrimg: true });
      return { success: true, key, qrUrl: qr.data?.qrurl, qrImage: qr.data?.qrimg, status: 801 };
    }
    if (route.endsWith('/login/qr/check')) {
      const result = await call('login_qr_check', { key: input.key });
      if (result.code === 803 && result.cookie) { cookie = result.cookie; fs.writeFileSync(cookieFile, cookie, { mode: 0o600 }); }
      return { ...(result.code === 803 ? await account() : { success: true, loggedIn: false }), status: result.code, message: result.message };
    }
    if (route.endsWith('/search')) {
      const result = await call('cloudsearch', { keywords: input.query, limit: Math.min(50, input.limit || 12), type: 1 });
      return { success: true, candidates: (result.result?.songs || []).map(song => ({ songId: String(song.id), title: song.name, artist: (song.ar || song.artists || []).map(x => x.name).join(' / '), album: (song.al || song.album)?.name, artworkUrl: (song.al || song.album)?.picUrl, durationMs: song.dt || song.duration })) };
    }
    if (route.endsWith('/resolve')) {
      const id = String(input.songId || input.candidate?.songId || '');
      if (!/^\d+$/.test(id)) throw new Error('A valid NetEase song ID is required');
      for (const level of [...new Set([input.neteaseQualityLevel || 'exhigh', 'higher', 'standard'])]) {
        const result = await call('song_url_v1', { id, level });
        const track = result.data?.[0];
        const expectedMs = Number(input.candidate?.durationMs) || 0;
        const estimatedMs = Number(track?.br) > 0 ? Number(track?.size) * 8000 / Number(track.br) : 0;
        const truncated = expectedMs >= 60_000 && estimatedMs > 0 && estimatedMs < expectedMs * 0.72;
        const preview = track?.freeTrialInfo != null || (Number(track?.fee) > 0 && !(Number(track?.payed) > 0));
        if (!track?.url || preview || truncated || Number(track.code) < 0) continue;
        if (!/^https?:\/\//i.test(track.url)) throw new Error('Invalid music media URL');
        const token = crypto.randomUUID();
        streams.set(token, { url: track.url, expires: Date.now() + 20 * 60_000 });
        for (const [key, value] of streams) if (value.expires < Date.now()) streams.delete(key);
        return { success: true, candidate: { ...input.candidate, songId: id, url: `/api/music/netease/stream?token=${token}`, qualityLevel: level } };
      }
      throw new Error('当前账号没有可播放的完整音源，请登录网易云或选择其他歌曲。');
    }
    throw Object.assign(new Error('Unknown music route'), { status: 404 });
  }
  return { handle, localFile: id => localFiles.get(id), streamUrl: token => { const item = streams.get(token); return item?.expires > Date.now() ? item.url : null; } };
}
