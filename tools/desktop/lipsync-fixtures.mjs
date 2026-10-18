import { createMfccExtractor } from '../../src/shared/audio-lipsync.mjs';
import { DEFAULT_VOWEL_PROFILE } from '../../src/shared/lipsync-profile.mjs';
export const names = ['A', 'I', 'U', 'E', 'O'];
const formants = [[800, 1500, 2900], [300, 2600, 3300], [350, 900, 2400], [500, 2200, 3100], [500, 1000, 2600]];
export function vowelSamples(index, seconds = 0.4, level = 0.15, pitch = 220) {
  const frequencies = formants[index], samples = new Float32Array(Math.ceil(seconds * 16000));
  for (let h = 1; h * pitch < 7500; h++) {
    const frequency = h * pitch;
    const amplitude = frequencies.reduce((sum, f, i) => sum + (1 / (i + 1)) * Math.exp(-0.5 * ((frequency - f) / 100) ** 2), 0) / Math.sqrt(h);
    for (let i = 0; i < samples.length; i++) samples[i] += amplitude * Math.sin(2 * Math.PI * frequency * i / 16000);
  }
  const peak = Math.max(...samples);
  for (let i = 0; i < samples.length; i++) samples[i] *= level / peak;
  return samples;
}
export function wav(samples, stereo = false) {
  const channels = stereo ? 2 : 1, out = Buffer.alloc(44 + samples.length * 2 * channels);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(channels, 22); out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000 * channels, 28);
  out.writeUInt16LE(2 * channels, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(out.length - 44, 40);
  for (let i = 0; i < samples.length; i++) for (let c = 0; c < channels; c++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767) * (c ? -1 : 1), 44 + (i * channels + c) * 2);
  return out;
}
export function lipsyncFixture() {
  const samples = new Float32Array(16000 * 5), profile = { ...DEFAULT_VOWEL_PROFILE }, extract = createMfccExtractor();
  for (let v = 0; v < 5; v++) {
    const tone = vowelSamples(v, 0.5);
    samples.set(tone, Math.round((0.5 + v * 0.8) * 16000));
    const rows = [];
    for (let i = 0; i + 1024 < tone.length; i += 320) rows.push(extract(tone.subarray(i, i + 1024)));
    profile[names[v]] = Array.from({ length: 12 }, (_, i) => rows.reduce((s, row) => s + row[i], 0) / rows.length);
  }
  return { samples, profile, wav: wav(samples, true) };
}
