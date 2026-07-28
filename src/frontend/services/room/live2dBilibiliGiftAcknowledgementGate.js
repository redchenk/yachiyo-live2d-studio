export const BILIBILI_GIFT_ACK_QUIET_WINDOW_MS = 15_000;
const DEFAULT_MAX_SESSIONS = 512;

function normalizedToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function giftSessionKey(message = {}) {
  if (String(message.type || '').trim().toLowerCase() !== 'gift') return '';
  const viewer = normalizedToken(message.userId) ||
    normalizedToken(message.userName) ||
    'anonymous';
  const gift = normalizedToken(message.giftName || message.text) || 'gift';
  return `${viewer}|${gift}`;
}

export function createLive2DBilibiliGiftAcknowledgementGate(options = {}) {
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  const quietWindowMs = Math.max(
    1_000,
    Number(options.quietWindowMs) || BILIBILI_GIFT_ACK_QUIET_WINDOW_MS
  );
  const maxSessions = Math.max(
    16,
    Math.round(Number(options.maxSessions) || DEFAULT_MAX_SESSIONS)
  );
  const sessions = new Map();

  function prune(now) {
    const retentionMs = quietWindowMs * 4;
    for (const [key, session] of sessions) {
      if (now - session.lastSeenAt > retentionMs) sessions.delete(key);
    }
    if (sessions.size <= maxSessions) return;
    const oldest = [...sessions.entries()]
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
      .slice(0, sessions.size - maxSessions);
    for (const [key] of oldest) sessions.delete(key);
  }

  function allow(message = {}) {
    const key = giftSessionKey(message);
    if (!key) return true;
    const now = Number(clock()) || Date.now();
    prune(now);
    const previous = sessions.get(key);
    const allowed = !previous || now - previous.lastSeenAt > quietWindowMs;
    sessions.set(key, {
      lastSeenAt: now,
      suppressedCount: allowed ? 0 : Number(previous?.suppressedCount || 0) + 1
    });
    return allowed;
  }

  function reset() {
    sessions.clear();
  }

  return { allow, reset };
}
