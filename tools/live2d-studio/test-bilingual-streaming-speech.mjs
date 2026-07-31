import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const store = new Map();

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

globalThis.window = {
  localStorage: globalThis.localStorage,
  location: {
    protocol: 'http:',
    hostname: '127.0.0.1',
    origin: 'http://127.0.0.1'
  },
  setTimeout,
  clearTimeout
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

after(async () => {
  await server.close();
});

const {
  clearLive2DLLMHistory,
  requestLive2DControlStream
} = await server.ssrLoadModule('/src/frontend/services/room/live2dLlmControl.js');
const {
  writeRoomLLMSettings,
  writeRoomMemorySettings
} = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');

test('streaming pairs Chinese captions with Japanese GPT-SoVITS speech', async () => {
  clearLive2DLLMHistory();
  writeRoomLLMSettings({
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    useProxy: false
  });
  writeRoomMemorySettings({
    enabled: false,
    retrievalMode: 'off',
    writeMode: 'off'
  });

  const firstCaption = '\u7c73\u5a1c\uff0c\u665a\u4e0a\u597d\u5440\u3002';
  const firstVoice = '\u30df\u30ca\u3001\u3053\u3093\u3070\u3093\u306f\u3002';
  const secondCaption = '\u4eca\u5929\u4e5f\u8981\u8f7b\u677e\u5730\u804a\u5929\u54e6\u3002';
  const secondVoice = '\u4eca\u65e5\u3082\u3086\u3063\u304f\u308a\u304a\u8a71\u3057\u3057\u3088\u3046\u306d\u3002';
  const finalReply = `${firstVoice}${secondVoice}`;
  const streamLines = [
    'BEAT: {"emotion":"happy","actions":[{"type":"look_at_chat"}]}',
    `CAPTION: ${firstCaption}`,
    `VOICE: ${firstVoice}`,
    'BEAT: {"emotion":"neutral","actions":[{"type":"breathe"}]}',
    `CAPTION: ${secondCaption}`,
    `VOICE: ${secondVoice}`,
    `CONTROL: ${JSON.stringify({
      reply: finalReply,
      emotion: 'happy',
      actions: [{ type: 'look_at_chat' }, { type: 'breathe' }],
      memory_writes: []
    })}`
  ];
  const secondVoiceSplitAt = Math.floor(secondVoice.length / 2);
  const streamDeltas = [
    ...streamLines.slice(0, 5).map((line) => `${line}\n`),
    `VOICE: ${secondVoice.slice(0, secondVoiceSplitAt)}`,
    `${secondVoice.slice(secondVoiceSplitAt)}\n`,
    streamLines.at(-1)
  ];
  const packets = streamDeltas
    .map((content) => {
      return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
    })
    .join('');
  let requestBody = null;

  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(String(options.body || '{}'));
    return new Response(`${packets}data: [DONE]\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };

  const emitted = [];
  await requestLive2DControlStream('viewer greeting', {
    onSentence(sentence) {
      emitted.push(sentence);
    }
  });

  assert.match(
    requestBody?.messages?.[0]?.content || '',
    /CAPTION[\s\S]*Simplified Chinese[\s\S]*VOICE[\s\S]*Japanese/i,
    'the same LLM stream should produce a Chinese caption before Japanese speech'
  );
  assert.deepEqual(
    emitted.map(({ text, caption }) => ({ text, caption })),
    [
      { text: firstVoice, caption: firstCaption },
      { text: secondVoice, caption: secondCaption }
    ],
    'each Japanese speech chunk must carry its already-generated Chinese caption'
  );
});
