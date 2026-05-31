import assert from 'node:assert/strict';
import { naturalAutoBlinkOpen } from '../../src/frontend/services/room/live2dBlinkTiming.js';

function closedClusters(durationMs = 120000, frameMs = 1000 / 60) {
  const clusters = [];
  let current = null;
  for (let at = 0; at <= durationMs; at += frameMs) {
    const open = naturalAutoBlinkOpen(at, 0.92);
    if (open < 0.35) {
      if (!current) current = { start: at, end: at, min: open };
      current.end = at;
      current.min = Math.min(current.min, open);
      continue;
    }
    if (current) {
      clusters.push(current);
      current = null;
    }
  }
  if (current) clusters.push(current);
  return clusters;
}

const blinks = closedClusters();
assert.ok(blinks.length >= 20, 'idle auto blink should keep happening over a long idle session');

for (let index = 0; index < blinks.length; index += 1) {
  const blink = blinks[index];
  const durationMs = blink.end - blink.start + 1000 / 60;
  assert.ok(blink.start > 900, 'the first idle blink should not fire immediately on boot');
  assert.ok(durationMs >= 120, `blink ${index} should not look like a one-frame twitch`);
  assert.ok(durationMs <= 360, `blink ${index} should still read as a blink, not a long eye close`);
  assert.ok(blink.min <= 0.06, `blink ${index} should fully close`);
  if (index > 0) {
    const gapMs = blink.start - blinks[index - 1].start;
    assert.ok(gapMs >= 2800, `blink ${index} starts too soon after the previous blink`);
  }
}

console.log('natural blink timing checks passed');
