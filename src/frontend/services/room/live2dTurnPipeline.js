export function createLive2DTurnPipeline(options = {}) {
  const onPlaybackIdle = typeof options.onPlaybackIdle === 'function'
    ? options.onPlaybackIdle
    : () => {};
  let generationInFlight = false;
  let playbackEpoch = 0;
  const playbackTasks = new Set();

  function trackPlayback(playbackDone) {
    if (!playbackDone || typeof playbackDone.then !== 'function') return null;
    const epoch = playbackEpoch;
    let tracked = null;
    tracked = Promise.resolve(playbackDone)
      .catch(() => undefined)
      .finally(() => {
        if (epoch !== playbackEpoch) return;
        playbackTasks.delete(tracked);
        if (playbackTasks.size < 1) onPlaybackIdle();
      });
    playbackTasks.add(tracked);
    return tracked;
  }

  async function runGeneration(generate) {
    if (generationInFlight || typeof generate !== 'function') {
      return { accepted: false, result: null };
    }
    generationInFlight = true;
    try {
      const result = await generate();
      trackPlayback(result?.playbackDone);
      return { accepted: true, result };
    } finally {
      generationInFlight = false;
    }
  }

  function clearPlayback() {
    playbackEpoch += 1;
    playbackTasks.clear();
  }

  return {
    runGeneration,
    trackPlayback,
    clearPlayback,
    isGenerationInFlight: () => generationInFlight,
    pendingPlaybackCount: () => playbackTasks.size
  };
}
