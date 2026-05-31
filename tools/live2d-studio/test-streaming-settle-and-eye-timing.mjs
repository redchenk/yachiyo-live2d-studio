import assert from 'node:assert/strict';
import { createServer } from 'vite';

function maxPoseDelta(left, right) {
  const keys = ['faceY', 'bodyY', 'bodyPosY', 'faceZ', 'bodyZ'];
  return Math.max(...keys.map((key) => Math.abs((Number(right[key]) || 0) - (Number(left[key]) || 0))));
}

const originalRandom = Math.random;
Math.random = () => 0.5;

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
});

try {
  const { createLive2DBehaviorPlan } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dBehaviorOrchestrator.js'
  );
  const { createLive2DPerformanceBrain } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dPerformanceBrain.js'
  );

  const eyePlan = createLive2DBehaviorPlan([
    { type: 'blink', durationMs: 340, delayMs: 0 },
    { type: 'wink', durationMs: 520, delayMs: 420 },
    { type: 'nod', durationMs: 1000, delayMs: 700 }
  ], 2200, { now: 1000, durationScale: 0.65 });
  const blink = eyePlan.actions.find((action) => action.type === 'blink');
  const wink = eyePlan.actions.find((action) => action.type === 'wink');

  assert.equal(blink.durationMs, 340, 'blink duration must keep natural timing');
  assert.equal(blink.tempo, 1, 'blink tempo must not be accelerated');
  assert.equal(wink.durationMs, 520, 'wink duration must keep natural timing');
  assert.equal(wink.tempo, 1, 'wink tempo must not be accelerated');

  const brain = createLive2DPerformanceBrain();
  brain.onExternalState({
    mode: 'speaking',
    holdMs: 3000,
    attention: 0.88,
    arousal: 0.68
  }, 1000);
  brain.onRoomAct({
    source: 'streaming-speech',
    emotion: 'happy',
    expression: 'smile',
    intensity: 0.72,
    durationMs: 1800,
    behaviorActions: [
      { type: 'nod', intensity: 0.72, delayMs: 0, durationMs: 900 },
      { type: 'sway', intensity: 0.72, delayMs: 620, durationMs: 1100 }
    ]
  }, 1000);

  const beforeComplete = brain.sample(2750).character;
  const completedFrame = brain.sample(2800);
  const afterComplete = brain.sample(2850).character;
  const settling = brain.sample(3200).character;
  const settled = brain.sample(3800).character;

  assert.equal(completedFrame.completed, true, 'streaming plan should complete at its end');
  assert.equal(completedFrame.character.mode, 'listening', 'streaming completion should enter settle mode immediately');
  assert.ok(completedFrame.character.speakingBlend > 0.98, 'completion frame should retain the speaking pose');
  assert.ok(afterComplete.speakingBlend > 0.95, 'first settle frames should keep speaking pose continuity');
  assert.ok(settling.speakingBlend > 0 && settling.speakingBlend < afterComplete.speakingBlend, 'speaking pose should fade down after completion');
  assert.equal(settled.speakingBlend, 0, 'speaking pose tail should finish after the release blend');
  assert.ok(
    maxPoseDelta(beforeComplete, afterComplete) < 0.26,
    'streaming completion should not introduce a sharp body-pose jump'
  );
} finally {
  Math.random = originalRandom;
  await server.close();
}

console.log('streaming settle and eye timing checks passed');
