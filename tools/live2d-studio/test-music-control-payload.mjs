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

  const parsedMusicOnly = parseLive2DControlPayload(JSON.stringify({
    action: '点歌',
    song: '晴天',
    singer: '周杰伦'
  }));
  assert.deepEqual(parsedMusicOnly.music, {
    action: 'request',
    query: '晴天 周杰伦'
  });
} finally {
  await server.close();
}

console.log('music control payload checks passed');
