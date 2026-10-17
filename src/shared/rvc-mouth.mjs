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
  if (!value || value.version !== 1 || value.stepMs !== MOUTH_STEP_MS ||
      !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > MAX_VOCAL_SECONDS ||
      typeof value.vocalName !== 'string' || !value.vocalName.trim() || value.vocalName.length > 240 ||
      !Array.isArray(value.frames) || value.frames.length !== Math.ceil(value.duration * 1000 / MOUTH_STEP_MS) ||
      value.frames.some(n => !Number.isInteger(n) || n < 0 || n > 10000)) {
    throw new Error('人声口型数据无效，请重新关联纯人声轨（最长 20 分钟）');
  }
  return { version: 1, stepMs: MOUTH_STEP_MS, duration: value.duration,
    vocalName: value.vocalName.replace(/[\x00-\x1f]/g, ''), frames: value.frames,
    ...validateMouthSettings(value) };
}

export function mouthSummary(timeline) {
  if (!timeline) return null;
  const { vocalName, duration, offsetMs, gateDb } = timeline;
  return { vocalName, duration, offsetMs, gateDb };
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
