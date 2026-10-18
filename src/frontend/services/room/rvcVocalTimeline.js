import { buildVocalTimeline } from '../../../shared/vocal-analysis.mjs';
export { buildVocalTimeline } from '../../../shared/vocal-analysis.mjs';
import { validateMouthTimeline } from '../../../shared/rvc-mouth.mjs';
import { readLipsyncSettings } from './lipsyncSettings.js';
export async function analyseVocalFile(file) {
  if (!file.size || file.size > 256 * 1024 * 1024) throw new Error('请选择非空的纯人声音频，最大 256 MB');
  // Decode at 16 kHz: enough for the energy envelope, with less decoded memory.
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const profile = readLipsyncSettings().profile;
    if (typeof Worker === 'undefined') return await buildVocalTimeline(buffer, file.name, { profile });
    const worker = new Worker(new URL('./vocalAnalysis.worker.js', import.meta.url), { type: 'module' });
    try {
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice());
      return await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(validateMouthTimeline(data.timeline));
        worker.onerror = () => reject(new Error('人声分析失败，请重试'));
        worker.postMessage({ channels, sampleRate: buffer.sampleRate, duration: buffer.duration, name: file.name, profile }, channels.map(c => c.buffer));
      });
    } finally { worker.terminate(); }
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('人声轨解码失败，请重新导出为 WAV / MP3');
    throw error;
  } finally { await context.close().catch(() => {}); }
}
