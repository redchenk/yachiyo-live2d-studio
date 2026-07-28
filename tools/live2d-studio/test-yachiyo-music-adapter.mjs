import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    LIVE2D_PROVIDER_TO_YACHIYO_SOURCE,
    YACHIYO_SOURCE_TO_LIVE2D_PROVIDER,
    candidateToYachiyoTrack,
    createYachiyoMusicAdapter,
    installYachiyoMusicWindowApi,
    live2DProviderToYachiyoSource,
    musicCandidateToYachiyoPlaybackInfo,
    sanitizeYachiyoMusicToolResult,
    yachiyoSourceToLive2DProvider,
    yachiyoTrackToCandidate
  } = await server.ssrLoadModule('/src/frontend/services/room/yachiyoMusicAdapter.js');

  assert.equal(YACHIYO_SOURCE_TO_LIVE2D_PROVIDER.netease, 'netease-cloud');
  assert.equal(YACHIYO_SOURCE_TO_LIVE2D_PROVIDER.qqmusic, 'qqmusic');
  assert.equal(LIVE2D_PROVIDER_TO_YACHIYO_SOURCE['netease-cloud'], 'netease');
  assert.equal(yachiyoSourceToLive2DProvider('NetEase Cloud'), 'netease-cloud');
  assert.equal(yachiyoSourceToLive2DProvider('qq-music'), 'qqmusic');
  assert.equal(live2DProviderToYachiyoSource('qq-music'), 'qqmusic');

  const track = {
    id: '347230',
    source: 'netease',
    name: '海阔天空',
    artists: ['Beyond'],
    albumName: '乐与怒',
    albumId: 'album-1',
    albumCoverUrl: 'https://img.example.test/cover.jpg',
    duration: 326000,
    quality: 'lossless',
    vip: false,
    mappedTrackId: 'qq-123',
    mappedSource: 'qqmusic'
  };
  const candidate = yachiyoTrackToCandidate(track, {
    query: '海阔天空 Beyond',
    requestedBy: 'viewer-a'
  });
  assert.equal(candidate.provider, 'netease-cloud');
  assert.equal(candidate.songId, track.id);
  assert.equal(candidate.artist, 'Beyond');
  assert.equal(candidate.requestedBy, 'viewer-a');
  assert.equal(candidate.url, undefined);
  assert.deepEqual(candidateToYachiyoTrack(candidate), track);

  assert.deepEqual(
    musicCandidateToYachiyoPlaybackInfo({
      ...candidate,
      url: 'https://stream.example.test/song.flac?token=private',
      bitrate: 999000,
      size: 123456
    }),
    {
      url: 'https://stream.example.test/song.flac?token=private',
      quality: 'lossless',
      format: 'flac',
      bitrate: 999000,
      size: 123456
    }
  );

  const safeResult = sanitizeYachiyoMusicToolResult({
    status: 'playing',
    url: 'https://stream.example.test/song.mp3?token=private',
    albumCoverUrl: track.albumCoverUrl,
    nested: {
      developerToken: 'developer-secret',
      neteaseCookie: 'MUSIC_U=private',
      message: 'Authorization: Bearer abc.def, SESSDATA=private, stream=https://stream.example.test/private.mp3?token=private'
    }
  });
  assert.equal(safeResult.url, '[redacted]');
  assert.equal(safeResult.albumCoverUrl, track.albumCoverUrl);
  assert.equal(safeResult.nested.developerToken, '[redacted]');
  assert.equal(safeResult.nested.neteaseCookie, '[redacted]');
  assert.ok(!JSON.stringify(safeResult).includes('developer-secret'));
  assert.ok(!JSON.stringify(safeResult).includes('abc.def'));
  assert.ok(!JSON.stringify(safeResult).includes('SESSDATA=private'));
  assert.ok(!JSON.stringify(safeResult).includes('stream.example.test'));

  const searchCalls = [];
  const commandCalls = [];
  const adapter = createYachiyoMusicAdapter({
    supportedSources: ['netease'],
    settings: { enabled: true, provider: 'netease-cloud' },
    searchLive2DMusic: async (query, settings, options) => {
      searchCalls.push({ query, settings, options });
      return {
        query,
        provider: 'netease-cloud',
        tracks: [
          {
            provider: 'netease-cloud',
            songId: 'first',
            title: '第一首',
            artist: '歌手甲',
            album: '专辑甲',
            artworkUrl: 'https://img.example.test/first.jpg',
            durationMs: 180000
          },
          {
            provider: 'netease-cloud',
            songId: 'second',
            title: '第二首',
            artist: '歌手乙',
            album: '专辑乙',
            durationMs: 200000
          }
        ],
        total: 12
      };
    },
    executeLive2DMusicCommand: async (command) => {
      commandCalls.push(command);
      return {
        status: 'queued',
        requestedBy: command.requestedBy,
        candidate: command.candidate,
        url: 'https://stream.example.test/private.mp3'
      };
    },
    getLive2DMusicPublicState: () => ({
      current: null,
      queue: [{ songId: 'queued', url: 'https://stream.example.test/queued.mp3' }]
    })
  });

  const searchResult = await adapter.search({
    query: '第一首',
    source: 'netease',
    limit: 1
  });
  assert.deepEqual(searchCalls, [{
    query: '第一首',
    settings: { enabled: true, provider: 'netease-cloud' },
    options: { provider: 'netease-cloud', limit: 1 }
  }]);
  assert.equal(searchResult.source, 'netease');
  assert.equal(searchResult.total, 12);
  assert.equal(searchResult.tracks.length, 1);
  assert.deepEqual(searchResult.albums, []);
  assert.deepEqual(searchResult.artists, []);
  assert.deepEqual(searchResult.playlists, []);
  assert.equal(searchResult.tracks[0].id, 'first');
  assert.equal(searchResult.tracks[0].name, '第一首');

  const requestResult = await adapter.request({
    track,
    requestedBy: 'payload-viewer'
  }, {
    requestedBy: 'context-viewer'
  });
  assert.equal(commandCalls.length, 1);
  assert.equal(commandCalls[0].action, 'request');
  assert.equal(commandCalls[0].provider, 'netease-cloud');
  assert.equal(commandCalls[0].requestedBy, 'context-viewer');
  assert.equal(commandCalls[0].candidate.requestedBy, 'context-viewer');
  assert.equal(commandCalls[0].candidate.url, undefined);
  assert.equal(requestResult.url, '[redacted]');
  assert.equal(requestResult.candidate.requestedBy, 'context-viewer');

  await adapter.execute({
    action: 'play_next',
    query: '第二首',
    source: 'netease'
  }, {
    requestedBy: 'viewer-b'
  });
  assert.equal(commandCalls[1].action, 'play_next');
  assert.equal(commandCalls[1].requestedBy, 'viewer-b');

  await adapter.callTool('music_control', {
    action: 'pause',
    source: 'netease'
  });
  assert.equal(commandCalls[2].action, 'pause');

  const stateFromTool = await adapter.callTool('music_state');
  assert.equal(stateFromTool.queue[0].url, '[redacted]');

  await assert.rejects(
    () => adapter.request({
      query: '任意歌曲',
      url: 'https://attacker.example.test/audio.mp3'
    }),
    /do not accept playback URLs/
  );
  await assert.rejects(
    () => adapter.callTool('request_music', {
      track: {
        ...track,
        url: 'https://attacker.example.test/audio.mp3'
      }
    }),
    /do not accept playback URLs/
  );
  await assert.rejects(
    () => adapter.request({
      query: '任意歌曲',
      candidate: {
        songId: 'unsafe',
        src: 'https://attacker.example.test/audio.mp3'
      }
    }),
    /do not accept playback URLs/
  );
  await assert.rejects(
    () => adapter.search('https://attacker.example.test/audio.mp3'),
    /non-URL query|do not accept playback URLs/
  );

  const publicState = await adapter.getState();
  assert.equal(publicState.queue[0].url, '[redacted]');

  const failingSearchAdapter = createYachiyoMusicAdapter({
    supportedSources: ['netease'],
    searchLive2DMusic: async () => {
      throw new Error('Cookie: MUSIC_U=private; upstream=https://stream.example.test/search?token=private');
    }
  });
  await assert.rejects(
    () => failingSearchAdapter.search({ query: 'safe query', source: 'netease' }),
    (error) => {
      assert.ok(!error.message.includes('MUSIC_U=private'));
      assert.ok(!error.message.includes('stream.example.test'));
      assert.ok(error.message.includes('[redacted]'));
      return true;
    }
  );

  const failingCommandAdapter = createYachiyoMusicAdapter({
    supportedSources: ['netease'],
    executeLive2DMusicCommand: async () => {
      throw new Error('SESSDATA=private https://stream.example.test/play.mp3?token=private');
    }
  });
  await assert.rejects(
    () => failingCommandAdapter.request({
      query: 'safe query',
      source: 'netease'
    }),
    (error) => {
      assert.ok(!error.message.includes('SESSDATA=private'));
      assert.ok(!error.message.includes('stream.example.test'));
      return true;
    }
  );

  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const order = [];
  const serialAdapter = createYachiyoMusicAdapter({
    supportedSources: ['netease'],
    executeLive2DMusicCommand: async (command) => {
      const label = command.query || command.action;
      order.push(`start:${label}`);
      if (label === 'first') {
        markFirstStarted();
        await firstGate;
      }
      order.push(`end:${label}`);
      return { status: 'ok', label };
    }
  });

  const firstCommand = serialAdapter.request('first');
  await firstStarted;
  const secondCommand = serialAdapter.control('pause');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, ['start:first']);
  releaseFirst();
  await Promise.all([firstCommand, secondCommand]);
  assert.deepEqual(order, [
    'start:first',
    'end:first',
    'start:pause',
    'end:pause'
  ]);

  const target = {};
  const windowApi = installYachiyoMusicWindowApi(target, adapter);
  assert.equal(target.yachiyoMusic, windowApi);
  assert.equal(Object.isFrozen(windowApi), true);
  assert.equal(windowApi.capabilities.acceptsPlaybackUrl, false);
} finally {
  await server.close();
}

console.log('Yachiyo music adapter checks passed');
