import { DEFAULT_GATE_DB, MAX_VOCAL_SECONDS, MOUTH_STEP_MS, validateMouthTimeline } from '../../../shared/rvc-mouth.mjs';

// Average channel energy (not samples): anti-phase stereo must not cancel vocals.
export async function buildVocalTimeline(buffer, vocalName, { yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > MAX_VOCAL_SECONDS) {
    throw new Error('纯人声轨时长需要在 20 分钟以内');
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const count = Math.ceil(buffer.duration * 1000 / MOUTH_STEP_MS), frames = new Array(count);
  for (let frame = 0; frame < count; frame++) {
    const start = Math.floor(frame * buffer.sampleRate * MOUTH_STEP_MS / 1000);
    const end = Math.min(buffer.length, Math.floor((frame + 1) * buffer.sampleRate * MOUTH_STEP_MS / 1000));
    let sum = 0;
    for (const channel of channels) for (let i = start; i < end; i++) sum += channel[i] ** 2;
    frames[frame] = Math.min(10000, Math.round(Math.sqrt(sum / Math.max(1, (end - start) * channels.length)) * 10000));
    // Bound main-thread work so importing a long vocal stem does not stall Cubism.
    if (frame % 200 === 199) await yieldControl();
  }
  return validateMouthTimeline({ version: 1, stepMs: MOUTH_STEP_MS, duration: buffer.duration,
    vocalName: vocalName.slice(0, 240), offsetMs: 0, gateDb: DEFAULT_GATE_DB, frames });
}

export async function analyseVocalFile(file) {
  if (!file.size || file.size > 256 * 1024 * 1024) throw new Error('请选择非空的纯人声音频，最大 256 MB');
  // Decode at 16 kHz: enough for the energy envelope, with less decoded memory.
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    return await buildVocalTimeline(buffer, file.name);
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('人声轨解码失败，请重新导出为 WAV / MP3');
    throw error;
  } finally { await context.close().catch(() => {}); }
}
