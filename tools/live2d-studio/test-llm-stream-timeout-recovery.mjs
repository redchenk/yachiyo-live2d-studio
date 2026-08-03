import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createLive2DTurnPipeline } from '../../src/frontend/services/room/live2dTurnPipeline.js';

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

function abortableNeverResponse(signal) {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason || new DOMException(
      'aborted',
      'AbortError'
    )), { once: true });
  });
}

function stalledSseResponse(signal) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        'data: {"choices":[{"delta":{"content":"VOICE: こんにちは。\\n"}}]}\n\n'
      ));
      signal?.addEventListener('abort', () => controller.error(
        signal.reason || new DOMException('aborted', 'AbortError')
      ), { once: true });
    }
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
}

function heartbeatOnlySseResponse(signal) {
  const encoder = new TextEncoder();
  let timer = null;
  return new Response(new ReadableStream({
    start(controller) {
      timer = setInterval(() => controller.enqueue(encoder.encode(': keep-alive\n\n')), 8);
      signal?.addEventListener('abort', () => {
        clearInterval(timer);
        controller.error(signal.reason || new DOMException('aborted', 'AbortError'));
      }, { once: true });
    },
    cancel() {
      clearInterval(timer);
    }
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
}

function successfulResponse() {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          reply: '回复已恢复',
          caption: '回复已恢复',
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

async function settleWithin(promise, timeoutMs = 250) {
  return Promise.race([
    promise.then(
      (value) => ({ status: 'resolved', value }),
      (error) => ({ status: 'rejected', error })
    ),
    new Promise((resolve) => setTimeout(() => resolve({ status: 'pending' }), timeoutMs))
  ]);
}

try {
  const {
    clearLive2DLLMHistory,
    requestLive2DControlStream
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

  let fetchMode = 'no-response';
  globalThis.fetch = async (_url, options = {}) => {
    if (fetchMode === 'no-response') return abortableNeverResponse(options.signal);
    if (fetchMode === 'stalled-stream') return stalledSseResponse(options.signal);
    if (fetchMode === 'heartbeat-only') return heartbeatOnlySseResponse(options.signal);
    return successfulResponse();
  };

  const noResponse = await settleWithin(requestLive2DControlStream('NO_RESPONSE_TURN', {
    requestTimeoutMs: 100,
    streamIdleTimeoutMs: 35
  }));
  assert.equal(
    noResponse.status,
    'rejected',
    'an LLM connection that never returns headers must release the live reply slot'
  );
  assert.equal(noResponse.error?.name, 'TimeoutError');

  fetchMode = 'stalled-stream';
  const partialSentences = [];
  const stalledStream = await settleWithin(requestLive2DControlStream('STALLED_STREAM_TURN', {
    requestTimeoutMs: 180,
    streamIdleTimeoutMs: 40,
    onSentence: (sentence) => partialSentences.push(sentence.text)
  }));
  assert.equal(partialSentences.length, 1, 'the first streamed sentence should still be delivered');
  assert.equal(
    stalledStream.status,
    'rejected',
    'an LLM stream that stops after a partial reply must release its prefetch barrier'
  );
  assert.equal(stalledStream.error?.name, 'TimeoutError');

  fetchMode = 'heartbeat-only';
  const heartbeatOnly = await settleWithin(requestLive2DControlStream('HEARTBEAT_ONLY_TURN', {
    requestTimeoutMs: 180,
    streamIdleTimeoutMs: 40
  }));
  assert.equal(
    heartbeatOnly.status,
    'rejected',
    'transport keep-alives without reply tokens must not keep a live reply slot occupied forever'
  );
  assert.equal(heartbeatOnly.error?.name, 'TimeoutError');

  fetchMode = 'no-response';
  const pipeline = createLive2DTurnPipeline({ maxConcurrentGenerations: 2 });
  const stalledSlots = await Promise.allSettled([
    pipeline.runGeneration(() => requestLive2DControlStream('STALLED_SLOT_ONE', {
      requestTimeoutMs: 100,
      streamIdleTimeoutMs: 30
    })),
    pipeline.runGeneration(() => requestLive2DControlStream('STALLED_SLOT_TWO', {
      requestTimeoutMs: 100,
      streamIdleTimeoutMs: 30
    }))
  ]);
  assert.deepEqual(
    stalledSlots.map((result) => result.status),
    ['rejected', 'rejected'],
    'both stalled look-ahead generations should time out'
  );
  assert.equal(pipeline.activeGenerationCount(), 0, 'timed-out requests must release both generation slots');
  assert.equal(pipeline.canStartGeneration(), true);

  fetchMode = 'success';
  const recoveredRun = await pipeline.runGeneration(
    () => requestLive2DControlStream('RECOVERED_AFTER_TIMEOUT')
  );
  const recovered = recoveredRun.result;
  assert.equal(recoveredRun.accepted, true);
  assert.equal(
    recovered.reply,
    '回复已恢复',
    'a later audience turn must succeed after timed-out reservations release the concurrent pipeline'
  );

  console.log('LLM stream timeout recovery checks passed');
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.localStorage;
  delete globalThis.window;
}
