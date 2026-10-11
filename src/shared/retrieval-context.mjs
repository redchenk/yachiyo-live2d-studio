/** Query-aware bounded excerpts shared by the browser and embedded memory service. */
export function retrievalTokens(text) {
  const value = String(text || '').normalize('NFKC').toLowerCase()
    .replace(/彩葉/g, '彩叶').replace(/輝夜/g, '辉夜').replace(/ヤチヨ/g, '八千代');
  const stop = new Set(['八千代', '八千', '千代', '可以', '什么', '怎么', '这个', '那个', '一下', '继续', '请问']);
  return [...new Set((value.match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]{2,}/g) || []).flatMap(word =>
    /[\u3400-\u9fff]/.test(word) ? [word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))] : [word]))]
    .filter(word => !stop.has(word)).slice(0, 100);
}

export function followupRetrievalQuery(message, history = []) {
  const current = String(message || '').trim();
  const previous = history.filter(item => item?.role === 'user' && item.content).at(-1);
  return previous && current.length <= 60 && /^(那|然后|后来|接着|所以|她|他|它|这|这个|那个|为什么|还有|继续|それ|その|では)/.test(current)
    ? `${String(previous.content).slice(-600)}\n${current}` : current;
}

export function relevantExcerpt(text, query, maxChars = 1400) {
  const content = String(text || '').trim();
  const budget = Math.max(80, Math.floor(Number(maxChars) || 1400));
  if (content.length <= budget) return content;
  const tokens = retrievalTokens(query);
  const windows = [];
  const size = Math.min(520, budget);
  const stride = Math.max(60, size - 120);
  for (let start = 0; start < content.length; start += stride) {
    const body = content.slice(start, start + size);
    const lower = body.normalize('NFKC').toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (lower.includes(token) ? token.length : 0), 0);
    windows.push({ start, end: start + body.length, score });
  }
  windows.sort((a, b) => b.score - a.score || a.start - b.start);
  const selected = [];
  let used = 0;
  for (const window of windows) {
    if (selected.some(item => window.start < item.end && window.end > item.start)) continue;
    const available = budget - used - (selected.length ? 3 : 0);
    if (available < 80) break;
    const end = Math.min(window.end, window.start + available);
    selected.push({ start: window.start, end });
    used += end - window.start + (selected.length > 1 ? 3 : 0);
  }
  return selected.sort((a, b) => a.start - b.start).map(item => content.slice(item.start, item.end)).join('\n…\n');
}

export function boundedConversation(history, { historyMaxTurns = 24, historyMaxChars = 24000 } = {}) {
  const candidates = history.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
    .slice(-Math.max(2, Math.min(128, Number(historyMaxTurns) * 2 || 48)));
  const selected = [];
  let remaining = Math.max(1000, Math.min(100000, Number(historyMaxChars) || 24000));
  for (let i = candidates.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const item = candidates[i];
    const content = item.content.slice(-remaining);
    selected.unshift({ role: item.role, content });
    remaining -= content.length;
  }
  // Do not start a trimmed window with an assistant reply lacking its question.
  while (selected[0]?.role === 'assistant') selected.shift();
  return selected;
}

export function diverseMemoryResults(notes, limit = 8) {
  const seen = new Set();
  const selected = [];
  for (const note of notes) {
    const sourceKey = note.sourceMemoryId || (note.id?.startsWith('cell-') ? note.id.slice(5) : note.id) || note.path;
    const textKey = String(note.content || note.episode || note.summary || '').normalize('NFKC').replace(/\s+/g, '');
    const identity = `${note.viewerId || ''}:${sourceKey}`;
    const content = `${note.viewerId || ''}:${textKey}`;
    if (seen.has(identity) || (textKey && seen.has(content))) continue;
    seen.add(identity); if (textKey) seen.add(content);
    selected.push(note);
    if (selected.length >= limit) break;
  }
  return selected;
}

/** Reciprocal rank fusion keeps long keyword lists from overwhelming semantics. */
export function fuseRetrievalRanks(candidates) {
  const scores = new Map(candidates.map(row => [row.note.id, 0]));
  for (const field of ['lexicalScore', 'vectorScore', 'milvusScore']) {
    const ranked = candidates.filter(row => Number(row[field]) > 0.05).sort((a, b) => b[field] - a[field]);
    ranked.forEach((row, index) => scores.set(row.note.id, scores.get(row.note.id) + 30 / (60 + index + 1)));
  }
  return candidates.map(row => ({ ...row.note, score: scores.get(row.note.id) +
    (row.note.viewerId ? .15 : 0) })).sort((a, b) => b.score - a.score);
}
