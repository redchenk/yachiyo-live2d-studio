import assert from 'node:assert/strict';
import { createServer } from 'vite';

const values = new Map();
globalThis.localStorage = {
  getItem(key) {
    return values.has(key) ? values.get(key) : null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
  removeItem(key) {
    values.delete(key);
  }
};

localStorage.setItem('roomMemorySettings', JSON.stringify({
  enabled: true,
  provider: 'sqlite',
  databasePath: 'memory-test.sqlite',
  retrievalMode: 'hybrid',
  writeMode: 'auto-approved',
  allowViewerMemory: true,
  allowSessionMemory: true,
  sessionRollupEnabled: true,
  embeddingDimension: 64
}));

let requests = [];
let online = false;
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, body: JSON.parse(options.body || '{}') });
  if (!online) throw new Error('offline');
  return {
    ok: true,
    async json() {
      return { success: true };
    }
  };
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    flushLive2DMemoryOutbox,
    recordLive2DViewerMemoryInteraction
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');

  const viewerEvent = {
    id: 'bili-event-42',
    source: 'bilibili',
    platform: 'bilibili',
    userId: '1001',
    userName: '小月',
    text: '我喜欢 Ray',
    eventType: 'danmu',
    timestamp: 1785300000000
  };
  assert.equal(recordLive2DViewerMemoryInteraction(viewerEvent), true);
  assert.equal(recordLive2DViewerMemoryInteraction(viewerEvent), true);

  const queued = JSON.parse(localStorage.getItem('live2dMemoryDurableOutboxV1') || '[]');
  assert.equal(queued.length, 1, 'duplicate platform event IDs should occupy one durable outbox slot');

  const offlineFlush = await flushLive2DMemoryOutbox();
  assert.equal(offlineFlush.flushed, 0);
  assert.equal(offlineFlush.pending, 1, 'failed writes must remain durable for a later retry');

  online = true;
  requests = [];
  const onlineFlush = await flushLive2DMemoryOutbox();
  assert.equal(onlineFlush.flushed, 1);
  assert.equal(onlineFlush.pending, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/memory/record-turn');
  assert.equal(requests[0].body.turns.length, 1, 'viewer events should flush through the batch API');
  assert.equal(requests[0].body.turns[0].viewer.userId, '1001');
  assert.equal(requests[0].body.turns[0].turnId, 'viewer-bilibili-bili-event-42');
  assert.deepEqual(JSON.parse(localStorage.getItem('live2dMemoryDurableOutboxV1') || '[]'), []);
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.localStorage;
}

console.log('memory durable outbox checks passed');
