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

const deliveredIds = [];
globalThis.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || '{}');
  deliveredIds.push(...(body.turns || []).map((turn) => turn.turnId));
  return { ok: true, async json() { return { success: true }; } };
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const memory = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');
  const burstStartedAt = performance.now();
  for (let index = 0; index < 2105; index += 1) {
    memory.recordLive2DViewerMemoryInteraction({
      id: `event-${index}`,
      source: 'bilibili',
      platform: 'bilibili',
      userId: `viewer-${index % 30}`,
      userName: `Viewer ${index % 30}`,
      text: `message ${index}`,
      eventType: 'danmu',
      timestamp: 1785300000000 + index
    });
  }

  assert.equal(
    [...values.keys()].filter((key) => key.startsWith('live2dMemoryDurableOutboxHotV2:')).length,
    2105,
    'each event must have a synchronous crash-recovery hot-log entry before the IndexedDB batch commits'
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    indexedDB.dump('yachiyo-live2d-memory', 'durable-outbox').length,
    2105,
    'every event must reach IndexedDB before delivery'
  );
  const result = await memory.flushLive2DMemoryOutbox();
  assert.equal(
    indexedDB.dump('yachiyo-live2d-memory', 'durable-outbox').length,
    0,
    'a successful flush must acknowledge every IndexedDB event'
  );
  assert.equal(result.flushed, 2105, 'a burst larger than the former 2000-item cap must not lose its oldest events');
  assert.equal(result.pending, 0);
  assert.equal(deliveredIds.length, 2105);
  assert.equal(new Set(deliveredIds).size, 2105);
  assert.equal(deliveredIds.includes('viewer-bilibili-event-0'), true, 'the oldest event must survive');
  const burstElapsedMs = performance.now() - burstStartedAt;
  console.log(`memory IndexedDB outbox burst elapsed: ${Math.round(burstElapsedMs)}ms`);
  assert.equal(
    burstElapsedMs < 8000,
    true,
    `2105-event IndexedDB burst should complete within a wide 8s budget (actual ${Math.round(burstElapsedMs)}ms)`
  );
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.indexedDB;
  delete globalThis.localStorage;
}

console.log('memory IndexedDB outbox capacity checks passed');
