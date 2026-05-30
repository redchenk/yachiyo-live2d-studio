import { readRoomASRSettings } from './roomSettings';

const ASR_FETCH_TIMEOUT_MS = 45000;
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096;

function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function setState(onState, patch) {
  try {
    onState?.(patch);
  } catch (_) {
    // ASR state should never interrupt room interaction.
  }
}

function fetchWithTimeout(url, options = {}, timeoutMs = ASR_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => window.clearTimeout(timer));
}

function flattenSamples(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  const sourceRate = Math.max(1, Number(inputSampleRate) || outputSampleRate);
  const targetRate = Math.max(1, Number(outputSampleRate) || sourceRate);
  if (targetRate >= sourceRate) return buffer;

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(buffer.length / ratio));
  const output = new Float32Array(outputLength);
  let sourceOffset = 0;
  for (let i = 0; i < outputLength; i++) {
    const nextOffset = Math.min(buffer.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = Math.round(sourceOffset); j < nextOffset; j++) {
      sum += buffer[j] || 0;
      count += 1;
    }
    output[i] = count ? sum / count : 0;
    sourceOffset = nextOffset;
  }
  return output;
}

function floatTo16BitPcm(view, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const sample = Math.max(-1, Math.min(1, input[i] || 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);
  floatTo16BitPcm(view, 44, samples);
  return new Blob([view], { type: 'audio/wav' });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.includes(',') ? value.split(',').pop() : value);
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

async function requestVoskRecognition(wavBlob, settings) {
  const audioBase64 = await blobToBase64(wavBlob);
  const response = await fetchWithTimeout(settings.endpoint || '/api/asr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'vosk',
      modelPath: settings.modelPath,
      sampleRate: settings.sampleRate,
      words: settings.words,
      audioFormat: 'wav',
      audioBase64
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || payload?.message || `ASR failed (${response.status})`);
  }
  return payload.data || payload;
}

export function createLive2DAsrRecorder({ onState, onResult } = {}) {
  let stream = null;
  let audioContext = null;
  let source = null;
  let processor = null;
  let chunks = [];
  let startedAt = 0;
  let maxTimer = 0;
  let recording = false;

  function cleanup() {
    window.clearTimeout(maxTimer);
    maxTimer = 0;
    if (processor) {
      processor.onaudioprocess = null;
      processor.disconnect();
      processor = null;
    }
    if (source) {
      source.disconnect();
      source = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (audioContext) {
      audioContext.close?.().catch(() => {});
      audioContext = null;
    }
  }

  async function start() {
    const settings = readRoomASRSettings();
    if (!settings.enabled) throw new Error('ASR is disabled in settings.');
    if (recording) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support WebAudio recording.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable.');

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true
      }
    });
    audioContext = new AudioContextClass();
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1);
    chunks = [];
    startedAt = performance.now();
    recording = true;

    processor.onaudioprocess = (event) => {
      if (!recording) return;
      const input = event.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
      event.outputBuffer.getChannelData(0).fill(0);
    };
    source.connect(processor);
    processor.connect(audioContext.destination);

    maxTimer = window.setTimeout(() => {
      stop().catch(() => {});
    }, clamp(settings.maxRecordMs, 1500, 60000, 12000));
    setState(onState, { status: 'listening', error: '', text: '' });
  }

  async function stop() {
    if (!recording) return null;
    const settings = readRoomASRSettings();
    const inputSampleRate = audioContext?.sampleRate || settings.sampleRate;
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    recording = false;
    setState(onState, { status: 'transcribing', error: '' });

    const captured = flattenSamples(chunks);
    cleanup();
    if (captured.length < Math.max(1600, inputSampleRate * 0.16)) {
      setState(onState, { status: 'idle', error: 'No speech captured.' });
      return null;
    }

    const sampleRate = Math.round(clamp(settings.sampleRate, 8000, 48000, 16000));
    const samples = downsampleBuffer(captured, inputSampleRate, sampleRate);
    const wavBlob = encodeWav(samples, sampleRate);
    const result = await requestVoskRecognition(wavBlob, {
      ...settings,
      sampleRate
    });
    const text = String(result.text || '').trim();
    setState(onState, { status: 'idle', error: '', text, elapsedMs });
    if (text) onResult?.({ ...result, text, elapsedMs });
    return result;
  }

  function isRecording() {
    return recording;
  }

  function destroy() {
    recording = false;
    cleanup();
    setState(onState, { status: 'idle', error: '' });
  }

  return {
    start,
    stop,
    isRecording,
    destroy
  };
}
