import assert from 'node:assert/strict';
import { createServer } from 'vite';

const chineseSource = '\u8fd9\u662f\u4e00\u53e5\u4e2d\u6587\u53f0\u8bcd\u3002';
const secondChineseSource = '\u8fd9\u662f\u53e6\u4e00\u53e5\u4e2d\u6587\u53f0\u8bcd\u3002';
const japaneseSource = '\u516b\u5343\u4ee3\u3001\u767b\u573a\u3002';
const japaneseTranslation = '\u516b\u5343\u4ee3\u304c\u7b54\u3048\u308b\u3088\u3002';
const store = new Map([
  ['roomTTSSettings', JSON.stringify({
    enabled: true,
    provider: 'gpt-sovits',
    apiUrl: 'http://localhost:9880/tts',
    textLang: 'zh',
    promptLang: 'zh',
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
const playbackEvents = [];
let translationCalls = 0;
let translationReply = japaneseTranslation;

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
  location: { protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1' },
  setTimeout,
  clearTimeout,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  dispatchEvent() {
    return true;
  }
};
globalThis.fetch = async (url) => {
  assert.equal(String(url), '/api/chat');
  translationCalls += 1;
  return new Response(JSON.stringify({ success: true, data: { reply: translationReply } }), {
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
    playbackEvents.push('play-requested');
    this.paused = false;
    this.onplay?.();
    queueMicrotask(() => {
      playbackEvents.push('audio-playing');
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
  const { createLive2DSpeechPlayer } = await server.ssrLoadModule('/src/frontend/services/room/live2dSpeech.js');
  player = createLive2DSpeechPlayer();

  await player.enqueue(chineseSource, {
    queueGroup: 'live-reply',
    priority: 100,
    onStart: () => playbackEvents.push('caption-start')
  });
  assert.equal(translationCalls, 1, 'a non-Japanese line should use one bounded translation request');
  let audioUrl = new URL(audios.at(-1).src);
  assert.equal(audioUrl.searchParams.get('text'), japaneseTranslation);
  assert.equal(audioUrl.searchParams.get('text_lang'), 'ja');
  assert.equal(audioUrl.searchParams.get('prompt_lang'), 'ja');
  assert.ok(
    playbackEvents.indexOf('caption-start') > playbackEvents.indexOf('audio-playing'),
    'captions must start from the real audio-playing event'
  );

  translationReply = '';
  const callsBeforeEmpty = translationCalls;
  const audioCountBeforeEmpty = audios.length;
  await assert.rejects(
    player.enqueue(secondChineseSource, { queueGroup: 'live-reply', priority: 100 }),
    (error) => error?.name === 'AbortError'
  );
  assert.equal(translationCalls, callsBeforeEmpty + 1, 'empty translation must not trigger a latency-adding retry');
  assert.equal(audios.length, audioCountBeforeEmpty, 'non-Japanese fallback text must never reach GPT-SoVITS');

  const callsBeforeJapanese = translationCalls;
  await player.enqueue(japaneseSource, {
    queueGroup: 'live-reply',
    priority: 100,
    sourceLang: 'ja'
  });
  assert.equal(translationCalls, callsBeforeJapanese, 'known Japanese VOICE must bypass translation entirely');
  audioUrl = new URL(audios.at(-1).src);
  assert.equal(audioUrl.searchParams.get('text'), japaneseSource);
  assert.equal(audioUrl.searchParams.get('text_lang'), 'ja');

  console.log('GPT-SoVITS Japanese-only realtime checks passed');
} finally {
  player?.destroy();
  await server.close();
}
