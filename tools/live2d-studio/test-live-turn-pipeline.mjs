import assert from 'node:assert/strict';
import { createLive2DTurnPipeline } from '../../src/frontend/services/room/live2dTurnPipeline.js';

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const concurrentEvents = [];
const firstGenerationGate = deferred();
const secondGenerationGate = deferred();
const concurrentPipeline = createLive2DTurnPipeline({ maxConcurrentGenerations: 2 });
const firstConcurrentRun = concurrentPipeline.runGeneration(async () => {
  concurrentEvents.push('generate-1-start');
  await firstGenerationGate.promise;
  concurrentEvents.push('generate-1-done');
  return { reply: '第一轮回复' };
});
await Promise.resolve();
assert.equal(concurrentPipeline.activeGenerationCount(), 1);
assert.equal(
  concurrentPipeline.canStartGeneration(),
  true,
  'the next LLM slot must be available while the first streamed turn is still finishing'
);
const secondConcurrentRun = concurrentPipeline.runGeneration(async () => {
  concurrentEvents.push('generate-2-start');
  await secondGenerationGate.promise;
  concurrentEvents.push('generate-2-done');
  return { reply: '第二轮回复' };
});
await Promise.resolve();
assert.deepEqual(
  concurrentEvents,
  ['generate-1-start', 'generate-2-start'],
  'TTS playback start must be able to launch the next LLM request before the previous stream ends'
);
assert.equal(concurrentPipeline.activeGenerationCount(), 2);
assert.equal(concurrentPipeline.canStartGeneration(), false);
assert.equal(
  (await concurrentPipeline.runGeneration(async () => ({ reply: 'must not run' }))).accepted,
  false,
  'only one look-ahead generation may run alongside the active streamed turn'
);
firstGenerationGate.resolve();
secondGenerationGate.resolve();
assert.equal((await firstConcurrentRun).accepted, true);
assert.equal((await secondConcurrentRun).accepted, true);
assert.equal(concurrentPipeline.activeGenerationCount(), 0);

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
