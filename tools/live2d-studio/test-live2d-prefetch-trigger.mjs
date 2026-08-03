import assert from 'node:assert/strict';
import { createLive2DPrefetchWindowTrigger } from '../../src/frontend/services/room/live2dTurnPipeline.js';

const opened = [];
const trigger = createLive2DPrefetchWindowTrigger((source) => opened.push(source));

assert.equal(trigger.sentenceReady(), true, 'first usable streamed sentence must open prefetch');
assert.equal(trigger.playbackStarted(), false, 'playback start must not open the same window twice');
assert.equal(trigger.sentenceReady(), false);
assert.deepEqual(opened, ['sentence-ready']);

const playbackFallback = [];
const fallbackTrigger = createLive2DPrefetchWindowTrigger((source) => playbackFallback.push(source));
assert.equal(fallbackTrigger.playbackStarted(), true, 'playback remains a fallback when no sentence hook fired');
assert.deepEqual(playbackFallback, ['playback-started']);

const disabled = createLive2DPrefetchWindowTrigger(() => {
  throw new Error('disabled prefetch must not run');
}, { isActive: () => false });
assert.equal(disabled.sentenceReady(), false);

console.log('Live2D prefetch trigger checks passed');
