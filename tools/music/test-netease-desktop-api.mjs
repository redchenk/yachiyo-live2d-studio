const baseUrl = String(process.argv[2] || 'http://127.0.0.1:3288').replace(/\/+$/g, '');
const musicSettings = {
  neteaseApiUrl: 'http://127.0.0.1:3302',
  neteaseQualityLevel: 'exhigh',
  neteaseBitrate: 320000,
  neteaseUnblock: false
};

async function post(route, body = {}, timeoutMs = 20000) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(`${route} failed (${response.status}): ${data?.message || 'unknown error'}`);
  }
  return { data, ms: Date.now() - startedAt };
}

const status = await post('/api/music/netease/managed/status', musicSettings);
const account = await post('/api/music/netease/account', musicSettings);
const qr = await post('/api/music/netease/login/qr/create', musicSettings);
const search = await post('/api/music/netease/search', {
  ...musicSettings,
  query: '周杰伦 晴天',
  limit: 3
});
const firstSong = search.data?.candidates?.[0];
let resolve = null;
let resolveError = '';

if (firstSong?.songId) {
  try {
    resolve = await post('/api/music/netease/resolve', {
      ...musicSettings,
      candidate: firstSong
    }, 30000);
  } catch (error) {
    resolveError = error?.message || String(error);
  }
}

const serializedAccount = JSON.stringify(account.data);
if (/MUSIC_U=|cookie/i.test(serializedAccount)) {
  throw new Error('Account endpoint exposed Cookie material.');
}
if (status.data?.apiUrl === musicSettings.neteaseApiUrl) {
  throw new Error('Desktop API reused the logical fixed sidecar port.');
}

console.log(JSON.stringify({
  managed: status.data?.managed,
  ready: status.data?.ready,
  ownedApiUrl: status.data?.apiUrl,
  statusMs: status.ms,
  loggedIn: account.data?.loggedIn,
  accountMs: account.ms,
  qrReady: Boolean(qr.data?.qrImage),
  qrMs: qr.ms,
  searchMs: search.ms,
  songCount: search.data?.candidates?.length || 0,
  firstSong: firstSong
    ? {
        songId: firstSong.songId,
        title: firstSong.title,
        artist: firstSong.artist
      }
    : null,
  resolveMs: resolve?.ms || 0,
  playable: Boolean(resolve?.data?.candidate?.url),
  quality: resolve?.data?.candidate?.quality || '',
  resolveError
}, null, 2));
