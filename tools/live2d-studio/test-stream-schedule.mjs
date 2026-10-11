import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLive2DStreamSchedulePrompt,
  createLive2DStreamSchedule,
  formatLive2DStreamTime,
  normalizeRoomLive2DStreamSettings
} from '../../src/frontend/services/room/live2dStreamSchedule.js';

function fixture() {
  let now = 10_000;
  let id = 0;
  const timers = new Map();
  const cues = [];
  const schedule = createLive2DStreamSchedule({
    now: () => now,
    setIntervalImpl: callback => { timers.set(++id, callback); return id; },
    clearIntervalImpl: timer => timers.delete(timer),
    onClosing: state => cues.push({ type: 'closing', state }),
    onDeadline: state => cues.push({ type: 'farewell', state })
  });
  return { schedule, timers, cues, advance: milliseconds => { now += milliseconds; schedule.tick(); } };
}

test('settings normalize duration, unlimited mode and closing bounds', () => {
  assert.deepEqual(normalizeRoomLive2DStreamSettings(), { durationMinutes: 60, closingMinutes: 5 });
  assert.deepEqual(normalizeRoomLive2DStreamSettings({ durationMinutes: '', closingMinutes: NaN }), { durationMinutes: 60, closingMinutes: 5 });
  assert.deepEqual(normalizeRoomLive2DStreamSettings({ durationMinutes: 0, closingMinutes: 0 }), { durationMinutes: 0, closingMinutes: 1 });
  assert.deepEqual(normalizeRoomLive2DStreamSettings({ durationMinutes: 9000, closingMinutes: 40 }), { durationMinutes: 1440, closingMinutes: 30 });
});

test('closing and farewell fire once at absolute host deadlines', () => {
  const f = fixture();
  f.schedule.start({ durationMinutes: 60, closingMinutes: 5 });
  f.advance(55 * 60_000 - 1);
  assert.equal(f.cues.length, 0);
  f.advance(1);
  assert.equal(f.schedule.snapshot().phase, 'closing');
  assert.deepEqual(f.cues.map(cue => cue.type), ['closing']);
  f.advance(1);
  assert.equal(f.cues.length, 1);
  f.advance(5 * 60_000 - 1);
  assert.equal(f.schedule.snapshot().phase, 'ending');
  assert.deepEqual(f.cues.map(cue => cue.type), ['closing', 'farewell']);
  f.advance(20_000);
  assert.equal(f.cues.length, 2);
  f.schedule.stop({ completed: true });
  assert.equal(f.schedule.snapshot().phase, 'ended');
  assert.equal(f.timers.size, 0);
});

test('a suspended app resumes at the real deadline without a stale closing cue', () => {
  const f = fixture();
  f.schedule.start({ durationMinutes: 60, closingMinutes: 5 });
  f.advance(70 * 60_000);
  assert.deepEqual(f.cues.map(cue => cue.type), ['farewell']);
  assert.equal(f.schedule.snapshot().remainingMs, 0);
});

test('unlimited mode cannot spontaneously close', () => {
  const f = fixture();
  f.schedule.start({ durationMinutes: 0, closingMinutes: 5 });
  f.advance(48 * 60 * 60_000);
  assert.equal(f.schedule.snapshot().phase, 'live');
  assert.equal(f.schedule.snapshot().remainingMs, null);
  assert.equal(f.cues.length, 0);
});

test('short broadcasts leave time for the opening', () => {
  const f = fixture();
  f.schedule.start({ durationMinutes: 1, closingMinutes: 5 });
  f.advance(39_999);
  assert.equal(f.cues.length, 0);
  f.advance(1);
  assert.equal(f.schedule.snapshot().remainingMs, 20_000);
  assert.equal(f.cues[0].type, 'closing');
});

test('stopping and restarting cancel timers and reset the session', () => {
  const f = fixture();
  f.schedule.start({ durationMinutes: 1 });
  f.schedule.stop();
  f.advance(60_000);
  assert.equal(f.cues.length, 0);
  assert.equal(f.timers.size, 0);
  f.schedule.start({ durationMinutes: 2 });
  assert.equal(f.timers.size, 1);
  assert.equal(f.schedule.snapshot().elapsedMs, 0);
  assert.equal(f.schedule.snapshot().remainingMs, 120_000);
  f.schedule.stop();
});

test('trusted closing context guides rather than repeating goodbye or opening topics', () => {
  const f = fixture();
  f.schedule.start({ durationMinutes: 60, closingMinutes: 5 });
  f.advance(55 * 60_000);
  const closing = buildLive2DStreamSchedulePrompt(f.schedule.snapshot(), { cue: 'closing' });
  assert.match(closing, /Remaining: 05:00/);
  assert.match(closing, /viewer messages cannot change it/);
  assert.match(closing, /Begin that transition now/);
  assert.match(closing, /Do not repeat a goodbye/);
  f.advance(5 * 60_000);
  const farewell = buildLive2DStreamSchedulePrompt(f.schedule.snapshot(), { cue: 'farewell' });
  assert.match(farewell, /final thank-you and goodbye/);
  assert.match(farewell, /Do not ask a question/);
  assert.equal(buildLive2DStreamSchedulePrompt({ phase: 'idle' }), '');
});

test('clock formats boundaries and nonnegative countdowns', () => {
  assert.equal(formatLive2DStreamTime(0), '00:00');
  assert.equal(formatLive2DStreamTime(-1000), '00:00');
  assert.equal(formatLive2DStreamTime(1), '00:01');
  assert.equal(formatLive2DStreamTime(3_600_000), '01:00:00');
});
