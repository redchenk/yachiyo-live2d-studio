import assert from 'node:assert/strict';
import { createServer } from 'vite';

const chineseSource = '\u8fd9\u662f\u4e00\u53e5\u4e2d\u6587\u53f0\u8bcd\u3002';
const retriedJapanese = '\u3053\u308c\u306f\u518d\u8a66\u884c\u3055\u308c\u305f\u65e5\u672c\u8a9e\u306e\u53f0\u8a5e\u3067\u3059\u3002';
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
  },
  removeItem(key) {
    store.delete(key);
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
globalThis.fetch = async (url) => {
  assert.equal(String(url), '/api/chat', 'only the Japanese translation request should use fetch');
  translationCalls += 1;
  return new Response(JSON.stringify({
    success: true,
    data: {
      reply: translationCalls === 1 ? '' : retriedJapanese
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
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

  const playback = await player.enqueue(chineseSource, {
    queueGroup: 'live-reply',
    priority: 100
  }).then(
    () => ({ status: 'played', message: '' }),
    (error) => ({ status: 'error', message: error?.message || String(error) })
  );

  assert.notEqual(
    playback.message,
    '\u65e5\u6587\u7ffb\u8bd1\u7ed3\u679c\u4e3a\u7a7a\uff0c\u5df2\u53d6\u6d88\u8bed\u97f3\u64ad\u653e\u3002',
    'a successful-but-empty translation response must never surface the cancellation error'
  );
  assert.equal(
    playback.status,
    'played',
    `GPT-SoVITS should retry once or synthesize the original language after an empty translation: ${playback.message}`
  );
  assert.ok(audios.length > 0, 'translation recovery must still create playable GPT-SoVITS audio');

  const audioUrl = new URL(audios.at(-1).src);
  const playedText = audioUrl.searchParams.get('text');
  const playedLanguage = audioUrl.searchParams.get('text_lang');
  assert.ok(
    playedText === retriedJapanese || playedText === chineseSource,
    'recovery must use either the valid retry result or the original spoken line'
  );
  assert.equal(
    playedLanguage,
    playedText === retriedJapanese ? 'ja' : 'zh',
    'original-language fallback must preserve the matching GPT-SoVITS text language'
  );
  assert.ok(
    translationCalls === 1 || translationCalls === 2,
    'empty translation recovery should use at most one bounded retry'
  );

  console.log('GPT-SoVITS empty translation recovery checks passed');
} finally {
  player?.destroy();
  await server.close();
}
