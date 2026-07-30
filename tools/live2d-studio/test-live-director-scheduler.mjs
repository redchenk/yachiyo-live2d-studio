import assert from 'node:assert/strict';
import {
  createLive2DDirectorScheduler,
  LIVE2D_DIRECTOR_AUDIENCE_DELAY_MS,
  LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS,
  resolveLive2DDirectorTrafficLevel,
  sampleLive2DDirectorReplyDelay
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

function sequenceRng(values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, 'the scheduler consumed more random values than expected');
    const value = values[index];
    index += 1;
    return value;
  };
}

assert.equal(resolveLive2DDirectorTrafficLevel({ pendingCount: 1 }), 'low');
assert.equal(resolveLive2DDirectorTrafficLevel({ pendingCount: 2 }), 'low');
assert.equal(resolveLive2DDirectorTrafficLevel({ pendingCount: 3 }), 'normal');
assert.equal(resolveLive2DDirectorTrafficLevel({ pendingCount: 7 }), 'normal');
assert.equal(resolveLive2DDirectorTrafficLevel({ pendingCount: 8 }), 'high');
assert.equal(resolveLive2DDirectorTrafficLevel({}), 'normal');
assert.equal(
  resolveLive2DDirectorTrafficLevel({ pendingCount: 30, trafficLevel: 'low' }),
  'low',
  'an explicit traffic level must override backlog inference'
);

assert.equal(
  sampleLive2DDirectorReplyDelay(
    { pendingCount: 1 },
    sequenceRng([0, 0.5])
  ),
  2_500,
  'low traffic pause must start at 2.5 seconds'
);
assert.equal(
  sampleLive2DDirectorReplyDelay(
    { pendingCount: 4 },
    sequenceRng([0.5, 0.5])
  ),
  2_500,
  'normal traffic pause must be sampled from 1.8-3.2 seconds'
);
assert.equal(
  sampleLive2DDirectorReplyDelay(
    { pendingCount: 12 },
    sequenceRng([1, 0.5])
  ),
  2_200,
  'high backlog pause must not exceed 2.2 seconds'
);
assert.equal(
  sampleLive2DDirectorReplyDelay(
    { pendingCount: 4 },
    sequenceRng([0.5, 0.05, 0.25])
  ),
  3_750,
  'roughly ten percent of ordinary turns receive an extra 1-2 second thinking pause'
);
assert.equal(
  sampleLive2DDirectorReplyDelay(
    { pendingCount: 20, priorityPending: true },
    sequenceRng([0.5])
  ),
  1_100,
  'priority audience uses only the 0.8-1.4 second priority pause'
);

const scheduler = createLive2DDirectorScheduler({
  setTimeoutImpl,
  clearTimeoutImpl,
  onTurn: (context) => turns.push({ at: now, ...context }),
  rng: sequenceRng([0.5, 0.5, 0.5, 0.5])
});

scheduler.schedule();
assert.equal(onlyTimer().dueAt, now + LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS);

now += 52_000;
scheduler.audienceArrived({ turnInFlight: false });
assert.equal(onlyTimer().dueAt, now + LIVE2D_DIRECTOR_AUDIENCE_DELAY_MS);
fireNextTimer();
assert.deepEqual(turns, [{
  at: 62_180,
  reason: 'audience',
  delayMs: LIVE2D_DIRECTOR_AUDIENCE_DELAY_MS
}]);
assert.equal(timers.size, 0);

now += 3_500;
scheduler.playbackIdle({ pendingAudience: false });
assert.equal(onlyTimer().dueAt, now + LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS);

now += 20_000;
scheduler.audienceArrived({ turnInFlight: true });
assert.equal(timers.size, 0);
scheduler.playbackIdle({ pendingAudience: true, pendingCount: 4 });
assert.equal(onlyTimer().dueAt, now + 2_500);

const replyGapDueAt = onlyTimer().dueAt;
now += 300;
scheduler.audienceArrived({ turnInFlight: false });
assert.equal(
  onlyTimer().dueAt,
  replyGapDueAt,
  'new arrivals must not shorten a reply gap that already started after playback became idle'
);
fireNextTimer();
assert.deepEqual(turns.at(-1), {
  at: replyGapDueAt,
  reason: 'reply-gap',
  delayMs: 2_500
});

now += 2_000;
scheduler.replyCompleted({ pendingAudience: false });
assert.equal(onlyTimer().dueAt, now + LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS);

now += 1_000;
scheduler.audienceArrived({ playbackPending: true });
assert.equal(
  timers.size,
  0,
  'an audience arrival during TTS playback must wait for the playback-idle signal'
);
const playbackEndedAt = now + 5_000;
now = playbackEndedAt;
scheduler.playbackIdle({ pendingAudience: true, pendingCount: 10 });
assert.equal(
  onlyTimer().dueAt,
  playbackEndedAt + 1_700,
  'the human-like gap must be measured from playback idle, not generation completion'
);

console.log('live director scheduler checks passed');
