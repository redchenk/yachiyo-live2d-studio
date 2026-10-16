const clamp = (n, low, high) => Math.min(high, Math.max(low, Number(n) || 0));

export function formatSongTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// One media element and one analyser per player, independent of LLM/TTS.
export function createRvcSongPlayer({ onState = () => {}, onMouth = () => {}, onEnded = () => {},
  createAudio = () => new Audio(), createContext = () => new AudioContext(),
  requestFrame = fn => requestAnimationFrame(fn), cancelFrame = id => cancelAnimationFrame(id)
} = {}) {
  let audio, context, analyser, source, samples, frame = 0, envelope = 0;
  let generation = 0, disposed = false, loadedTrackId = '';
  const listeners = [];
  const state = { status: 'idle', track: null, currentTime: 0, duration: 0, volume: 0.8, error: '' };
  const patch = value => { Object.assign(state, value); onState({ ...state }); };
  function mouthOff() {
    cancelFrame(frame); frame = 0; envelope = 0; onMouth(0);
  }
  function meter() {
    if (disposed || !audio || audio.paused || audio.ended) return mouthOff();
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) sum += value * value;
    const target = clamp((Math.sqrt(sum / samples.length) - 0.012) * 6, 0, 1);
    envelope += (target - envelope) * (target > envelope ? 0.55 : 0.22);
    onMouth(envelope);
    frame = requestFrame(meter);
  }
  function fail(error) {
    audio?.pause(); mouthOff();
    patch({ status: 'error', error: error?.name === 'NotAllowedError'
      ? '请点击播放以允许音频播放。' : '歌曲播放失败，请检查音频文件，或重新导出为 WAV / MP3。' });
  }
  function ensureAudio() {
    if (audio) return;
    audio = createAudio(); audio.preload = 'metadata'; audio.volume = state.volume;
    const listen = (name, fn) => { audio.addEventListener(name, fn); listeners.push([name, fn]); };
    listen('loadedmetadata', () => patch({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 }));
    listen('timeupdate', () => patch({ currentTime: audio.currentTime }));
    listen('playing', () => {
      if (disposed || audio.paused) return;
      patch({ status: 'playing', error: '' });
      cancelFrame(frame); meter();
    });
    listen('waiting', () => { if (!audio.paused) { mouthOff(); patch({ status: 'loading' }); } });
    listen('pause', mouthOff);
    listen('ended', () => { if (loadedTrackId && audio.ended) { mouthOff(); patch({ status: 'ended', currentTime: state.duration }); onEnded(); } });
    listen('error', () => { if (loadedTrackId) fail(audio.error); });
  }
  async function play(track = state.track) {
    if (disposed || !track) return;
    const token = ++generation;
    ensureAudio();
    if (loadedTrackId !== track.id) {
      audio.pause(); mouthOff();
      loadedTrackId = track.id;
      audio.src = `/api/rvc/tracks/${encodeURIComponent(track.id)}/audio`;
      patch({ track, currentTime: 0, duration: 0 });
    } else if (state.status === 'ended' || state.status === 'stopped') audio.currentTime = 0;
    patch({ status: 'loading', error: '' });
    try {
      if (!context) {
        context = createContext(); analyser = context.createAnalyser(); analyser.fftSize = 1024;
        samples = new Float32Array(analyser.fftSize);
        source = context.createMediaElementSource(audio);
        source.connect(analyser); analyser.connect(context.destination);
      }
      await context.resume();
      if (disposed || token !== generation) return;
      await audio.play();
      // A newer command owns this shared element; never pause it from an old promise.
    } catch (error) { if (!disposed && token === generation) fail(error); }
  }
  function pause() { generation++; audio?.pause(); mouthOff(); patch({ status: 'paused' }); }
  function stop() {
    generation++; audio?.pause();
    loadedTrackId = '';
    // Release the media request/file handle too, especially before deletion on Windows.
    if (audio) { audio.currentTime = 0; audio.removeAttribute('src'); audio.load(); }
    mouthOff(); patch({ status: state.track ? 'stopped' : 'idle', currentTime: 0, duration: 0, error: '' });
  }
  return {
    play, pause, stop,
    clear() { stop(); patch({ track: null, status: 'idle' }); },
    seek(time) { if (audio && state.duration) { audio.currentTime = clamp(time, 0, state.duration); patch({ currentTime: audio.currentTime }); } },
    setVolume(value) { const volume = clamp(value, 0, 1); if (audio) audio.volume = volume; patch({ volume }); },
    dispose() {
      stop(); disposed = true;
      if (audio) {
        for (const [name, fn] of listeners) audio.removeEventListener(name, fn);
        audio.removeAttribute('src'); audio.load();
      }
      source?.disconnect(); analyser?.disconnect(); context?.close().catch(() => {});
    }
  };
}
