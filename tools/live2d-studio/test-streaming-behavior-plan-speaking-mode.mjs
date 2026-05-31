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
  assert.equal(brain.getBehaviorPlan()?.source, 'streaming-speech');
} finally {
  await server.close();
}

console.log('streaming behavior plan speaking mode checks passed');
