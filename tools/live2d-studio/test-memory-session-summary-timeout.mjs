import assert from 'node:assert/strict';
import { createServer } from 'vite';

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); }
};

localStorage.setItem('roomMemorySettings', JSON.stringify({
  enabled: true,
  provider: 'sqlite',
  databasePath: 'summary-timeout-test.sqlite',
  retrievalMode: 'hybrid',
  writeMode: 'auto-approved',
  allowSessionMemory: true,
  sessionRollupEnabled: true,
  embeddingDimension: 64
}));
localStorage.setItem('roomLLMSettings', JSON.stringify({
  apiKey: 'test-only-key',
  apiUrl: 'https://llm.invalid/v1/chat/completions',
  model: 'summary-timeout-model',
  memorySummaryTimeoutMs: 50
}));

let summaryAttempts = 0;
const memoryWrites = [];
globalThis.fetch = async (url, options = {}) => {
  if (url === '/api/chat') {
    summaryAttempts += 1;
    return new Promise((resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  }
  if (url === '/api/memory/write') {
    memoryWrites.push(JSON.parse(options.body || '{}'));
    return { ok: true, async json() { return { success: true }; } };
  }
  throw new Error(`unexpected fetch in summary timeout test: ${url}`);
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const { recordLive2DSessionMemoryTurn } = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');
  for (let sequence = 1; sequence <= 20; sequence += 1) {
    recordLive2DSessionMemoryTurn({
      turnId: `timeout-turn-${sequence}`,
      input: `Timeout audience sequence ${sequence}`,
      reply: `Timeout natural reply ${sequence}`
    });
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1500 && memoryWrites.length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(summaryAttempts, 2, 'each timed-out batch should fall back independently');
  assert.equal(memoryWrites.length, 2, 'a hung summary API must fall back and continue draining the backlog');
  assert.equal(JSON.parse(localStorage.getItem('live2dMemoryLastSummaryAt') || '0'), 20);
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.localStorage;
}

console.log('memory session summary timeout checks passed');
