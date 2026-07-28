const DEFAULT_MAX_QUEUE_SIZE = 120;
const DEFAULT_BILIBILI_MAX_AGE_MS = 20_000;
const DEFAULT_BILIBILI_PAID_MAX_AGE_MS = 45_000;

const SOURCE_PRIORITY = Object.freeze({
  manual: 52,
  asr: 48,
  bilibili: 32,
  audience: 28
});

let audienceEntrySequence = 0;

function asText(value) {
  return String(value || '').trim();
}

function normalizedMessageKey(text) {
  const value = asText(text).normalize('NFKC').toLowerCase();
  const compact = value.replace(/[\s\p{P}\p{S}]+/gu, '');
  return compact || value.replace(/\s+/g, '');
}

function looksLikeRepeatedSpam(text) {
  const compact = asText(text).replace(/\s+/g, '');
  if (compact.length < 10) return false;
  return /^(.)\1{9,}$/u.test(compact) ||
    /^(.{1,4})\1{5,}$/u.test(compact);
}

function audienceIdentity(entry) {
  return asText(entry?.userId) ||
    asText(entry?.userName).toLowerCase() ||
    (entry?.source === 'manual' || entry?.source === 'asr' ? 'local-audience' : '') ||
    asText(entry?.id);
}

function sourcePriority(entry) {
  if (entry?.messageType === 'superchat') return 94;
  if (entry?.messageType === 'guard') return 92;
  if (entry?.messageType === 'gift') return 88;
  return SOURCE_PRIORITY[entry?.source] || SOURCE_PRIORITY.audience;
}

function isPaidBilibiliMessage(entry) {
  return ['superchat', 'gift', 'guard'].includes(entry?.messageType);
}

export function scoreLive2DAudienceEntry(entry, now = Date.now()) {
  if (!entry) return Number.NEGATIVE_INFINITY;
  const text = asText(entry.text);
  let score = sourcePriority(entry);

  if (/(八千代|やちよ|yachiyo|主播|月见)/iu.test(text)) score += 24;
  if (/[?？]|为什么|为何|怎么|如何|哪[个里]|什么|谁|吗(?:\s|[?？!！。.]|$)/u.test(text)) score += 18;
  if (/(点歌|唱一|播放|来一首|song request|play\s+)/iu.test(text)) score += 10;

  const price = Math.max(0, Number(entry.price) || 0);
  if (price > 0) score += Math.min(42, Math.log2(price + 1) * 7);

  const ageMs = Math.max(0, Number(now) - Number(entry.receivedAt || now));
  score += Math.max(0, 16 - Math.floor(ageMs / 15000) * 2);

  if (text.length >= 4 && text.length <= 140) score += 6;
  if (text.length > 260) score -= 18;
  return score;
}

export function createLive2DAudienceEntry(text, meta = {}, now = Date.now()) {
  const value = asText(text);
  if (!value) return null;
  if (looksLikeRepeatedSpam(value)) return null;

  const bilibili = meta?.bilibili || {};
  const source = asText(meta?.source) || 'manual';
  const id = asText(meta?.id) ||
    asText(bilibili.id) ||
    `audience-${Number(now) || Date.now()}-${audienceEntrySequence += 1}`;

  return {
    id,
    text: value.slice(0, 600),
    normalizedKey: normalizedMessageKey(value),
    source,
    messageType: asText(meta?.messageType) || asText(bilibili.type) || 'message',
    userId: asText(meta?.userId) || asText(bilibili.userId),
    userName: asText(meta?.userName) || asText(bilibili.userName),
    price: Math.max(0, Number(meta?.price ?? bilibili.price) || 0),
    amount: Math.max(0, Number(meta?.amount ?? bilibili.amount) || 0),
    giftName: asText(meta?.giftName) || asText(bilibili.giftName),
    receivedAt: Number(meta?.timestamp ?? bilibili.timestamp) || Number(now) || Date.now()
  };
}

export function enqueueLive2DAudienceEntry(queue, text, meta = {}, options = {}) {
  const current = Array.isArray(queue) ? queue : [];
  const now = Number(options.now) || Date.now();
  const maxQueueSize = Math.max(1, Math.round(Number(options.maxQueueSize) || DEFAULT_MAX_QUEUE_SIZE));
  const entry = createLive2DAudienceEntry(text, meta, now);

  if (!entry) {
    return { queue: current.slice(), entry: null, accepted: false, reason: 'empty-or-spam' };
  }

  if (current.some((item) => item?.normalizedKey === entry.normalizedKey)) {
    return { queue: current.slice(), entry, accepted: false, reason: 'duplicate' };
  }

  const next = [...current, entry];
  if (next.length <= maxQueueSize) {
    return { queue: next, entry, accepted: true, reason: '' };
  }

  let lowestIndex = 0;
  let lowestScore = scoreLive2DAudienceEntry(next[0], now);
  for (let index = 1; index < next.length; index += 1) {
    const score = scoreLive2DAudienceEntry(next[index], now);
    if (score < lowestScore) {
      lowestIndex = index;
      lowestScore = score;
    }
  }
  const removed = next.splice(lowestIndex, 1)[0];
  const accepted = removed !== entry;
  return {
    queue: next,
    entry,
    accepted,
    reason: accepted ? 'evicted-lower-priority' : 'queue-full'
  };
}

