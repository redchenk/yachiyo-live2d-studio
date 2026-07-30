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
  localStorage: globalThis.localStorage
};

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error('an already-aborted LLM request must not reach fetch');
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const { writeRoomLLMSettings } = await server.ssrLoadModule(
    '/src/frontend/services/room/roomSettings.js'
  );
  writeRoomLLMSettings({
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    useProxy: false
  });

  const {
    requestLive2DControl,
    requestLive2DControlStream
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dLlmControl.js');

  const directController = new AbortController();
  directController.abort();
  await assert.rejects(
    requestLive2DControl('cancel direct request', {
      signal: directController.signal
    }),
    (error) => error?.name === 'AbortError'
  );

  const streamingController = new AbortController();
  streamingController.abort();
  await assert.rejects(
    requestLive2DControlStream('cancel streaming request', {
      signal: streamingController.signal
    }),
    (error) => error?.name === 'AbortError'
  );

  assert.equal(fetchCalls, 0);
  console.log('LLM request abort checks passed');
} finally {
  await server.close();
}
