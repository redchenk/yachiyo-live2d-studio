import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const values = new Map([['yachiyo:live2d:broadcastScene', 'game']]);
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value))
};
const eventTarget = new EventTarget();

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    LIVE2D_BROADCAST_SCENE_EVENT,
    normalizeLive2DBroadcastScene,
    readLive2DBroadcastScene,
    writeLive2DBroadcastScene
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dBroadcastScene.js');

  assert.equal(readLive2DBroadcastScene(storage), 'game');
  assert.equal(normalizeLive2DBroadcastScene('unsupported'), 'chat');

  let changedScene = '';
  eventTarget.addEventListener(LIVE2D_BROADCAST_SCENE_EVENT, (event) => {
    changedScene = event.detail.scene;
  });
  assert.equal(writeLive2DBroadcastScene('chat', { storage, eventTarget }), 'chat');
  assert.equal(storage.getItem('yachiyo:live2d:broadcastScene'), 'chat');
  assert.equal(changedScene, 'chat');

  const [pageSource, sceneStyles] = await Promise.all([
    readFile('src/frontend/pages/Live2DPage.vue', 'utf8'),
    readFile('assets/css/vue/pages/live2d.css', 'utf8')
  ]);
  assert.doesNotMatch(pageSource, /Live2DGameCapturePanel|getDisplayMedia/);
  assert.doesNotMatch(sceneStyles, /live2d-game-capture/);
  assert.match(sceneStyles, /data-broadcast-scene="game"[^}]*\.live2d-model[\s\S]*?right:\s*-/);
  assert.match(sceneStyles, /data-broadcast-scene="game"[^}]*\.live2d-broadcast-hud[\s\S]*?right:\s*min\(/);

  console.log('Broadcast scene switcher checks passed');
} finally {
  await server.close();
}
