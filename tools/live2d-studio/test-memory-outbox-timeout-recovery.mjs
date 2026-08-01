import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createFakeIndexedDB } from './fake-indexeddb.mjs';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key: (index) => [...values.keys()][index] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key)
};
globalThis.indexedDB = createFakeIndexedDB();

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

let mode = 'hung';
let successfulDeliveries = 0;
globalThis.fetch = async () => {
  if (mode === 'hung') return new Promise(() => {});
  successfulDeliveries += 1;
  return { ok: true, async json() { return { success: true }; } };
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const memory = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');
  memory.recordLive2DViewerMemoryInteraction({
    id: 'timeout-event',
    source: 'bilibili',
    platform: 'bilibili',
    userId: 'viewer-1',
    userName: 'Viewer 1',
    text: 'remember me',
    eventType: 'danmu',
    timestamp: 1785300000000
  });

  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (handler, delay, ...args) => realSetTimeout(handler, Math.min(Number(delay) || 0, 50), ...args);
  const flushPromise = memory.flushLive2DMemoryOutbox();
  const firstFlush = await Promise.race([
    flushPromise,
    new Promise((resolve) => realSetTimeout(() => resolve('test-timeout'), 500))
  ]);
  globalThis.setTimeout = realSetTimeout;
  assert.notEqual(firstFlush, 'test-timeout', 'a fetch that never settles must not pin the shared flush promise');
  assert.equal(firstFlush.flushed, 0);
  assert.equal(firstFlush.pending, 1);

  mode = 'online';
  const recovered = await memory.flushLive2DMemoryOutbox();
  assert.equal(recovered.flushed, 1);
  assert.equal(recovered.pending, 0);
  assert.equal(successfulDeliveries, 1, 'recovery must deliver the durable event exactly once');
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.indexedDB;
  delete globalThis.localStorage;
}

console.log('memory outbox timeout recovery checks passed');
