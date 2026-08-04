import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    formatMemoryPrompt,
    isLive2DObsoleteSyntheticRecoveryText
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');

  assert.equal(
    isLive2DObsoleteSyntheticRecoveryText('Aliceさん、待たせてごめんね。コメントはちゃんと届いているよ、ここから一緒に話そう！'),
    true
  );
  assert.equal(
    isLive2DObsoleteSyntheticRecoveryText('Bob，刚才稍微想久了一点，但心意已经好好收到了！'),
    true
  );
  assert.equal(
    isLive2DObsoleteSyntheticRecoveryText('Alice，谢谢你的建议，我们继续聊这个话题。'),
    false
  );

  const prompt = formatMemoryPrompt([
    {
      type: 'session',
      title: 'obsolete recovery',
      summary: 'Aliceさん、待たせてごめんね。コメントはちゃんと届いているよ、ここから一緒に話そう！'
    },
    {
      type: 'viewer',
      title: 'trusted preference',
      summary: 'Alice likes astronomy and calm music.'
    }
  ]);
  assert.doesNotMatch(prompt, /待たせてごめんね/u);
  assert.match(prompt, /Alice likes astronomy/u);

  console.log('Synthetic recovery memory filter checks passed');
} finally {
  await server.close();
}
