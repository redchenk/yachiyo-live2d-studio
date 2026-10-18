const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
const key = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

export function requestedConcertTracks(text, tracks) {
  if (!/(点歌|想听|要听|来一首|唱|听一首|song\s*request|sing|play)/iu.test(text)) return [];
  const query = key(text);
  return tracks.filter(track => {
    const title = track.name.replace(/\.(wav|mp3|flac|ogg|m4a)$/i, '');
    const aliases = [title, ...title.split(/\s[-–—·|]\s|[《》]/u)].map(key).filter(name => name.length >= 2);
    return aliases.some(name => query.includes(name));
  });
}

export function selectConcertTrack(tracks, { history = [], votes = [], failed = [], rng = Math.random } = {}) {
  let candidates = tracks.filter(track => !failed.includes(track.id));
  if (candidates.length > 1) candidates = candidates.filter(track => track.id !== history.at(-1));
  if (!candidates.length) return null;
  const score = track => {
    const voters = new Set(votes.filter(vote => vote.trackId === track.id).map(vote => vote.viewer));
    const plays = history.filter(id => id === track.id).length;
    return voters.size * 100 - plays * 10;
  };
  const best = Math.max(...candidates.map(score));
  const tied = candidates.filter(track => score(track) === best);
  return tied[Math.min(tied.length - 1, Math.floor(clamp(rng(), 0, 0.999999) * tied.length))];
}

export function concertBreakMs({ pendingCount = 0, priorityPending = false, opening = false, rng = Math.random } = {}) {
  const base = opening ? 12_000 : 24_000;
  return Math.round(clamp(base + Math.min(8, pendingCount) * 5000 + (priorityPending ? 10_000 : 0) + clamp(rng(), 0, 1) * 12_000, 12_000, 90_000));
}

