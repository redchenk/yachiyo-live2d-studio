const DEFAULT_MAX_QUEUE_SIZE = 120;
const DEFAULT_BILIBILI_MAX_AGE_MS = 20_000;
const DEFAULT_BILIBILI_PAID_MAX_AGE_MS = 45_000;
const DEFAULT_MAX_VIEWERS_PER_TURN = 2;
const DEFAULT_SINGLE_VIEWER_PROBABILITY = 0.65;
const DEFAULT_REPLY_COOLDOWN_MS = 60_000;
const DEFAULT_FIRST_MESSAGE_BONUS = 34;
const DEFAULT_MAX_WAIT_BONUS = 28;

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
  const userId = asText(entry?.userId);
  return (userId && userId !== '0' ? userId : '') ||
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

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampedRandom(rng) {
  const value = finiteNumber(typeof rng === 'function' ? rng() : Math.random(), 0.5);
  return Math.min(1 - Number.EPSILON, Math.max(0, value));
}

function viewerStateForEntry(viewerState, entry, identity) {
  if (!viewerState) return null;
  if (typeof viewerState === 'function') {
    return viewerState(entry, identity) || null;
  }

  const userId = asText(entry?.userId);
  const keys = [
    identity,
    userId && userId !== '0' ? userId : '',
    asText(entry?.userName),
    asText(entry?.userName).toLowerCase()
  ].filter(Boolean);
  if (viewerState instanceof Map) {
    for (const key of keys) {
      if (viewerState.has(key)) return viewerState.get(key) || null;
    }
    return null;
  }
  if (typeof viewerState === 'object') {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(viewerState, key)) {
        return viewerState[key] || null;
      }
    }
  }
  return null;
}

function isFirstViewerMessage(entry, state) {
  if (entry?.isFirstMessage === true || state?.isFirstMessage === true || state?.firstMessage === true) {
    return true;
  }
  for (const value of [
    state?.messageCount,
    state?.seenCount,
    state?.interactionCount,
    state?.totalMessages
  ]) {
    const count = Number(value);
    if (Number.isFinite(count) && count === 1) return true;
  }
  return false;
}

function viewerLastRepliedAt(state) {
  return Math.max(
    0,
    finiteNumber(
      state?.lastRepliedAt ??
      state?.lastReplyAt ??
      state?.lastAcknowledgedAt,
      0
    )
  );
}

function isViewerCoolingDown(state, now, cooldownMs) {
  if (!state || cooldownMs <= 0) return false;
  if (state.recentlyReplied === true && viewerLastRepliedAt(state) <= 0) return true;
  const lastRepliedAt = viewerLastRepliedAt(state);
  return lastRepliedAt > 0 && Math.max(0, now - lastRepliedAt) < cooldownMs;
}

function weightedCandidateIndex(candidates, rng) {
  if (!candidates.length) return -1;
  const totalWeight = candidates.reduce(
    (total, candidate) => total + Math.max(1, finiteNumber(candidate.weight, 1)),
    0
  );
  let cursor = clampedRandom(rng) * totalWeight;
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= Math.max(1, finiteNumber(candidates[index].weight, 1));
    if (cursor < 0) return index;
  }
  return candidates.length - 1;
}

function selectionWeight(entry, now, state, options = {}) {
  const firstMessageBonus = Math.max(
    0,
    finiteNumber(options.firstMessageBonus, DEFAULT_FIRST_MESSAGE_BONUS)
  );
  return Math.max(
    1,
    scoreLive2DAudienceEntry(entry, now) +
    (entry?.isFirstMessage !== true && isFirstViewerMessage(entry, state) ? firstMessageBonus : 0)
  );
}

function paidCandidateSort(left, right) {
  return (
    right.score - left.score ||
    Number(left.entry?.receivedAt || 0) - Number(right.entry?.receivedAt || 0) ||
    left.index - right.index
  );
}

