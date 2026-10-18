// MFCC pipeline adapted from hecomi/uLipSync (MIT). See licenses/uLipSync-MIT.txt.
// 16 kHz / 1024 samples / 26 mel bands / 12 coefficients, matching its female profile.
import { DEFAULT_VOWEL_PROFILE } from './lipsync-profile.mjs';
export const VOWELS = ['A', 'I', 'U', 'E', 'O'];
export const ANALYSIS_RATE = 16000;
export const ANALYSIS_SIZE = 1024;
export const CLOSED_MOUTH = Object.freeze({ value: 0, vowels: Object.freeze([0, 0, 0, 0, 0]), silence: 1 });
const clamp = (x, a, b) => Math.min(b, Math.max(a, Number(x) || 0));

export function validateVowelProfile(profile) {
  if (!profile || ![...VOWELS, '-'].every(key => Array.isArray(profile[key]) && profile[key].length === 12 &&
    profile[key].every(x => Number.isFinite(x) && Math.abs(x) < 10000) && Math.hypot(...profile[key]) > 0.001)) throw new Error('口型校准数据无效');
  return Object.fromEntries([...VOWELS, '-'].map(key => [key, [...profile[key]]]));
}

export function createMfccExtractor() {
  const size = ANALYSIS_SIZE, bands = 26;
  const re = new Float64Array(size), im = new Float64Array(size), magnitude = new Float64Array(size / 2 + 1);
  const window = Float64Array.from({ length: size }, (_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (size - 1)));
  const filters = Array.from({ length: bands }, (_, band) => {
    const hz = i => 700 * (Math.exp(Math.log(1 + 8000 / 700) * i / (bands + 1)) - 1);
    const begin = hz(band), center = hz(band + 1), end = hz(band + 2), df = ANALYSIS_RATE / size;
    const points = [];
    for (let i = Math.ceil(begin / df) + 1; i <= Math.min(size / 2, Math.floor(end / df)); i++) {
      const f = i * df;
      points.push([i, (i < Math.round(center / df) ? (f - begin) / (center - begin) : (end - f) / (end - center)) / ((end - begin) * 0.5)]);
    }
    return points;
  });
  const cosines = Array.from({ length: 12 }, (_, i) => Float64Array.from({ length: bands }, (_, j) => Math.cos((j + 0.5) * (i + 1) * Math.PI / bands)));
  return samples => {
    let peak = 0;
    // Match uLipSync's backward pre-emphasis: sample 0 is unchanged.
    for (let i = 0; i < size; i++) {
      re[i] = ((samples[i] || 0) - (i ? 0.97 * (samples[i - 1] || 0) : 0)) * window[i];
      peak = Math.max(peak, Math.abs(re[i])); im[i] = 0;
    }
    if (peak < 1e-9) return new Array(12).fill(0);
    for (let i = 0; i < size; i++) re[i] /= peak;
    // Iterative radix-2 FFT; reuse buffers instead of allocating in the render loop.
    for (let i = 1, j = 0; i < size; i++) {
      let bit = size >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) [re[i], re[j]] = [re[j], re[i]];
    }
    for (let length = 2; length <= size; length *= 2) {
      const angle = -2 * Math.PI / length, cr = Math.cos(angle), ci = Math.sin(angle);
      for (let start = 0; start < size; start += length) {
        let wr = 1, wi = 0;
        for (let j = 0; j < length / 2; j++) {
          const a = start + j, b = a + length / 2;
          const tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const next = wr * cr - wi * ci; wi = wr * ci + wi * cr; wr = next;
        }
      }
    }
    for (let i = 0; i < magnitude.length; i++) magnitude[i] = Math.hypot(re[i], im[i]);
    const mel = filters.map(filter => 10 * Math.log10(Math.max(1e-10, filter.reduce((sum, [i, w]) => sum + magnitude[i] * w, 0))));
    return cosines.map(row => row.reduce((sum, c, j) => sum + c * mel[j], 0));
  };
}

export function classifyVowels(mfcc, profile = DEFAULT_VOWEL_PROFILE) {
  const norm = Math.hypot(...mfcc);
  if (norm < 1e-6) return [0, 0, 0, 0, 0];
  // Compare normalized templates, then normalize scores so vowels cannot all peak.
  const scores = [...VOWELS, '-'].map(key => {
    const ref = profile[key], similarity = mfcc.reduce((sum, n, i) => sum + n * ref[i], 0) / (norm * Math.hypot(...ref));
    return Math.pow(clamp(similarity, 0, 1), 100);
  });
  const sum = scores.reduce((a, b) => a + b, 0);
  if (sum < 1e-12) return [0, 0, 0, 0, 0];
  return scores.slice(0, 5).map(n => n / sum);
}

export function mouthFromAudio(rms, vowels = CLOSED_MOUTH.vowels, { gateDb = -38, gain = 1 } = {}) {
  const db = 20 * Math.log10(Math.max(1e-9, rms * clamp(gain, 0.25, 4)));
  if (db <= gateDb) return { ...CLOSED_MOUTH };
  // Log loudness retains quiet syllables without saturating every sung note.
  const value = 0.82 * Math.pow(clamp((db - gateDb) / (-9 - gateDb), 0, 1), 0.9);
  const safe = VOWELS.map((_, i) => clamp(vowels[i], 0, 1));
  const sum = safe.reduce((a, b) => a + b, 0);
  if (sum > 0 && sum < 0.15) return { ...CLOSED_MOUTH }; // Calibrated breath/noise class dominates.
  return { value, vowels: sum > 1 ? safe.map(n => n / sum) : safe, silence: 0 };
}

// Mouth geometry for Yachiyo's actual rig; smile remains owned by emotion.
export function mouthTrackingFrame(detail = {}) {
  const value = clamp(detail.value, 0, 1);
  const [a, i, u, e, o] = VOWELS.map((_, index) => value ? clamp(detail.vowels?.[index], 0, 1) : 0);
  return [
    { id: 'MouthOpen', value, weight: 1 },
    { id: 'VoiceVolumePlusMouthOpen', value, weight: 1 },
    { id: 'VoiceVolume', value, weight: 1 },
    { id: 'JawOpen', value: value * (0.55 + a * 0.35 + o * 0.15), weight: 1 },
    { id: 'MouthPucker', value: (u * 0.65 + o * 0.45 - i * 0.45 - e * 0.3) * Math.min(1, value * 3), weight: 1 },
    { id: 'MouthFunnel', value: (u * 0.32 + o * 0.5) * Math.min(1, value * 3), weight: 1 },
    { id: 'MouthPressLipOpen', value: 0, weight: 1 },
    { id: 'MouthShrug', value: 0, weight: 1 }
  ];
}

// One smoothing stage, based on elapsed audio time (independent of monitor Hz).
export function createMouthSmoother() {
  let previous = { ...CLOSED_MOUTH }, time = null;
  return (next = CLOSED_MOUTH, at = 0) => {
    const delta = time === null ? 0.02 : at - time;
    time = at;
    if (!next.value || delta < 0 || delta > 0.2) { previous = next; return next; }
    const alpha = 1 - Math.exp(-Math.max(0, delta) / 0.025);
    previous = { ...next, value: previous.value + (next.value - previous.value) * alpha,
      vowels: next.vowels.map((v, i) => previous.vowels[i] + (v - previous.vowels[i]) * alpha) };
    return previous;
  };
}
