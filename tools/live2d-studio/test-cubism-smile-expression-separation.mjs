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

function hasParam(frame, id) {
  return frame.some((item) => item.id === id);
}

try {
  const { createLive2DPerformanceBrain } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dPerformanceBrain.js'
  );
  const { sampleCubismBehaviorFrame } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dCubismBehaviorBridge.js'
  );
  const brain = createLive2DPerformanceBrain();

  brain.onRoomAct({
    expression: 'smile',
    emotion: 'happy',
    intensity: 0.72,
    durationMs: 1800,
    behaviorActions: [
      { type: 'smile', intensity: 0.72, delayMs: 0, durationMs: 1200 }
    ]
  }, 1000);

  const smileFrame = sampleCubismBehaviorFrame(brain.sample(1280), 1280);
  assert.ok(
    paramValue(smileFrame, 'ParamEyeLOpen') > 1.2 && paramValue(smileFrame, 'ParamEyeROpen') > 1.2,
    'plain smile should keep natural open eyes instead of forcing the closed-smile eye preset'
  );
  assert.equal(
    hasParam(smileFrame, 'ParamEyeSmile_Happy_L') || hasParam(smileFrame, 'ParamEyeSmile_Happy_R'),
    false,
    'plain smile should not stack the model-specific closed-smile eye expression'
  );

  brain.onRoomAct({
    expression: 'closed_smile',
    emotion: 'closed_smile',
    intensity: 0.72,
    durationMs: 1800,
    behaviorActions: [
      { type: 'smile', intensity: 0.72, delayMs: 0, durationMs: 1200 }
    ]
  }, 3400);

  const closedSmileFrame = sampleCubismBehaviorFrame(brain.sample(3680), 3680);
  assert.ok(
    paramValue(closedSmileFrame, 'ParamEyeLOpen') < 0.1 && paramValue(closedSmileFrame, 'ParamEyeROpen') < 0.1,
    'closed_smile should still intentionally close the eyes'
  );
  assert.ok(
    hasParam(closedSmileFrame, 'ParamEyeSmile_Happy_L') && hasParam(closedSmileFrame, 'ParamEyeSmile_Happy_R'),
    'closed_smile should keep the dedicated happy-eye expression'
  );
} finally {
  Math.random = originalRandom;
  await server.close();
}

console.log('cubism smile expression separation checks passed');
