import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    applyRoomLLMProviderPreset,
    normalizeLLMApiUrl,
    normalizeRoomLLMSettings
  } = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');
  const {
    formatLive2DVisionPrompt
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dVision.js');

  const deepseek = applyRoomLLMProviderPreset({
    apiKey: 'keep-key',
    systemPrompt: 'keep prompt'
  }, 'deepseek');
  assert.equal(deepseek.provider, 'deepseek');
  assert.equal(deepseek.apiUrl, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(deepseek.model, 'deepseek-chat');
  assert.equal(deepseek.apiKey, 'keep-key');
  assert.equal(deepseek.systemPrompt, 'keep prompt');

  assert.equal(
    normalizeLLMApiUrl('https://api.deepseek.com', 'deepseek-chat'),
    'https://api.deepseek.com/v1/chat/completions'
  );
  assert.equal(
    normalizeLLMApiUrl('https://api.siliconflow.cn/v1', 'deepseek-ai/DeepSeek-V3'),
    'https://api.siliconflow.cn/v1/chat/completions'
  );

  const context = {
    enabled: true,
    capturedAt: '2026-06-02T00:00:00.000Z',
    cursor: { x: 12, y: 34 },
    pointerWindow: { available: true, title: 'Editor', processName: 'Code', bounds: { x: 0, y: 0, width: 800, height: 600 } },
    foregroundWindow: { available: true, title: 'Editor', processName: 'Code', bounds: { x: 0, y: 0, width: 800, height: 600 } },
    redacted: false,
    image: {
      mimeType: 'image/png',
      cursorCropBase64: 'iVBORw0KGgo=',
      cursorCropRect: { x: 0, y: 0, width: 512, height: 512 }
    }
  };
  const visionSettings = { includeScreenshot: true, maxPromptChars: 1600, detail: 'low' };

  const deepseekVision = formatLive2DVisionPrompt(
    context,
    visionSettings,
    normalizeRoomLLMSettings({ provider: 'deepseek', apiUrl: 'https://api.deepseek.com', model: 'deepseek-chat' })
  );
  assert.equal(deepseekVision.payload, null);
  assert.ok(deepseekVision.prompt.includes('Desktop visual context:'));

  const openAiVision = formatLive2DVisionPrompt(
    context,
    visionSettings,
    normalizeRoomLLMSettings({ provider: 'openai', apiUrl: 'https://api.openai.com/v1/responses', model: 'gpt-4o-mini' })
  );
  assert.equal(openAiVision.payload?.imageBase64, 'iVBORw0KGgo=');
} finally {
  await server.close();
}

console.log('llm provider switch checks passed');