export function selectLive2DAudienceTurn(queue, options = {}) {
  const current = Array.isArray(queue) ? queue : [];
  const limit = Math.max(1, Math.round(Number(options.limit) || 3));
  const now = Number(options.now) || Date.now();
  const bilibiliMaxAgeMs = Math.max(
    1,
    Number(options.bilibiliMaxAgeMs) || DEFAULT_BILIBILI_MAX_AGE_MS
  );
  const bilibiliPaidMaxAgeMs = Math.max(
    bilibiliMaxAgeMs,
    Number(options.bilibiliPaidMaxAgeMs ?? options.bilibiliSuperchatMaxAgeMs) || DEFAULT_BILIBILI_PAID_MAX_AGE_MS
  );
  const discarded = current.filter((entry) => {
    if (entry?.source !== 'bilibili') return false;
    const ageMs = Math.max(0, now - Number(entry?.receivedAt || now));
    const maxAgeMs = isPaidBilibiliMessage(entry)
      ? bilibiliPaidMaxAgeMs
      : bilibiliMaxAgeMs;
    return ageMs > maxAgeMs;
  });
  const discardedEntries = new Set(discarded);
  const eligible = current.filter((entry) => !discardedEntries.has(entry));
  const ranked = eligible
    .map((entry, index) => ({
      entry,
      index,
      score: scoreLive2DAudienceEntry(entry, now),
      identity: audienceIdentity(entry)
    }))
    .sort((left, right) => (
      right.score - left.score ||
      Number(left.entry?.receivedAt || 0) - Number(right.entry?.receivedAt || 0) ||
      left.index - right.index
    ));

  const selected = [];
  const selectedEntries = new Set();
  const selectedIdentities = new Set();

  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (selectedIdentities.has(candidate.identity)) continue;
    selected.push(candidate.entry);
    selectedEntries.add(candidate.entry);
    selectedIdentities.add(candidate.identity);
  }

  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (selectedEntries.has(candidate.entry)) continue;
    selected.push(candidate.entry);
    selectedEntries.add(candidate.entry);
  }

  return {
    selected,
    remaining: eligible.filter((entry) => !selectedEntries.has(entry)),
    discarded
  };
}

export function selectLive2DBilibiliMessages(messages, options = {}) {
  const current = Array.isArray(messages) ? messages : [];
  const now = Number(options.now) || Date.now();
  const entries = [];
  const messageByEntryId = new Map();
  const seenMessageIds = new Set();

  for (const message of current) {
    const messageId = asText(message?.id);
    if (!messageId || seenMessageIds.has(messageId)) continue;
    seenMessageIds.add(messageId);
    const text = asText(message?.text);
    const userName = asText(message?.userName);
    const entry = createLive2DAudienceEntry(
      userName ? `${userName}: ${text}` : text,
      {
        source: 'bilibili',
        bilibili: {
          id: messageId,
          type: message?.type,
          userId: message?.userId,
          userName,
          price: message?.price,
          amount: message?.amount,
          giftName: message?.giftName,
          timestamp: message?.timestamp
        }
      },
      now
    );
    if (!entry) continue;
    entries.push(entry);
    messageByEntryId.set(entry.id, message);
  }

  const turn = selectLive2DAudienceTurn(entries, {
    ...options,
    now,
    limit: Math.max(1, Math.round(Number(options.limit) || entries.length || 1))
  });
  return turn.selected
    .map((entry) => messageByEntryId.get(entry.id))
    .filter(Boolean);
}

export function requeueLive2DAudienceTurn(queue, entries, options = {}) {
  const current = Array.isArray(queue) ? queue : [];
  const restored = Array.isArray(entries) ? entries : [];
  const maxQueueSize = Math.max(1, Math.round(Number(options.maxQueueSize) || DEFAULT_MAX_QUEUE_SIZE));
  const knownIds = new Set(current.map((entry) => entry?.id).filter(Boolean));
  return [
    ...restored.filter((entry) => entry && !knownIds.has(entry.id)),
    ...current
  ].slice(0, maxQueueSize);
}

export function formatLive2DAudiencePromptEntry(entry) {
  return JSON.stringify({
    source: entry?.source || 'audience',
    type: entry?.messageType || 'message',
    viewer: entry?.userName || undefined,
    paid: entry?.price || undefined,
    gift: entry?.giftName || undefined,
    amount: entry?.amount || undefined,
    text: asText(entry?.text)
  });
}
