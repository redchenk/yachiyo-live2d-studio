import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    createLive2DAudienceMusicRequestRouter
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dAudienceMusicRequest.js');

  const calls = [];
  const router = createLive2DAudienceMusicRequestRouter({
    execute: async (command, context) => {
      calls.push({ command, context });
      return { status: 'queued', title: command.query };
    }
  });
  const rayEntry = {};
  const ray = router.handle('测试观众: 我要听ray', {
    source: 'bilibili',
    bilibili: {
      id: 'danmu-ray',
      userName: '测试观众'
    }
  }, rayEntry);

  assert.equal(ray.handled, true);
  assert.equal(ray.duplicate, false);
  assert.equal(rayEntry.musicRequestHandled, true);
  assert.deepEqual(ray.command, {
    action: 'request',
    provider: 'netease-cloud',
    query: 'ray'
  });
  assert.equal(ray.requestedBy, '测试观众');
  assert.equal((await ray.promise).status, 'queued');
  assert.equal(calls.length, 1);

  const duplicate = router.handle('测试观众: 我要听ray', {
    source: 'bilibili',
    bilibili: {
      id: 'danmu-ray',
      userName: '测试观众'
    }
  });
  assert.equal(duplicate.handled, true);
  assert.equal(duplicate.duplicate, true);
  await duplicate.promise;
  assert.equal(calls.length, 1);

  const sing = router.handle('小明: 唱一首同桌的你', {
    source: 'bilibili',
    bilibili: {
      id: 'danmu-sing',
      userName: '小明'
    }
  });
  assert.equal(sing.handled, true);
  assert.deepEqual(sing.command, {
    action: 'request',
    provider: 'netease-cloud',
    query: '同桌的你'
  });
  await sing.promise;
  assert.equal(calls.length, 2);

  const ordinary = router.handle('今天聊什么？', {
    source: 'bilibili',
    bilibili: {
      id: 'danmu-chat',
      userName: '路人'
    }
  });
  assert.equal(ordinary.handled, false);
  assert.equal(ordinary.promise, null);
  assert.equal(calls.length, 2);
} finally {
  await server.close();
}

console.log('audience music request routing checks passed');
