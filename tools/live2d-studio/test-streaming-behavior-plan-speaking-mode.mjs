import assert from 'node:assert/strict';
import { createServer } from 'vite';

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
  assert.equal(brain.sample(1520).character.mode, 'speaking');
} finally {
  await server.close();
}

console.log('streaming behavior plan speaking mode checks passed');
