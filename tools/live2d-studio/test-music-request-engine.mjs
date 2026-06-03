import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    normalizeLive2DMusicCommand
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dMusic.js');
  const {
    DEFAULT_ROOM_MUSIC_SETTINGS,
    normalizeRoomMusicSettings
  } = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');
  const {
    formatLive2DMusicWait,
    parseMusicBlacklist,
    pickLive2DMusicCandidate
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dMusicQueue.js');

  assert.deepEqual(normalizeLive2DMusicCommand({ action: 'song_request', song: 'Cloud 9 Beach Bunny', by: 'viewer-a' }), {
    action: 'request',
    query: 'Cloud 9 Beach Bunny',
    requestedBy: 'viewer-a'
  });
  assert.deepEqual(normalizeLive2DMusicCommand({ action: 'next', query: 'Cloud 9 Beach Bunny' }), {
    action: 'play_next',
    query: 'Cloud 9 Beach Bunny'
  });
  assert.deepEqual(normalizeLive2DMusicCommand({ action: 'clear_queue' }), {
    action: 'clear'
  });
  assert.equal(DEFAULT_ROOM_MUSIC_SETTINGS.provider, 'netease-cloud');
  assert.equal(normalizeRoomMusicSettings({}).provider, 'netease-cloud');
  assert.deepEqual(
    normalizeRoomMusicSettings({
      provider: 'local-library',
      localLibraryPaths: ['E:\\Music', 'D:\\Music'],
      localMaxScanFiles: 500
    }),
    {
      enabled: false,
      provider: 'local-library',
      developerToken: '',
      musicUserToken: '',
      storefront: 'cn',
      autoAuthorize: true,
      neteaseApiUrl: 'http://127.0.0.1:3302',
      neteaseCookie: '',
      neteaseCookiePath: 'C:\\Users\\lenovo\\Desktop\\网易云cookie.txt',
      neteaseQualityLevel: 'exhigh',
      neteaseBitrate: 320000,
      neteaseUnblock: false,
      neteaseUnblockSource: '',
      localLibraryPaths: 'E:\\Music\nD:\\Music',
      localIncludeProjectMusic: true,
      localIncludeUserMusic: true,
      localMaxScanFiles: 500,
      searchLimit: 25,
      smartPick: true,
      maxQueueSize: 30,
      dedupeEnabled: true,
      autoPlayRequests: true,
      filterShortSongs: true,
      minDurationMs: 60000,
      historyLimit: 50,
      blacklist: ''
    }
  );
  assert.deepEqual(
    normalizeRoomMusicSettings({
      provider: 'netease-cloud',
      neteaseApiUrl: 'http://127.0.0.1:3000/',
      neteaseQualityLevel: 'LOSSLESS',
      neteaseBitrate: 9999999,
      neteaseUnblock: true,
      neteaseUnblockSource: 'kugou'
    }),
    {
      enabled: false,
      provider: 'netease-cloud',
      developerToken: '',
      musicUserToken: '',
      storefront: 'cn',
      autoAuthorize: true,
      neteaseApiUrl: 'http://127.0.0.1:3302',
      neteaseCookie: '',
      neteaseCookiePath: 'C:\\Users\\lenovo\\Desktop\\网易云cookie.txt',
      neteaseQualityLevel: 'lossless',
      neteaseBitrate: 999000,
      neteaseUnblock: true,
      neteaseUnblockSource: 'kugou',
      localLibraryPaths: '',
      localIncludeProjectMusic: true,
      localIncludeUserMusic: true,
      localMaxScanFiles: 3000,
      searchLimit: 25,
      smartPick: true,
      maxQueueSize: 30,
      dedupeEnabled: true,
      autoPlayRequests: true,
      filterShortSongs: true,
      minDurationMs: 60000,
      historyLimit: 50,
      blacklist: ''
    }
  );

  const candidates = [
    { songId: 'loose', title: 'Cloud Nine', artist: 'Other Artist', durationMs: 220000 },
    { songId: 'short', title: 'Cloud 9', artist: 'Beach Bunny', durationMs: 42000 },
    { songId: 'exact', title: 'Cloud 9', artist: 'Beach Bunny', durationMs: 185000 },
    { songId: 'live', title: 'Cloud 9 - Live', artist: 'Beach Bunny', durationMs: 205000 }
  ];
  const picked = pickLive2DMusicCandidate('Cloud 9 - Beach Bunny', candidates, {
    smartPick: true,
    filterShortSongs: true,
    minDurationMs: 60000
  });
  assert.equal(picked.candidate.songId, 'exact');

  const blacklisted = pickLive2DMusicCandidate('Cloud 9 Beach Bunny', candidates, {
    blacklist: 'Beach Bunny',
    filterShortSongs: true
  });
  assert.equal(blacklisted.candidate.songId, 'loose');

  const shortOnly = pickLive2DMusicCandidate('Cloud 9 Beach Bunny', [candidates[1]], {
    filterShortSongs: true,
    minDurationMs: 60000
  });
  assert.equal(shortOnly.candidate, null);

  assert.deepEqual(parseMusicBlacklist('live\nremix, cover；demo'), ['live', 'remix', 'cover', 'demo']);
  assert.equal(formatLive2DMusicWait(125000), '2m 05s');
} finally {
  await server.close();
}

console.log('music request engine checks passed');
