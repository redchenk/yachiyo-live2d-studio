import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    executeLive2DMusicCommand,
    inferLive2DMusicCommandFromText,
    normalizeLive2DMusicCommand
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dMusic.js');
  const {
    DEFAULT_ROOM_MUSIC_SETTINGS
  } = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');
  const {
    live2DControlSystemPrompt,
    parseLive2DControlPayload
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dLlmControl.js');

  assert.deepEqual(normalizeLive2DMusicCommand('Cloud 9 Beach Bunny'), {
    action: 'play',
    query: 'Cloud 9 Beach Bunny'
  });
  assert.deepEqual(normalizeLive2DMusicCommand({ action: 'pause' }), {
    action: 'pause'
  });
  assert.equal(normalizeLive2DMusicCommand({ action: 'play' }), null);
  assert.deepEqual(normalizeLive2DMusicCommand({ action: '点歌', title: '晴天', artist: '周杰伦' }), {
    action: 'request',
    query: '晴天 周杰伦'
  });
  assert.deepEqual(normalizeLive2DMusicCommand({ action: '立即播放', song: '晴天', singer: '周杰伦' }), {
    action: 'play_now',
    query: '晴天 周杰伦'
  });
  assert.deepEqual(normalizeLive2DMusicCommand({ action: '放歌', song: '晴天', singer: '周杰伦' }), {
    action: 'play_now',
    query: '晴天 周杰伦'
  });
  assert.deepEqual(normalizeLive2DMusicCommand({ action: '点歌', provider: '网易云', title: '晴天', artist: '周杰伦' }), {
    action: 'request',
    provider: 'netease-cloud',
    query: '晴天 周杰伦'
  });
  const eason = '\u9648\u5955\u8fc5';
  const loveLikeTide = '\u7231\u5982\u6f6e\u6c34';
  assert.deepEqual(inferLive2DMusicCommandFromText(`\u6211\u8981\u542c${eason}\u7684\u6b4c`), {
    action: 'play_now',
    provider: 'netease-cloud',
    query: eason
  });
  assert.deepEqual(inferLive2DMusicCommandFromText(`\u6211\u8981\u542c${loveLikeTide}`), {
    action: 'play_now',
    provider: 'netease-cloud',
    query: loveLikeTide
  });
  assert.equal(inferLive2DMusicCommandFromText(`\u6211\u542c\u8bf4${eason}\u7684\u6b4c\u5f88\u597d`), null);

  const parsed = parseLive2DControlPayload(`CONTROL: ${JSON.stringify({
    reply: 'すぐ流すね。',
    emotion: 'smile',
    actions: [
      { type: 'look_at_chat', duration: 1.1 },
      { type: 'smile', duration: 1.2 }
    ],
    music: {
      action: 'play',
      query: 'Cloud 9 Beach Bunny',
      storefront: 'us'
    },
    memory_writes: []
  })}`);

  assert.equal(parsed.music.action, 'play');
  assert.equal(parsed.music.query, 'Cloud 9 Beach Bunny');
  assert.equal(parsed.music.storefront, 'us');
  assert.equal(parsed.memoryWrites.length, 0);
  assert.ok(live2DControlSystemPrompt().includes('"music":null'));
  assert.ok(live2DControlSystemPrompt().includes('music JSON'));
  assert.ok(live2DControlSystemPrompt().includes('\u6211\u8981\u542c'));

  const parsedMusicRequest = parseLive2DControlPayload(JSON.stringify({
    reply: '好，我来点这首。',
    emotion: 'smile',
    actions: [{ type: 'look_at_chat', duration: 1.1 }, { type: 'smile', duration: 1.2 }],
    music_request: {
      action: '点歌',
      title: '晴天',
      artist: '周杰伦'
    }
  }));
  assert.deepEqual(parsedMusicRequest.music, {
    action: 'request',
    query: '晴天 周杰伦'
  });

  const parsedNeteaseRequest = parseLive2DControlPayload(JSON.stringify({
    reply: '好，我用网易云点这首。',
    emotion: 'smile',
    actions: [{ type: 'look_at_chat', duration: 1.1 }, { type: 'smile', duration: 1.2 }],
    music: {
      action: '点歌',
      platform: '网易云',
      title: '晴天',
      artist: '周杰伦'
    }
  }));
  assert.deepEqual(parsedNeteaseRequest.music, {
    action: 'request',
    provider: 'netease-cloud',
    query: '晴天 周杰伦'
  });

  const parsedNeteaseAlias = parseLive2DControlPayload(JSON.stringify({
    reply: '好，我走网易云。',
    emotion: 'smile',
    actions: [{ type: 'look_at_chat', duration: 1.1 }, { type: 'smile', duration: 1.2 }],
    neteaseMusic: {
      action: '点歌',
      title: '晴天',
      artist: '周杰伦'
    }
  }));
  assert.deepEqual(parsedNeteaseAlias.music, {
    action: 'request',
    provider: 'netease-cloud',
    query: '晴天 周杰伦'
  });

  const parsedMusicOnly = parseLive2DControlPayload(JSON.stringify({
    action: '点歌',
    song: '晴天',
    singer: '周杰伦'
  }));
  assert.deepEqual(parsedMusicOnly.music, {
    action: 'request',
    query: '晴天 周杰伦'
  });

  const queueStatus = await executeLive2DMusicCommand(
    { action: 'queue', provider: '网易云' },
    { ...DEFAULT_ROOM_MUSIC_SETTINGS, enabled: true, provider: 'local-library' }
  );
  assert.equal(queueStatus.provider, 'netease-cloud');
} finally {
  await server.close();
}

console.log('music control payload checks passed');
