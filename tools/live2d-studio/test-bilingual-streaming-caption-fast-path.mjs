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

test('Japanese VOICE is emitted before its Chinese CAPTION and carries a caption promise', async () => {
  clearLive2DLLMHistory();
  writeRoomLLMSettings({
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    useProxy: false
  });
  writeRoomMemorySettings({ enabled: false, retrievalMode: 'off', writeMode: 'off' });

  const firstVoice = '\u30df\u30ca\u3001\u3053\u3093\u3070\u3093\u306f\u3002';
  const firstCaption = '\u5927\u5bb6\u665a\u4e0a\u597d\u3002';
  const secondVoice = '\u4eca\u65e5\u3082\u697d\u3057\u304f\u304a\u8a71\u3057\u3057\u3088\u3046\u306d\u3002';
  const secondCaption = '\u4eca\u5929\u4e5f\u5f00\u5fc3\u5730\u804a\u5929\u5427\u3002';
  const finalReply = `${firstVoice}${secondVoice}`;
  const finalCaption = `${firstCaption}${secondCaption}`;
  const lines = [
    'BEAT: {"emotion":"happy","actions":[{"type":"look_at_chat"}]}',
    `VOICE: ${firstVoice}`,
    `CAPTION: ${firstCaption}`,
    'BEAT: {"emotion":"neutral","actions":[{"type":"breathe"}]}',
    `VOICE: ${secondVoice}`,
    `CAPTION: ${secondCaption}`,
    `CONTROL: ${JSON.stringify({
      reply: finalReply,
      caption: finalCaption,
      emotion: 'happy',
      actions: [{ type: 'look_at_chat' }, { type: 'breathe' }],
      memory_writes: []
    })}`
  ];
  const packetFor = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content: `${content}\n` } }] })}\n\n`;
  const encoder = new TextEncoder();
  let releaseCaptionLines = null;
  let requestBody = null;

  globalThis.fetch = async (_url, options = {}) => {
    if (String(_url) === '/api/vision/context') {
      return new Response(JSON.stringify({ success: true, enabled: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    requestBody = JSON.parse(String(options.body || '{}'));
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines.slice(0, 2).map(packetFor).join('')));
        releaseCaptionLines = () => {
          controller.enqueue(encoder.encode(`${lines.slice(2).map(packetFor).join('')}data: [DONE]\n\n`));
          controller.close();
        };
      }
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };

  const emitted = [];
  const streamingRequest = requestLive2DControlStream('viewer greeting', {
    onSentence(sentence) {
      emitted.push(sentence);
    }
  });
  const voiceDeadline = Date.now() + 2500;
  while (emitted.length < 1 && Date.now() < voiceDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(emitted[0]?.text, firstVoice, 'the first VOICE must be dispatched before CAPTION tokens arrive');
  assert.equal(typeof releaseCaptionLines, 'function');
  releaseCaptionLines();
  await streamingRequest;

  const prompt = requestBody?.messages?.[0]?.content || '';
  assert.match(prompt, /VOICE[\s\S]*Japanese[\s\S]*CAPTION[\s\S]*Simplified Chinese/i);
  assert.ok(
    prompt.indexOf('VOICE:') < prompt.indexOf('CAPTION:'),
    'the first Japanese VOICE must stay ahead of caption generation for first-token latency'
  );
  assert.deepEqual(emitted.map((item) => item.text), [firstVoice, secondVoice]);
  assert.deepEqual(
    emitted.map((item) => item.sourceLang),
    ['ja', 'ja'],
    'explicit VOICE lines must take the zero-translation GPT-SoVITS path'
  );
  assert.deepEqual(
    await Promise.all(emitted.map((item) => item.captionReady)),
    [firstCaption, secondCaption],
    'each Japanese speech chunk must receive the matching Chinese caption from the same stream'
  );
});
