import assert from 'node:assert/strict';
import { createServer } from 'vite';

class TestCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
}

globalThis.window = new EventTarget();
globalThis.CustomEvent = TestCustomEvent;

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const bilibili = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dBilibiliDanmaku.js'
  );
  let stateEvents = 0;
  let messageEvents = 0;
  let latestMessage = null;
  window.addEventListener(bilibili.BILIBILI_DANMAKU_STATE_EVENT, () => {
    stateEvents += 1;
    bilibili.readBilibiliDanmakuSnapshot();
  });
  window.addEventListener(bilibili.BILIBILI_DANMAKU_EVENT, (event) => {
    messageEvents += 1;
    latestMessage = event.detail;
  });

  const count = Math.max(1, Number(process.env.BILIBILI_BURST_COUNT) || 2000);
  const startedAt = performance.now();
  for (let index = 0; index < count; index += 1) {
    bilibili.publishBilibiliDanmakuTestMessage(`burst-${index}`);
  }
  const publishElapsedMs = performance.now() - startedAt;
  await new Promise((resolve) => setTimeout(resolve, 80));

  const snapshot = bilibili.readBilibiliDanmakuSnapshot();
  assert.equal(messageEvents, count, 'every captured danmaku must reach the processing event');
  assert.equal(snapshot.state.messageCount, count);
  assert.ok(
    stateEvents <= 2,
    `UI state should be batched during bursts, received ${stateEvents} state events`
  );
  assert.equal(snapshot.messages.length, 100);
  assert.equal(snapshot.messages[0].text, `burst-${count - 1}`);
  assert.equal('raw' in latestMessage, false, 'public events must not clone large raw protocol payloads');

  console.log(
    `Bilibili danmaku burst checks passed: ${count} messages, ` +
    `${stateEvents} UI state event(s), ${publishElapsedMs.toFixed(2)}ms publish time`
  );
} finally {
  await server.close();
}
