import assert from 'node:assert/strict';
import { createServer } from 'vite';

const originalRandom = Math.random;
Math.random = () => 0.5;

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const { createLive2DPerformanceBrain } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dPerformanceBrain.js'
  );
  const brain = createLive2DPerformanceBrain();

  brain.onExternalState({
    mode: 'speaking',
    holdMs: 2400,
    attention: 0.88,
    arousal: 0.68
  }, 1000);

  brain.onRoomAct({
    source: 'streaming-speech',
    emotion: 'happy',
    expression: 'smile',
    intensity: 0.72,
    durationMs: 1000,
    behaviorActions: [
      { type: 'nod', intensity: 0.72, delayMs: 0, durationMs: 900 }
    ]
  }, 1000);

  assert.ok(brain.sample(1500).dominant?.energy > 0.8, 'first queue should be active before completion');
  assert.equal(brain.sample(2020).completed, true, 'first queue should complete before the next queue arrives');

  brain.onRoomAct({
    source: 'streaming-speech',
    emotion: 'happy',
    expression: 'smile',
    intensity: 0.72,
    durationMs: 1200,
    behaviorActions: [
      { type: 'sway', intensity: 0.72, delayMs: 0, durationMs: 1000 }
    ]
  }, 2120);

  const handoffFrame = brain.sample(2120);
  assert.equal(handoffFrame.character.mode, 'speaking');
  assert.ok(handoffFrame.samples.length > 0, 'next queue should produce action samples immediately');
  assert.ok(
    Number(handoffFrame.dominant?.energy) > 0.08,
    'next queue should not start with a zero-energy frame after a just-completed queue'
  );
  assert.ok(
    Number(handoffFrame.dominant?.energy) < 0.72,
    'next queue should fade in instead of entering at full action energy'
  );
  assert.ok(
    Number(brain.sample(2380).dominant?.energy) > Number(handoffFrame.dominant?.energy),
    'handoff action energy should ramp up after the queue boundary'
  );
} finally {
  Math.random = originalRandom;
  await server.close();
}

console.log('action queue handoff checks passed');
