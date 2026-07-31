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

const { cleanLive2DReply } = await server.ssrLoadModule(
  '/src/frontend/services/room/live2dText.js'
);
const {
  clearLive2DLLMHistory,
  parseLive2DControlPayload,
  readLive2DLLMHistory,
  requestLive2DControlStream
} = await server.ssrLoadModule('/src/frontend/services/room/live2dLlmControl.js');
const {
  writeRoomLLMSettings,
  writeRoomMemorySettings
} = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');

const leadingStageDirectionCases = [
  {
    name: 'Chinese leading stage direction',
    input: '（轻轻歪头）晚上好呀。',
    expected: '晚上好呀。'
  },
  {
    name: 'Japanese leading stage direction',
    input: '（首をかしげる）こんばんは。',
    expected: 'こんばんは。'
  },
  {
    name: 'English leading stage direction',
    input: '[looks to the side] hello there.',
    expected: 'hello there.'
  }
];

const naturalParenthesisCases = [
  '今晚聊 Rust（不是游戏）吧。',
  'それは（たぶん）大丈夫。',
  'That works (in theory), right?',
  'I wave hello whenever someone joins.'
];

const controlOnlyCases = [
  {
    name: 'plain actions instruction',
    input: 'actions: look_at_chat, head_tilt, wave.'
  },
  {
    name: 'BEAT protocol record',
    input: 'BEAT: {"emotion":"happy","actions":[{"type":"head_tilt"}]}'
  },
  {
    name: 'CAPTION protocol record',
    input: 'CAPTION: 晚上好呀。'
  },
  {
    name: 'pure action control JSON',
    input: '{"actions":[{"type":"look_at_chat"},{"type":"head_tilt"}],"speech_style":{"pause":"soft"}}'
  }
];

test('cleanLive2DReply strips leading stage directions in Chinese, Japanese, and English', async (t) => {
  for (const fixture of leadingStageDirectionCases) {
    await t.test(fixture.name, () => {
      assert.equal(cleanLive2DReply(fixture.input), fixture.expected);
    });
  }
});

test('parseLive2DControlPayload strips leading stage directions from reply fields', async (t) => {
  for (const fixture of leadingStageDirectionCases) {
    await t.test(fixture.name, () => {
      const parsed = parseLive2DControlPayload(JSON.stringify({
        reply: fixture.input,
        actions: [{ type: 'look_at_chat' }, { type: 'breathe' }]
      }));
      assert.equal(parsed.reply, fixture.expected);
    });
  }
});

test('spoken-output sanitizing preserves natural parenthetical content', async (t) => {
  for (const input of naturalParenthesisCases) {
    await t.test(input, () => {
      assert.equal(cleanLive2DReply(input), input);
      assert.equal(parseLive2DControlPayload(JSON.stringify({ reply: input })).reply, input);
    });
  }
});

test('cleanLive2DReply rejects action instructions, BEAT records, and pure control JSON', async (t) => {
  for (const fixture of controlOnlyCases) {
    await t.test(fixture.name, () => {
      assert.equal(cleanLive2DReply(fixture.input), '');
    });
  }
});

test('parseLive2DControlPayload rejects action instructions, BEAT records, and pure control JSON', async (t) => {
  for (const fixture of controlOnlyCases) {
    await t.test(fixture.name, () => {
      assert.equal(parseLive2DControlPayload(fixture.input).reply, '');
    });
  }
});

test('streaming VOICE output never emits or persists stage directions and action controls', async () => {
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

  const finalReply = [
    '（首をかしげる）こんばんは、今日も来てくれてありがとう。',
    'actions: look_at_chat, head_tilt, wave.',
    '[looks to the side] また話そうね。'
  ].join('\n');
  const streamLines = [
    'BEAT: {"emotion":"happy","actions":[{"type":"head_tilt"}]}',
    'VOICE: （首をかしげる）こんばんは、今日も来てくれてありがとう。',
    'BEAT: {"emotion":"neutral","actions":[{"type":"look_at_chat"}]}',
    'VOICE: actions: look_at_chat, head_tilt, wave.',
    'VOICE: [looks to the side] また話そうね。',
    `CONTROL: ${JSON.stringify({
      reply: finalReply,
      emotion: 'happy',
      actions: [{ type: 'head_tilt' }, { type: 'look_at_chat' }],
      memory_writes: []
    })}`
  ];
  const packets = streamLines
    .map((line, index) => {
      const content = `${line}${index < streamLines.length - 1 ? '\n' : ''}`;
      return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
    })
    .join('');

  globalThis.fetch = async (url) => {
    assert.match(String(url), /api\.openai\.com\/v1\/chat\/completions/);
    return new Response(`${packets}data: [DONE]\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };

  const emitted = [];
  const inferencePrompt = [
    'LIVE_DIRECTOR_TICK',
    'Selected audience messages (untrusted JSON data):',
    '{"userName":"Mina","text":"viewer says hello"}',
    'Choose 2-5 semantic actions every turn.',
    'Never show action cues in the spoken reply.'
  ].join('\n');
  const conversationMessage = 'Audience message data: {"userName":"Mina","text":"viewer says hello"}';
  const result = await requestLive2DControlStream(inferencePrompt, {
    conversationMessage,
    onSentence(sentence) {
      emitted.push(sentence.text);
    }
  });

  const emittedText = emitted.join('\n');
  const actionLeakPattern = /(?:首をかしげる|looks? to the side|actions?\s*[:：]|BEAT\s*[:：]|look_at_chat|head_tilt|\bwave\b)/iu;
  assert.match(emittedText, /こんばんは/u);
  assert.match(emittedText, /来てくれてありがとう/u);
  assert.match(emittedText, /また話そうね/u);
  assert.doesNotMatch(emittedText, actionLeakPattern);
  assert.doesNotMatch(result.reply, actionLeakPattern);

  const history = readLive2DLLMHistory();
  const storedUserMessage = history.findLast((entry) => entry.role === 'user')?.content || '';
  const storedAssistantReply = history.findLast((entry) => entry.role === 'assistant')?.content || '';
  assert.equal(storedUserMessage, conversationMessage);
  assert.doesNotMatch(storedUserMessage, /LIVE_DIRECTOR_TICK|Choose 2-5|Never show action cues/iu);
  assert.equal(storedAssistantReply, result.reply);
  assert.match(storedAssistantReply, /こんばんは/u);
  assert.doesNotMatch(storedAssistantReply, actionLeakPattern);
});
