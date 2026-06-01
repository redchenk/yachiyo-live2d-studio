import assert from 'node:assert/strict';
import { createServer } from 'vite';

const originalRandom = Math.random;
Math.random = () => 0.5;

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom'
});

try {
  const { createLive2DPerformanceBrain } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dPerformanceBrain.js'
  );
  const brain = createLive2DPerformanceBrain();

  brain.onExternalState({
    mode: 'speaking',
    holdMs: 2600,
    attention: 0.88,
    arousal: 0.68
  }, 1000);

  brain.onRoomAct({
    source: 'streaming-speech',
    emotion: 'happy',
    expression: 'smile',
    intensity: 0.72,
    durationMs: 2200,
    behaviorActions: [
      { type: 'nod', intensity: 0.72, delayMs: 0, durationMs: 1200 }
    ]
  }, 1120);

  const duringPlan = brain.sample(1280);
  assert.equal(
    duringPlan.character.mode,
    'speaking',
    'streaming speech behavior plans should not flip the character into acting between TTS chunks'
  );
  const firstPlan = brain.getBehaviorPlan();
  assert.equal(firstPlan?.source, 'streaming-speech');

  brain.onRoomAct({
    source: 'streaming-speech',
    emotion: 'happy',
    expression: 'smile',
    intensity: 0.72,
    durationMs: 2200,
    behaviorActions: [
      { type: 'sway', intensity: 0.72, delayMs: 0, durationMs: 1200 }
    ]
  }, 1460);

  const extendedPlan = brain.getBehaviorPlan();
  assert.equal(
    extendedPlan?.id,
    firstPlan?.id,
    'streaming speech action queues should extend the current behavior plan instead of replacing it'
  );
  assert.ok(
    extendedPlan.actions.length > firstPlan.actions.length,
    'extended streaming plans should keep queued actions continuous'
  );
  const handoffFrame = brain.sample(1520);
  const newActionEnergy = handoffFrame.samples.find((sample) => sample.action.type === 'sway')?.energy || 0;
  assert.equal(handoffFrame.character.mode, 'speaking');
  assert.ok(
    newActionEnergy < 0.16,
    'new streaming action queues should not immediately take over the current action'
  );
  assert.ok(
    (brain.sample(2180).samples.find((sample) => sample.action.type === 'sway')?.energy || 0) > newActionEnergy,
    'queued streaming actions should ramp in after the handoff window'
  );
} finally {
  Math.random = originalRandom;
  await server.close();
}

console.log('streaming behavior plan speaking mode checks passed');
