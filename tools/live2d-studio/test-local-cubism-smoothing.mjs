import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

function paramValue(frame, id) {
  return frame.find((item) => item.id === id)?.value;
}

try {
  const {
    __resetLocalCubismSmoothingForTests,
    smoothLocalCubismFrame
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dLocalCubismBridge.js');

  __resetLocalCubismSmoothingForTests();

  const first = smoothLocalCubismFrame([
    { id: 'ParamAngleX', value: 18, weight: 1 },
    { id: 'ParamAngleY', value: -6, weight: 1 }
  ], 1000);
  assert.equal(paramValue(first, 'ParamAngleX'), 18);

  const handoff = smoothLocalCubismFrame([
    { id: 'ParamAngleY', value: -5, weight: 1 }
  ], 1016);
  const releasedAngleX = paramValue(handoff, 'ParamAngleX');
  assert.ok(
    Math.abs(Number(releasedAngleX) || 0) > 0.05,
    'missing Cubism parameters should release smoothly instead of disappearing between action queues'
  );
  assert.ok(
    Math.abs(releasedAngleX) < 18,
    'released Cubism parameters should move toward neutral during the handoff'
  );
} finally {
  await server.close();
}

console.log('local cubism smoothing checks passed');
