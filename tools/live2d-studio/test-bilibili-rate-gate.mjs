import assert from 'node:assert/strict';
import { createLive2DBilibiliRateGate } from '../../src/frontend/services/room/live2dBilibiliRateGate.js';

let now = 1_750_000_000_000;
const gate = createLive2DBilibiliRateGate({ now: () => now });
const settings = { maxForwardPerMinute: 12 };

assert.equal(gate.allow(settings, { type: 'danmu' }), true);
assert.equal(gate.allow(settings, { type: 'danmu' }), true);
assert.equal(gate.allow(settings, { type: 'danmu' }), false);

now += 5_000;
assert.equal(gate.allow(settings, { type: 'danmu' }), true);
assert.equal(gate.allow(settings, { type: 'danmu' }), false);

assert.equal(gate.allow(settings, { type: 'superchat' }), true);
assert.equal(gate.allow(settings, { type: 'gift' }), true);
assert.equal(gate.allow(settings, { type: 'guard' }), true);
assert.equal(gate.allow(settings, { type: 'danmu' }), false);

console.log('Bilibili rate gate checks passed');
