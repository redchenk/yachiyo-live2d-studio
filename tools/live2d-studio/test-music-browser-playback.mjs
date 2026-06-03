import assert from 'node:assert/strict';
import { createServer } from 'vite';

const store = new Map();
const dispatchedEvents = [];
const playedUrls = [];

globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  }
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
  dispatchEvent(event) {
    dispatchedEvents.push(event);
  }
};

globalThis.Audio = class MockAudio {
  constructor(src = '') {
    this.src = src;
    this.currentTime = 0;
    this.duration = 180;
    this.ended = false;
    this.muted = false;
    this.paused = true;
    this.preload = '';
    this.volume = 1;
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }

  getAttribute(name) {
    return name === 'src' ? this.src : '';
  }

  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }

  load() {}

  pause() {
    this.paused = true;
  }

  play() {
    this.paused = false;
    this.ended = false;
    playedUrls.push(this.src);
    return Promise.resolve();
  }
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    executeLive2DMusicCommand,
    warmupLive2DMusicPlayback
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dMusic.js');
  const {
    DEFAULT_ROOM_MUSIC_SETTINGS
  } = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');
  const {
    readLive2DMusicQueueState,
    writeLive2DMusicQueueState
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dMusicQueue.js');

  const settings = {
    ...DEFAULT_ROOM_MUSIC_SETTINGS,
    enabled: true,
    provider: 'netease-cloud'
  };

  assert.equal(await warmupLive2DMusicPlayback(), true);
  assert.ok(playedUrls[0].startsWith('data:audio/wav;base64,'));
  playedUrls.length = 0;

  writeLive2DMusicQueueState({
    current: {
      provider: 'netease-cloud',
      songId: 'old-song',
      url: '/api/music/netease/stream?token=old-song',
      title: 'Old Song',
      status: 'playing',
      startedAt: Date.now()
    },
    queue: []
  });

  const staleCurrentResult = await executeLive2DMusicCommand({
    action: 'request',
    provider: 'netease-cloud',
    url: '/api/music/netease/stream?token=new-song',
    title: 'New Song'
  }, settings);

  assert.equal(staleCurrentResult.status, 'playing');
  assert.equal(staleCurrentResult.current.url, '/api/music/netease/stream?token=new-song');
  assert.deepEqual(playedUrls, ['/api/music/netease/stream?token=new-song']);
  assert.equal(readLive2DMusicQueueState().queue.length, 0);

  playedUrls.length = 0;
  const llmImmediateResult = await executeLive2DMusicCommand({
    action: 'request',
    provider: 'netease-cloud',
    url: '/api/music/netease/stream?token=llm-song',
    title: 'LLM Song'
  }, settings, {
    playRequestsImmediately: true
  });

  assert.equal(llmImmediateResult.status, 'playing');
  assert.equal(llmImmediateResult.current.url, '/api/music/netease/stream?token=llm-song');
  assert.deepEqual(playedUrls, ['/api/music/netease/stream?token=llm-song']);
  assert.equal(readLive2DMusicQueueState().current.title, 'LLM Song');
  assert.ok(dispatchedEvents.some((event) => event.type === 'tsukuyomi:live2d-music-queue'));
} finally {
  await server.close();
}

console.log('music browser playback checks passed');
