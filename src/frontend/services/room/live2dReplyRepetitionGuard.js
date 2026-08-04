const DEFAULT_COOLDOWN_MS = 90_000;
const DEFAULT_MAX_ENTRIES = 5;
const DEFAULT_SIMILARITY_THRESHOLD = 0.86;

function asText(value) {
  return String(value || '').normalize('NFKC').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedReplyBody(text, viewerNames = []) {
  let value = asText(text).toLocaleLowerCase();
  const names = [...new Set((Array.isArray(viewerNames) ? viewerNames : [])
    .map((name) => asText(name).toLocaleLowerCase())
    .filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  for (const name of names) {
    value = value.replace(new RegExp(escapeRegExp(name), 'gu'), '');
  }
  return value
    .replace(/(?:さん|ちゃん|さま|様|桑|老师)/gu, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function characterBigrams(value) {
  if (value.length < 2) return value ? [value] : [];
  const output = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    output.push(value.slice(index, index + 2));
  }
  return output;
}

function diceSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftPairs = characterBigrams(left);
  const rightPairs = characterBigrams(right);
  if (!leftPairs.length || !rightPairs.length) return 0;
  const remaining = new Map();
  for (const pair of rightPairs) remaining.set(pair, (remaining.get(pair) || 0) + 1);
  let matches = 0;
  for (const pair of leftPairs) {
    const count = remaining.get(pair) || 0;
    if (count < 1) continue;
    matches += 1;
    if (count === 1) remaining.delete(pair);
    else remaining.set(pair, count - 1);
  }
  return (2 * matches) / (leftPairs.length + rightPairs.length);
}

export function createLive2DReplyRepetitionGuard(options = {}) {
  const cooldownMs = Math.max(1, Number(options.cooldownMs) || DEFAULT_COOLDOWN_MS);
  const maxEntries = Math.max(1, Math.round(Number(options.maxEntries) || DEFAULT_MAX_ENTRIES));
  const similarityThreshold = Math.min(
    1,
    Math.max(0.5, Number(options.similarityThreshold) || DEFAULT_SIMILARITY_THRESHOLD)
  );
  let entries = [];

  function accept(text, context = {}) {
    const now = Number(context.now) || Date.now();
    const body = normalizedReplyBody(text, context.viewerNames);
    entries = entries.filter((entry) => now - entry.acceptedAt < cooldownMs);
    if (!body) return { accepted: false, reason: 'empty', similarity: 0 };
    const similarity = entries.reduce(
      (maximum, entry) => Math.max(maximum, diceSimilarity(body, entry.body)),
      0
    );
    if (similarity >= similarityThreshold && context.forceAllow !== true) {
      return { accepted: false, reason: 'repeated', similarity };
    }
    entries.push({ body, acceptedAt: now });
    if (entries.length > maxEntries) entries = entries.slice(-maxEntries);
    return { accepted: true, reason: '', similarity };
  }

  return {
    accept,
    reset() {
      entries = [];
    },
    size() {
      return entries.length;
    }
  };
}
