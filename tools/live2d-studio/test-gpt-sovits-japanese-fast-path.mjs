import assert from 'node:assert/strict';
import { createServer } from 'vite';

const japaneseSource = '\u30df\u30ca\u3001\u3053\u3093\u3070\u3093\u306f\u3002';
const store = new Map([
  ['roomTTSSettings', JSON.stringify({
    enabled: true,
    provider: 'gpt-sovits',
    apiUrl: 'http://localhost:9880/tts',
    textLang: 'auto',
    promptLang: 'ja',
    useProxy: false
  })],
  ['roomLLMSettings', JSON.stringify({
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    useProxy: true
  })]
]);
const audios = [];
let translationCalls = 0;

globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  }
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
};
globalThis.window = {
  location: {
    protocol: 'http:',
    hostname: '127.0.0.1',
    origin: 'http://127.0.0.1'
  },
  setTimeout,
  clearTimeout,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  dispatchEvent() {
    return true;
  }
};
globalThis.fetch = async () => {
  translationCalls += 1;
  throw new Error('Japanese GPT-SoVITS input must not call the LLM translator');
};
globalThis.Image = class MockImage {
  set src(value) {
    this.value = value;
    queueMicrotask(() => this.onload?.());
  }
};
globalThis.Audio = class MockAudio {
  constructor(src = '') {
    this.src = src;
    this.dataset = {};
    this.duration = 1;
    this.currentTime = 0;
    this.paused = true;
    this.ended = false;
    audios.push(this);
  }

  load() {}

  play() {
    this.paused = false;
    this.onplay?.();
    queueMicrotask(() => {
      this.onplaying?.();
      queueMicrotask(() => {
        this.currentTime = this.duration;
        this.paused = true;
        this.ended = true;
        this.onended?.();
      });
    });
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

let player = null;
try {
  const { createLive2DSpeechPlayer } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dSpeech.js'
  );
  player = createLive2DSpeechPlayer();

  await player.enqueue(japaneseSource, {
    queueGroup: 'live-reply',
    priority: 100
  });

  assert.equal(translationCalls, 0, 'Japanese speech must take the zero-translation fast path');
  assert.ok(audios.length > 0, 'the Japanese line should create GPT-SoVITS audio');
  const audioUrl = new URL(audios.at(-1).src);
  assert.equal(audioUrl.searchParams.get('text'), japaneseSource);
  assert.equal(audioUrl.searchParams.get('text_lang'), 'ja');
} finally {
  player?.destroy();
  await server.close();
}
