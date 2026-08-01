import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createFakeIndexedDB } from './fake-indexeddb.mjs';

const values = new Map();
let quotaFault = false;
globalThis.localStorage = {
  get length() { return values.size; },
  key: (index) => [...values.keys()][index] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem(key, value) {
    if (quotaFault && key.startsWith('live2dMemoryDurableOutboxHotV2:')) {
      const error = new Error('quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    values.set(key, String(value));
  },
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

const delivered = [];
globalThis.fetch = async (_url, options = {}) => {
  delivered.push(...(JSON.parse(options.body || '{}').turns || []));
  return { ok: true, async json() { return { success: true }; } };
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const memory = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');
  quotaFault = true;
  assert.doesNotThrow(() => memory.recordLive2DViewerMemoryInteraction({
    id: 'quota-event',
    source: 'bilibili',
    platform: 'bilibili',
    userId: 'viewer-1',
    userName: 'Viewer 1',
    text: 'quota must not interrupt streaming',
    eventType: 'danmu',
    timestamp: 1785300000000
  }), 'localStorage quota failures must not escape into the live event handler');

  const result = await memory.flushLive2DMemoryOutbox();
  assert.equal(result.flushed, 1, 'the event must still be durably handed to IndexedDB');
  assert.equal(result.pending, 0);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].turnId, 'viewer-bilibili-quota-event');
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.indexedDB;
  delete globalThis.localStorage;
}

console.log('memory outbox quota fallback checks passed');
