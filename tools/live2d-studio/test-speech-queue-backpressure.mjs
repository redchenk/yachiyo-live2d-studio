import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createLive2DCaptionSynchronizer } from '../../src/frontend/services/room/live2dCaptionSynchronizer.js';

const store = new Map([
  ['roomTTSSettings', JSON.stringify({
    enabled: true,
    provider: 'mock-tts',
    useProxy: true
  })]
]);
const started = [];
const audios = [];

globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  }
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
};
globalThis.window = {
  location: {
    protocol: 'http:',
    hostname: '127.0.0.1',
    origin: 'http://127.0.0.1'
  },
  setTimeout,
  clearTimeout,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  dispatchEvent() {
    return true;
  }
};
globalThis.fetch = async (url) => {
  assert.equal(String(url), '/api/tts');
  return new Response(new Blob(['mock audio'], { type: 'audio/wav' }), { status: 200 });
};
globalThis.Audio = class MockAudio {
  constructor(src = '') {
    this.src = src;
    this.dataset = {};
    this.duration = 1;
    this.currentTime = 0;
    this.paused = true;
    this.ended = false;
    audios.push(this);
  }

  play() {
    this.paused = false;
    this.onplay?.();
    queueMicrotask(() => this.onplaying?.());
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  finish() {
    this.currentTime = this.duration;
    this.ended = true;
    this.paused = true;
    this.onended?.();
  }
};

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

let player = null;
try {
  const {
    adaptLive2DInterTurnPauseMs,
    createLive2DSpeechPlayer
  } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dSpeech.js'
  );
  assert.equal(adaptLive2DInterTurnPauseMs(240, 0), 240);
  assert.equal(adaptLive2DInterTurnPauseMs(240, 2), 150);
  assert.equal(
    adaptLive2DInterTurnPauseMs(240, 4),
    110,
    'heavy reply backlog must keep the human pause short'
  );
  player = createLive2DSpeechPlayer();

  const firstAudience = player.enqueue('第一条弹幕', {
    queueGroup: 'bilibili-read',
    priority: 10,
    maxQueuedInGroup: 1,
    onStart: () => started.push('audience-1')
  }).catch((error) => error.name);
  await waitFor(() => started.length === 1, 'first audience speech');

  const staleAudience = player.enqueue('很快就过时的第二条弹幕', {
    queueGroup: 'bilibili-read',
    priority: 10,
    maxQueuedInGroup: 1,
    onStart: () => started.push('audience-2')
  }).catch((error) => error.name);
  const latestAudience = player.enqueue('最新的第三条弹幕', {
    queueGroup: 'bilibili-read',
    priority: 10,
    maxQueuedInGroup: 1,
    onStart: () => started.push('audience-3')
  }).catch((error) => error.name);
  const liveReply = player.enqueue('八千代的当前回复', {
    queueGroup: 'live-reply',
    priority: 100,
    onStart: () => started.push('reply')
  }).catch((error) => error.name);

  audios.find((audio) => !audio.ended && !audio.paused)?.finish();
  await waitFor(() => started.length >= 2, 'next prioritized speech');

  assert.deepEqual(
    started.slice(0, 2),
    ['audience-1', 'reply'],
    'AI reply must jump ahead of queued read-aloud danmaku'
  );
  assert.equal(
    await staleAudience,
    'AbortError',
    'superseded ordinary danmaku must be removed instead of spoken late'
  );

  player.stop();
  await Promise.allSettled([firstAudience, latestAudience, liveReply]);

  let expiredStarted = false;
  const expiredResult = await player.enqueue('已经过期的弹幕', {
    queueGroup: 'bilibili-read',
    priority: 10,
    expiresAt: Date.now() - 1,
    onStart: () => {
      expiredStarted = true;
    }
  }).catch((error) => error.name);
  assert.equal(expiredResult, 'AbortError');
  assert.equal(expiredStarted, false, 'expired speech must never reach audio playback');

  let releaseCaptionGate;
  const captionGate = new Promise((resolve) => {
    releaseCaptionGate = resolve;
  });
  let gatedSpeechStarted = false;
  const audioCountBeforeGate = audios.length;
  const gatedSpeech = player.enqueue('Japanese TTS source', {
    queueGroup: 'live-reply',
    priority: 100,
    startGate: captionGate,
    onStart: () => {
      gatedSpeechStarted = true;
    }
  });
  await waitFor(() => audios.length > audioCountBeforeGate, 'gated speech synthesis');
  const gatedAudio = audios.at(-1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    gatedSpeechStarted,
    false,
    'speech must not start before its Chinese caption is ready'
  );
  assert.equal(gatedAudio.paused, true, 'prepared audio must remain paused behind the caption gate');

  releaseCaptionGate('\u4e2d\u6587\u5b57\u5e55\u5df2\u5c31\u7eea');
  await waitFor(() => gatedSpeechStarted, 'caption-gated speech playback');
  assert.equal(gatedAudio.paused, false);
  gatedAudio.finish();
  await gatedSpeech;

  let cancelledGateStarted = false;
  const audioCountBeforeCancelledGate = audios.length;
  const cancelledGateSpeech = player.enqueue('Cancelled gated TTS source', {
    queueGroup: 'live-reply',
    priority: 100,
    startGate: new Promise(() => {}),
    onStart: () => {
      cancelledGateStarted = true;
    }
  }).catch((error) => error.name);
  await waitFor(() => audios.length > audioCountBeforeCancelledGate, 'cancelled gated speech synthesis');
  player.stop();
  assert.equal(await cancelledGateSpeech, 'AbortError');
  assert.equal(cancelledGateStarted, false, 'stopping must cancel caption-gated speech immediately');

  const synchronizedCaptions = [];
  const captionSynchronizer = createLive2DCaptionSynchronizer({
    holdMs: 0,
    onChange: (caption) => {
      if (caption) synchronizedCaptions.push(caption);
    }
  });
  const pipelinedStarts = [];
  let firstReplyCaptionToken = 0;
  let secondReplyCaptionToken = 0;
  const firstReply = player.enqueue('第一轮流式回复', {
    queueGroup: 'live-reply',
    priority: 100,
    onStart: () => {
      pipelinedStarts.push('reply-1');
      firstReplyCaptionToken = captionSynchronizer.start({ fallback: '第一轮字幕' });
    }
  }).finally(() => captionSynchronizer.finish(firstReplyCaptionToken));
  await waitFor(() => pipelinedStarts.length === 1, 'first pipelined reply');
  const secondReply = player.enqueue('第二轮流式回复', {
    queueGroup: 'live-reply',
    priority: 100,
    interTurnPauseMs: 30,
    onStart: () => {
      pipelinedStarts.push('reply-2');
      secondReplyCaptionToken = captionSynchronizer.start({ fallback: '第二轮字幕' });
    }
  }).finally(() => captionSynchronizer.finish(secondReplyCaptionToken));

  const firstReplyEndedAt = Date.now();
  audios.find((audio) => !audio.ended && !audio.paused)?.finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    pipelinedStarts,
    ['reply-1'],
    'the next audience reply must not start in the same tick as the previous reply ends'
  );
  await waitFor(() => pipelinedStarts.length === 2, 'second pipelined reply');
  assert.ok(
    Date.now() - firstReplyEndedAt >= 15,
    'the next audience reply should preserve a perceptible but short boundary pause'
  );
  assert.deepEqual(pipelinedStarts, ['reply-1', 'reply-2']);
  assert.deepEqual(synchronizedCaptions, ['第一轮字幕', '第二轮字幕']);

  audios.find((audio) => !audio.ended && !audio.paused)?.finish();
  await Promise.allSettled([firstReply, secondReply]);

  console.log('speech queue backpressure checks passed');
} finally {
  player?.destroy();
  await server.close();
}
