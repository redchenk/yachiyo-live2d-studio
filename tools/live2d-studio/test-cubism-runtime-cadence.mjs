import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped runtime entry point with a deterministic display clock.
// Stub WebGL/model work only; keep its actual scheduling and event handlers.
const bundle = fs.readFileSync(new URL('../../lib/bundled/live2d-room-neuro-live.iife.js', import.meta.url), 'utf8');
const start = bundle.indexOf('function tsukuyomiCubismShouldRender(');
const entry = bundle.slice(start < 0 ? bundle.indexOf('function Zi()') : start, bundle.indexOf('window.initTsukuyomiLive2DRoom=oa'));
function runtime({ bridge = false, mobile = false } = {}) {
  let callback;
  const draws = [];
  const calls = [];
  const listeners = new Map();
  const canvas = { style: {}, dataset: {}, remove() {} };
  const manager = Object.fromEntries(['setExpression', 'startTapBodyMotion', 'startProceduralBodyPose', 'setParameterTargets', 'setFaceCaptureParameters', 'setMouthOpen'].map(name => [name, (...args) => calls.push([name, ...args])]));
  const noop = () => {};
  const context = vm.createContext({
    console,
  });
  Object.assign(context, {
    $: null, Xi: () => mobile, qi: new Set(['smile', 'neutral']), Ji: new Set(['tap_body']), Yi: new Set(['nod', 'sway']),
    N: { updateTime: noop }, be: class {}, Oe: 0, j: { startUp: noop, initialize: noop },
    Ki: class { initialize() { return true; } getLive2DManager() { return manager; } update() { draws.push(context.clock); } release() {} },
    document: { visibilityState: 'visible', getElementById: () => ({ clientWidth: 800, clientHeight: 600, appendChild: noop }), createElement: () => canvas, addEventListener: noop, removeEventListener: noop },
    window: { TSUKUYOMI_CUBISM_STARTED: true, TSUKUYOMI_CUBISM_BEHAVIOR_BRIDGE: bridge, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: noop },
    requestAnimationFrame: fn => { callback = fn; return 1; }, cancelAnimationFrame: noop,
    clock: 0, Node: class {}
  });
  vm.runInContext(entry + ';oa();', context);
  return { draws, calls, frame(at) { context.clock = at; callback(at); }, act(detail) { listeners.get('tsukuyomi:room-act')({ detail }); }, visibility(value) { context.document.visibilityState = value; context.$.onVisibilityChange(); } };
}
for (const hz of [60, 120, 144]) {
  const rt = runtime();
  for (let i = 0; i < hz * 3; i++) rt.frame(1000 + i * 1000 / hz + (i % 2 ? 0.08 : -0.08));
  assert.ok(rt.draws.length >= 179 && rt.draws.length <= 181, `${hz} Hz display should render about 180 frames in 3 seconds, got ${rt.draws.length}`);
  rt.visibility('hidden'); rt.frame(5000); const before = rt.draws.length;
  rt.visibility('visible'); rt.frame(5001);
  assert.equal(rt.draws.length, before + 1, 'resume must render immediately without catching up hidden frames');
}
const managed = runtime({ bridge: true });
managed.act({ expression: 'smile', bodyPose: 'nod', motion: 'tap_body', durationMs: 1800 });
assert.equal(managed.calls.filter(([name]) => name === 'startProceduralBodyPose' || name === 'startTapBodyMotion').length, 0, 'semantic bridge must be the only body-motion owner');
assert.equal(managed.calls.filter(([name]) => name === 'setExpression').length, 1, 'model-authored expression files must still apply');
const standalone = runtime();
standalone.act({ expression: 'smile', bodyPose: 'nod', durationMs: 1800 });
assert.ok(standalone.calls.some(([name]) => name === 'startProceduralBodyPose'), 'standalone runtime retains procedural motion fallback');
const low = runtime({ mobile: true });
for (let i = 0; i < 180; i++) low.frame(1000 + i * 1000 / 60);
assert.ok(low.draws.length >= 134 && low.draws.length <= 136, 'low-power mode retains a drift-free 45 fps cap');
console.log('Cubism runtime cadence and single-owner motion checks passed');

const managerSource = bundle.slice(bundle.indexOf('Pi=class{') + 3, bundle.indexOf(';function Fi()'));
let resetExpression;
const expressionCalls = [];
const model = { setExpression: value => expressionCalls.push(value), setRandomExpression() {}, setParameterTargets() {} };
const expressionContext = vm.createContext({ window: { setTimeout(fn) { resetExpression = fn; return 1; }, clearTimeout() {} } });
vm.runInContext(`this.Manager = ${managerSource}`, expressionContext);
const manager = Object.create(expressionContext.Manager.prototype);
manager._models = { at: () => model, clear() {} };
manager.setExpression('smile', 1200);
manager.setExpression('smile', 1800);
assert.deepEqual(expressionCalls, ['smile'], 'repeated expression refreshes its hold without restarting the fade');
resetExpression();
manager.setExpression('smile');
assert.deepEqual(expressionCalls, ['smile', 'neutral', 'smile'], 'expired expressions can be activated again');
manager.releaseAllModel();
manager.setExpression('smile');
assert.equal(expressionCalls.length, 4, 'reloading a model clears the expression identity cache');
console.log('Cubism expression hold and reset checks passed');
