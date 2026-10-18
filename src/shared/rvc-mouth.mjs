import { CLOSED_MOUTH, mouthFromAudio } from './audio-lipsync.mjs';
// A compact, local vocal-energy timeline. Never derive it from the audible mix.
export const MOUTH_STEP_MS = 10;
export const MAX_VOCAL_SECONDS = 20 * 60;
export const DEFAULT_GATE_DB = -38;

export function validateMouthSettings(value) {
  if (!value || !Number.isInteger(value.offsetMs) || Math.abs(value.offsetMs) > 5000 ||
      !Number.isFinite(value.gateDb) || value.gateDb < -60 || value.gateDb > -20) {
    throw new Error('口型设置无效：偏移范围 ±5000 ms，静音门限范围 -60 至 -20 dB');
  }
  return { offsetMs: value.offsetMs, gateDb: value.gateDb };
}

export function validateMouthTimeline(value) {
  if (!value || ![1, 2].includes(value.version) || value.stepMs !== MOUTH_STEP_MS ||
      !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > MAX_VOCAL_SECONDS ||
      typeof value.vocalName !== 'string' || !value.vocalName.trim() || value.vocalName.length > 240 ||
      !Array.isArray(value.frames) || value.frames.length !== Math.ceil(value.duration * 1000 / MOUTH_STEP_MS) ||
      value.frames.some(n => !Number.isInteger(n) || n < 0 || n > 10000)) {
    throw new Error('人声口型数据无效，请重新关联纯人声轨（最长 20 分钟）');
  }
  if (value.version === 2 && (value.vowelStepMs !== 20 || !Array.isArray(value.vowels) ||
      value.vowels.length !== Math.ceil(value.duration * 50) * 5 ||
      value.vowels.some(n => !Number.isInteger(n) || n < 0 || n > 255))) {
    throw new Error('元音口型数据无效，请重新关联纯人声轨');
  }
  return { version: value.version, ...(value.version === 2 ? { vowelStepMs: 20, vowels: value.vowels } : {}), stepMs: MOUTH_STEP_MS, duration: value.duration,
    vocalName: value.vocalName.replace(/[\x00-\x1f]/g, ''), frames: value.frames,
    ...validateMouthSettings(value) };
}

export function mouthSummary(timeline) {
  if (!timeline) return null;
  const { version, vocalName, duration, offsetMs, gateDb } = timeline;
  return { version, vocalName, duration, offsetMs, gateDb };
}

export function vocalMouthAt(timeline, songTime) {
  if (!timeline) return 0;
  // A positive offset delays the mouth, so trimmed vocal stems can be aligned.
  const time = songTime - timeline.offsetMs / 1000;
  if (!Number.isFinite(time) || time < 0 || time >= timeline.duration) return 0;
  const rms = (timeline.frames[Math.floor(time * 1000 / timeline.stepMs)] || 0) / 10000;
  const gate = 10 ** (timeline.gateDb / 20);
  return rms <= gate ? 0 : Math.min(1, (rms - gate) * 7);
}

export function vocalMouthFrameAt(timeline, songTime) {
  if (!timeline) return { ...CLOSED_MOUTH };
  if (timeline.version === 1) {
    const value = vocalMouthAt(timeline, songTime);
    return { ...CLOSED_MOUTH, value, silence: value ? 0 : 1 };
  }
  const time = songTime - timeline.offsetMs / 1000;
  if (!Number.isFinite(time) || time < 0 || time >= timeline.duration) return { ...CLOSED_MOUTH };
  const index = Math.floor(time * 1000 / timeline.vowelStepMs) * 5;
  return mouthFromAudio((timeline.frames[Math.floor(time * 1000 / timeline.stepMs)] || 0) / 10000,
    timeline.vowels.slice(index, index + 5).map(n => n / 255), { gateDb: timeline.gateDb });
}
