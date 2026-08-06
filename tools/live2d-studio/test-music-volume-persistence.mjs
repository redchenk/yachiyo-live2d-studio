import assert from 'node:assert/strict';
import { createServer } from 'vite';

const store = new Map([
  ['roomMusicSettings', JSON.stringify({ enabled: true, provider: 'netease-cloud', volume: 0.35 })]
]);
let audio = null;

globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  setTimeout,
  clearTimeout,
  dispatchEvent() {}
};
globalThis.Audio = class MockAudio {
  constructor() {
    audio = this;
    this.volume = 1;
    this.muted = false;
    this.paused = true;
    this.ended = false;
    this.src = '';
    this.currentTime = 0;
  }

  addEventListener() {}
  pause() { this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() {}
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const { warmupLive2DMusicPlayback } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dMusic.js'
  );
  assert.equal(await warmupLive2DMusicPlayback(), true);
  assert.equal(audio.volume, 0.35, 'saved volume must be applied before the music panel is opened');
  console.log('Music volume persistence checks passed');
} finally {
  await server.close();
}
