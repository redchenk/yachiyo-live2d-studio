import assert from 'node:assert/strict';
import { naturalLive2DMicroSaccade } from '../../src/frontend/services/room/live2dCharacterStateMachine.js';

const samples = [];
for (let now = 0; now <= 8000; now += 16) {
  samples.push(naturalLive2DMicroSaccade(now, {
    seed: 42.5,
    attention: 0.82,
    mode: 'speaking'
  }));
}

const moving = samples.filter((sample) => Math.abs(sample.x) + Math.abs(sample.y) > 0.002);
const peakX = Math.max(...samples.map((sample) => Math.abs(sample.x)));
const positive = samples.some((sample) => sample.x > 0.008);
const negative = samples.some((sample) => sample.x < -0.008);

assert.ok(moving.length > 20, 'micro-saccades should recur during a speaking segment');
assert.ok(moving.length < samples.length * 0.28, 'micro-saccades should be brief, with stable fixations between them');
assert.ok(peakX >= 0.025 && peakX <= 0.06, 'micro-saccades should be visible without looking jittery');
assert.ok(positive && negative, 'micro-saccades should vary direction instead of drifting to one side');

console.log('natural gaze motion checks passed');
