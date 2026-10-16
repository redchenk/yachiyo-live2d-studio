import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDesktopServer } from '../server.mjs';
import { createRvcSongPlayer } from '../../../src/frontend/services/room/rvcSongPlayer.js';

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

function fixture() {
  class Audio extends EventTarget {
    paused = true; ended = false; duration = 120; currentTime = 0; plays = 0;
    play() { this.plays++; this.paused = false; this.dispatchEvent(new Event('playing')); return Promise.resolve(); }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    removeAttribute() {} load() {}
  }
  const audio = new Audio(); const mouths = []; const frames = new Map(); let frameId = 0, state;
  const analyser = { fftSize: 0, getFloatTimeDomainData: a => a.fill(0.1), connect() {}, disconnect() {} };
  const context = { resume: async () => {}, close: async () => {}, createAnalyser: () => analyser, createMediaElementSource: () => ({ connect() {}, disconnect() {} }) };
  const player = createRvcSongPlayer({ createAudio: () => audio, createContext: () => context, onState: s => { state = s; }, onMouth: n => mouths.push(n),
    requestFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelFrame: id => frames.delete(id) });
  return { audio, context, player, mouths, frames, state: () => state };
}

test('RVC pause/stop cancels pending resume, releases mouth and keeps one animation loop', async () => {
  const f = fixture(); let resume;
  f.context.resume = () => new Promise(resolve => { resume = resolve; });
  const pending = f.player.play({ id: 'first', name: 'one.wav' });
  f.player.stop(); resume(); await pending;
  assert.equal(f.audio.plays, 0, 'stopped pending context must never play');
  f.context.resume = async () => {};
  await f.player.play({ id: 'first', name: 'one.wav' });
  f.audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(f.state().duration, 120);
  assert.ok(f.mouths.at(-1) > 0);
  assert.equal(f.frames.size, 1);
  f.player.seek(23); f.player.pause();
  assert.equal(f.state().currentTime, 23);
  assert.equal(f.mouths.at(-1), 0); assert.equal(f.frames.size, 0);
  await f.player.play(); assert.equal(f.audio.currentTime, 23);
  await f.player.play({ id: 'second', name: 'two.mp3' });
  assert.match(f.audio.src, /second\/audio$/); assert.equal(f.frames.size, 1);
  f.player.stop(); assert.equal(f.audio.currentTime, 0);
  f.player.dispose(); assert.equal(f.frames.size, 0); assert.equal(f.mouths.at(-1), 0);
  const plays = f.audio.plays; await f.player.play({ id: 'third' }); assert.equal(f.audio.plays, plays);
});
