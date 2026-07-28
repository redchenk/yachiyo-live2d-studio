import assert from 'node:assert/strict';
import {
  createLive2DDirectorScheduler,
  LIVE2D_DIRECTOR_AUDIENCE_DELAY_MS,
  LIVE2D_DIRECTOR_PENDING_DELAY_MS,
  LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS
} from '../../src/frontend/services/room/live2dDirectorScheduler.js';

let now = 10_000;
let timerSequence = 0;
const timers = new Map();
const turns = [];

function setTimeoutImpl(callback, delay) {
  const id = timerSequence += 1;
  timers.set(id, { callback, dueAt: now + delay });
  return id;
}

function clearTimeoutImpl(id) {
  timers.delete(id);
}

function onlyTimer() {
  assert.equal(timers.size, 1);
  return [...timers.values()][0];
}

function fireNextTimer() {
  assert.ok(timers.size > 0);
  const [id, timer] = [...timers.entries()]
    .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
  timers.delete(id);
  now = timer.dueAt;
  timer.callback();
}

const scheduler = createLive2DDirectorScheduler({
  setTimeoutImpl,
  clearTimeoutImpl,
  onTurn: () => turns.push(now)
});

scheduler.schedule();
assert.equal(onlyTimer().dueAt, now + LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS);

now += 52_000;
scheduler.audienceArrived({ turnInFlight: false });
assert.equal(onlyTimer().dueAt, now + LIVE2D_DIRECTOR_AUDIENCE_DELAY_MS);
fireNextTimer();
assert.deepEqual(turns, [62_180]);
assert.equal(timers.size, 0);

now += 3_500;
scheduler.replyCompleted({ pendingAudience: false });
assert.equal(onlyTimer().dueAt, now + LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS);

now += 20_000;
scheduler.audienceArrived({ turnInFlight: true });
assert.equal(timers.size, 0);
scheduler.replyCompleted({ pendingAudience: true });
assert.equal(onlyTimer().dueAt, now + LIVE2D_DIRECTOR_PENDING_DELAY_MS);
fireNextTimer();
assert.deepEqual(turns, [62_180, 85_800]);

now += 2_000;
scheduler.replyCompleted({ pendingAudience: false });
assert.equal(onlyTimer().dueAt, now + LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS);

console.log('live director scheduler checks passed');
