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
globalThis.window = {
  localStorage: globalThis.localStorage,
  setTimeout,
  clearTimeout
};

localStorage.setItem('roomMemorySettings', JSON.stringify({
  enabled: true,
  provider: 'sqlite',
  databasePath: 'memory-retrieval-nonblocking.sqlite',
  retrievalMode: 'hybrid',
  writeMode: 'auto-approved',
  allowViewerMemory: true,
  allowSessionMemory: true,
  sessionRollupEnabled: false,
  embeddingDimension: 64,
  maxNotesPerTurn: 4
}));

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

let memory = null;
let replenishWrites = true;
let writeCalls = 0;

globalThis.fetch = async (url) => {
  const route = String(url || '');
  if (route.includes('/api/memory/record-turn')) {
    writeCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (replenishWrites) {
      memory.recordLive2DViewerMemoryInteraction({
        id: `continuous-viewer-message-${writeCalls}`,
        source: 'bilibili',
        platform: 'bilibili',
        userId: `viewer-${writeCalls % 12}`,
        userName: `Viewer ${writeCalls % 12}`,
        text: `continuous chat ${writeCalls}`,
        eventType: 'danmu',
        timestamp: 1785300000000 + writeCalls
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  if (route.includes('/api/memory/search')) {
    return new Response(JSON.stringify({ success: true, notes: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  throw new Error(`unexpected memory route: ${route}`);
};

try {
  memory = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');
  memory.recordLive2DViewerMemoryInteraction({
    id: 'seed-viewer-message',
    source: 'bilibili',
    platform: 'bilibili',
    userId: 'seed-viewer',
    userName: 'Seed Viewer',
    text: 'seed continuous chat',
    eventType: 'danmu',
    timestamp: 1785300000000
  });

  const continuousFlush = memory.flushLive2DMemoryOutbox();
  while (writeCalls < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const searchPromise = memory.searchLive2DMemory('reply to the current audience');
  const searchOutcome = await Promise.race([
    searchPromise.then(() => 'search-completed'),
    new Promise((resolve) => setTimeout(() => resolve('blocked-by-writes'), 200))
  ]);
  replenishWrites = false;
  await searchPromise;
  await continuousFlush;

  assert.equal(
    searchOutcome,
    'search-completed',
    'continuous durable memory writes must not block the live reply retrieval path'
  );
  assert.ok(writeCalls > 1, 'the reproduction must keep adding writes while retrieval starts');

  console.log('memory retrieval nonblocking outbox checks passed');
} finally {
  replenishWrites = false;
  await server.close();
  delete globalThis.fetch;
  delete globalThis.indexedDB;
  delete globalThis.localStorage;
  delete globalThis.window;
}
