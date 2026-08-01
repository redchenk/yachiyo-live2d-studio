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
  databasePath: 'summary-backlog-test.sqlite',
  retrievalMode: 'hybrid',
  writeMode: 'auto-approved',
  allowSessionMemory: true,
  sessionRollupEnabled: true,
  embeddingDimension: 64
}));
localStorage.setItem('roomLLMSettings', JSON.stringify({
  apiKey: 'test-only-key',
  apiUrl: 'https://llm.invalid/v1/chat/completions',
  model: 'summary-backlog-model',
  memorySummaryTimeoutMs: 5000
}));

const summaryInputs = [];
const memoryWrites = [];
let releaseFirstSummary = null;

function summaryResponse(index) {
  return {
    ok: true,
    async json() {
      return {
        success: true,
        data: {
          reply: JSON.stringify({
            title: `Backlog summary ${index}`,
            episode: `Backlog episode ${index}`,
            facts: [`backlog-${index}`],
            foresight: [],
            tags: ['session'],
            importance: 0.5,
            confidence: 0.8
          })
        }
      };
    }
  };
}

globalThis.fetch = async (url, options = {}) => {
  const body = JSON.parse(options.body || '{}');
  if (url === '/api/chat') {
    summaryInputs.push(String(body.message || ''));
    const index = summaryInputs.length;
    if (index === 1) {
      return new Promise((resolve) => {
        releaseFirstSummary = () => resolve(summaryResponse(index));
      });
    }
    return summaryResponse(index);
  }
  if (url === '/api/memory/write') {
    memoryWrites.push(body);
    return { ok: true, async json() { return { success: true }; } };
  }
  throw new Error(`unexpected fetch in backlog test: ${url}`);
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

async function drain() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

try {
  const { recordLive2DSessionMemoryTurn } = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');
  for (let sequence = 1; sequence <= 100; sequence += 1) {
    recordLive2DSessionMemoryTurn({
      turnId: `backlog-turn-${sequence}`,
      source: 'live2d',
      input: `Audience sequence ${sequence}`,
      reply: `Natural reply ${sequence}`,
      emotion: 'neutral'
    });
  }
  assert.equal(typeof releaseFirstSummary, 'function', 'the first summary must be held while the backlog grows');
  releaseFirstSummary();
  for (let attempt = 0; attempt < 50 && memoryWrites.length < 10; attempt += 1) await drain();

  const summarizedSequences = summaryInputs.flatMap((input) => (
    [...input.matchAll(/Audience sequence (\d+)/g)].map((match) => Number(match[1]))
  ));
  assert.deepEqual(
    summarizedSequences,
    Array.from({ length: 100 }, (_, index) => index + 1),
    'a slow first summary must not make the bounded buffer skip any sequence'
  );
  assert.equal(memoryWrites.length, 10, '100 turns must produce exactly ten non-overlapping summaries');
  assert.equal(JSON.parse(localStorage.getItem('live2dMemoryLastSummaryAt') || '0'), 100);
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.localStorage;
}

console.log('memory session summary backlog checks passed');
