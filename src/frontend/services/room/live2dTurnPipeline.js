export function createLive2DPrefetchWindowTrigger(openWindow, options = {}) {
  const open = typeof openWindow === 'function' ? openWindow : () => {};
  const isActive = typeof options.isActive === 'function' ? options.isActive : () => true;
  let opened = false;

  const tryOpen = (source) => {
    if (opened || !isActive()) return false;
    opened = true;
    open(source);
    return true;
  };

  return {
    sentenceReady: () => tryOpen('sentence-ready'),
    playbackStarted: () => tryOpen('playback-started'),
    isOpened: () => opened
  };
}

export function createLive2DTurnPipeline(options = {}) {
  const onPlaybackIdle = typeof options.onPlaybackIdle === 'function'
    ? options.onPlaybackIdle
    : () => {};
  const maxConcurrentGenerations = Math.max(
    1,
    Math.round(Number(options.maxConcurrentGenerations) || 2)
  );
  let activeGenerations = 0;
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
    if (activeGenerations >= maxConcurrentGenerations || typeof generate !== 'function') {
      return { accepted: false, result: null };
    }
    activeGenerations += 1;
    try {
      const result = await generate();
      trackPlayback(result?.playbackDone);
      return { accepted: true, result };
    } finally {
      activeGenerations = Math.max(0, activeGenerations - 1);
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
    isGenerationInFlight: () => activeGenerations > 0,
    activeGenerationCount: () => activeGenerations,
    canStartGeneration: () => activeGenerations < maxConcurrentGenerations,
    pendingPlaybackCount: () => playbackTasks.size
  };
}
