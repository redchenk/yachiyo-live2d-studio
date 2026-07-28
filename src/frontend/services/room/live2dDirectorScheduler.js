export const LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS = 60_000;
export const LIVE2D_DIRECTOR_AUDIENCE_DELAY_MS = 180;
export const LIVE2D_DIRECTOR_PENDING_DELAY_MS = 120;

export function createLive2DDirectorScheduler(options = {}) {
  const setTimer = options.setTimeoutImpl || globalThis.setTimeout;
  const clearTimer = options.clearTimeoutImpl || globalThis.clearTimeout;
  const onTurn = typeof options.onTurn === 'function' ? options.onTurn : () => {};
  const autoIntervalMs = Math.max(
    1,
    Number(options.autoIntervalMs ?? LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS)
  );
  const audienceDelayMs = Math.max(
    0,
    Number(options.audienceDelayMs ?? LIVE2D_DIRECTOR_AUDIENCE_DELAY_MS)
  );
  const pendingDelayMs = Math.max(
    0,
    Number(options.pendingDelayMs ?? LIVE2D_DIRECTOR_PENDING_DELAY_MS)
  );
  let timer = null;

  function cancel() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function schedule(delayMs = autoIntervalMs) {
    cancel();
    const delay = Math.max(0, Number(delayMs) || 0);
    timer = setTimer(() => {
      timer = null;
      onTurn();
    }, delay);
    return delay;
  }

  function audienceArrived({ turnInFlight = false } = {}) {
    cancel();
    if (turnInFlight) return null;
    return schedule(audienceDelayMs);
  }

  function replyCompleted({ pendingAudience = false } = {}) {
    return schedule(pendingAudience ? pendingDelayMs : autoIntervalMs);
  }

  return {
    schedule,
    cancel,
    audienceArrived,
    replyCompleted,
    hasPendingTimer: () => timer !== null
  };
}
