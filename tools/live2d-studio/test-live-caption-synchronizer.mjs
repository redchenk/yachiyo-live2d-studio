import assert from 'node:assert/strict';
import {
  createLive2DCaptionSynchronizer,
  createLive2DOrderedCaptionTranscript
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

assert.deepEqual(changes, ['旧句', '当前句', '当前句中文', '']);
console.log('live caption synchronizer checks passed');
