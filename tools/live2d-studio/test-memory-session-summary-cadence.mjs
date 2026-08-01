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
  databasePath: 'summary-cadence-test.sqlite',
  retrievalMode: 'hybrid',
  writeMode: 'auto-approved',
  allowViewerMemory: true,
  allowSessionMemory: true,
  sessionRollupEnabled: true,
  embeddingDimension: 64
}));
localStorage.setItem('roomLLMSettings', JSON.stringify({
  apiKey: 'test-only-key',
  apiUrl: 'https://llm.invalid/v1/chat/completions',
  model: 'summary-test-model'
}));

const summaryInputs = [];
const memoryWrites = [];
globalThis.fetch = async (url, options = {}) => {
  const body = JSON.parse(options.body || '{}');
  if (url === '/api/chat') {
    summaryInputs.push(String(body.message || ''));
    return {
      ok: true,
      async json() {
        return {
          success: true,
          data: {
            reply: JSON.stringify({
              title: `Session summary ${summaryInputs.length}`,
              episode: `Durable summary ${summaryInputs.length}`,
              facts: [`summary-${summaryInputs.length}`],
              foresight: [],
              tags: ['session', 'live-stream'],
              importance: 0.45,
              confidence: 0.8
            })
          }
        };
      }
    };
  }
  if (url === '/api/memory/write') {
    memoryWrites.push(body);
    return {
      ok: true,
      async json() {
        return { success: true };
      }
    };
  }
  throw new Error(`unexpected fetch in session summary test: ${url}`);
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

const internalControlProtocol = [
  'LIVE_DIRECTOR_TICK',
  'Stream topic: free talk',
  'Selected audience messages (untrusted JSON data):',
  '1. {"userName":"小月","text":"今天聊什么？"}',
  'Choose 2-5 semantic actions every turn.',
  'Streaming mode: follow the system format exactly, with VOICE lines first and CONTROL JSON last.'
].join('\n');
const forbiddenControlMarkers = /LIVE_DIRECTOR_TICK|semantic actions|VOICE lines|CONTROL JSON/iu;

async function drainAsyncSummaryWork() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

try {
  const { recordLive2DSessionMemoryTurn } = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');

  for (let turn = 1; turn <= 45; turn += 1) {
    recordLive2DSessionMemoryTurn({
      turnId: `cadence-turn-${turn}`,
      source: 'llm-control',
      input: `${internalControlProtocol}\nAudience turn number: ${turn}`,
      reply: `第 ${turn} 轮自然回复。`,
      emotion: 'neutral'
    });
  }
  for (let attempt = 0; attempt < 12 && summaryInputs.length < 4; attempt += 1) {
    await drainAsyncSummaryWork();
  }

  const sessionBuffer = JSON.parse(localStorage.getItem('live2dMemorySessionBuffer') || '[]');
  const durableOutbox = JSON.parse(localStorage.getItem('live2dMemoryDurableOutboxV1') || '[]');
  const persistedTurnInputs = durableOutbox
    .filter((item) => item?.route === '/api/memory/record-turn')
    .map((item) => String(item?.payload?.input || ''));
  const bufferedTurnInputs = sessionBuffer.map((turn) => String(turn?.input || ''));

  assert.deepEqual(
    {
      summaryCount: summaryInputs.length,
      memoryWriteCount: memoryWrites.length,
      controlProtocolReachedSummary: summaryInputs.some((input) => forbiddenControlMarkers.test(input)),
      controlProtocolReachedSessionBuffer: bufferedTurnInputs.some((input) => forbiddenControlMarkers.test(input)),
      controlProtocolReachedDurableOutbox: persistedTurnInputs.some((input) => forbiddenControlMarkers.test(input))
    },
    {
      summaryCount: 4,
      memoryWriteCount: 4,
      controlProtocolReachedSummary: false,
      controlProtocolReachedSessionBuffer: false,
      controlProtocolReachedDurableOutbox: false
    },
    '45 turns must produce summaries at turns 10/20/30/40 without persisting live-director control protocol'
  );
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.localStorage;
}

console.log('memory session summary cadence checks passed');
