import assert from 'node:assert/strict';
import { createServer } from 'vite';

const store = new Map();
globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  }
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  location: {
    protocol: 'http:',
    hostname: '127.0.0.1',
    origin: 'http://127.0.0.1'
  },
  setTimeout,
  clearTimeout
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

function responseFor(reply) {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          reply,
          caption: reply,
          acknowledgedIndexes: [1],
          emotion: 'neutral',
          actions: [{ type: 'look_at_chat' }, { type: 'breathe' }]
        })
      }
    }]
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

try {
  const {
    clearLive2DLLMHistory,
    readLive2DLLMHistory,
    requestLive2DControl
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dLlmControl.js');
  const {
    writeRoomLLMSettings,
    writeRoomMemorySettings,
    writeRoomVisionSettings
  } = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');

  writeRoomLLMSettings({
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    useProxy: false
  });
  writeRoomMemorySettings({ enabled: false, retrievalMode: 'off', writeMode: 'off' });
  writeRoomVisionSettings({ enabled: false });
  clearLive2DLLMHistory();

  let resolveFirst = null;
  let resolveSecond = null;
  globalThis.fetch = async (_url, options = {}) => {
    const request = JSON.parse(String(options.body || '{}'));
    const prompt = String(request.messages?.at(-1)?.content || '');
    if (prompt.includes('FIRST_CONCURRENT_TURN')) {
      return new Promise((resolve) => {
        resolveFirst = () => resolve(responseFor('first answer'));
      });
    }
    if (prompt.includes('SECOND_CONCURRENT_TURN')) {
      return new Promise((resolve) => {
        resolveSecond = () => resolve(responseFor('second answer'));
      });
    }
    throw new Error(`unexpected concurrent-history request: ${String(_url)}`);
  };

  const firstRequest = requestLive2DControl('FIRST_CONCURRENT_TURN');
  while (!resolveFirst) await new Promise((resolve) => setTimeout(resolve, 1));
  const secondRequest = requestLive2DControl('SECOND_CONCURRENT_TURN');
  while (!resolveSecond) await new Promise((resolve) => setTimeout(resolve, 1));

  resolveSecond();
  await secondRequest;
  resolveFirst();
  await firstRequest;

  assert.deepEqual(
    readLive2DLLMHistory().map(({ role, content }) => ({ role, content })),
    [
      { role: 'user', content: 'FIRST_CONCURRENT_TURN' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'SECOND_CONCURRENT_TURN' },
      { role: 'assistant', content: 'second answer' }
    ],
    'concurrent prefetch responses must commit conversation history in request order without overwriting each other'
  );

  clearLive2DLLMHistory();
  let cancelledRequestStarted = false;
  globalThis.fetch = async (_url, options = {}) => {
    const request = JSON.parse(String(options.body || '{}'));
    const prompt = String(request.messages?.at(-1)?.content || '');
    if (prompt.includes('CANCELLED_PREFETCH_TURN')) {
      cancelledRequestStarted = true;
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          const error = new Error('cancelled');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
    if (prompt.includes('RECOVERED_PREFETCH_TURN')) {
      return responseFor('recovered answer');
    }
    throw new Error(`unexpected cancellation-history request: ${String(_url)}`);
  };

  const abortController = new AbortController();
  const cancelledRequest = requestLive2DControl('CANCELLED_PREFETCH_TURN', {
    signal: abortController.signal
  });
  while (!cancelledRequestStarted) await new Promise((resolve) => setTimeout(resolve, 1));
  const recoveredRequest = requestLive2DControl('RECOVERED_PREFETCH_TURN');
  abortController.abort();
  await assert.rejects(cancelledRequest, { name: 'AbortError' });
  await recoveredRequest;
  assert.deepEqual(
    readLive2DLLMHistory().map(({ role, content }) => ({ role, content })),
    [
      { role: 'user', content: 'RECOVERED_PREFETCH_TURN' },
      { role: 'assistant', content: 'recovered answer' }
    ],
    'an aborted earlier turn must not block later prefetched history from committing'
  );

  console.log('concurrent LLM history checks passed');
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.localStorage;
  delete globalThis.window;
}
