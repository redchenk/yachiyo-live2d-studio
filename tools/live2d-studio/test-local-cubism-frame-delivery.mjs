import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const previousWindow = globalThis.window;
try {
  const { createLive2DPerformanceBrain } = await server.ssrLoadModule('/src/frontend/services/room/live2dPerformanceBrain.js');
  const brain = createLive2DPerformanceBrain();
  const sample = brain.characterState.sample;
  let characterSamples = 0;
  brain.characterState.sample = (...args) => { characterSamples++; return sample(...args); };
  const local = brain.sample(1000, { intensityScale: 1.86 });
  const stage = brain.sample(1000, { intensityScale: 1.62 });
  assert.equal(characterSamples, 1, 'two render consumers must not advance or decay the character twice');
  assert.equal(local.character, stage.character, 'same display frame shares its character snapshot');
  const next = brain.sample(1008.333, { intensityScale: 1.62 });
  assert.notEqual(next, stage, '120 Hz frames must not reuse a quantized 16 ms pose');
  assert.equal(characterSamples, 2);
  brain.onExternalState({ mode: 'thinking' }, 1008.333);
  brain.sample(1008.333, { intensityScale: 1.62 });
  assert.equal(characterSamples, 3, 'input changes invalidate cached character state');

  const callbacks = new Map();
  const frames = [];
  let sequence = 0;
  globalThis.window = {
    TSUKUYOMI_LOCAL_CUBISM_BRIDGE: { setFrame: frame => frames.push(frame) },
    requestAnimationFrame(fn) { callbacks.set(++sequence, fn); return sequence; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
  };
  const { mountLocalCubismBridge } = await server.ssrLoadModule('/src/frontend/services/room/live2dLocalCubismBridge.js');
  const destroy = mountLocalCubismBridge();
  assert.equal(callbacks.size, 1);
  const [id, callback] = callbacks.entries().next().value;
  callbacks.delete(id); callback(1000);
  assert.equal(frames.length, 1, 'the current pose reaches Cubism in the sampling frame, without another RAF');
  assert.ok(frames[0].some(({ id }) => id === 'ParamAngleX'));
  assert.equal(callbacks.size, 1, 'only the next sampling frame remains scheduled');
  destroy();
  assert.equal(callbacks.size, 0, 'unmount cancels the animation loop');
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  await server.close();
}
console.log('Local Cubism frame delivery and shared-character checks passed');
