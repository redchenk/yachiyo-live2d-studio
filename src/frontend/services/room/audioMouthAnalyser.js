import { ANALYSIS_SIZE, CLOSED_MOUTH, createMfccExtractor, classifyVowels, mouthFromAudio, createMouthSmoother } from '../../../shared/audio-lipsync.mjs';

// The audible element and meter share a graph/clock. The meter branches BEFORE
// monitor volume, and reads channel energy separately to avoid stereo cancellation.
export function attachAudioMouthAnalyser(context, audio, getSettings) {
  const source = context.createMediaElementSource(audio);
  const splitter = context.createChannelSplitter(2);
  const analysers = [context.createAnalyser(), context.createAnalyser()];
  const silent = context.createGain(); silent.gain.value = 0;
  const monitor = context.createGain();
  monitor.gain.value = audio.muted ? 0 : audio.volume;
  source.connect(monitor); monitor.connect(context.destination);
  source.connect(splitter);
  const buffers = analysers.map((analyser, index) => {
    analyser.fftSize = ANALYSIS_SIZE; analyser.smoothingTimeConstant = 0;
    splitter.connect(analyser, index); analyser.connect(silent);
    return new Float32Array(ANALYSIS_SIZE);
  });
  silent.connect(context.destination);
  const mfcc = createMfccExtractor(), smooth = createMouthSmoother();
  let lastAnalysis = -1, vowels = [0, 0, 0, 0, 0], history = [];
  // App speech elements use volume=1; keep mute/volume changes downstream of analysis.
  const volume = audio.volume, muted = audio.muted;
  audio.volume = 1; audio.muted = false;
  return {
    sample() {
      if (audio.paused || audio.ended || context.state !== 'running') return { ...CLOSED_MOUTH };
      const settings = getSettings(), time = audio.currentTime;
      let best = 0, maxEnergy = 0;
      analysers.forEach((analyser, index) => {
        analyser.getFloatTimeDomainData(buffers[index]);
        let energy = 0;
        for (let i = ANALYSIS_SIZE - 160; i < ANALYSIS_SIZE; i++) energy += buffers[index][i] ** 2;
        if (energy > maxEnergy) { maxEnergy = energy; best = index; }
      });
      if (time < lastAnalysis || time - lastAnalysis >= 0.02) {
        vowels = classifyVowels(mfcc(buffers[best]), settings.profile); lastAnalysis = time;
      }
      const next = smooth(mouthFromAudio(Math.sqrt(maxEnergy / 160), vowels, settings), time);
      if (history.length && time < history.at(-1).time) history = [];
      history.push({ time, next });
      const target = time - settings.delayMs / 1000;
      while (history.length > 1 && history[1].time <= target) history.shift();
      if (history.length > 100) history.shift();
      return history[0].time <= target ? history[0].next : { ...CLOSED_MOUTH };
    },
    reset() { history = []; lastAnalysis = -1; smooth(CLOSED_MOUTH, audio.currentTime); },
    dispose() {
      source.disconnect(); splitter.disconnect(); analysers.forEach(a => a.disconnect()); silent.disconnect(); monitor.disconnect();
      audio.volume = volume; audio.muted = muted;
    }
  };
}
