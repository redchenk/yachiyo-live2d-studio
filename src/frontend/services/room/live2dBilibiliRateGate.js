function normalizedLimit(settings = {}) {
  const value = Math.round(Number(settings.maxForwardPerMinute || 0));
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 120);
}

function burstCapacity(limit) {
  if (limit <= 0) return 0;
  return Math.min(limit, 4, Math.max(2, Math.ceil(limit / 30)));
}

export function createLive2DBilibiliRateGate(options = {}) {
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  let tokens = 0;
  let lastRefillAt = 0;
  let activeLimit = 0;

  function reset() {
    tokens = 0;
    lastRefillAt = 0;
    activeLimit = 0;
  }

  function allow(settings = {}, message = {}) {
    const limit = normalizedLimit(settings);
    if (limit <= 0) return false;
    const now = Number(clock()) || Date.now();
    const capacity = burstCapacity(limit);
    if (!lastRefillAt || activeLimit !== limit) {
      activeLimit = limit;
      tokens = capacity;
      lastRefillAt = now;
    } else {
      const elapsedMs = Math.max(0, now - lastRefillAt);
      tokens = Math.min(capacity, tokens + elapsedMs * limit / 60_000);
      lastRefillAt = now;
    }

    if (['superchat', 'gift', 'guard'].includes(message?.type)) return true;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }

  return { allow, reset };
}
