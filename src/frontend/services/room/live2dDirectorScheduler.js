export const LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS = 60_000;
export const LIVE2D_DIRECTOR_AUDIENCE_DELAY_MS = 120;
export const LIVE2D_DIRECTOR_PENDING_DELAY_MS = 1_800;
export const LIVE2D_DIRECTOR_LOW_TRAFFIC_MAX_PENDING = 2;
export const LIVE2D_DIRECTOR_HIGH_TRAFFIC_MIN_PENDING = 8;
export const LIVE2D_DIRECTOR_THINKING_PAUSE_CHANCE = 0.08;
export const LIVE2D_DIRECTOR_THINKING_PAUSE_RANGE_MS = Object.freeze([700, 1_300]);
export const LIVE2D_DIRECTOR_REPLY_GAP_RANGES_MS = Object.freeze({
  low: Object.freeze([2_000, 3_500]),
  normal: Object.freeze([1_400, 2_500]),
  high: Object.freeze([850, 1_500]),
  priority: Object.freeze([350, 800])
});

function randomUnit(rng) {
  const value = Number(rng());
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1 - Number.EPSILON;
  return value;
}

function randomRangeMs(range, rng) {
  const [minimum, maximum] = range;
  return Math.round(minimum + ((maximum - minimum) * randomUnit(rng)));
}

export function resolveLive2DDirectorTrafficLevel({
  trafficLevel = '',
  pendingCount
} = {}) {
  const explicitLevel = String(trafficLevel || '').trim().toLowerCase();
  if (explicitLevel === 'low' || explicitLevel === 'normal' || explicitLevel === 'high') {
    return explicitLevel;
  }

  if (pendingCount === undefined || pendingCount === null || pendingCount === '') {
    return 'normal';
  }
  const count = Math.max(0, Math.floor(Number(pendingCount) || 0));
  if (count <= LIVE2D_DIRECTOR_LOW_TRAFFIC_MAX_PENDING) return 'low';
  if (count >= LIVE2D_DIRECTOR_HIGH_TRAFFIC_MIN_PENDING) return 'high';
  return 'normal';
}

export function sampleLive2DDirectorReplyDelay({
  pendingCount,
  trafficLevel = '',
  priorityPending = false,
  rng: optionRng
} = {}, injectedRng) {
  const random = typeof injectedRng === 'function'
    ? injectedRng
    : (typeof optionRng === 'function' ? optionRng : Math.random);
  if (priorityPending) {
    return randomRangeMs(LIVE2D_DIRECTOR_REPLY_GAP_RANGES_MS.priority, random);
  }

  const level = resolveLive2DDirectorTrafficLevel({ pendingCount, trafficLevel });
  let delay = randomRangeMs(LIVE2D_DIRECTOR_REPLY_GAP_RANGES_MS[level], random);
  if (randomUnit(random) < LIVE2D_DIRECTOR_THINKING_PAUSE_CHANCE) {
    delay += randomRangeMs(LIVE2D_DIRECTOR_THINKING_PAUSE_RANGE_MS, random);
  }
  return delay;
}

export const resolveLive2DDirectorReplyDelay = sampleLive2DDirectorReplyDelay;

export function createLive2DDirectorScheduler(options = {}) {
  const setTimer = options.setTimeoutImpl || globalThis.setTimeout;
  const clearTimer = options.clearTimeoutImpl || globalThis.clearTimeout;
  const rng = typeof options.rng === 'function' ? options.rng : Math.random;
  const onTurn = typeof options.onTurn === 'function' ? options.onTurn : () => {};
  const autoIntervalMs = Math.max(
    1,
    Number(options.autoIntervalMs ?? LIVE2D_DIRECTOR_AUTO_TURN_INTERVAL_MS)
  );
  const audienceDelayMs = Math.max(
    0,
    Number(options.audienceDelayMs ?? LIVE2D_DIRECTOR_AUDIENCE_DELAY_MS)
  );
  let timer = null;
  let timerKind = '';
  let scheduledDelay = null;

  function cancel() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
    timerKind = '';
    scheduledDelay = null;
  }

  function scheduleTimer(delayMs, kind) {
    cancel();
    const delay = Math.max(0, Number(delayMs) || 0);
    timerKind = kind;
    scheduledDelay = delay;
    timer = setTimer(() => {
      const reason = timerKind;
      const elapsedDelayMs = scheduledDelay;
      timer = null;
      timerKind = '';
      scheduledDelay = null;
      onTurn({ reason, delayMs: elapsedDelayMs });
    }, delay);
    return delay;
  }

  function schedule(delayMs = autoIntervalMs) {
    return scheduleTimer(delayMs, 'manual');
  }

  function audienceArrived({
    turnInFlight = false,
    playbackPending = false
  } = {}) {
    if (turnInFlight || playbackPending) {
      cancel();
      return null;
    }
    if (timerKind === 'reply-gap' || timerKind === 'audience') return scheduledDelay;
    cancel();
    return scheduleTimer(audienceDelayMs, 'audience');
  }

  function playbackIdle({
    pendingAudience = false,
    pendingCount,
    trafficLevel = '',
    priorityPending = false
  } = {}) {
    if (!pendingAudience) return scheduleTimer(autoIntervalMs, 'auto');
    const delay = sampleLive2DDirectorReplyDelay({
      pendingCount,
      trafficLevel,
      priorityPending,
      rng
    });
    return scheduleTimer(delay, 'reply-gap');
  }

  function replyCompleted(options = {}) {
    return playbackIdle(options);
  }

  return {
    schedule,
    cancel,
    audienceArrived,
    playbackIdle,
    replyCompleted,
    hasPendingTimer: () => timer !== null
  };
}
