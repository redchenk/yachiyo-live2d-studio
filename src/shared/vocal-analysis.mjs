import { createMfccExtractor, classifyVowels, ANALYSIS_SIZE, ANALYSIS_RATE } from './audio-lipsync.mjs';
import { DEFAULT_GATE_DB, MAX_VOCAL_SECONDS, MOUTH_STEP_MS, validateMouthTimeline } from './rvc-mouth.mjs';
// Average channel energy (not samples): anti-phase stereo must not cancel vocals.
export async function buildVocalTimeline(buffer, vocalName, { yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), profile } = {}) {
  if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > MAX_VOCAL_SECONDS) {
    throw new Error('纯人声轨时长需要在 20 分钟以内');
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const count = Math.ceil(buffer.duration * 1000 / MOUTH_STEP_MS), frames = new Array(count);
  const vowels = [], mfcc = createMfccExtractor(), samples = new Float32Array(ANALYSIS_SIZE);
  for (let frame = 0; frame < count; frame++) {
    const start = Math.floor(frame * buffer.sampleRate * MOUTH_STEP_MS / 1000);
    const end = Math.min(buffer.length, Math.floor((frame + 1) * buffer.sampleRate * MOUTH_STEP_MS / 1000));
    let sum = 0;
    for (const channel of channels) for (let i = start; i < end; i++) sum += channel[i] ** 2;
    frames[frame] = Math.min(10000, Math.round(Math.sqrt(sum / Math.max(1, (end - start) * channels.length)) * 10000));
    if (frame % 2 === 0) {
      // Use the strongest channel for spectral shape; retain all-channel RMS above.
      let best = channels[0], bestEnergy = -1;
      for (const channel of channels) {
        let energy = 0;
        for (let i = start; i < end; i++) energy += channel[i] ** 2;
        if (energy > bestEnergy) { bestEnergy = energy; best = channel; }
      }
      const center = (frame + 1) * buffer.sampleRate / 100;
      for (let i = 0; i < ANALYSIS_SIZE; i++) {
        const pos = center + (i - ANALYSIS_SIZE / 2) * buffer.sampleRate / ANALYSIS_RATE;
        const index = Math.floor(pos), fraction = pos - index;
        samples[i] = (best[index] || 0) * (1 - fraction) + (best[index + 1] || 0) * fraction;
      }
      const scores = frames[frame] > 5 ? classifyVowels(mfcc(samples), profile) : [0, 0, 0, 0, 0];
      vowels.push(...scores.map(n => Math.round(n * 255)));
    }
    // Bound main-thread work so importing a long vocal stem does not stall Cubism.
    if (frame % 20 === 19) await yieldControl();
  }
  return validateMouthTimeline({ version: 2, vowels, vowelStepMs: 20, stepMs: MOUTH_STEP_MS, duration: buffer.duration,
    vocalName: vocalName.slice(0, 240), offsetMs: 0, gateDb: DEFAULT_GATE_DB, frames });
}
