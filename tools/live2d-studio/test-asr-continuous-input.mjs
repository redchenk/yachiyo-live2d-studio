import assert from 'node:assert/strict';
import { createServer } from 'vite';

const store = new Map([
  ['roomASRSettings', JSON.stringify({
    enabled: true,
    provider: 'vosk',
    sampleRate: 16000,
    inputGain: 1,
    vadThreshold: 0.01,
    continuousSilenceMs: 500,
    continuousMaxSegmentMs: 5000,
    minSpeechMs: 250,
    maxAlternatives: 3,
    endpoint: '/api/asr'
  })]
]);
const states = [];
const results = [];
const requests = [];
let processor = null;
let nowMs = 0;

globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.performance = { now: () => nowMs };
globalThis.FileReader = class FileReader {
  async readAsDataURL(blob) {
    const bytes = Buffer.from(await blob.arrayBuffer());
    this.result = `data:audio/wav;base64,${bytes.toString('base64')}`;
    this.onload?.();
  }
};

const source = { connect() {}, disconnect() {} };
const audioContext = {
  sampleRate: 16000,
  destination: {},
  createMediaStreamSource: () => source,
  createScriptProcessor: () => {
    processor = { connect() {}, disconnect() {}, onaudioprocess: null };
    return processor;
  },
  close: () => Promise.resolve()
};
const stream = { getTracks: () => [{ stop() {} }] };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices: { getUserMedia: async () => stream } }
});
globalThis.window = {
  localStorage: globalThis.localStorage,
  setTimeout,
  clearTimeout,
  AudioContext: class AudioContext { constructor() { return audioContext; } }
};
globalThis.fetch = async (_url, options = {}) => {
  requests.push(JSON.parse(options.body || '{}'));
  return Response.json({
    success: true,
    data: {
      text: '我 要 听 类',
      result: {
        alternatives: [
          { text: '我 要 听 类', confidence: 0.4 },
          { text: '我 要 听 r a y', confidence: 0.86 }
        ]
      }
    }
  });
};

function emitAudio(amplitude, at) {
  nowMs = at;
  const samples = new Float32Array(4096).fill(amplitude);
  processor.onaudioprocess({
    inputBuffer: { getChannelData: () => samples },
    outputBuffer: { getChannelData: () => new Float32Array(4096) }
  });
}

async function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for continuous ASR');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const { createLive2DAsrRecorder } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dAsr.js'
  );
  const recorder = createLive2DAsrRecorder({
    onState: (state) => states.push(state),
    onResult: (result) => results.push(result)
  });

  assert.equal(recorder.setInputGain(1.6), 1.6);
  await recorder.start({ continuous: true });
  assert.equal(recorder.isContinuous(), true);
  emitAudio(0.04, 100);
  emitAudio(0.04, 450);
  emitAudio(0, 1050);
  await waitFor(() => results.length === 1);
  assert.equal(results[0].text, '我要听 ray');
  assert.equal(requests[0].maxAlternatives, 3);
  assert.equal(recorder.isRecording(), true, 'continuous mode must keep listening after each result');

  recorder.setSuppressed(true);
  emitAudio(0.05, 1400);
  emitAudio(0.05, 1750);
  emitAudio(0, 2400);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(results.length, 1, 'the always-on microphone must not transcribe Yachiyo TTS playback');
  recorder.setSuppressed(false);
  await recorder.stop();
  assert.equal(recorder.isRecording(), false);
  assert.ok(states.some((state) => state.status === 'listening' && state.continuous === true));

  console.log('Continuous ASR input checks passed');
} finally {
  await server.close();
}
