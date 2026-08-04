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
  1_700,
  'low traffic pause must start at 1.7 seconds'
);
assert.equal(
  sampleLive2DDirectorReplyDelay(
    { pendingCount: 4 },
    sequenceRng([0.5, 0.5])
  ),
  1_600,
  'normal traffic pause must be sampled from 1.1-2.1 seconds'
);
assert.equal(
  sampleLive2DDirectorReplyDelay(
    { pendingCount: 12 },
    sequenceRng([1, 0.5])
  ),
  1_250,
  'high backlog pause must not exceed 1.25 seconds'
);
assert.equal(
  sampleLive2DDirectorReplyDelay(
    { pendingCount: 4 },
    sequenceRng([0.5, 0.05, 0.25])
  ),
  2_450,
  'a small share of ordinary turns receive a short extra thinking pause'
);
assert.equal(
  sampleLive2DDirectorReplyDelay(
    { pendingCount: 20, priorityPending: true },
    sequenceRng([0.5])
  ),
  450,
  'priority audience uses only a short 0.25-0.65 second pause'
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
  at: 62_120,
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
assert.equal(onlyTimer().dueAt, now + 1_600);

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
  delayMs: 1_600
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
  playbackEndedAt + 950,
  'the human-like gap must be measured from playback idle, not generation completion'
);

let burstNow = 0;
let burstTimerSequence = 0;
const burstTimers = new Map();
const burstTurns = [];
const burstScheduler = createLive2DDirectorScheduler({
  setTimeoutImpl: (callback, delay) => {
    const id = burstTimerSequence += 1;
    burstTimers.set(id, { callback, dueAt: burstNow + delay });
    return id;
  },
  clearTimeoutImpl: (id) => burstTimers.delete(id),
  onTurn: (context) => burstTurns.push({ at: burstNow, ...context })
});

function advanceBurstTo(targetTime) {
  while (true) {
    const next = [...burstTimers.entries()]
      .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
    if (!next || next[1].dueAt > targetTime) break;
    burstTimers.delete(next[0]);
    burstNow = next[1].dueAt;
    next[1].callback();
  }
  burstNow = targetTime;
}

for (let index = 0; index < 40; index += 1) {
  advanceBurstTo(index * 80);
  burstScheduler.audienceArrived({ turnInFlight: false, playbackPending: false });
}
assert.ok(
  burstTurns.length > 0,
  'a continuous audience burst faster than the 120ms startup delay must not postpone the first reply forever'
);

console.log('live director scheduler checks passed');
