import assert from 'node:assert/strict';
import { after, test } from 'node:test';
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

after(async () => {
  await server.close();
});

const {
  translateLive2DReplyToChinese
} = await server.ssrLoadModule('/src/frontend/services/room/live2dLlmControl.js');
const {
  writeRoomLLMSettings
} = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');

test('legacy caption translation cannot block the live turn forever', async () => {
  writeRoomLLMSettings({
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    useProxy: true
  });

  globalThis.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      reject(options.signal.reason || new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

  const outcome = await Promise.race([
    translateLive2DReplyToChinese('\u3053\u3093\u3070\u3093\u306f\u3002', {
      timeoutMs: 20,
      maxAttempts: 1
    }).then(
      () => 'resolved',
      (error) => error?.name || 'rejected'
    ),
    new Promise((resolve) => setTimeout(() => resolve('still-pending'), 200))
  ]);

  assert.notEqual(
    outcome,
    'still-pending',
    'a hung caption request must settle so the next audience turn can continue'
  );
});
