import assert from 'node:assert/strict';
import {
  createLive2DCaptionPlaybackGate,
  createLive2DPreparedCaption,
  createLive2DCaptionSynchronizer,
  createLive2DOrderedCaptionTranscript,
  resolveFirstLive2DChineseCaption,
  resolveLive2DChineseCaptionWithFallback
} from '../../src/frontend/services/room/live2dCaptionSynchronizer.js';

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const changes = [];
const timers = new Map();
let timerSequence = 0;
const synchronizer = createLive2DCaptionSynchronizer({
  onChange: (caption) => changes.push(caption),
  setTimeoutImpl: (callback) => {
    const id = timerSequence += 1;
    timers.set(id, callback);
    return id;
  },
  clearTimeoutImpl: (id) => timers.delete(id),
  holdMs: 200
});

const oldTranslation = deferred();
const currentTranslation = deferred();
const oldToken = synchronizer.start({
  fallback: '旧句',
  resolved: oldTranslation.promise
});
const currentToken = synchronizer.start({
  fallback: '当前句',
  resolved: currentTranslation.promise
});

oldTranslation.resolve('旧句中文');
await Promise.resolve();
assert.equal(synchronizer.read(), '当前句', 'late old translation must not replace the active caption');

currentTranslation.resolve('当前句中文');
await Promise.resolve();
assert.equal(synchronizer.read(), '当前句中文');

synchronizer.finish(oldToken);
assert.equal(timers.size, 0, 'finishing an old line must not clear the active caption');
synchronizer.finish(currentToken);
assert.equal(timers.size, 1);
for (const callback of timers.values()) callback();
timers.clear();
assert.equal(synchronizer.read(), '');

const transcript = createLive2DOrderedCaptionTranscript();
transcript.resolve(1, '第二句');
assert.equal(transcript.read(), '', 'a later sentence must wait for the missing earlier sentence');
transcript.resolve(0, '第一句');
assert.equal(transcript.read(), '第一句第二句');
transcript.resolve(2, '第三句');
assert.equal(transcript.read(), '第一句第二句第三句');

const pendingChineseCaption = deferred();
const preparedCaption = createLive2DPreparedCaption(pendingChineseCaption.promise, {
  unavailableText: '\u4e2d\u6587\u5b57\u5e55\u6682\u4e0d\u53ef\u7528'
});
assert.equal(
  preparedCaption.read(),
  '',
  'the Japanese speech source must never be exposed while Chinese translation is pending'
);
pendingChineseCaption.resolve('\u76f4\u63a5\u663e\u793a\u4e2d\u6587');
assert.equal(await preparedCaption.ready, '\u76f4\u63a5\u663e\u793a\u4e2d\u6587');
assert.equal(preparedCaption.read(), '\u76f4\u63a5\u663e\u793a\u4e2d\u6587');

const unavailableCaption = createLive2DPreparedCaption(Promise.reject(new Error('translation failed')), {
  unavailableText: '\u4e2d\u6587\u5b57\u5e55\u6682\u4e0d\u53ef\u7528'
});
assert.equal(
  await unavailableCaption.ready,
  '',
  'translation failures must stay visually silent instead of exposing an internal status message'
);

const pairedCaption = deferred();
const legacyCaption = deferred();
const firstUsableCaption = resolveFirstLive2DChineseCaption([
  pairedCaption.promise,
  legacyCaption.promise
], { timeoutMs: 100 });
legacyCaption.resolve('');
pairedCaption.resolve('\u76f4\u64ad\u6d41\u4e2d\u6587\u5b57\u5e55');
assert.equal(
  await firstUsableCaption,
  '\u76f4\u64ad\u6d41\u4e2d\u6587\u5b57\u5e55',
  'an empty fallback must not beat a valid caption from the main stream'
);

const fastCaptionStartedAt = Date.now();
assert.equal(
  await resolveFirstLive2DChineseCaption([
    Promise.resolve('\u4e0d\u7b49\u540e\u5907\u7528\u7ffb\u8bd1'),
    new Promise(() => {})
  ], { timeoutMs: 1000 }),
  '\u4e0d\u7b49\u540e\u5907\u7528\u7ffb\u8bd1'
);
assert.ok(Date.now() - fastCaptionStartedAt < 100, 'the main-stream caption must not wait for backup translation');

const captionTimeoutStartedAt = Date.now();
assert.equal(
  await resolveFirstLive2DChineseCaption([new Promise(() => {})], { timeoutMs: 20 }),
  '',
  'a stuck caption source must release playback without showing a placeholder'
);
assert.ok(Date.now() - captionTimeoutStartedAt < 150, 'caption release must use a bounded deadline');

assert.deepEqual(changes, ['旧句', '当前句', '当前句中文', '']);
let unusedFallbackCalls = 0;
assert.equal(
  await resolveLive2DChineseCaptionWithFallback(
    Promise.resolve('\u4e3b\u6d41\u5b57\u5e55'),
    () => {
      unusedFallbackCalls += 1;
      return Promise.resolve('\u5907\u7528\u5b57\u5e55');
    },
    { fallbackDelayMs: 30, timeoutMs: 200 }
  ),
  '\u4e3b\u6d41\u5b57\u5e55'
);
assert.equal(
  unusedFallbackCalls,
  0,
  'the backup translation request must stay lazy when the paired stream caption succeeds'
);

let delayedFallbackCalls = 0;
const delayedFallbackStartedAt = Date.now();
assert.equal(
  await resolveLive2DChineseCaptionWithFallback(
    new Promise(() => {}),
    () => {
      delayedFallbackCalls += 1;
      return Promise.resolve('\u5ef6\u8fdf\u540e\u7684\u5907\u7528\u5b57\u5e55');
    },
    { fallbackDelayMs: 15, timeoutMs: 200 }
  ),
  '\u5ef6\u8fdf\u540e\u7684\u5907\u7528\u5b57\u5e55'
);
assert.equal(delayedFallbackCalls, 1);
assert.ok(
  Date.now() - delayedFallbackStartedAt < 150,
  'a missing paired caption must start one bounded backup translation without waiting for stream completion'
);

const playbackCaption = createLive2DPreparedCaption(Promise.resolve('\u64ad\u653e\u524d\u5b57\u5e55'));
assert.equal(
  await createLive2DCaptionPlaybackGate(playbackCaption),
  '\u64ad\u653e\u524d\u5b57\u5e55',
  'TTS playback may start only after a non-empty Chinese caption is ready'
);
await assert.rejects(
  createLive2DCaptionPlaybackGate(createLive2DPreparedCaption(Promise.resolve(''))),
  (error) => error?.name === 'AbortError',
  'caption failure must cancel the audio item instead of playing without subtitles'
);

console.log('live caption synchronizer checks passed');
