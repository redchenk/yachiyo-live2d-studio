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

function abortableNeverResponse(signal) {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(
      signal.reason || new DOMException('aborted', 'AbortError')
    ), { once: true });
  });
}

async function settleWithin(promise, timeoutMs = 500) {
  return Promise.race([
    promise.then(
      (value) => ({ status: 'resolved', value }),
      (error) => ({ status: 'rejected', error })
    ),
    new Promise((resolve) => setTimeout(() => resolve({ status: 'pending' }), timeoutMs))
  ]);
}

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    clearLive2DLLMHistory,
    live2DStreamingControlSystemPrompt,
    requestLive2DControlStreamWithRecovery
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

  const streamingPrompt = live2DStreamingControlSystemPrompt();
  assert.ok(streamingPrompt.length < 5_000, 'the first-token streaming prompt must stay compact');
  assert.match(streamingPrompt, /VOICE:/u);
  assert.match(streamingPrompt, /CAPTION:/u);
  assert.match(streamingPrompt, /CONTROL:/u);

  let fetchCalls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    fetchCalls += 1;
    return abortableNeverResponse(options.signal);
  };

  const recoveryEvents = [];
  const audienceLines = [
    {
      messageType: 'gift',
      userName: 'Alice',
      giftName: 'Coffee',
      text: 'private gift payload must not be repeated'
    },
    {
      messageType: 'danmu',
      userName: 'Bob',
      text: 'private chat payload must not be repeated'
    }
  ];
  const outcome = await settleWithin(requestLive2DControlStreamWithRecovery(
    'LIVE_DIRECTOR_TICK',
    {
      audienceLines,
      memoryContext: {
        viewers: audienceLines.map((line) => ({
          platform: 'bilibili',
          userName: line.userName
        }))
      },
      requestTimeoutMs: 100,
      streamIdleTimeoutMs: 30,
      recoveryRequestTimeoutMs: 80,
      recoveryStreamIdleTimeoutMs: 25,
      onRecovery: (event) => recoveryEvents.push(event.phase)
    }
  ));

  assert.equal(outcome.status, 'resolved', 'two stalled upstream calls must still produce a reply');
  assert.equal(fetchCalls, 2, 'recovery must attempt exactly one compact upstream retry');
  assert.deepEqual(recoveryEvents, ['compact-retry', 'local-fallback']);
  assert.deepEqual(outcome.value.acknowledgedIndexes, [1, 2]);
  assert.match(outcome.value.reply, /Alice/u);
  assert.match(outcome.value.reply, /Bob/u);
  assert.match(outcome.value.caption, /Alice/u);
  assert.match(outcome.value.caption, /Bob/u);
  assert.equal(outcome.value.reply.includes(audienceLines[0].text), false);
  assert.equal(outcome.value.reply.includes(audienceLines[1].text), false);
  assert.equal(outcome.value.raw?.recovery, 'local-fallback');

  console.log('LLM live recovery checks passed');
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.localStorage;
  delete globalThis.window;
}
