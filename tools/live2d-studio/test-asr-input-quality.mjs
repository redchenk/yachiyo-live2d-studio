import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    normalizeLive2DAsrText,
    prepareLive2DAsrSamples,
    selectLive2DAsrTranscript
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dAsr.js');

  assert.equal(normalizeLive2DAsrText('我 要 听 r a y'), '我要听 ray');
  assert.equal(normalizeLive2DAsrText('八 千 代 你 好'), '八千代你好');
  assert.equal(selectLive2DAsrTranscript({
    text: '我要听类',
    result: {
      alternatives: [
        { text: '我要听类', confidence: 0.42 },
        { text: '我要听 ray', confidence: 0.81 }
      ]
    }
  }), '我要听 ray');

  const samples = new Float32Array([
    0, 0, 0, 0,
    0.01, -0.01, 0.02, -0.02, 0.015, -0.015,
    0, 0, 0, 0
  ]);
  const prepared = prepareLive2DAsrSamples(samples, 1000, {
    inputGain: 1.5,
    trimThreshold: 0.005,
    paddingMs: 1,
    targetPeak: 0.82,
    maxNormalizationGain: 50
  });
  assert.ok(prepared.length < samples.length, 'leading and trailing silence must be removed');
  const peak = Math.max(...prepared.map((sample) => Math.abs(sample)));
  assert.ok(peak >= 0.79 && peak <= 0.83, `speech peak should be normalized, received ${peak}`);
  assert.ok(prepared.every((sample) => sample >= -1 && sample <= 1));

  console.log('ASR input quality checks passed');
} finally {
  await server.close();
}
