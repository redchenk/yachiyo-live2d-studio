import test from 'node:test';
import assert from 'node:assert/strict';
import { createMfccExtractor, classifyVowels, mouthFromAudio, mouthTrackingFrame, createMouthSmoother, CLOSED_MOUTH, validateVowelProfile } from '../../../src/shared/audio-lipsync.mjs';
import { DEFAULT_VOWEL_PROFILE } from '../../../src/shared/lipsync-profile.mjs';
import { buildVocalTimeline } from '../../../src/shared/vocal-analysis.mjs';
import { validateMouthTimeline, vocalMouthFrameAt } from '../../../src/shared/rvc-mouth.mjs';
import { startDesktopServer } from '../server.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('MFCC remains finite at silence, polarity and gain invariant; templates normalize vowels', () => {
  const extract = createMfccExtractor();
  assert.deepEqual(extract(new Float32Array(1024)), new Array(12).fill(0));
  const signal = Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i * 0.11) + 0.3 * Math.sin(i * 0.35));
  const a = extract(signal), b = extract(signal.map(n => -n * 0.05));
  assert.ok(a.every((n, i) => Math.abs(n - b[i]) < 0.0001));
  for (const [index, key] of ['A', 'I', 'U', 'E', 'O'].entries()) {
    const scores = classifyVowels(DEFAULT_VOWEL_PROFILE[key]);
    assert.equal(scores.indexOf(Math.max(...scores)), index);
    assert.ok(scores.reduce((x, y) => x + y, 0) <= 1.000001);
  }
  const noise = classifyVowels(DEFAULT_VOWEL_PROFILE['-']);
  assert.ok(noise.reduce((x, y) => x + y, 0) < 0.1);
  assert.throws(() => validateVowelProfile({ A: [Infinity] }));
});

test('log opening, noise gate and single time-based smoother close without release chatter', () => {
  assert.equal(mouthFromAudio(0).value, 0);
  assert.equal(mouthFromAudio(0.001).value, 0);
  assert.ok(mouthFromAudio(0.04).value > 0.1);
  assert.ok(mouthFromAudio(0.08).value > mouthFromAudio(0.04).value);
  assert.equal(mouthFromAudio(0.04, [], { gateDb: -20 }).value, 0);
  const samples = [];
  for (const hz of [30, 60, 144]) {
    const smooth = createMouthSmoother(); smooth(CLOSED_MOUTH, 0);
    for (let i = 1; i <= hz; i++) samples.push(smooth({ value: 0.5, vowels: [1, 0, 0, 0, 0] }, i / hz));
    assert.ok(Math.abs(samples.at(-1).value - 0.5) < 0.0001);
    assert.equal(smooth(CLOSED_MOUTH, 1.01).value, 0);
  }
  const u = mouthTrackingFrame({ value: 0.6, vowels: [0, 0, 1, 0, 0] });
  const i = mouthTrackingFrame({ value: 0.6, vowels: [0, 1, 0, 0, 0] });
  assert.ok(u.find(x => x.id === 'MouthPucker').value > 0);
  assert.ok(i.find(x => x.id === 'MouthPucker').value < 0);
  assert.equal(u.some(x => x.id === 'MouthSmile'), false, 'do not destroy emotion smiles');
});

test('v2 vocal cache preserves stereo/clock/gates and validates bounded vowels; v1 still plays', async () => {
  const sr = 16000, samples = new Float32Array(sr * 2);
  for (let i = sr / 2; i < sr; i++) samples[i] = 0.15 * Math.sin(i * 0.1);
  const channels = [samples, samples.map(n => -n)];
  const result = await buildVocalTimeline({ sampleRate: sr, duration: 2, length: samples.length, numberOfChannels: 2, getChannelData: i => channels[i] }, 'vocal.wav');
  assert.equal(result.version, 2); assert.equal(result.vowels.length, 500);
  assert.ok(vocalMouthFrameAt(result, 0.7).value > 0.1);
  assert.equal(vocalMouthFrameAt(result, 0.2).value, 0);
  assert.equal(vocalMouthFrameAt(result, 1.4).value, 0);
  assert.equal(vocalMouthFrameAt({ ...result, offsetMs: 500 }, 0.7).value, 0);
  assert.ok(vocalMouthFrameAt({ ...result, offsetMs: 500 }, 1.2).value > 0.1);
  assert.equal(vocalMouthFrameAt({ ...result, gateDb: -20, frames: result.frames.map(n => Math.round(n / 10)) }, 0.7).value, 0);
  assert.throws(() => validateMouthTimeline({ ...result, vowels: [256] }));
  const legacy = { ...result, version: 1 }; delete legacy.vowels; delete legacy.vowelStepMs;
  assert.ok(vocalMouthFrameAt(validateMouthTimeline(legacy), 0.7).value > 0.1);
  const worst = { ...result, duration: 1200, frames: new Array(120000).fill(10000), vowels: new Array(300000).fill(255) };
  assert.ok(Buffer.byteLength(JSON.stringify(validateMouthTimeline(worst))) < 2 * 1024 * 1024);
});

test('same-origin TTS relay streams before completion, single use, aborts upstream and rejects foreign sites', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lipsync-relay-'));
  let upstreamSignal, sendTail, upstreamCalls = 0;
  const runtime = await startDesktopServer({ resourceRoot: path.resolve(import.meta.dirname, '../../..'), dataDir, services: {}, port: 0,
    fetchImpl: async (url, options) => {
      upstreamCalls++; upstreamSignal = options.signal;
      assert.equal(new URL(url).pathname, '/tts');
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); sendTail = () => { controller.enqueue(new Uint8Array([4])); controller.close(); }; } }), { headers: { 'Content-Type': 'audio/wav' } });
    } });
  const prepare = headers => fetch(runtime.origin + '/api/tts/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url: 'http://127.0.0.1:9880/tts?text=test&streaming_mode=true' }) });
  try {
    assert.equal((await prepare({ Origin: 'https://foreign.invalid' })).status, 403);
    assert.equal((await prepare({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal(upstreamCalls, 0);
    const prepared = await (await prepare()).json();
    assert.ok(!prepared.url.includes('text=test'));
    const response = await fetch(runtime.origin + prepared.url), reader = response.body.getReader();
    assert.deepEqual(Array.from((await reader.read()).value), [1, 2, 3]);
    assert.equal((await fetch(runtime.origin + prepared.url)).status, 404);
    sendTail(); assert.deepEqual(Array.from((await reader.read()).value), [4]);
    assert.equal((await reader.read()).done, true);
    const second = await (await prepare()).json();
    const control = new AbortController();
    const stream = await fetch(runtime.origin + second.url, { signal: control.signal });
    await stream.body.getReader().read(); control.abort();
    for (let i = 0; !upstreamSignal.aborted && i < 50; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(upstreamSignal.aborted, true);
  } finally { await runtime.close(); await fs.rm(dataDir, { recursive: true, force: true }); }
});
