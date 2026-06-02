import { readJson, writeJson } from './roomStorage';
import { normalizeRoomMusicSettings } from './roomSettings';

export const ROOM_MUSIC_QUEUE_STATE_KEY = 'roomMusicQueueState';
export const LIVE2D_MUSIC_QUEUE_EVENT = 'tsukuyomi:live2d-music-queue';

const CURRENT_STALE_GRACE_MS = 10 * 60 * 1000;
const DEFAULT_SONG_DURATION_MS = 4 * 60 * 1000;

function asText(value) {
  return String(value ?? '').trim();
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function now() {
  return Date.now();
}

function uid(prefix = 'song') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
  );
}

export function normalizeMusicText(value) {
  return asText(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[()[\]{}"'`~!@#$%^&*_+=|\\:;,.?/<>，。！？、；：“”‘’【】《》（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLooseText(value) {
  return normalizeMusicText(value).replace(/\s+/g, '');
}

function splitWords(value) {
  return normalizeMusicText(value).split(/\s+/g).filter(Boolean);
}

export function parseMusicBlacklist(value) {
  const source = Array.isArray(value) ? value.join('\n') : String(value || '');
  return source
    .split(/[\n,，;；|]+/g)
    .map((item) => normalizeMusicText(item))
    .filter(Boolean);
}

function parseSongArtistQuery(query) {
  const text = normalizeMusicText(query);
  if (!text) return { title: '', artist: '', words: [] };

  const dashMatch = text.match(/^(.+?)\s*-\s*(.+)$/);
  if (dashMatch) {
    return {
      title: dashMatch[1].trim(),
      artist: dashMatch[2].trim(),
      words: splitWords(text)
    };
  }

  const words = splitWords(text);
  if (words.length >= 2) {
    return {
      title: words.slice(0, -1).join(' '),
      artist: words[words.length - 1],
      words
    };
  }

  return { title: text, artist: '', words };
}

export function musicCandidateKey(candidate = {}) {
  const provider = asText(candidate.provider) || 'apple-music';
  const id = asText(candidate.songId || candidate.id || candidate.url);
  if (id) return `${provider}:${id}`;
  return `${provider}:${normalizeLooseText(candidate.title)}:${normalizeLooseText(candidate.artist)}`;
}

export function normalizeMusicCandidate(raw = {}, defaults = {}) {
  const durationMs = Math.max(0, Math.round(asNumber(
    raw.durationMs ?? raw.durationInMillis ?? raw.duration,
    defaults.durationMs || 0
  )));
  const candidate = compactObject({
    uid: asText(raw.uid) || uid('music'),
    provider: asText(raw.provider || defaults.provider) || 'apple-music',
    songId: asText(raw.songId || raw.id || defaults.songId),
    url: asText(raw.url || defaults.url),
    title: asText(raw.title || raw.name || defaults.title),
    artist: asText(raw.artist || raw.artistName || defaults.artist),
    album: asText(raw.album || raw.albumName || defaults.album),
    artworkUrl: asText(raw.artworkUrl || defaults.artworkUrl),
    storefront: asText(raw.storefront || defaults.storefront),
    query: asText(raw.query || defaults.query),
    requestedBy: asText(raw.requestedBy || raw.by || defaults.requestedBy),
    requestedAt: Math.max(0, Math.round(asNumber(raw.requestedAt, defaults.requestedAt || now()))),
    durationMs
  });
  candidate.key = musicCandidateKey(candidate);
  return candidate;
}

function candidateSearchText(candidate = {}) {
  return normalizeMusicText([
    candidate.title,
    candidate.artist,
    candidate.album
  ].filter(Boolean).join(' '));
}

function candidateIsBlacklisted(candidate, blacklist) {
  if (!blacklist.length) return false;
  const text = candidateSearchText(candidate);
  return blacklist.some((term) => text.includes(term));
}

function allWordsContained(words, text) {
  return words.length > 0 && words.every((word) => text.includes(word));
}

function allCharactersContained(query, text) {
  const looseQuery = normalizeLooseText(query);
  const looseText = normalizeLooseText(text);
  if (!looseQuery || !looseText) return false;
  return [...looseQuery].every((char) => looseText.includes(char));
}

function scoreCandidate(query, candidate, index, settings) {
  const parsed = parseSongArtistQuery(query);
  const title = normalizeMusicText(candidate.title);
  const artist = normalizeMusicText(candidate.artist);
  const combined = candidateSearchText(candidate);
  const baseRank = Math.max(0, 120 - index);
  let score = baseRank;
  let reason = 'rank';

  if (parsed.title && parsed.artist) {
    if (title === parsed.title && artist === parsed.artist) {
      score += 1000;
      reason = 'exact-title-artist';
    } else if (title === parsed.title && artist.includes(parsed.artist)) {
      score += 920;
      reason = 'exact-title-artist-contains';
    } else if (title.includes(parsed.title) && artist === parsed.artist) {
      score += 860;
      reason = 'title-contains-exact-artist';
    } else if (title.includes(parsed.title) && artist.includes(parsed.artist)) {
      score += 800;
      reason = 'title-artist-contains';
    }
  }

  const normalizedQuery = normalizeMusicText(query);
  if (title === normalizedQuery && score < 700) {
    score += 700;
    reason = 'exact-title';
  } else if (title.includes(normalizedQuery) && score < 600) {
    score += 600;
    reason = 'title-contains-query';
  } else if (allWordsContained(parsed.words, combined) && score < 520) {
    score += 520;
    reason = 'all-words';
  } else if (allCharactersContained(normalizedQuery, combined) && score < 420) {
    score += 420;
    reason = 'all-characters';
  }

  if (settings.filterShortSongs && candidate.durationMs && candidate.durationMs < settings.minDurationMs) {
    score -= 450;
    reason = `${reason}-short`;
  }

  return { score, reason };
}

export function pickLive2DMusicCandidate(query, rawCandidates = [], rawSettings = {}) {
  const settings = normalizeRoomMusicSettings(rawSettings);
  const blacklist = parseMusicBlacklist(settings.blacklist);
  const candidates = rawCandidates
    .map((candidate) => normalizeMusicCandidate(candidate, { query }))
    .filter((candidate) => candidate.songId || candidate.url)
    .filter((candidate) => !candidateIsBlacklisted(candidate, blacklist))
    .filter((candidate) => (
      !settings.filterShortSongs ||
      !candidate.durationMs ||
      candidate.durationMs >= settings.minDurationMs
    ));

  if (!candidates.length) {
    return { candidate: null, scored: [] };
  }

  if (!settings.smartPick) {
    return {
      candidate: candidates[0],
      scored: candidates.map((candidate, index) => ({ candidate, score: Math.max(0, 120 - index), reason: 'rank' }))
    };
  }

  const scored = candidates
    .map((candidate, index) => ({
      candidate,
      ...scoreCandidate(query, candidate, index, settings)
    }))
    .sort((left, right) => right.score - left.score);

  return { candidate: scored[0]?.candidate || null, scored };
}

function normalizeQueueItem(item = {}) {
  return normalizeMusicCandidate(item);
}

function normalizeCurrent(item = null) {
  if (!item) return null;
  const candidate = normalizeQueueItem(item);
  const startedAt = Math.max(0, Math.round(asNumber(item.startedAt, 0)));
  const durationMs = Math.max(0, Math.round(asNumber(candidate.durationMs, 0)));
  const staleAfter = startedAt + (durationMs || DEFAULT_SONG_DURATION_MS) + CURRENT_STALE_GRACE_MS;
  if (startedAt && staleAfter < now()) return null;
  return compactObject({
    ...candidate,
    status: ['playing', 'paused', 'stopped', 'ended'].includes(asText(item.status)) ? asText(item.status) : 'playing',
    startedAt,
    pausedAt: Math.max(0, Math.round(asNumber(item.pausedAt, 0))),
    elapsedPausedMs: Math.max(0, Math.round(asNumber(item.elapsedPausedMs, 0))),
    playbackToken: asText(item.playbackToken)
  });
}

export function normalizeLive2DMusicQueueState(rawState = {}) {
  const queue = Array.isArray(rawState.queue) ? rawState.queue.map(normalizeQueueItem).filter((item) => item.key) : [];
  const history = Array.isArray(rawState.history) ? rawState.history.map(normalizeQueueItem).filter((item) => item.key) : [];
  const favorites = Array.isArray(rawState.favorites) ? rawState.favorites.map(normalizeQueueItem).filter((item) => item.key) : [];
  return {
    version: 1,
    current: normalizeCurrent(rawState.current),
    queue,
    history,
    favorites,
    lastError: asText(rawState.lastError),
    updatedAt: Math.max(0, Math.round(asNumber(rawState.updatedAt, 0)))
  };
}

export function readLive2DMusicQueueState() {
  if (typeof localStorage === 'undefined') return normalizeLive2DMusicQueueState();
  return normalizeLive2DMusicQueueState(readJson(ROOM_MUSIC_QUEUE_STATE_KEY, {}));
}

export function writeLive2DMusicQueueState(state) {
  const normalized = normalizeLive2DMusicQueueState({
    ...state,
    updatedAt: now()
  });
  if (typeof localStorage !== 'undefined') {
    writeJson(ROOM_MUSIC_QUEUE_STATE_KEY, normalized);
  }
  publishLive2DMusicQueueState(normalized);
  return normalized;
}

export function publishLive2DMusicQueueState(state = readLive2DMusicQueueState()) {
  if (typeof window === 'undefined') return state;
  window.dispatchEvent(new CustomEvent(LIVE2D_MUSIC_QUEUE_EVENT, {
    detail: normalizeLive2DMusicQueueState(state)
  }));
  return state;
}

function trimList(list, limit) {
  return list.slice(0, Math.max(1, Math.round(asNumber(limit, 50))));
}

function hasSong(list, candidate) {
  const key = musicCandidateKey(candidate);
  return list.some((item) => musicCandidateKey(item) === key);
}

function sameSong(left, right) {
  if (!left || !right) return false;
  if (musicCandidateKey(left) === musicCandidateKey(right)) return true;
  return Boolean(
    normalizeLooseText(left.title) &&
    normalizeLooseText(left.title) === normalizeLooseText(right.title) &&
    normalizeLooseText(left.artist) === normalizeLooseText(right.artist)
  );
}

export function enqueueLive2DMusicCandidate(rawCandidate, options = {}) {
  const settings = normalizeRoomMusicSettings(options.settings || {});
  const state = normalizeLive2DMusicQueueState(options.state || readLive2DMusicQueueState());
  const candidate = normalizeMusicCandidate(rawCandidate);
  const mode = ['next', 'immediate'].includes(options.mode) ? options.mode : 'append';

  if (settings.dedupeEnabled) {
    if (state.current && sameSong(state.current, candidate)) {
      return { status: 'duplicate', reason: 'current', state, candidate };
    }
    if (state.queue.some((item) => sameSong(item, candidate))) {
      return { status: 'duplicate', reason: 'queue', state, candidate };
    }
  }

  if (state.queue.length >= settings.maxQueueSize && mode !== 'immediate') {
    return { status: 'full', state, candidate };
  }

  const queue = mode === 'next'
    ? [candidate, ...state.queue.filter((item) => !sameSong(item, candidate))]
    : [...state.queue, candidate];
  const nextState = writeLive2DMusicQueueState({
    ...state,
    queue: trimList(queue, settings.maxQueueSize),
    lastError: ''
  });
  return { status: 'queued', state: nextState, candidate, position: nextState.queue.findIndex((item) => sameSong(item, candidate)) + 1 };
}

export function dequeueNextLive2DMusicCandidate(state = readLive2DMusicQueueState()) {
  const normalized = normalizeLive2DMusicQueueState(state);
  const [candidate, ...queue] = normalized.queue;
  const nextState = writeLive2DMusicQueueState({
    ...normalized,
    queue
  });
  return { candidate: candidate || null, state: nextState };
}

export function setLive2DMusicCurrent(rawCandidate, patch = {}, state = readLive2DMusicQueueState()) {
  const normalized = normalizeLive2DMusicQueueState(state);
  const candidate = rawCandidate ? normalizeMusicCandidate(rawCandidate) : null;
  const current = candidate
    ? {
        ...candidate,
        status: asText(patch.status) || 'playing',
        startedAt: Math.max(0, Math.round(asNumber(patch.startedAt, now()))),
        pausedAt: Math.max(0, Math.round(asNumber(patch.pausedAt, 0))),
        elapsedPausedMs: Math.max(0, Math.round(asNumber(patch.elapsedPausedMs, 0))),
        playbackToken: asText(patch.playbackToken) || uid('playback')
      }
    : null;
  return writeLive2DMusicQueueState({
    ...normalized,
    current
  });
}

export function updateLive2DMusicCurrent(patch = {}, state = readLive2DMusicQueueState()) {
  const normalized = normalizeLive2DMusicQueueState(state);
  if (!normalized.current) return normalized;
  return writeLive2DMusicQueueState({
    ...normalized,
    current: {
      ...normalized.current,
      ...patch
    }
  });
}

export function clearLive2DMusicCurrent(state = readLive2DMusicQueueState()) {
  const normalized = normalizeLive2DMusicQueueState(state);
  return writeLive2DMusicQueueState({
    ...normalized,
    current: null
  });
}

export function addLive2DMusicHistory(rawCandidate, options = {}) {
  const settings = normalizeRoomMusicSettings(options.settings || {});
  const state = normalizeLive2DMusicQueueState(options.state || readLive2DMusicQueueState());
  const candidate = normalizeMusicCandidate(rawCandidate);
  const history = [candidate, ...state.history.filter((item) => !sameSong(item, candidate))];
  return writeLive2DMusicQueueState({
    ...state,
    history: trimList(history, settings.historyLimit)
  });
}

export function removeLive2DMusicQueueItem(keyOrUid, state = readLive2DMusicQueueState()) {
  const key = asText(keyOrUid);
  const normalized = normalizeLive2DMusicQueueState(state);
  return writeLive2DMusicQueueState({
    ...normalized,
    queue: normalized.queue.filter((item) => item.uid !== key && item.key !== key && item.songId !== key)
  });
}

export function clearLive2DMusicQueue(state = readLive2DMusicQueueState()) {
  const normalized = normalizeLive2DMusicQueueState(state);
  return writeLive2DMusicQueueState({
    ...normalized,
    queue: []
  });
}

export function toggleLive2DMusicFavorite(rawCandidate, favorite = true, state = readLive2DMusicQueueState()) {
  const normalized = normalizeLive2DMusicQueueState(state);
  const candidate = normalizeMusicCandidate(rawCandidate);
  const favorites = favorite
    ? [candidate, ...normalized.favorites.filter((item) => !sameSong(item, candidate))]
    : normalized.favorites.filter((item) => !sameSong(item, candidate));
  return writeLive2DMusicQueueState({
    ...normalized,
    favorites: trimList(favorites, 100)
  });
}

export function estimateLive2DMusicWaitMs(candidate, state = readLive2DMusicQueueState()) {
  const normalized = normalizeLive2DMusicQueueState(state);
  let waitMs = 0;
  if (normalized.current?.status === 'playing') {
    const durationMs = normalized.current.durationMs || DEFAULT_SONG_DURATION_MS;
    const elapsedMs = Math.max(0, now() - (normalized.current.startedAt || now()) - (normalized.current.elapsedPausedMs || 0));
    waitMs += Math.max(0, durationMs - elapsedMs);
  }
  for (const item of normalized.queue) {
    if (sameSong(item, candidate)) break;
    waitMs += item.durationMs || DEFAULT_SONG_DURATION_MS;
  }
  return waitMs;
}

export function formatLive2DMusicWait(waitMs) {
  const totalSeconds = Math.max(0, Math.round(asNumber(waitMs, 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

export function getLive2DMusicPublicState() {
  return readLive2DMusicQueueState();
}

export function candidateAlreadyKnown(rawCandidate, state = readLive2DMusicQueueState()) {
  const candidate = normalizeMusicCandidate(rawCandidate);
  const normalized = normalizeLive2DMusicQueueState(state);
  return Boolean(
    (normalized.current && sameSong(normalized.current, candidate)) ||
    hasSong(normalized.queue, candidate) ||
    hasSong(normalized.history, candidate) ||
    hasSong(normalized.favorites, candidate)
  );
}
