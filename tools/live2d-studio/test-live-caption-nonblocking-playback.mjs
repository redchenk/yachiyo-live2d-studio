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

assert.match(
  streamingTurn,
  /startGate\s*:\s*captionPlaybackGate/,
  'audio must be gated by a non-empty Chinese caption while GPT-SoVITS prepares in parallel'
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
assert.doesNotMatch(
  streamingTurn,
  /await\s+Promise\.all\(captionPreparationPromises\)/,
  'slow backup captions must not block the next LLM generation'
);
assert.match(
  streamingTurn,
  /resolveLive2DChineseCaptionWithFallback/,
  'backup caption translation must be lazy instead of firing for every streamed sentence'
);
assert.match(
  streamingTurn,
  /onFirstPlaybackStart/,
  'the first confirmed TTS playback event must be exposed to the live-turn prefetch coordinator'
);
assert.match(
  source,
  /reason:\s*'playback-prefetch'/,
  'the next audience LLM turn must be launched from the previous turn playback-start boundary'
);
assert.match(
  streamingTurn,
  /Promise\.resolve\(options\.enqueueAfter\)/,
  'prefetched speech must wait until the previous stream has queued all of its sentences'
);
assert.match(
  streamingTurn,
  /interTurnPauseMs/,
  'streaming prefetch must retain the speech queue boundary pause between audience turns'
);

console.log('live caption nonblocking playback checks passed');