function representativeForIdentity(candidates) {
  return candidates
    .slice()
    .sort((left, right) => (
      right.weight - left.weight ||
      Number(left.entry?.receivedAt || 0) - Number(right.entry?.receivedAt || 0) ||
      left.index - right.index
    ))[0];
}

function groupedIdentityCandidates(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const existing = groups.get(candidate.identity);
    if (existing) existing.push(candidate);
    else groups.set(candidate.identity, [candidate]);
  }
  return [...groups.values()].map(representativeForIdentity);
}

export function scoreLive2DAudienceEntry(entry, now = Date.now()) {
  if (!entry) return Number.NEGATIVE_INFINITY;
  const text = asText(entry.text);
  let score = sourcePriority(entry);

  if (entry.isFirstMessage === true) score += DEFAULT_FIRST_MESSAGE_BONUS;
  if (/(八千代|やちよ|yachiyo|主播|月见)/iu.test(text)) score += 24;
  if (/[?？]|为什么|为何|怎么|如何|哪[个里]|什么|谁|吗(?:\s|[?？!！。.]|$)/u.test(text)) score += 18;
  if (/(点歌|唱一|播放|来一首|我要听|想听|听一首|听首|song request|play\s+)/iu.test(text)) score += 10;

  const price = Math.max(0, Number(entry.price) || 0);
  if (price > 0) score += Math.min(42, Math.log2(price + 1) * 7);

  const ageMs = Math.max(0, Number(now) - Number(entry.receivedAt || now));
  score += Math.min(DEFAULT_MAX_WAIT_BONUS, (ageMs / 1000) * 1.4);

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
    isFirstMessage: meta?.isFirstMessage === true || bilibili.isFirstMessage === true,
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

// A speaking turn is capped at two viewers by default. Tests and callers may
// inject rng/replyCount, while viewerState supplies first-message and cooldown
// metadata without making this otherwise pure selector own playback state.
export function selectLive2DAudienceTurn(queue, options = {}) {
  const current = Array.isArray(queue) ? queue : [];
  const requestedLimit = Math.max(
    1,
    Math.round(finiteNumber(options.limit, DEFAULT_MAX_VIEWERS_PER_TURN))
  );
  const maxPerTurn = Math.max(
    1,
    Math.round(finiteNumber(options.maxPerTurn, DEFAULT_MAX_VIEWERS_PER_TURN))
  );
  const limit = Math.min(requestedLimit, maxPerTurn);
  const now = Number(options.now) || Date.now();
  const rng = typeof options.rng === 'function' ? options.rng : Math.random;
  const viewerState = options.viewerState ?? options.viewerStates;
  const enforceUniqueViewers = options.enforceUniqueViewers !== false;
  const replyCooldownMs = Math.max(
    0,
    finiteNumber(options.replyCooldownMs, DEFAULT_REPLY_COOLDOWN_MS)
  );
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
  const candidates = eligible
    .map((entry, index) => ({
      entry,
      index,
      score: scoreLive2DAudienceEntry(entry, now),
      identity: audienceIdentity(entry)
    }))
    .map((candidate) => {
      const state = viewerStateForEntry(viewerState, candidate.entry, candidate.identity);
      return {
        ...candidate,
        state,
        coolingDown: isViewerCoolingDown(state, now, replyCooldownMs),
        weight: selectionWeight(candidate.entry, now, state, options)
      };
    });

  const selected = [];
  const selectedEntries = new Set();
  const selectedIdentities = new Set();
  const paidCandidates = candidates
    .filter((candidate) => isPaidBilibiliMessage(candidate.entry))
    .sort(paidCandidateSort);
  const guaranteedPaidCount = enforceUniqueViewers
    ? new Set(paidCandidates.map((candidate) => candidate.identity)).size
    : paidCandidates.length;
  let targetCount;
  if (options.replyCount != null) {
    targetCount = Math.max(1, Math.min(limit, Math.round(finiteNumber(options.replyCount, limit))));
  } else if (options.randomizeCount === false || limit === 1) {
    targetCount = limit;
  } else {
    const singleViewerProbability = Math.min(
      1,
      Math.max(0, finiteNumber(options.singleViewerProbability, DEFAULT_SINGLE_VIEWER_PROBABILITY))
    );
    targetCount = clampedRandom(rng) < singleViewerProbability ? 1 : limit;
  }
  targetCount = Math.max(targetCount, Math.min(limit, guaranteedPaidCount));

  for (const candidate of paidCandidates) {
    if (selected.length >= targetCount) break;
    if (enforceUniqueViewers && selectedIdentities.has(candidate.identity)) continue;
    selected.push(candidate.entry);
    selectedEntries.add(candidate.entry);
    selectedIdentities.add(candidate.identity);
  }

  const ordinaryCandidates = candidates.filter((candidate) => (
    !isPaidBilibiliMessage(candidate.entry) &&
    (!enforceUniqueViewers || !selectedIdentities.has(candidate.identity))
  ));
  const groupCandidates = enforceUniqueViewers
    ? groupedIdentityCandidates
    : (items) => items.slice();
  const readyCandidates = groupCandidates(
    ordinaryCandidates.filter((candidate) => !candidate.coolingDown)
  );
  const cooldownCandidates = groupCandidates(
    ordinaryCandidates.filter((candidate) => candidate.coolingDown)
  );

  const candidatePools = [readyCandidates];
  if (selected.length === 0 && readyCandidates.length === 0 && options.allowCooldownFallback !== false) {
    candidatePools.push(cooldownCandidates);
  }
  for (const pool of candidatePools) {
    while (selected.length < targetCount && pool.length > 0) {
      const candidateIndex = weightedCandidateIndex(pool, rng);
      const [candidate] = pool.splice(candidateIndex, 1);
      if (!candidate || (enforceUniqueViewers && selectedIdentities.has(candidate.identity))) continue;
      selected.push(candidate.entry);
      selectedEntries.add(candidate.entry);
      selectedIdentities.add(candidate.identity);
    }
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
          isFirstMessage: message?.isFirstMessage === true,
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
    limit: Math.max(1, Math.round(Number(options.limit) || entries.length || 1)),
    maxPerTurn: Math.max(1, Math.round(Number(options.limit) || entries.length || 1)),
    replyCount: Math.max(1, Math.round(Number(options.limit) || entries.length || 1)),
    enforceUniqueViewers: false
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

export function live2DAudienceDisplayNames(entries = []) {
  return [...new Set((Array.isArray(entries) ? entries : [])
    .map((entry) => asText(entry?.userName))
    .filter(Boolean))].slice(0, DEFAULT_MAX_VIEWERS_PER_TURN);
}

export function resolveLive2DAudienceAcknowledgements(entries = [], indexes = []) {
  const audience = (Array.isArray(entries) ? entries : [])
    .slice(0, DEFAULT_MAX_VIEWERS_PER_TURN);
  const rawIndexes = Array.isArray(indexes) ? indexes : [indexes];
  const explicitIndexes = [...new Set(rawIndexes
    .map((value) => Math.round(Number(value)))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= audience.length))];
  const acknowledgedIndexes = explicitIndexes.length
    ? explicitIndexes
    : (audience.length ? [1] : []);
  const acknowledgedIndexSet = new Set(acknowledgedIndexes);
  return {
    acknowledged: audience.filter((_, index) => acknowledgedIndexSet.has(index + 1)),
    unacknowledged: audience.filter((_, index) => !acknowledgedIndexSet.has(index + 1)),
    acknowledgedIndexes,
    usedFallback: explicitIndexes.length < 1 && audience.length > 0
  };
}

export function ensureLive2DAudienceNamesInSpeech(text, entries = []) {
  const value = asText(text);
  if (!value) return '';
  const normalizedReply = value.normalize('NFKC').toLocaleLowerCase();
  const missingNames = live2DAudienceDisplayNames(entries).filter((name) => (
    !normalizedReply.includes(name.normalize('NFKC').toLocaleLowerCase())
  ));
  return missingNames.length ? `${missingNames.join('、')}，${value}` : value;
}
