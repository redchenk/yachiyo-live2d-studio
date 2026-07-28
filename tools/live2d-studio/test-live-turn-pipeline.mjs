import assert from 'node:assert/strict';
import { createLive2DTurnPipeline } from '../../src/frontend/services/room/live2dTurnPipeline.js';

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const firstPlayback = deferred();
const secondPlayback = deferred();
const events = [];
const pipeline = createLive2DTurnPipeline({
  onPlaybackIdle: () => events.push('playback-idle')
});

const firstResult = await pipeline.runGeneration(async () => {
  events.push('generate-1');
  return {
    reply: '第一条回复',
    playbackDone: firstPlayback.promise
  };
});
assert.equal(firstResult.accepted, true);
assert.equal(pipeline.isGenerationInFlight(), false);
assert.equal(pipeline.pendingPlaybackCount(), 1);

const secondResult = await pipeline.runGeneration(async () => {
  events.push('generate-2');
  return {
    reply: '第二条回复',
    playbackDone: secondPlayback.promise
  };
});
assert.equal(secondResult.accepted, true);
assert.deepEqual(
  events,
  ['generate-1', 'generate-2'],
  'the next LLM generation must start before the previous TTS/audio playback settles'
);
assert.equal(pipeline.pendingPlaybackCount(), 2);

firstPlayback.resolve();
await Promise.resolve();
await Promise.resolve();
assert.equal(pipeline.pendingPlaybackCount(), 1);
assert.equal(events.includes('playback-idle'), false);

secondPlayback.resolve();
await Promise.resolve();
await Promise.resolve();
assert.equal(pipeline.pendingPlaybackCount(), 0);
assert.equal(events.at(-1), 'playback-idle');

console.log('live turn pipeline checks passed');
