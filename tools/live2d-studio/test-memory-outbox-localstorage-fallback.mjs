import assert from 'node:assert/strict';
import { createServer } from 'vite';

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key)
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

let delivered = 0;
globalThis.fetch = async (_url, options = {}) => {
  delivered += JSON.parse(options.body || '{}').turns?.length || 0;
  return { ok: true, async json() { return { success: true }; } };
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const memory = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');
  for (let index = 0; index < 2005; index += 1) {
    memory.recordLive2DViewerMemoryInteraction({
      id: `fallback-${index}`,
      source: 'bilibili',
      platform: 'bilibili',
      userId: 'viewer-1',
      userName: 'Viewer 1',
      text: `fallback message ${index}`,
      eventType: 'danmu',
      timestamp: 1785300000000 + index
    });
  }
  const queued = JSON.parse(localStorage.getItem('live2dMemoryDurableOutboxV1') || '[]');
  assert.equal(queued.length, 2005, 'the no-IndexedDB fallback must not silently discard its oldest event');
  const result = await memory.flushLive2DMemoryOutbox();
  assert.equal(result.flushed, 2005);
  assert.equal(delivered, 2005);
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.localStorage;
}

console.log('memory outbox localStorage fallback checks passed');
