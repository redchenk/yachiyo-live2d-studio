const LIVE_REPLY_TELEMETRY_STAGES = new Set([
  'audience-arrived',
  'selected',
  'llm-start',
  'first-sentence',
  'caption-ready',
  'tts-queued',
  'tts-start',
  'tts-end',
  'tts-fail',
  'recovery'
]);

const ALLOWED_SOURCES = new Set(['bilibili', 'manual', 'asr', 'live', 'unknown']);
const ALLOWED_MESSAGE_TYPES = new Set(['danmu', 'gift', 'superchat', 'guard', 'mixed', 'unknown']);

function safeToken(value, maxLength = 48) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, maxLength);
}

function safeCount(value, maximum = 100_000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(maximum, Math.max(0, Math.round(number)));
}

function safeEnum(value, allowed, fallback = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

export function sanitizeLive2DReplyTelemetry(event = {}, options = {}) {
  const stage = safeEnum(event.stage, LIVE_REPLY_TELEMETRY_STAGES);
  if (!stage) return null;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const timestampMs = Number(now());
  const payload = {
    version: 1,
    timestamp: new Date(Number.isFinite(timestampMs) ? timestampMs : Date.now()).toISOString(),
    stage
  };
  const turnId = safeToken(event.turnId, 64);
  const source = safeEnum(event.source, ALLOWED_SOURCES);
  const messageType = safeEnum(event.messageType, ALLOWED_MESSAGE_TYPES);
  const outcome = safeToken(event.outcome, 48).toLowerCase();
  if (turnId) payload.turnId = turnId;
  if (source) payload.source = source;
  if (messageType) payload.messageType = messageType;
  for (const [key, maximum] of [
    ['audienceCount', 20],
    ['paidCount', 20],
    ['queueDepth', 100_000],
    ['durationMs', 3_600_000],
    ['attempt', 10]
  ]) {
    const value = safeCount(event[key], maximum);
    if (value !== undefined) payload[key] = value;
  }
  if (outcome) payload.outcome = outcome;
  return payload;
}

export async function recordLive2DReplyTelemetry(event = {}, options = {}) {
  const payload = sanitizeLive2DReplyTelemetry(event, options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!payload || typeof fetchImpl !== 'function') return false;
  try {
    const response = await fetchImpl('/api/live-reply/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    });
    return Boolean(response?.ok);
  } catch (_) {
    return false;
  }
}
