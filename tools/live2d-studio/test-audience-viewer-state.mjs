import assert from 'node:assert/strict';
import {
  createLive2DAudienceViewerState,
  live2DAudienceViewerIdentity
} from '../../src/frontend/services/room/live2dAudienceViewerState.js';

let now = 10_000;
const viewers = createLive2DAudienceViewerState({ now: () => now });
const alice = {
  id: 'message-a',
  userId: 0,
  userName: 'Alice',
  receivedAt: 9_000
};
const bob = {
  id: 'message-b',
  userId: '0',
  userName: 'Bob',
  receivedAt: 9_500
};

assert.equal(live2DAudienceViewerIdentity(alice), 'alice');
assert.equal(live2DAudienceViewerIdentity(bob), 'bob');

viewers.recordArrival(alice);
viewers.recordArrival(bob);
assert.equal(viewers.stateFor(alice).messageCount, 1);
assert.equal(viewers.stateFor(bob).messageCount, 1);
assert.equal(viewers.isFirstUnansweredMessage(alice), true);

viewers.markPending([alice]);
assert.equal(viewers.stateFor(alice).pendingReplyCount, 1);
assert.equal(viewers.stateFor(alice).recentlyReplied, true);

now = 12_000;
viewers.settle([alice], { replied: false });
assert.equal(viewers.stateFor(alice).pendingReplyCount, 0);
assert.equal(viewers.stateFor(alice).lastRepliedAt, 0);
assert.equal(viewers.isFirstUnansweredMessage(alice), true);

viewers.markPending([alice]);
now = 14_000;
viewers.settle([alice], { replied: true });
assert.equal(viewers.stateFor(alice).lastRepliedAt, 14_000);
assert.equal(viewers.isFirstUnansweredMessage(alice), false);

viewers.recordArrival(alice);
assert.equal(viewers.stateFor(alice).messageCount, 2);
viewers.markPending([alice, bob]);
viewers.clearPending();
assert.equal(viewers.stateFor(alice).pendingReplyCount, 0);
assert.equal(viewers.stateFor(bob).pendingReplyCount, 0);

viewers.clear();
assert.equal(viewers.snapshot().size, 0);

console.log('audience viewer state checks passed');
