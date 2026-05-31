import assert from 'node:assert/strict';
import {
  alignLive2DIntentToStreamingSpeech,
  createLive2DStreamingSpeechSession,
  streamingSpeechHoldMs
} from '../../src/frontend/services/room/live2dStreamingSpeechSession.js';

const events = [];
let timers = [];

function setTimer(callback, delayMs) {
  const timer = { callback, delayMs };
  timers.push(timer);
  return timer;
}

function clearTimer(timer) {
  timers = timers.filter((item) => item !== timer);
}

function runNextTimer() {
  const [timer] = timers;
  assert.ok(timer, 'expected a pending timer');
  clearTimer(timer);
  timer.callback();
}

const session = createLive2DStreamingSpeechSession({
  dispatchCharacterState: (mode, detail) => events.push({ mode, detail }),
  isLiveDirectorRunning: () => true,
  setTimer,
  clearTimer
});

session.begin();
session.queueLine();
session.lineStarted({ durationMs: 640, emotion: 'happy' });
assert.equal(events.at(-1).mode, 'speaking');
assert.ok(events.at(-1).detail.holdMs >= streamingSpeechHoldMs(640));

const swallowedLoading = session.handleSpeechStatePatch({ status: 'loading' });
assert.equal(swallowedLoading, true);
assert.equal(events.at(-1).mode, 'speaking');
assert.equal(events.some((event) => event.mode === 'thinking'), false);

session.queueLine();
session.lineSettled();
assert.equal(timers.length, 0, 'first sentence must not end the streaming speech session while another line is queued');

session.lineStarted({ durationMs: 720, emotion: 'smile' });
session.lineSettled();
assert.equal(timers.length, 1, 'last sentence should settle after a grace timer');
runNextTimer();
assert.equal(events.at(-1).mode, 'listening');

const aligned = alignLive2DIntentToStreamingSpeech({
  durationMs: 900,
  interruptPolicy: { mode: 'replace', blendOutMs: 100 },
  behaviorActions: [
    { type: 'nod', delayMs: 0, durationMs: 600 }
  ],
  sequence: [
    {
      durationMs: 700,
      interruptPolicy: 'replace',
      behaviorActions: [
        { type: 'sway', delayMs: 0, durationMs: 500 }
      ]
    }
  ]
}, 800);

assert.equal(aligned.interruptPolicy.mode, 'blend');
assert.ok(aligned.interruptPolicy.blendOutMs >= 900);
assert.ok(aligned.durationMs >= 1800);
assert.ok(aligned.behaviorActions[0].durationMs > 600);
assert.equal(aligned.sequence[0].interruptPolicy.mode, 'blend');
assert.ok(aligned.sequence[0].durationMs >= 1800);

console.log('streaming speech session checks passed');
