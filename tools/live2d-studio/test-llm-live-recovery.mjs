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
    readLive2DLLMHistory,
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
      onRecovery: (event) => recoveryEvents.push({
        phase: event.phase,
        failureKind: event.failureKind
      })
    }
  ));

  assert.equal(outcome.status, 'resolved', 'two stalled upstream calls must still produce a reply');
  assert.equal(fetchCalls, 2, 'recovery must attempt exactly one compact upstream retry');
  assert.deepEqual(recoveryEvents, [
    { phase: 'compact-retry', failureKind: 'stream-idle-timeout' },
    { phase: 'local-fallback', failureKind: 'stream-idle-timeout' }
  ]);
  assert.deepEqual(outcome.value.acknowledgedIndexes, [1, 2]);
  assert.match(outcome.value.reply, /Alice/u);
  assert.match(outcome.value.reply, /Bob/u);
  assert.match(outcome.value.caption, /Alice/u);
  assert.match(outcome.value.caption, /Bob/u);
  assert.equal(outcome.value.reply.includes(audienceLines[0].text), false);
  assert.equal(outcome.value.reply.includes(audienceLines[1].text), false);
  assert.equal(outcome.value.raw?.recovery, 'local-fallback');
  assert.deepEqual(
    readLive2DLLMHistory(),
    [],
    'synthetic recovery speech must not contaminate LLM history or later memory writes'
  );

  const ordinaryAudience = [{
    messageType: 'danmu',
    userName: 'Carol',
    text: 'ordinary viewer payload'
  }];
  const ordinaryRecovery = async (overrides = {}) => requestLive2DControlStreamWithRecovery(
    'LIVE_DIRECTOR_TICK',
    {
      audienceLines: ordinaryAudience,
      requestTimeoutMs: 100,
      streamIdleTimeoutMs: 30,
      recoveryRequestTimeoutMs: 80,
      recoveryStreamIdleTimeoutMs: 25,
      ...overrides
    }
  );
  const firstOrdinary = await ordinaryRecovery();
  const secondOrdinary = await ordinaryRecovery();
  assert.notEqual(
    firstOrdinary.caption,
    secondOrdinary.caption,
    'consecutive local recovery turns must not repeat the same audience-facing template'
  );
  assert.doesNotMatch(firstOrdinary.caption, /思考|卡住|故障|超时/u);
  assert.doesNotMatch(secondOrdinary.caption, /思考|卡住|故障|超时/u);

  const ordinaryCaptions = [firstOrdinary.caption, secondOrdinary.caption];
  for (let index = 0; index < 4; index += 1) {
    ordinaryCaptions.push((await ordinaryRecovery()).caption);
  }
  assert.equal(
    new Set(ordinaryCaptions).size,
    6,
    'all safe ordinary recovery templates must rotate before suppression'
  );
  let suppressedSentenceCount = 0;
  const suppressedRecoveryEvents = [];
  const suppressed = await ordinaryRecovery({
    onSentence: () => { suppressedSentenceCount += 1; },
    onRecovery: (event) => suppressedRecoveryEvents.push(event.phase)
  });
  assert.equal(suppressed.reply, '');
  assert.equal(suppressed.caption, '');
  assert.deepEqual(suppressed.acknowledgedIndexes, []);
  assert.equal(suppressed.raw?.recovery, 'local-fallback-suppressed');
  assert.equal(suppressedSentenceCount, 0, 'suppression must stay silent to viewers');
  assert.deepEqual(
    suppressedRecoveryEvents,
    ['compact-retry', 'local-fallback-suppressed']
  );

  const paidRecoveries = [];
  for (let index = 0; index < 6; index += 1) {
    paidRecoveries.push(await requestLive2DControlStreamWithRecovery(
      'LIVE_DIRECTOR_TICK',
      {
        audienceLines: [audienceLines[0]],
        requestTimeoutMs: 100,
        streamIdleTimeoutMs: 30,
        recoveryRequestTimeoutMs: 80,
        recoveryStreamIdleTimeoutMs: 25
      }
    ));
  }
  assert.ok(paidRecoveries.every((result) => result.reply && result.caption));
  assert.ok(paidRecoveries.every((result) => result.acknowledgedIndexes[0] === 1));
  assert.ok(paidRecoveries.every((result) => /Alice/u.test(result.caption)));
  assert.ok(paidRecoveries.every((result) => /Coffee/u.test(result.caption)));
  assert.ok(paidRecoveries.every((result) => !/思考|卡住|故障|超时/u.test(result.caption)));
  assert.ok(
    new Set(paidRecoveries.map((result) => result.caption)).size >= 4,
    'paid recovery must rotate dedicated thank-you templates without becoming silent'
  );

  let autonomousSentenceCount = 0;
  const autonomousRecovery = await requestLive2DControlStreamWithRecovery(
    'LIVE_DIRECTOR_TICK',
    {
      audienceLines: [],
      requestTimeoutMs: 100,
      streamIdleTimeoutMs: 30,
      recoveryRequestTimeoutMs: 80,
      recoveryStreamIdleTimeoutMs: 25,
      onSentence: () => { autonomousSentenceCount += 1; }
    }
  );
  assert.equal(autonomousRecovery.raw?.recovery, 'local-fallback-suppressed');
  assert.equal(autonomousSentenceCount, 0, 'an autonomous timeout must stay silent');

  console.log('LLM live recovery checks passed');
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.localStorage;
  delete globalThis.window;
}
