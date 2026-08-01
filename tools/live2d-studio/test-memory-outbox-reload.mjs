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

const createMemoryModule = async () => {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom'
  });
  return {
    server,
    memory: await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js')
  };
};

let firstRuntime;
let secondRuntime;
let deliveredTurns = [];
try {
  globalThis.fetch = async () => { throw new Error('offline'); };
  firstRuntime = await createMemoryModule();
  const event = {
    id: 'reload-event',
    source: 'bilibili',
    platform: 'bilibili',
    userId: 'viewer-1',
    userName: 'Viewer 1',
    text: 'persistent hello',
    eventType: 'danmu',
    timestamp: 1785300000000
  };
  firstRuntime.memory.recordLive2DViewerMemoryInteraction(event);
  firstRuntime.memory.recordLive2DViewerMemoryInteraction(event);
  const offline = await firstRuntime.memory.flushLive2DMemoryOutbox();
  assert.equal(offline.flushed, 0);
  assert.equal(offline.pending, 1, 'duplicate IDs must share one durable record before reload');
  await firstRuntime.server.close();
  firstRuntime = null;

  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    deliveredTurns.push(...(body.turns || []));
    return { ok: true, async json() { return { success: true }; } };
  };
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    addEventListener() {}
  };
  secondRuntime = await createMemoryModule();
  const automaticFlushStartedAt = Date.now();
  while (deliveredTurns.length < 1 && Date.now() - automaticFlushStartedAt < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(deliveredTurns.length, 1, 'a reload must recover and acknowledge one logical event exactly once');
  assert.equal(deliveredTurns[0].turnId, 'viewer-bilibili-reload-event');
  assert.equal(indexedDB.dump('yachiyo-live2d-memory', 'durable-outbox').length, 0);
} finally {
  await firstRuntime?.server.close();
  await secondRuntime?.server.close();
  delete globalThis.fetch;
  delete globalThis.indexedDB;
  delete globalThis.localStorage;
  delete globalThis.window;
}

console.log('memory outbox reload checks passed');
