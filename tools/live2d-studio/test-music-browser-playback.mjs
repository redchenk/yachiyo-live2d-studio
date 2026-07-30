import assert from 'node:assert/strict';
import { createServer } from 'vite';

const store = new Map();
const dispatchedEvents = [];
const playedUrls = [];
const appleVolumeWrites = [];
let latestAudio = null;
let appleVolume = 1;
const appleMusic = {};
Object.defineProperty(appleMusic, 'volume', {
  configurable: true,
  get: () => appleVolume,
  set(value) {
    appleVolume = Number(value);
    appleVolumeWrites.push(appleVolume);
  }
});

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
  MusicKit: {
    getInstance: () => appleMusic
  },
  dispatchEvent(event) {
    dispatchedEvents.push(event);
  }
};

globalThis.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/api/music/netease/search')) {
    const body = JSON.parse(options.body || '{}');
    return Response.json({
      success: true,
      candidates: body.query === 'healthy-after-search-error'
        ? [{
            provider: 'netease-cloud',
            songId: 'healthy-after-search-error',
            title: 'Healthy After Search Error'
          }]
        : []
    });
  }
  if (String(url).endsWith('/api/music/netease/resolve')) {
    const body = JSON.parse(options.body || '{}');
    if (body.songId === 'broken-song') {
      return Response.json({
        success: false,
        message: 'simulated resolve failure'
      }, { status: 404 });
    }
    if (body.songId === 'healthy-after-search-error') {
      return Response.json({
        success: true,
        candidate: {
          provider: 'netease-cloud',
          songId: body.songId,
          title: 'Healthy After Search Error',
          url: '/api/music/netease/stream?token=healthy-after-search-error'
        }
      });
    }
  }
  throw new Error(`Unexpected fetch in music browser test: ${url}`);
};

