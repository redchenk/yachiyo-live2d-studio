import { validateMouthTimeline, vocalMouthAt } from '../../../shared/rvc-mouth.mjs';

const clamp = (n, low, high) => Math.min(high, Math.max(low, Number(n) || 0));

export function formatSongTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// The mix is audible; only a precomputed vocal timeline drives the mouth.
// Both use audio.currentTime, so seeks, buffering and pauses cannot drift apart.
export function createRvcSongPlayer({ onState = () => {}, onMouth = () => {}, onEnded = () => {},
  createAudio = () => new Audio(),
  loadMouth = async (track, signal) => {
    const response = await fetch(`/api/rvc/tracks/${encodeURIComponent(track.id)}/mouth`, { signal });
    if (!response.ok) throw new Error('口型数据读取失败');
    return (await response.json()).mouth;
  },
  requestFrame = fn => requestAnimationFrame(fn), cancelFrame = id => cancelAnimationFrame(id)
} = {}) {
  let audio, timeline = null, controller, frame = 0, mouthRevision = 0;
  let generation = 0, disposed = false, loadedTrackId = '';
  const listeners = [];
  const state = { status: 'idle', track: null, currentTime: 0, duration: 0, volume: 0.8, error: '', mouthError: '' };
  const patch = value => { Object.assign(state, value); onState({ ...state }); };
  function mouthOff() {
    cancelFrame(frame); frame = 0; onMouth(0);
  }
  function meter() {
    if (disposed || !audio || audio.paused || audio.ended || state.status !== 'playing') return mouthOff();
    onMouth(vocalMouthAt(timeline, audio.currentTime));
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
    listen('seeking', mouthOff);
    listen('seeked', () => { cancelFrame(frame); if (!audio.paused) meter(); });
    listen('ended', () => { if (loadedTrackId && audio.ended) { mouthOff(); patch({ status: 'ended', currentTime: state.duration }); onEnded(); } });
    listen('error', () => { if (loadedTrackId) fail(audio.error); });
  }
  async function play(track = state.track) {
    if (disposed || !track) return;
    if (loadedTrackId === track.id && !audio?.paused && state.status === 'playing') return;
    const token = ++generation;
    controller?.abort(); controller = new AbortController();
    ensureAudio();
    if (loadedTrackId !== track.id) {
      audio.pause(); mouthOff();
      loadedTrackId = track.id;
      timeline = null;
      audio.src = `/api/rvc/tracks/${encodeURIComponent(track.id)}/audio`;
      patch({ track, currentTime: 0, duration: 0, mouthError: '' });
    } else if (state.status === 'ended' || state.status === 'stopped') audio.currentTime = 0;
    patch({ status: 'loading', error: '' });
    try {
      if (track.mouth && !timeline) {
        const revision = mouthRevision;
        try {
          const loaded = validateMouthTimeline(await loadMouth(track, controller.signal));
          if (!disposed && token === generation && revision === mouthRevision) { timeline = loaded; patch({ mouthError: '' }); }
        } catch {
          if (!disposed && token === generation && revision === mouthRevision) {
            patch({ mouthError: '人声口型数据读取失败，当前保持闭嘴。请重新关联人声轨。' });
          }
        }
      }
      if (disposed || token !== generation) return;
      await audio.play();
      // A newer command owns this shared element; never pause it from an old promise.
    } catch (error) { if (!disposed && token === generation) fail(error); }
  }
  function pause() { generation++; controller?.abort(); audio?.pause(); mouthOff(); patch({ status: 'paused' }); }
  function stop() {
    generation++; controller?.abort(); audio?.pause();
    loadedTrackId = '';
    // Release the media request/file handle too, especially before deletion on Windows.
    if (audio) { audio.currentTime = 0; audio.removeAttribute('src'); audio.load(); }
    timeline = null;
    mouthOff(); patch({ status: state.track ? 'stopped' : 'idle', currentTime: 0, duration: 0, error: '', mouthError: '' });
  }
  return {
    play, pause, stop,
    clear() { stop(); patch({ track: null, status: 'idle' }); },
    seek(time) { if (audio && state.duration) { mouthOff(); audio.currentTime = clamp(time, 0, state.duration); patch({ currentTime: audio.currentTime }); } },
    updateMouth(track, mouth) {
      if (state.track?.id !== track.id || disposed) return;
      mouthRevision++; timeline = mouth ? validateMouthTimeline(mouth) : null;
      patch({ track, mouthError: '' });
      // Updating a reference or gate must not leave the last vowel held open.
      onMouth(state.status === 'playing' && audio && !audio.paused && !audio.ended ? vocalMouthAt(timeline, audio.currentTime) : 0);
    },
    setVolume(value) { const volume = clamp(value, 0, 1); if (audio) audio.volume = volume; patch({ volume }); },
    dispose() {
      stop(); disposed = true;
      if (audio) {
        for (const [name, fn] of listeners) audio.removeEventListener(name, fn);
        audio.removeAttribute('src'); audio.load();
      }
    }
  };
}
