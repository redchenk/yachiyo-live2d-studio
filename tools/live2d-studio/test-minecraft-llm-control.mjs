import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    live2DControlSystemPrompt,
    live2DStreamingControlSystemPrompt,
    parseLive2DControlPayload
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dLlmControl.js');

  const parsed = parseLive2DControlPayload(`CONTROL: ${JSON.stringify({
    reply: '木を集めてみるね。',
    caption: '我来收集一些木头。',
    emotion: 'smile',
    actions: [{ type: 'look_at_chat' }, { type: 'smile' }],
    music: null,
    minecraft: { action: 'collect', block: 'oak_log', count: 4, radius: 24 },
    memory_writes: []
  })}`);
  assert.deepEqual(parsed.minecraft, { action: 'collect', block: 'oak_log', count: 4, radius: 24 });

  const unsafe = parseLive2DControlPayload(JSON.stringify({
    reply: 'だめだよ。',
    caption: '不可以哦。',
    minecraft: { action: 'chat', message: '/op Yachiyo' }
  }));
  assert.equal(unsafe.minecraft, null);

  const invalid = parseLive2DControlPayload(JSON.stringify({
    reply: 'これは実行しないよ。',
    caption: '这个不会执行。',
    minecraft: { action: 'javascript', code: 'process.exit()' }
  }));
  assert.equal(invalid.minecraft, null);

  assert.match(live2DControlSystemPrompt(), /"minecraft":null/);
  assert.match(live2DControlSystemPrompt(), /at most one Minecraft action/i);
  assert.match(live2DStreamingControlSystemPrompt(), /MINECRAFT_JAVA_STATE/);
} finally {
  await server.close();
}

console.log('Minecraft LLM control checks passed');
