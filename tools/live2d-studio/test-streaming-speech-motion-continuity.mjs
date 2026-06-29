import assert from 'node:assert/strict';
import { createServer } from 'vite';

let seed = 42;
const originalRandom = Math.random;
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

function frameMap(frame) {
  return new Map(frame.map((item) => [item.id, Number(item.value) || 0]));
}

const watchedParameters = [
  'ParamAngleX',
  'ParamAngleY',
  'ParamAngleZ',
  'PositionX',
  'PositionY',
  'ParamBodyInput_BodyX',
  'ParamBodyInput_BodyY',
  'ParamBodyInput_BodyZ',
  'ParamAngle_BodyX',
  'ParamAngle_BodyY',
  'ParamAngle_BodyZ',
  'ParamOutput_BodyX',
  'ParamOutput_BodyY',
  'ParamOutput_BodyZ'
];

function largestFrameDelta(previous, next, now) {
  if (!previous) return null;
  return watchedParameters.reduce((largest, id) => {
    const before = previous.get(id) ?? 0;
    const after = next.get(id) ?? 0;
    const delta = Math.abs(after - before);
    return delta > largest.delta ? { id, delta, before, after, now } : largest;
  }, { id: '', delta: 0, before: 0, after: 0, now });
}

try {
  const { createLive2DPerformanceBrain } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dPerformanceBrain.js'
  );
  const { sampleCubismBehaviorFrame } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dCubismBehaviorBridge.js'
  );
  const {
    __resetLocalCubismSmoothingForTests,
    smoothLocalCubismFrame
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dLocalCubismBridge.js');

  const brain = createLive2DPerformanceBrain();
  __resetLocalCubismSmoothingForTests();
  brain.onExternalState({
    mode: 'speaking',
    holdMs: 5200,
    emotion: 'happy',
    attention: 0.88,
    arousal: 0.72
  }, 1000);

  const chunks = [
    { at: 1000, type: 'nod', durationMs: 1050 },
    { at: 1520, type: 'sway', durationMs: 980 },
    { at: 2120, type: 'smile', durationMs: 900 },
    { at: 2740, type: 'lean_in', durationMs: 1100 },
    { at: 3380, type: 'nod', durationMs: 950 }
  ];

  let chunkIndex = 0;
  let previous = null;
  let worst = { id: '', delta: 0, before: 0, after: 0, now: 0 };

  let frameIndex = 0;
  for (let now = 1000; now <= 4700;) {
    while (chunkIndex < chunks.length && now >= chunks[chunkIndex].at) {
      const chunk = chunks[chunkIndex++];
      brain.onRoomAct({
        source: 'streaming-speech',
        emotion: 'happy',
        expression: 'smile',
        intensity: 0.78,
        durationMs: chunk.durationMs + 760,
        behaviorActions: [
          { type: chunk.type, intensity: 0.76, delayMs: 0, durationMs: chunk.durationMs }
        ]
      }, chunk.at);
    }

    const rawFrame = sampleCubismBehaviorFrame(brain.sample(now, { intensityScale: 1.86 }), now);
    const smoothFrame = smoothLocalCubismFrame(rawFrame, now);
    const current = frameMap(smoothFrame);
    const delta = largestFrameDelta(previous, current, now);
    if (delta && delta.delta > worst.delta) worst = delta;
    previous = current;

    const browserJitterMs = frameIndex === 68 || frameIndex === 194 ? 28 : 16;
    now += browserJitterMs;
    frameIndex += 1;
  }

  assert.ok(
    worst.delta <= 1.65,
    `streaming speech motion should not jerk; max ${worst.id} delta ${worst.delta.toFixed(3)} at ${worst.now}ms`
  );
} finally {
  Math.random = originalRandom;
  await server.close();
}

console.log('streaming speech motion continuity checks passed');