globalThis.Audio = class MockAudio {
  constructor(src = '') {
    latestAudio = this;
    this.volumeWrites = [];
    this._volume = 1;
    this.src = src;
    this.currentTime = 0;
    this.duration = 180;
    this.ended = false;
    this.muted = false;
    this.paused = true;
    this.preload = '';
    this.listeners = new Map();
  }

  get volume() {
    return this._volume;
  }

  set volume(value) {
    this._volume = Number(value);
    this.volumeWrites.push(this._volume);
  }

  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }

  emit(type) {
    for (const callback of this.listeners.get(type) || []) {
      callback({ type, target: this });
    }
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

function installFakeWindowClock(startAt = 1_000) {
  const realDateNow = Date.now;
  const realWindowSetTimeout = window.setTimeout;
  const realWindowClearTimeout = window.clearTimeout;
  let fakeNow = startAt;
  let nextTimerId = 1;
  const timers = new Map();

  Date.now = () => fakeNow;
  window.setTimeout = (callback, delayMs = 0) => {
    const timerId = nextTimerId;
    nextTimerId += 1;
    timers.set(timerId, {
      callback,
      dueAt: fakeNow + Math.max(0, Number(delayMs) || 0)
    });
    return timerId;
  };
  window.clearTimeout = (timerId) => {
    timers.delete(timerId);
  };

  return {
    advanceBy(durationMs) {
      fakeNow += Math.max(0, Number(durationMs) || 0);
      const dueTimers = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= fakeNow)
        .sort((left, right) => left[1].dueAt - right[1].dueAt);
      for (const [timerId, timer] of dueTimers) {
        if (!timers.delete(timerId)) continue;
        timer.callback();
      }
    },
    restore() {
      Date.now = realDateNow;
      window.setTimeout = realWindowSetTimeout;
      window.clearTimeout = realWindowClearTimeout;
    }
  };
}

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    executeLive2DMusicCommand,
    setLive2DMusicSpeechDucking,
    syncLive2DMusicSpeechDucking,
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
  assert.deepEqual(
    setLive2DMusicSpeechDucking(true, { fadeMs: 0 }),
    { active: true, duckVolume: 0.08, targetVolume: 0.08 }
  );
  assert.equal(latestAudio.volume, 0.08);
  assert.deepEqual(
    setLive2DMusicSpeechDucking(false, { fadeMs: 0 }),
    { active: false, duckVolume: 0.08, targetVolume: 1 }
  );
  assert.equal(latestAudio.volume, 1);

  const recoveryClock = installFakeWindowClock();
  try {
    setLive2DMusicSpeechDucking(true, { fadeMs: 0 });
    setLive2DMusicSpeechDucking(false, { fadeMs: 120 });
    recoveryClock.advanceBy(16);
    assert.ok(
      latestAudio.volume > 0.08 && latestAudio.volume < 0.95,
      'music recovery must expose a deterministic intermediate volume'
    );
    const partialRecoveryVolume = latestAudio.volume;
    setLive2DMusicSpeechDucking(true, { fadeMs: 0 });
    setLive2DMusicSpeechDucking(false, { fadeMs: 0 });
    assert.equal(
      latestAudio.volume,
      1,
      `re-entering speech during recovery must not ratchet base volume down to ${partialRecoveryVolume}`
    );
  } finally {
    recoveryClock.restore();
  }
  assert.equal(appleMusic.volume, 1);

  for (let cycle = 0; cycle < 300; cycle += 1) {
    syncLive2DMusicSpeechDucking('playing', { fadeMs: 0 });
    syncLive2DMusicSpeechDucking(cycle % 2 ? 'loading' : 'idle', { fadeMs: 0 });
  }
  assert.equal(latestAudio.volume, 1, 'long-running speech state cycles must always restore local music');
  assert.equal(appleMusic.volume, 1, 'long-running speech state cycles must always restore Apple Music');
  syncLive2DMusicSpeechDucking('playing', { fadeMs: 0 });
  const recoveredFromError = syncLive2DMusicSpeechDucking('error', { fadeMs: 0 });
  assert.equal(recoveredFromError.active, false);
  assert.equal(latestAudio.volume, 1, 'speech errors must force music recovery');

  latestAudio.volumeWrites.length = 0;
  appleVolumeWrites.length = 0;
  const duckingClock = installFakeWindowClock();
  try {
    setLive2DMusicSpeechDucking(true, { fadeMs: 90 });
    assert.equal(latestAudio.volume, 1, 'local music fade must not jump on the first frame');
    assert.equal(appleMusic.volume, 1, 'Apple Music fade must not jump on the first frame');

    duckingClock.advanceBy(120);
    assert.ok(
      latestAudio.volume > 0.08 && latestAudio.volume < 1,
      'a delayed local music frame must still preserve a smooth transition'
    );
    assert.ok(
      appleMusic.volume > 0.08 && appleMusic.volume < 1,
      'a delayed Apple Music frame must still preserve a smooth transition'
    );

    duckingClock.advanceBy(16);
    assert.equal(latestAudio.volume, 0.08, 'local music duck must reach its target');
    assert.equal(appleMusic.volume, 0.08, 'Apple Music duck must reach its target');
    assert.ok(
      latestAudio.volumeWrites.some((value) => value > 0.08 && value < 1),
      'local music duck must include intermediate volume steps'
    );
    assert.ok(
      appleVolumeWrites.some((value) => value > 0.08 && value < 1),
      'Apple Music duck must include intermediate volume steps'
    );
  } finally {
    duckingClock.restore();
  }
  setLive2DMusicSpeechDucking(false, { fadeMs: 0 });

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

  const queuedAfterCurrent = await executeLive2DMusicCommand({
    action: 'request',
    provider: 'netease-cloud',
    url: '/api/music/netease/stream?token=recovery-song',
    title: 'Recovery Song'
  }, settings);
  assert.equal(queuedAfterCurrent.status, 'queued');
  assert.equal(readLive2DMusicQueueState().queue.length, 1);
  const secondQueuedAfterCurrent = await executeLive2DMusicCommand({
    action: 'request',
    provider: 'netease-cloud',
    url: '/api/music/netease/stream?token=second-queued-song',
    title: 'Second Queued Song'
  }, settings);
  assert.equal(secondQueuedAfterCurrent.status, 'queued');
  assert.equal(readLive2DMusicQueueState().current.title, 'LLM Song');
  assert.deepEqual(
    readLive2DMusicQueueState().queue.map((track) => track.title),
    ['Recovery Song', 'Second Queued Song']
  );
  assert.deepEqual(playedUrls, ['/api/music/netease/stream?token=llm-song']);

  latestAudio.ended = true;
  latestAudio.emit('ended');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(readLive2DMusicQueueState().current.title, 'Recovery Song');
  assert.deepEqual(
    readLive2DMusicQueueState().queue.map((track) => track.title),
    ['Second Queued Song']
  );
  assert.equal(playedUrls.at(-1), '/api/music/netease/stream?token=recovery-song');

  latestAudio.error = { code: 4 };
  latestAudio.emit('error');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(readLive2DMusicQueueState().current.title, 'Second Queued Song');
  assert.equal(readLive2DMusicQueueState().queue.length, 0);
  assert.equal(playedUrls.at(-1), '/api/music/netease/stream?token=second-queued-song');

  const brokenQueued = await executeLive2DMusicCommand({
    action: 'request',
    provider: 'netease-cloud',
    candidate: {
      provider: 'netease-cloud',
      songId: 'broken-song',
      title: 'Broken Song'
    }
  }, settings);
  assert.equal(brokenQueued.status, 'queued');

  const healthyQueued = await executeLive2DMusicCommand({
    action: 'request',
    provider: 'netease-cloud',
    url: '/api/music/netease/stream?token=after-broken-song',
    title: 'After Broken Song'
  }, settings);
  assert.equal(healthyQueued.status, 'queued');
  assert.equal(readLive2DMusicQueueState().queue.length, 2);

  latestAudio.ended = true;
  latestAudio.emit('ended');
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(readLive2DMusicQueueState().current.title, 'After Broken Song');
  assert.equal(readLive2DMusicQueueState().queue.length, 0);
  assert.equal(playedUrls.at(-1), '/api/music/netease/stream?token=after-broken-song');

  await executeLive2DMusicCommand({
    action: 'stop',
    provider: 'netease-cloud'
  }, settings);
  await assert.rejects(
    () => executeLive2DMusicCommand({
      action: 'request',
      provider: 'netease-cloud',
      query: 'not-found-first'
    }, settings),
    /did not find a song/
  );
  const afterSearchError = await executeLive2DMusicCommand({
    action: 'request',
    provider: 'netease-cloud',
    query: 'healthy-after-search-error'
  }, settings);
  assert.equal(afterSearchError.status, 'playing');
  assert.equal(readLive2DMusicQueueState().current.title, 'Healthy After Search Error');
  assert.equal(playedUrls.at(-1), '/api/music/netease/stream?token=healthy-after-search-error');
  assert.ok(dispatchedEvents.some((event) => event.type === 'tsukuyomi:live2d-music-queue'));
} finally {
  await server.close();
}

console.log('music browser playback checks passed');
