import assert from 'node:assert/strict';
import {
  recordLive2DReplyTelemetry,
  sanitizeLive2DReplyTelemetry
} from '../../src/frontend/services/room/live2dReplyTelemetry.js';

const safe = sanitizeLive2DReplyTelemetry({
  stage: 'tts-start',
  turnId: 'turn-123',
  source: 'bilibili',
  messageType: 'gift',
  audienceCount: 2,
  paidCount: 1,
  queueDepth: 17,
  durationMs: 1234.8,
  attempt: 2,
  outcome: 'started',
  text: 'private danmaku',
  userName: 'private viewer',
  cookie: 'SESSDATA=private',
  token: 'private token',
  nested: { apiKey: 'private key' }
}, { now: () => 1_775_000_000_000 });

assert.deepEqual(safe, {
  version: 1,
  timestamp: '2026-03-31T23:33:20.000Z',
  stage: 'tts-start',
  turnId: 'turn-123',
  source: 'bilibili',
  messageType: 'gift',
  audienceCount: 2,
  paidCount: 1,
  queueDepth: 17,
  durationMs: 1235,
  attempt: 2,
  outcome: 'started'
});
assert.equal(JSON.stringify(safe).includes('private'), false);

let request = null;
const sent = await recordLive2DReplyTelemetry({
  stage: 'selected',
  turnId: 'turn-456',
  audienceCount: 2,
  text: 'must be discarded'
}, {
  now: () => 1_775_000_000_000,
  fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(null, { status: 204 });
  }
});

assert.equal(sent, true);
assert.equal(request.url, '/api/live-reply/telemetry');
assert.equal(request.options.method, 'POST');
assert.equal(request.options.keepalive, true);
assert.equal(JSON.parse(request.options.body).text, undefined);
assert.equal(JSON.parse(request.options.body).stage, 'selected');

for (const stage of ['repetition-suppressed', 'director-start', 'director-stop']) {
  const lifecycle = sanitizeLive2DReplyTelemetry({
    stage,
    outcome: 'stream-idle-timeout',
    failureKind: 'stream-idle-timeout'
  }, { now: () => 1_775_000_000_000 });
  assert.equal(lifecycle.stage, stage);
  assert.equal(lifecycle.failureKind, 'stream-idle-timeout');
}

assert.equal(
  sanitizeLive2DReplyTelemetry({ stage: 'not-allowed' }),
  null,
  'unknown lifecycle stages must never be persisted'
);

console.log('Live reply telemetry checks passed');
