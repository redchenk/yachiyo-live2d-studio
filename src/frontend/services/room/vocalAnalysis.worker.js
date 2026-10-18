import { buildVocalTimeline } from '../../../shared/vocal-analysis.mjs';
self.onmessage = async ({ data }) => {
  try {
    const { channels, duration, sampleRate, name, profile } = data;
    const buffer = { numberOfChannels: channels.length, duration, sampleRate, length: channels[0].length, getChannelData: i => channels[i] };
    self.postMessage({ timeline: await buildVocalTimeline(buffer, name, { profile, yieldControl: () => Promise.resolve() }) });
  } catch (error) { self.postMessage({ error: error.message }); }
};