// Local scheduling owns timing/selection; the existing LLM only speaks during
// breaks and introduces the selected song. No extra model call while singing.
export function createRvcConcertDirector({ snapshot, onChange = () => {}, onCue = async () => {},
  onPlay = () => {}, now = () => Date.now(), rng = Math.random,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  let timer, waiter, epoch = 0, breakStarted = 0, history = [], votes = [], failed = [];
  let state = { phase: 'off', nextTrack: null, remainingMs: 0, waitMs: 0, previousName: '', reason: '' };
  const patch = changes => { state = { ...state, ...changes }; onChange({ ...state }); };
  const available = () => { const s = snapshot(); return s.active && s.enabled; };
  const choose = () => selectConcertTrack(snapshot().tracks, { history, votes, failed, rng });
  function stop() {
    epoch++; clearIntervalImpl(timer); clearIntervalImpl(waiter); timer = waiter = null;
    patch({ phase: 'off', nextTrack: null, remainingMs: 0, waitMs: 0, reason: '' });
  }
  function beginBreak({ opening = false, previousName = state.previousName } = {}) {
    if (!available()) return;
    epoch++; clearIntervalImpl(waiter); waiter = null;
    const s = snapshot(); breakStarted = now();
    const waitMs = concertBreakMs({ pendingCount: s.pendingCount, priorityPending: s.priorityPending, opening, rng });
    patch({ phase: 'interacting', previousName, nextTrack: s.canStart ? choose() : null,
      waitMs, remainingMs: waitMs, reason: '' });
    // runLiveTurn has its own concurrency and live-session guards.
    Promise.resolve(onCue('interact')).catch(() => {});
  }
  function start() {
    stop(); history = []; votes = []; failed = [];
    if (!available()) return;
    timer = setIntervalImpl(tick, 500);
    const s = snapshot();
    if (['playing', 'loading'].includes(s.songStatus)) songStarted(s.track);
    else beginBreak({ opening: true, previousName: '' });
  }
  function hold() {
    epoch++; clearIntervalImpl(waiter); waiter = null;
    patch({ phase: available() ? 'paused' : 'off', nextTrack: null, remainingMs: 0, reason: '已暂停自动接歌，继续与观众互动' });
  }
  function beforePlay() {
    epoch++; clearIntervalImpl(waiter); waiter = null;
    patch({ phase: 'singing', nextTrack: null, remainingMs: 0, reason: '' });
  }
  function songStarted(track) {
    if (!track) return;
    if (history.at(-1) !== track.id) history = [...history, track.id].slice(-100);
    votes = votes.filter(vote => vote.trackId !== track.id);
    if (available()) patch({ phase: 'singing', nextTrack: null, remainingMs: 0, previousName: track.name });
  }
  function songEnded() { if (available()) beginBreak(); }
  function songFailed(track) {
    if (track) failed = [...new Set([...failed, track.id])];
    if (available()) beginBreak();
  }
  function audienceArrived(entry) {
    if (!available()) return;
    votes = votes.filter(vote => now() - vote.at < 30 * 60_000);
    for (const track of snapshot().requestsEnabled === false ? [] : requestedConcertTracks(entry.text, snapshot().tracks)) {
      const viewer = entry.userId || entry.userName || 'anonymous';
      if (!votes.some(vote => vote.trackId === track.id && vote.viewer === viewer)) votes.push({ trackId: track.id, viewer, at: now() });
    }
    votes = votes.slice(-120);
    if (state.phase === 'interacting') {
      const s = snapshot();
      // Activity can extend this break, but chat floods cannot postpone forever.
      const waitMs = Math.max(state.waitMs, Math.min(90_000, 24_000 + Math.min(8, s.pendingCount) * 5000 + (s.priorityPending ? 10_000 : 0)));
      patch({ nextTrack: s.canStart ? choose() : null, waitMs, remainingMs: Math.max(0, breakStarted + waitMs - now()) });
    }
  }
  function libraryChanged() {
    if (state.phase !== 'interacting') return;
    if (!state.nextTrack || !snapshot().tracks.some(track => track.id === state.nextTrack.id)) patch({ nextTrack: choose() });
  }
  function tick() {
    if (!available()) { if (state.phase !== 'off') stop(); return; }
    const s = snapshot();
    if (state.phase !== 'interacting' && state.phase !== 'announcing') return;
    if (!s.canStart) { if (state.nextTrack) patch({ nextTrack: null, remainingMs: 0 }); return; }
    libraryChanged();
    if (state.phase !== 'interacting' || !state.nextTrack) return;
    const remainingMs = Math.max(0, breakStarted + state.waitMs - now());
    patch({ remainingMs });
    if (remainingMs > 0 || s.busy) return;
    const selected = state.nextTrack, token = ++epoch;
    patch({ phase: 'announcing', reason: '介绍下一首，等待说完后开唱' });
    Promise.resolve().then(() => {
      if (token !== epoch || !available()) return;
      return onCue('introduce-song');
    }).catch(() => {}).finally(() => {
      if (token !== epoch || !available()) return;
      // A spoken introduction can outlive the LLM response. Poll actual playback.
      const finish = () => {
        if (token !== epoch || !available()) return;
        const current = snapshot();
        if (!current.canStart) { patch({ phase: 'interacting', nextTrack: null, remainingMs: 0 }); return; }
        if (current.busy) return;
        clearIntervalImpl(waiter); waiter = null;
        const track = current.tracks.find(item => item.id === selected.id);
        if (!track) { beginBreak(); return; }
        beforePlay();
        Promise.resolve(onPlay(track)).catch(() => songFailed(track));
      };
      waiter = setIntervalImpl(() => {
        if (token !== epoch || !available() || !snapshot().canStart) { clearIntervalImpl(waiter); waiter = null; }
        finish();
      }, 250);
      finish();
    });
  }
  return { start, stop, hold, beforePlay, songStarted, songEnded, songFailed, audienceArrived, libraryChanged, tick,
    resume() { if (!available()) return; if (!timer) timer = setIntervalImpl(tick, 500); beginBreak(); },
    getState: () => ({ ...state }) };
}
