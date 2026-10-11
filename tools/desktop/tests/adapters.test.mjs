import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMusicAdapter } from '../music.mjs';
import { buildTtsRequest, audioBase64 } from '../tts.mjs';
import { buildChatRequest } from '../chat.mjs';

test('TTS adapters preserve streaming Japanese audio and provider-specific auth', () => {
  const local = buildTtsRequest({ provider: 'gpt-sovits', text: 'こんにちは', refAudioPath: '/voice.wav', apiUrl: 'http://tts.local/tts' });
  assert.equal(local.body.streaming_mode, true);
  assert.equal(local.body.text_lang, 'ja');
  assert.equal(local.body.ref_audio_path, '/voice.wav');
  const mimo = buildTtsRequest({ provider: 'mimo', text: 'こんにちは', apiKey: 'test-key' });
  assert.equal(mimo.headers['api-key'], 'test-key');
  assert.equal(mimo.body.messages.at(-1).content, 'こんにちは');
  assert.equal(audioBase64({ choices: [{ message: { audio: { data: 'YWJj' } } }] }).toString(), 'abc');
  assert.equal(buildTtsRequest({ provider: 'openai-compatible', text: 'hi', speechStyle: { speed: 50 } }).body.speed, 1.25);
});

test('chat adapters retain vision and history in both response formats', () => {
  for (const route of ['chat/completions', 'responses']) {
    const request = buildChatRequest({ apiUrl: `https://provider.invalid/v1/${route}`, model: 'test', systemPrompt: 'persona', message: 'look', conversation: [{ role: 'assistant', content: 'previous' }, { role: 'tool', content: 'ignored' }], vision: { imageBase64: 'YWJj', includeImage: true } }, true);
    assert.equal(request.body.stream, true);
    const lines = request.body.messages || request.body.input;
    assert.equal(lines.at(-2).content, 'previous');
    assert.equal(lines.at(-1).content.length, 2);
    assert.equal(lines.some(x => x.role === 'tool'), false);
  }
});

test('official DeepSeek Flash streams live replies without the default thinking delay', () => {
  const input = { apiUrl: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-flash', message: 'hello' };
  assert.deepEqual(buildChatRequest(input, true).body.thinking, { type: 'disabled' });
  assert.equal(buildChatRequest({ ...input, apiUrl: 'https://other.example/chat/completions' }).body.thinking, undefined);
});

test('music resolver skips previews and keeps provider URL behind a local token', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-music-adapter-'));
  const calls = [];
  try {
    const adapter = createMusicAdapter(dataDir, { client: { song_url_v1: async input => {
      calls.push(input.level);
      return { body: { data: [{ url: `https://audio.invalid/${input.level}`, code: 200, ...(input.level === 'exhigh' ? { freeTrialInfo: { start: 0, end: 30 } } : {}) }] } };
    } } });
    const result = await adapter.handle('/api/music/netease/resolve', { songId: '123', neteaseQualityLevel: 'exhigh' });
    assert.deepEqual(calls, ['exhigh', 'higher']);
    assert.match(result.candidate.url, /^\/api\/music\/netease\/stream\?token=/);
    assert.equal(adapter.streamUrl(result.candidate.url.split('token=')[1]), 'https://audio.invalid/higher');
    assert.equal(adapter.streamUrl('unknown'), null);
    const previews = createMusicAdapter(dataDir, { client: { song_url_v1: async () => ({ body: { data: [{ url: 'https://preview.invalid', freeTrialInfo: { end: 30 } }] } }) } });
    await assert.rejects(previews.handle('/api/music/netease/resolve', { songId: '123' }), /完整音源/);
    const truncated = createMusicAdapter(dataDir, { client: { song_url_v1: async () => ({ body: { data: [{ url: 'https://preview.invalid', br: 128000, size: 480000 }] } }) } });
    await assert.rejects(truncated.handle('/api/music/netease/resolve', { songId: '123', candidate: { durationMs: 180000 } }), /完整音源/);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
