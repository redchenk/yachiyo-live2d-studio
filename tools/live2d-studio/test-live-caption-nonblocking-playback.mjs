import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../src/frontend/pages/Live2DPage.vue', import.meta.url),
  'utf8'
);
const start = source.indexOf('async function performStreamingLiveTurn');
const end = source.indexOf('\nfunction handleLivePlaybackIdle', start);
assert.ok(start >= 0 && end > start, 'streaming live-turn implementation must be present');
const streamingTurn = source.slice(start, end);

assert.doesNotMatch(
  streamingTurn,
  /startGate\s*:\s*preparedCaption\.ready/,
  'Chinese caption preparation must never hold back GPT-SoVITS playback'
);
assert.ok(
  (streamingTurn.match(/resolved\s*:\s*(?:preparedCaption\.ready|finalCaptionReady)/g) || []).length >= 2,
  'late Chinese captions must still attach to the active TTS caption token'
);
assert.match(
  streamingTurn,
  /sourceLang\s*:\s*sentence\.sourceLang/,
  'known Japanese VOICE chunks must retain their zero-translation TTS fast path'
);

console.log('live caption nonblocking playback checks passed');
