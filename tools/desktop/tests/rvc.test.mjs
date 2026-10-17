import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDesktopServer } from '../server.mjs';
import { createRvcSongPlayer } from '../../../src/frontend/services/room/rvcSongPlayer.js';
import { buildVocalTimeline } from '../../../src/frontend/services/room/rvcVocalTimeline.js';
import { validateMouthTimeline, vocalMouthAt } from '../../../src/shared/rvc-mouth.mjs';

test('RVC library persists imports, serves ranges and deletes only its own copy', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rvc-library-'));
  const resourceRoot = path.resolve(import.meta.dirname, '../../..');
  const options = { resourceRoot, dataDir, services: {}, port: 0 };
  let server = await startDesktopServer(options);
  const input = Buffer.from('RIFF-local-RVC-audio-fixture');
  const get = route => fetch(server.origin + route);
  const upload = (name, body = input, headers = {}) => fetch(server.origin + '/api/rvc/tracks?name=' + encodeURIComponent(name), {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body
  });
  try {
    assert.equal((await upload('song.wav', input, { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await upload('song.exe')).status, 415);
    assert.equal((await upload('empty.wav', '')).status, 400);
    assert.equal((await upload('song.wav', input, { 'Content-Type': 'text/plain' })).status, 415);
    const response = await upload('C:\\RVC\\八千代 夜の歌.wav');
    assert.equal(response.status, 201);
    const { track } = await response.json();
    assert.equal(track.name, '八千代 夜の歌.wav');
    await server.close(); server = await startDesktopServer(options);
    const tracks = (await (await get('/api/rvc/tracks')).json()).tracks;
    assert.deepEqual(tracks, [track]);
    const audioUrl = server.origin + `/api/rvc/tracks/${track.id}/audio`;
    assert.deepEqual(Buffer.from(await (await fetch(audioUrl)).arrayBuffer()), input);
    const range = await fetch(audioUrl, { headers: { Range: 'bytes=4-9' } });
    assert.equal(range.status, 206);
    assert.equal(await range.text(), input.subarray(4, 10).toString());
    assert.equal((await fetch(audioUrl, { method: 'HEAD' })).headers.get('content-length'), String(input.length));
    assert.equal((await fetch(audioUrl, { headers: { Range: 'bytes=1000-' } })).status, 416);
    assert.equal((await get('/api/rvc/tracks/arbitrary-path/audio')).status, 404);
    const copiedFile = path.join(dataDir, 'rvc-songs', `${track.id}.wav`);
    const original = path.join(dataDir, 'original.wav');
    await fs.writeFile(original, input);
    await fs.unlink(copiedFile); await fs.symlink(original, copiedFile);
    assert.equal((await fetch(audioUrl)).status, 404, 'symlinks cannot expose arbitrary local files');
    await fs.unlink(copiedFile); await fs.copyFile(original, copiedFile);
    const removed = await fetch(server.origin + `/api/rvc/tracks/${track.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal((await fetch(audioUrl)).status, 404);
    assert.deepEqual(await fs.readFile(original), input);
    assert.deepEqual(await fs.readdir(path.join(dataDir, 'rvc-songs')), []);
  } finally { await server.close(); await fs.rm(dataDir, { recursive: true, force: true }); }
});

function timeline() {
  return { version: 1, stepMs: 10, duration: 4, vocalName: 'RVC vocals.wav', offsetMs: 0, gateDb: -38,
    frames: Array.from({ length: 400 }, (_, i) => i >= 100 && i < 200 ? 2000 : 0) };
}

function fixture(loadMouth = async () => timeline()) {
  class Audio extends EventTarget {
    paused = true; ended = false; duration = 120; time = 0; plays = 0;
    get currentTime() { return this.time; }
    set currentTime(value) { this.dispatchEvent(new Event('seeking')); this.time = value; this.dispatchEvent(new Event('seeked')); }
    play() { this.plays++; this.paused = false; this.ended = false; this.dispatchEvent(new Event('playing')); return Promise.resolve(); }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    removeAttribute() {} load() {}
  }
  const audio = new Audio(); const mouths = []; const frames = new Map(); let frameId = 0, state;
  const player = createRvcSongPlayer({ createAudio: () => audio, loadMouth, onState: s => { state = s; }, onMouth: n => mouths.push(n),
    requestFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelFrame: id => frames.delete(id) });
  const tick = () => { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(); };
  return { audio, player, mouths, frames, tick, state: () => state };
}
const track = { id: 'first', name: 'loud mix.wav', mouth: { vocalName: 'RVC vocals.wav' } };

test('vocal envelope respects stereo energy, silent intervals, gate and offset', async () => {
  const left = Float32Array.from({ length: 4000 }, (_, i) => i >= 1000 && i < 2000 ? 0.2 : 0);
  const right = left.map(n => -n);
  let yields = 0;
  const result = await buildVocalTimeline({ duration: 4, length: 4000, sampleRate: 1000, numberOfChannels: 2,
    getChannelData: i => i ? right : left }, 'vocals.wav', { yieldControl: async () => { yields++; } });
  assert.equal(result.frames[120], 2000, 'opposite phase channels must not cancel');
  assert.ok(yields > 0, 'large analysis yields to animation');
  assert.equal(vocalMouthAt(result, 0.5), 0);
  assert.equal(vocalMouthAt(result, 2.5), 0);
  assert.ok(vocalMouthAt(result, 1.5) > 0.9);
  assert.equal(vocalMouthAt({ ...result, offsetMs: 1000 }, 1.5), 0);
  assert.ok(vocalMouthAt({ ...result, offsetMs: 1000 }, 2.5) > 0.9);
  assert.ok(vocalMouthAt({ ...result, offsetMs: -1000 }, 0.5) > 0.9);
  const quiet = { ...result, frames: result.frames.map(n => n / 10), gateDb: -20 };
  assert.equal(vocalMouthAt(quiet, 1.5), 0);
  assert.equal(vocalMouthAt(result, 4), 0);
  assert.throws(() => validateMouthTimeline({ ...result, frames: [NaN] }));
});

test('mixed audio never drives mouth; vocal clock survives volume, seek, pause and switching', async () => {
  const f = fixture();
  await f.player.play(track); f.audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(f.mouths.at(-1), 0, 'instrumental intro stays closed');
  f.player.seek(1.2); f.tick(); assert.ok(f.mouths.at(-1) > 0.9);
  f.player.setVolume(0); f.tick(); assert.ok(f.mouths.at(-1) > 0.9, 'monitor volume cannot alter timing');
  f.player.seek(2.5); f.tick(); assert.equal(f.mouths.at(-1), 0, 'instrumental break closes immediately');
  f.player.seek(1.3); f.player.pause(); assert.equal(f.mouths.at(-1), 0); assert.equal(f.frames.size, 0);
  await f.player.play(); assert.equal(f.audio.currentTime, 1.3); assert.ok(f.mouths.at(-1) > 0.9);
  assert.equal(f.frames.size, 1);
  await f.player.play(track); assert.equal(f.state().status, 'playing'); assert.equal(f.frames.size, 1);
  f.audio.dispatchEvent(new Event('waiting'));
  f.player.updateMouth(track, timeline()); assert.equal(f.mouths.at(-1), 0, 'buffering keeps mouth closed');
  f.audio.dispatchEvent(new Event('playing')); assert.ok(f.mouths.at(-1) > 0.9);
  f.player.updateMouth({ ...track, mouth: null }, null); assert.equal(f.mouths.at(-1), 0);
  await f.player.play({ id: 'second', name: 'instrumental only.wav' }); f.tick();
  assert.equal(f.mouths.at(-1), 0, 'unconfigured accompaniment must never open mouth');
  assert.match(f.audio.src, /second\/audio$/); assert.equal(f.frames.size, 1);
  f.player.stop(); assert.equal(f.audio.currentTime, 0); assert.equal(f.frames.size, 0);
  f.player.dispose(); assert.equal(f.mouths.at(-1), 0);
  const plays = f.audio.plays; await f.player.play(track); assert.equal(f.audio.plays, plays);
});

test('stale vocal loads cannot start a stopped song or replace the next song', async () => {
  const pending = [];
  const f = fixture(() => new Promise(resolve => pending.push(resolve)));
  const first = f.player.play(track);
  f.player.stop(); pending.shift()(timeline()); await first;
  assert.equal(f.audio.plays, 0);
  const old = f.player.play(track);
  await f.player.play({ id: 'second', name: 'accompaniment.wav' });
  pending.shift()(timeline()); await old;
  f.audio.currentTime = 1.2; f.tick();
  assert.equal(f.audio.plays, 1); assert.equal(f.mouths.at(-1), 0);
  f.player.dispose();
});

test('corrupt or unavailable mouth data plays safely closed with an actionable error', async () => {
  for (const load of [async () => { throw new Error('missing'); }, async () => ({ frames: [] })]) {
    const f = fixture(load); await f.player.play(track);
    f.audio.currentTime = 1.2; f.tick();
    assert.equal(f.state().status, 'playing'); assert.equal(f.mouths.at(-1), 0);
    assert.match(f.state().mouthError, /重新关联/); f.player.dispose();
  }
});

test('vocal mouth association persists, validates input and deletes only its own timeline', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rvc-mouth-'));
  const options = { resourceRoot: path.resolve(import.meta.dirname, '../../..'), dataDir, services: {}, port: 0 };
  let server = await startDesktopServer(options);
  const request = (route, method = 'GET', body, extra = {}) => fetch(server.origin + route, { method,
    headers: { 'Content-Type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const imported = await fetch(server.origin + '/api/rvc/tracks?name=mix.wav', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'fixture' });
    const { track } = await imported.json(); const route = `/api/rvc/tracks/${track.id}/mouth`;
    assert.equal((await request(route, 'PUT', timeline(), { Origin: 'https://foreign.example' })).status, 403);
    for (const bad of [{ ...timeline(), frames: [0] }, { ...timeline(), offsetMs: 5001 }, { ...timeline(), gateDb: -100 }, { ...timeline(), duration: 2000 }]) {
      assert.equal((await request(route, 'PUT', bad)).status, 400);
    }
    assert.equal((await request(route, 'PUT', timeline())).status, 200);
    assert.equal((await request(route, 'PATCH', { offsetMs: 200, gateDb: -32 })).status, 200);
    await server.close(); server = await startDesktopServer(options);
    const restored = await (await request(route)).json();
    assert.deepEqual(restored.mouth, { ...timeline(), offsetMs: 200, gateDb: -32 });
    const listed = (await (await request('/api/rvc/tracks')).json()).tracks;
    assert.equal(listed.length, 1); assert.equal(listed[0].mouth.offsetMs, 200);
    const mouthFile = path.join(dataDir, 'rvc-songs', `${track.id}.mouth.json`);
    const original = path.join(dataDir, 'original.json'); await fs.writeFile(original, JSON.stringify(timeline()));
    await fs.unlink(mouthFile); await fs.symlink(original, mouthFile);
    assert.equal((await request(route)).status, 400, 'timeline symlink must not expose arbitrary files');
    assert.equal((await request(route, 'DELETE')).status, 200);
    assert.deepEqual(JSON.parse(await fs.readFile(original)), timeline());
    assert.equal((await (await request('/api/rvc/tracks')).json()).tracks[0].mouth, null);
    await request(route, 'PUT', timeline());
    assert.equal((await request(`/api/rvc/tracks/${track.id}`, 'DELETE')).status, 200);
    assert.deepEqual(await fs.readdir(path.join(dataDir, 'rvc-songs')), []);
  } finally { await server.close(); await fs.rm(dataDir, { recursive: true, force: true }); }
});
