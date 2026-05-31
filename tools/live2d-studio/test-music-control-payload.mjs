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
} finally {
  await server.close();
}

console.log('music control payload checks passed');
