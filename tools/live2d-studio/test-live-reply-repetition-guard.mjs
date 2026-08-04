import assert from 'node:assert/strict';
import {
  createLive2DReplyRepetitionGuard
} from '../../src/frontend/services/room/live2dReplyRepetitionGuard.js';

const guard = createLive2DReplyRepetitionGuard({
  cooldownMs: 90_000,
  maxEntries: 5
});

const first = guard.accept(
  'Aliceさん、待たせてごめんね。コメントはちゃんと届いているよ、ここから一緒に話そう！',
  { now: 10_000, viewerNames: ['Alice'] }
);
const repeatedForAnotherViewer = guard.accept(
  'Bobさん、待たせてごめんね。コメントはちゃんと届いているよ、ここから一緒に話そう！',
  { now: 20_000, viewerNames: ['Bob'] }
);

assert.equal(first.accepted, true);
assert.equal(
  repeatedForAnotherViewer.accepted,
  false,
  'changing only the viewer name must not bypass cross-turn repetition protection'
);

const paidMustPlay = guard.accept(
  'GiftViewerさん、待たせてごめんね。コメントはちゃんと届いているよ、ここから一緒に話そう！',
  { now: 30_000, viewerNames: ['GiftViewer'], forceAllow: true }
);
assert.equal(paidMustPlay.accepted, true, 'paid acknowledgement must never be silenced');

const afterCooldown = guard.accept(
  'LaterViewerさん、待たせてごめんね。コメントはちゃんと届いているよ、ここから一緒に話そう！',
  { now: 121_000, viewerNames: ['LaterViewer'] }
);
assert.equal(afterCooldown.accepted, true, 'ordinary speech may be reused after the cooldown');

console.log('live reply repetition guard checks passed');
