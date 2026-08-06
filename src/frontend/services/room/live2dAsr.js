import {
  readRoomASRSettings,
  writeRoomASRSettings
} from './roomSettings';

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

export function normalizeLive2DAsrText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '')
    .replace(/\b(?:[a-z]\s+)+[a-z]\b/giu, (letters) => letters.replace(/\s+/g, ''))
    .replace(/\s+([，。！？、,.!?])/gu, '$1')
    .trim();
}

export function selectLive2DAsrTranscript(payload = {}) {
  const alternatives = [
    ...(Array.isArray(payload?.alternatives) ? payload.alternatives : []),
    ...(Array.isArray(payload?.result?.alternatives) ? payload.result.alternatives : [])
  ].filter((item) => String(item?.text || '').trim());
  const best = alternatives.sort((left, right) => (
    Number(right?.confidence) - Number(left?.confidence)
  ))[0];
  return normalizeLive2DAsrText(best?.text || payload?.text || payload?.result?.text || '');
}

export function prepareLive2DAsrSamples(samples, sampleRate, options = {}) {
  const source = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  if (!source.length) return source;
  const inputGain = clamp(options.inputGain, 0, 4, 1);
  const trimThreshold = clamp(options.trimThreshold, 0, 0.2, 0.008);
  const paddingSamples = Math.max(
    0,
    Math.round((Number(sampleRate) || 16000) * clamp(options.paddingMs, 0, 1000, 120) / 1000)
  );
  const amplified = new Float32Array(source.length);
  let mean = 0;
  for (const sample of source) mean += Number(sample) || 0;
  mean /= source.length;
  let first = -1;
  let last = -1;
  for (let index = 0; index < source.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, ((Number(source[index]) || 0) - mean) * inputGain));
    amplified[index] = sample;
    if (Math.abs(sample) >= trimThreshold) {
      if (first < 0) first = index;
      last = index;
    }
  }
  if (first < 0 || last < first) return amplified;
  const start = Math.max(0, first - paddingSamples);
  const end = Math.min(amplified.length, last + paddingSamples + 1);
  const trimmed = amplified.slice(start, end);
  let peak = 0;
  for (const sample of trimmed) peak = Math.max(peak, Math.abs(sample));
  const targetPeak = clamp(options.targetPeak, 0.2, 0.98, 0.86);
  const maxNormalizationGain = clamp(options.maxNormalizationGain, 1, 64, 16);
  const normalizationGain = peak > 0
    ? Math.min(maxNormalizationGain, targetPeak / peak)
    : 1;
  if (normalizationGain <= 1.001) return trimmed;
  const output = new Float32Array(trimmed.length);
  for (let index = 0; index < trimmed.length; index += 1) {
    output[index] = Math.max(-1, Math.min(1, trimmed[index] * normalizationGain));
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
      maxAlternatives: settings.maxAlternatives,
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

async function transcribeCapturedSamples(captured, inputSampleRate, settings, inputGain, elapsedMs) {
  if (captured.length < Math.max(1600, inputSampleRate * 0.16)) return null;
  const sampleRate = Math.round(clamp(settings.sampleRate, 8000, 48000, 16000));
  const downsampled = downsampleBuffer(captured, inputSampleRate, sampleRate);
  const samples = prepareLive2DAsrSamples(downsampled, sampleRate, {
    inputGain,
    trimThreshold: Math.max(0.004, Number(settings.vadThreshold) * 0.6),
    paddingMs: 140,
    targetPeak: 0.86,
    maxNormalizationGain: 16
  });
  if (samples.length < Math.max(1600, sampleRate * 0.12)) return null;
  const wavBlob = encodeWav(samples, sampleRate);
  const result = await requestVoskRecognition(wavBlob, {
    ...settings,
    sampleRate
  });
  const text = selectLive2DAsrTranscript(result);
  return { ...result, text, elapsedMs };
}

export function createLive2DAsrRecorder({ onState, onResult } = {}) {
  let stream = null;
  let audioContext = null;
  let source = null;
  let processor = null;
  let chunks = [];
  let startedAt = 0;
  let segmentStartedAt = 0;
  let speechStartedAt = 0;
  let lastSpeechAt = 0;
  let lastLevelAt = 0;
  let maxTimer = 0;
  let recording = false;
  let continuous = false;
  let suppressed = false;
  let pendingRecognitions = 0;
  let destroyed = false;
  let activeSettings = readRoomASRSettings();
  let inputGain = activeSettings.inputGain;
  let recognitionTail = Promise.resolve();

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

  function resetSegment(now = performance.now()) {
    chunks = [];
    segmentStartedAt = now;
    speechStartedAt = 0;
    lastSpeechAt = 0;
  }

  function listeningState(patch = {}) {
    return {
      status: recording ? 'listening' : 'idle',
      continuous,
      transcribing: pendingRecognitions > 0,
      suppressed,
      ...patch
    };
  }

  function enqueueContinuousRecognition(segmentChunks, inputSampleRate, elapsedMs) {
    if (!segmentChunks.length) return recognitionTail;
    const captured = flattenSamples(segmentChunks);
    const settings = { ...activeSettings };
    const segmentGain = inputGain;
    pendingRecognitions += 1;
    setState(onState, listeningState({ error: '' }));
    recognitionTail = recognitionTail
      .then(async () => {
        const result = await transcribeCapturedSamples(
          captured,
          inputSampleRate,
          settings,
          segmentGain,
          elapsedMs
        );
        if (!destroyed && result?.text) onResult?.(result);
        return result;
      })
      .catch((error) => {
        if (!destroyed) {
          setState(onState, listeningState({
            error: error?.message || 'ASR failed'
          }));
        }
        return null;
      })
      .finally(() => {
        pendingRecognitions = Math.max(0, pendingRecognitions - 1);
        if (!destroyed) setState(onState, listeningState({ error: '' }));
      });
    return recognitionTail;
  }

  function flushContinuousSegment(now, inputSampleRate) {
    const segmentChunks = chunks;
    const elapsedMs = Math.max(0, now - (speechStartedAt || segmentStartedAt));
    resetSegment(now);
    return enqueueContinuousRecognition(segmentChunks, inputSampleRate, elapsedMs);
  }

  async function start(options = {}) {
    activeSettings = readRoomASRSettings();
    if (!activeSettings.enabled) throw new Error('ASR is disabled in settings.');
    if (recording) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support WebAudio recording.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable.');

    destroyed = false;
    continuous = options.continuous === true;
    suppressed = false;
    inputGain = Number.isFinite(Number(inputGain)) ? inputGain : activeSettings.inputGain;
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
    startedAt = performance.now();
    recording = true;
    resetSegment(startedAt);

    processor.onaudioprocess = (event) => {
      if (!recording) return;
      const now = performance.now();
      const input = event.inputBuffer.getChannelData(0);
      event.outputBuffer?.getChannelData?.(0)?.fill(0);
      if (suppressed) {
        resetSegment(now);
        if (now - lastLevelAt >= 80) {
          lastLevelAt = now;
          setState(onState, listeningState({ level: 0 }));
        }
        return;
      }
      const copy = new Float32Array(input);
      chunks.push(copy);
      let sumSquares = 0;
      for (const sample of copy) {
        const amplified = Math.max(-1, Math.min(1, sample * inputGain));
        sumSquares += amplified * amplified;
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, copy.length));
      if (now - lastLevelAt >= 80) {
        lastLevelAt = now;
        setState(onState, listeningState({ level: Math.min(1, rms * 8) }));
      }
      if (!continuous) return;

      const speaking = rms >= activeSettings.vadThreshold;
      if (speaking) {
        if (!speechStartedAt) speechStartedAt = now;
        lastSpeechAt = now;
      }
      const speechDuration = lastSpeechAt > 0 && speechStartedAt > 0
        ? lastSpeechAt - speechStartedAt
        : 0;
      const silenceDuration = lastSpeechAt > 0 ? now - lastSpeechAt : 0;
      const segmentDuration = now - segmentStartedAt;
      const completedBySilence = (
        speechStartedAt > 0 &&
        speechDuration >= activeSettings.minSpeechMs &&
        silenceDuration >= activeSettings.continuousSilenceMs
      );
      const completedByLimit = speechStartedAt > 0 && segmentDuration >= activeSettings.continuousMaxSegmentMs;
      if (completedBySilence || completedByLimit) {
        flushContinuousSegment(now, audioContext?.sampleRate || activeSettings.sampleRate);
      } else if (!speechStartedAt && segmentDuration >= 1000) {
        resetSegment(now);
      }
    };
    source.connect(processor);
    processor.connect(audioContext.destination);

    if (!continuous) {
      maxTimer = window.setTimeout(() => {
        stop().catch(() => {});
      }, clamp(activeSettings.maxRecordMs, 1500, 60000, 12000));
    }
    setState(onState, listeningState({ error: '', text: '', level: 0 }));
  }

  async function stop() {
    if (!recording) return null;
    const wasContinuous = continuous;
    const settings = { ...activeSettings };
    const inputSampleRate = audioContext?.sampleRate || settings.sampleRate;
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    const captured = flattenSamples(chunks);
    const shouldTranscribeTail = !suppressed && captured.length > 0 && (!wasContinuous || speechStartedAt > 0);
    recording = false;
    continuous = false;
    cleanup();

    if (wasContinuous) {
      if (shouldTranscribeTail) {
        enqueueContinuousRecognition([captured], inputSampleRate, elapsedMs);
      }
      await recognitionTail;
      setState(onState, listeningState({ error: '', level: 0 }));
      return null;
    }

    setState(onState, { status: 'transcribing', continuous: false, error: '' });
    if (!shouldTranscribeTail) {
      setState(onState, { status: 'idle', continuous: false, error: 'No speech captured.' });
      return null;
    }
    const result = await transcribeCapturedSamples(
      captured,
      inputSampleRate,
      settings,
      inputGain,
      elapsedMs
    );
    const text = result?.text || '';
    setState(onState, { status: 'idle', continuous: false, error: '', text, elapsedMs, level: 0 });
    if (text) onResult?.(result);
    return result;
  }

  function setInputGain(value, options = {}) {
    inputGain = clamp(value, 0, 4, 1);
    if (options.persist !== false) {
      activeSettings = writeRoomASRSettings({
        ...readRoomASRSettings(),
        inputGain
      });
    }
    return inputGain;
  }

  function setSuppressed(value) {
    suppressed = Boolean(value);
    if (suppressed) resetSegment();
    if (recording) setState(onState, listeningState({ level: 0 }));
    return suppressed;
  }

  function isRecording() {
    return recording;
  }

  function isContinuous() {
    return recording && continuous;
  }

  function destroy() {
    destroyed = true;
    recording = false;
    continuous = false;
    cleanup();
    setState(onState, { status: 'idle', continuous: false, error: '', level: 0 });
  }

  return {
    start,
    stop,
    setInputGain,
    setSuppressed,
    isRecording,
    isContinuous,
    destroy
  };
}
