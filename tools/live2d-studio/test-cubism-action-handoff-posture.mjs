import assert from 'node:assert/strict';
import { createServer } from 'vite';

const originalRandom = Math.random;
Math.random = () => 0.5;

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

function paramValue(frame, id) {
  return Number(frame.find((item) => item.id === id)?.value) || 0;
}

try {
  const { createLive2DPerformanceBrain } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dPerformanceBrain.js'
  );
  const { sampleCubismBehaviorFrame } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dCubismBehaviorBridge.js'
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

  const completedFrame = brain.sample(2020);
  assert.equal(completedFrame.completed, true);
  const completedCubismFrame = sampleCubismBehaviorFrame(completedFrame, 2020);
  const completedVerticalBody = Math.abs(paramValue(completedCubismFrame, 'ParamBodyInput_BodyY'));

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
  assert.equal(handoffFrame.active, true);
  assert.equal(handoffFrame.samples.length, 0);

  const handoffCubismFrame = sampleCubismBehaviorFrame(handoffFrame, 2120);
  const handoffVerticalBody = Math.abs(paramValue(handoffCubismFrame, 'ParamBodyInput_BodyY'));
  assert.ok(
    handoffVerticalBody < completedVerticalBody * 0.65,
    'Cubism action handoff should not briefly take over with the idle/listening vertical body pose'
  );
} finally {
  Math.random = originalRandom;
  await server.close();
}

console.log('cubism action handoff posture checks passed');
