import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { boundedConversation, followupRetrievalQuery, relevantExcerpt, diverseMemoryResults } from '../../src/shared/retrieval-context.mjs';
import { YACHIYO_CANON_ENTRIES } from '../../src/shared/yachiyo-canon.mjs';

const history = Array.from({ length: 40 }, (_, i) => [{ role: 'user', content: `question ${i}` }, { role: 'assistant', content: `reply ${i}` }]).flat();
assert.equal(boundedConversation(history).length, 48);
assert.equal(boundedConversation(history, { historyMaxTurns: 6, historyMaxChars: 1000 }).length, 12);
assert.equal(followupRetrievalQuery('那后来呢', [{ role: 'user', content: '辉夜为什么会回来' }, { role: 'assistant', content: 'invented lore' }]), '辉夜为什么会回来\n那后来呢');
const long = '普通无关的段落。'.repeat(1200) + '春日直播的暗号是樱花松饼，周六下午三点。' + '别的话题。'.repeat(800);
assert.match(relevantExcerpt(long, '春日直播的暗号', 800), /樱花松饼/);
assert.ok(relevantExcerpt(long, '春日直播', 800).length <= 800);
assert.equal(diverseMemoryResults([{ id: 'n1', summary: 'fact' }, { id: 'c1', sourceMemoryId: 'n1', summary: 'fact' }, { id: 'n2', summary: 'other' }]).length, 2);
assert.equal(YACHIYO_CANON_ENTRIES.length, 101);

const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const settings = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');
  assert.equal(settings.readRoomLLMSettings().model, 'deepseek-flash');
  assert.equal(settings.readRoomLLMSettings().provider, 'deepseek');
  const tts = settings.readRoomTTSSettings();
  assert.equal(tts.refAudioPath, 'E:\\visualstudio\\cankao.wav');
  assert.equal(tts.promptText, '八千年分の知識と経験で、どんなお悩み相談もお任せあれ。');
  assert.match(tts.gptWeightPath, /e20.ckpt$/);
  assert.match(tts.sovitsWeightPath, /e12_s684.pth$/);
  store.clear();
  store.set(settings.ROOM_LLM_SETTINGS_KEY, JSON.stringify({ provider: 'custom', apiUrl: 'https://private.example/chat/completions', apiKey: 'keep-local-test', model: 'private-model' }));
  assert.equal(settings.readRoomLLMSettings().model, 'private-model', 'migration retains customized provider credentials and model');
  store.set(settings.ROOM_TTS_SETTINGS_KEY, JSON.stringify({ provider: 'gpt-sovits', refAudioPath: 'custom.wav', gptWeightPath: 'custom.ckpt' }));
  assert.equal(settings.readRoomTTSSettings().refAudioPath, 'custom.wav');
  const { selectYachiyoCanon, buildYachiyoCanonPrompt } = await server.ssrLoadModule('/src/frontend/services/room/yachiyoCanon.js');
  assert.ok(selectYachiyoCanon('八千代的身世，不要剧透').every(entry => !entry.spoiler));
  assert.ok(selectYachiyoCanon('八千代与辉夜是不是同一个人，结局可以剧透').some(entry => entry.spoiler));
  assert.match(buildYachiyoCanonPrompt('八千代想吃松饼吗'), /references/);
  const { formatMemoryPrompt } = await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js');
  const prompt = formatMemoryPrompt([{ id: 'late-fact', type: 'session', source: 'runtime', content: long, summary: '此前聊过春日直播', updated: '2026-10-11' }], { query: '春日直播的暗号', contextMaxChars: 5000, snippetMaxChars: 800 });
  assert.match(prompt, /樱花松饼/);
  assert.ok(prompt.length <= 5000);
  assert.equal(formatMemoryPrompt([{ type: 'profile', source: 'seed', summary: 'obsolete persona' }]), '');
} finally { await server.close(); delete globalThis.localStorage; }
console.log('Spring defaults, canon, follow-up, long history and query-focused memory checks passed');
