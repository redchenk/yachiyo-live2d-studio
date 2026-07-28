import {
  executeLive2DMusicCommand,
  searchLive2DMusic
} from './live2dMusic';
import { getLive2DMusicPublicState } from './live2dMusicQueue';

/**
 * Compatibility layer for the Track/SearchResult/PlaybackInfo contract from
 * firefly20041001/Yachiyo at commit 044ffb1cd4c499caedfe68499ce11e5c3e5e2ec6.
 * This is a clean Vue/WebView2 adaptation; it does not embed the upstream
 * Electron, React, account-login, or cookie-storage implementation.
 */
export const YACHIYO_MUSIC_WINDOW_API_KEY = 'yachiyoMusic';
export const DEFAULT_YACHIYO_MUSIC_SOURCE = 'netease';

export const YACHIYO_SOURCE_TO_LIVE2D_PROVIDER = Object.freeze({
  netease: 'netease-cloud',
  qqmusic: 'qqmusic'
});

export const LIVE2D_PROVIDER_TO_YACHIYO_SOURCE = Object.freeze({
  netease: 'netease',
  'netease-cloud': 'netease',
  qq: 'qqmusic',
  qqmusic: 'qqmusic',
  'qq-music': 'qqmusic'
});

const QUALITY_LEVELS = new Set(['standard', 'high', 'lossless', 'hires']);
const CONTROL_ACTIONS = new Set(['pause', 'resume', 'stop', 'skip', 'queue', 'clear', 'remove']);
const REQUEST_ACTIONS = new Set(['play', 'request', 'play_next', 'play_now']);
const SECRET_KEY_PATTERN = /(?:authorization|credential|cookie|password|secret|sessdata|token|bili_jct|music_u|csrf)/i;
const PLAYBACK_URL_KEY_PATTERN = /^(?:url|uri|href|audioUrl|musicUrl|playbackUrl|streamUrl|streamingUrl)$/i;
const SAFE_PUBLIC_URL_KEY_PATTERN = /^(?:albumCoverUrl|artworkUrl|coverUrl|avatarUrl)$/i;
const EXTERNAL_URL_PATTERN = /^(?:https?|data|file|blob):/i;
const EXTERNAL_URL_IN_TEXT_PATTERN = /\b(?:https?|data|file|blob):[^\s"'<>]+/gi;
const REDACTED_VALUE = '[redacted]';

function asText(value) {
  return String(value ?? '').trim();
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null)
  );
}

function firstText(...values) {
  for (const value of values) {
    if (value && typeof value === 'object') continue;
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function normalizeYachiyoSource(value, fallback = '') {
  const source = asText(value).toLowerCase().replace(/[\s_-]/g, '');
  if (source === 'netease' || source === 'neteasecloud' || source === '163') return 'netease';
  if (source === 'qq' || source === 'qqmusic') return 'qqmusic';
  return fallback;
}

function normalizeArtists(value) {
  if (Array.isArray(value)) {
    return value.map((artist) => firstText(artist?.name, artist)).filter(Boolean);
  }
  return asText(value)
    .split(/\s*(?:\/|,|、)\s*/u)
    .map(asText)
    .filter(Boolean);
}

function normalizeQuality(value, fallback = 'high') {
  const quality = asText(value).toLowerCase();
  if (QUALITY_LEVELS.has(quality)) return quality;
  if (['low', 'normal', 'standard'].includes(quality)) return 'standard';
  if (['higher', 'exhigh', 'super', '320k'].includes(quality)) return 'high';
  if (['sq', 'flac'].includes(quality)) return 'lossless';
  if (['hi-res', 'hires', 'jyeffect', 'sky', 'jymaster'].includes(quality)) return 'hires';
  return normalizeQuality(fallback, 'high');
}

function normalizeFormat(value, url = '') {
  const explicit = asText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (explicit) return explicit;
  const match = asText(url).match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  return match?.[1]?.toLowerCase() || 'unknown';
}

export function yachiyoSourceToLive2DProvider(source, fallback = '') {
  const normalized = normalizeYachiyoSource(source);
  return YACHIYO_SOURCE_TO_LIVE2D_PROVIDER[normalized] || asText(fallback);
}

export function live2DProviderToYachiyoSource(provider, fallback = '') {
  const normalizedProvider = asText(provider).toLowerCase();
  return LIVE2D_PROVIDER_TO_YACHIYO_SOURCE[normalizedProvider] ||
    normalizeYachiyoSource(fallback);
}

export const mapYachiyoSourceToLive2DProvider = yachiyoSourceToLive2DProvider;
export const mapLive2DProviderToYachiyoSource = live2DProviderToYachiyoSource;

/**
 * Converts Yachiyo's Track contract into the candidate shape consumed by
 * live2dMusic.js. A Track deliberately has no playback URL.
 */
export function yachiyoTrackToMusicCandidate(rawTrack = {}, defaults = {}) {
  const source = normalizeYachiyoSource(
    rawTrack.source || defaults.source,
    DEFAULT_YACHIYO_MUSIC_SOURCE
  );
  const songId = firstText(rawTrack.id, rawTrack.songId, defaults.songId);
  if (!songId) throw new Error('Yachiyo Track requires a stable id.');

  const artists = normalizeArtists(
    rawTrack.artists?.length ? rawTrack.artists : (rawTrack.artist || defaults.artists)
  );
  const mappedSource = normalizeYachiyoSource(rawTrack.mappedSource);
  const requestedBy = firstText(defaults.requestedBy, rawTrack.requestedBy, defaults.by);
  const quality = normalizeQuality(rawTrack.quality || defaults.quality, '');
  const candidate = compactObject({
    provider: yachiyoSourceToLive2DProvider(source),
    songId,
    title: firstText(rawTrack.name, rawTrack.title, defaults.title),
    artist: artists.join(' / '),
    album: firstText(rawTrack.albumName, rawTrack.album, defaults.album),
    artworkUrl: firstText(rawTrack.albumCoverUrl, rawTrack.artworkUrl, defaults.artworkUrl),
    durationMs: Math.max(0, Math.round(asNumber(
      rawTrack.duration ?? rawTrack.durationMs,
      defaults.durationMs || 0
    ))),
    query: firstText(defaults.query, rawTrack.query),
    requestedBy,
    quality: quality || undefined,
    vip: typeof rawTrack.vip === 'boolean' ? rawTrack.vip : undefined,
    yachiyo: compactObject({
      source,
      artists,
      albumId: firstText(rawTrack.albumId, defaults.albumId),
      quality: quality || undefined,
      vip: typeof rawTrack.vip === 'boolean' ? rawTrack.vip : undefined,
      mappedTrackId: firstText(rawTrack.mappedTrackId),
      mappedSource: mappedSource || undefined
    })
  });
  return candidate;
}

/**
 * Converts a live2dMusic candidate back to Yachiyo's Track contract.
 */
export function musicCandidateToYachiyoTrack(candidate = {}, defaults = {}) {
  const metadata = candidate.yachiyo && typeof candidate.yachiyo === 'object'
    ? candidate.yachiyo
    : (candidate.metadata?.yachiyo || {});
  const source = normalizeYachiyoSource(
    metadata.source ||
    defaults.source ||
    live2DProviderToYachiyoSource(candidate.provider)
  );
  if (!source) {
    throw new Error(`Music provider "${asText(candidate.provider) || 'unknown'}" cannot be represented as a Yachiyo source.`);
  }

  const id = firstText(candidate.songId, candidate.id, defaults.id);
  if (!id) throw new Error('Music candidate requires a stable songId.');
  const artists = normalizeArtists(
    metadata.artists?.length ? metadata.artists : (candidate.artists || candidate.artist)
  );
  const quality = normalizeQuality(candidate.quality || metadata.quality || defaults.quality, '');
  const mappedSource = normalizeYachiyoSource(metadata.mappedSource || candidate.mappedSource);

  return compactObject({
    id,
    source,
    name: firstText(candidate.title, candidate.name, defaults.name),
    artists,
    albumName: firstText(candidate.album, candidate.albumName, defaults.albumName),
    albumId: firstText(metadata.albumId, candidate.albumId, defaults.albumId),
    albumCoverUrl: firstText(candidate.artworkUrl, candidate.albumCoverUrl, defaults.albumCoverUrl),
    duration: Math.max(0, Math.round(asNumber(
      candidate.durationMs ?? candidate.duration,
      defaults.duration || 0
    ))),
    quality: quality || undefined,
    vip: typeof (candidate.vip ?? metadata.vip) === 'boolean'
      ? Boolean(candidate.vip ?? metadata.vip)
      : undefined,
    mappedTrackId: firstText(metadata.mappedTrackId, candidate.mappedTrackId) || undefined,
    mappedSource: mappedSource || undefined
  });
}

export const yachiyoTrackToCandidate = yachiyoTrackToMusicCandidate;
export const candidateToYachiyoTrack = musicCandidateToYachiyoTrack;

/**
 * Creates Yachiyo's PlaybackInfo contract from a trusted resolved candidate.
 * Use sanitizeYachiyoMusicToolResult before returning this object to an LLM.
 */
export function musicCandidateToYachiyoPlaybackInfo(candidate = {}, defaults = {}) {
  const url = firstText(candidate.url, defaults.url);
  if (!url) throw new Error('Resolved music candidate has no playback URL.');
  return {
    url,
    quality: normalizeQuality(candidate.quality || defaults.quality),
    format: normalizeFormat(candidate.format || defaults.format, url),
    bitrate: Math.max(0, Math.round(asNumber(candidate.bitrate, defaults.bitrate || 0))),
    size: Math.max(0, Math.round(asNumber(candidate.size, defaults.size || 0)))
  };
}

function redactSensitiveText(value, options = {}) {
  let text = String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(SESSDATA|bili_jct|MUSIC_U|__csrf|cookie|token|secret|password)\s*[:=]\s*([^;\s,]+)/gi, '$1=[redacted]');
  if (options.redactUrls) {
    text = text.replace(EXTERNAL_URL_IN_TEXT_PATTERN, '[redacted-url]');
  }
  return text;
}

function safeToolError(error, fallback = 'Yachiyo music tool failed.') {
  const rawMessage = typeof error?.message === 'string' ? error.message : fallback;
  const message = redactSensitiveText(rawMessage, { redactUrls: true }).trim() || fallback;
  const safeError = new Error(message);
  safeError.name = 'YachiyoMusicToolError';
  return safeError;
}

/**
 * Produces a clone safe for model/tool output. Playback URLs and credentials
 * are redacted while public artwork URLs remain available to the UI.
 */
export function sanitizeYachiyoMusicToolResult(value) {
  const seen = new WeakMap();

  function visit(entry, key = '', depth = 0) {
    if (entry === null || entry === undefined) return entry;
    if (SECRET_KEY_PATTERN.test(key)) return REDACTED_VALUE;
    if (PLAYBACK_URL_KEY_PATTERN.test(key) && !SAFE_PUBLIC_URL_KEY_PATTERN.test(key)) {
      return asText(entry) ? REDACTED_VALUE : '';
    }
    if (typeof entry === 'string') {
      return redactSensitiveText(entry, {
        redactUrls: !SAFE_PUBLIC_URL_KEY_PATTERN.test(key)
      });
    }
    if (typeof entry === 'number' || typeof entry === 'boolean') return entry;
    if (typeof entry === 'bigint') return Number(entry);
    if (typeof entry === 'function' || typeof entry === 'symbol') return undefined;
    if (depth >= 10) return '[truncated]';
    if (seen.has(entry)) return '[circular]';

    if (Array.isArray(entry)) {
      seen.set(entry, true);
      return entry.map((item) => visit(item, '', depth + 1)).filter((item) => item !== undefined);
    }

    if (typeof entry === 'object') {
      seen.set(entry, true);
      return Object.fromEntries(
        Object.entries(entry)
          .map(([childKey, childValue]) => [childKey, visit(childValue, childKey, depth + 1)])
          .filter(([, childValue]) => childValue !== undefined)
      );
    }
    return undefined;
  }

  return visit(value);
}

export const redactYachiyoMusicToolResult = sanitizeYachiyoMusicToolResult;
export const toSafeYachiyoMusicToolResult = sanitizeYachiyoMusicToolResult;

function assertNoLlmPlaybackUrl(value, path = 'input', seen = new WeakSet()) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    const key = path.split('.').pop() || '';
    if (
      EXTERNAL_URL_PATTERN.test(value.trim()) &&
      !SAFE_PUBLIC_URL_KEY_PATTERN.test(key)
    ) {
      throw new Error('Music tools do not accept playback URLs; use a search query or Track id.');
    }
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  for (const [key, entry] of Object.entries(value)) {
    if (
      PLAYBACK_URL_KEY_PATTERN.test(key) &&
      !SAFE_PUBLIC_URL_KEY_PATTERN.test(key) &&
      asText(entry)
    ) {
      throw new Error('Music tools do not accept playback URLs; use a search query or Track id.');
    }
    assertNoLlmPlaybackUrl(entry, `${path}.${key}`, seen);
  }
}

function normalizeSupportedSources(value) {
  const sourceList = Array.isArray(value) ? value : [value || DEFAULT_YACHIYO_MUSIC_SOURCE];
  const sources = sourceList.map((source) => normalizeYachiyoSource(source)).filter(Boolean);
  return new Set(sources.length ? sources : [DEFAULT_YACHIYO_MUSIC_SOURCE]);
}

function parseToolArguments(value) {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new Error('Music tool arguments must be valid JSON.');
  }
}

function normalizeAction(value, fallback = '') {
  const action = asText(value).toLowerCase().replace(/[\s-]/g, '_');
  if (action === 'next' || action === 'playnext') return 'play_next';
  if (action === 'now' || action === 'playnow') return 'play_now';
  if (action === 'next_track') return 'skip';
  if (action === 'list' || action === 'status') return 'queue';
  return action || fallback;
}

function candidateFromSafeInput(input, source, requestedBy) {
  const rawCandidate = input.candidate && typeof input.candidate === 'object'
    ? input.candidate
    : null;
  if (!rawCandidate) return null;
  const candidateSource = normalizeYachiyoSource(
    input.source ||
    live2DProviderToYachiyoSource(rawCandidate.provider) ||
    source,
    source
  );
  const songId = firstText(rawCandidate.songId, rawCandidate.id);
  if (!songId) throw new Error('Music candidate requires a stable songId.');
  return compactObject({
    provider: yachiyoSourceToLive2DProvider(candidateSource),
    songId,
    title: firstText(rawCandidate.title, rawCandidate.name),
    artist: firstText(rawCandidate.artist, normalizeArtists(rawCandidate.artists).join(' / ')),
    album: firstText(rawCandidate.album, rawCandidate.albumName),
    artworkUrl: firstText(rawCandidate.artworkUrl, rawCandidate.albumCoverUrl),
    durationMs: Math.max(0, Math.round(asNumber(
      rawCandidate.durationMs ?? rawCandidate.duration,
      0
    ))),
    query: asText(rawCandidate.query),
    requestedBy
  });
}

export function createYachiyoMusicAdapter(deps = {}) {
  const searchMusic = deps.searchLive2DMusic || deps.searchMusic || searchLive2DMusic;
  const executeMusicCommand = deps.executeLive2DMusicCommand ||
    deps.executeMusicCommand ||
    executeLive2DMusicCommand;
  const readQueueState = deps.getLive2DMusicPublicState ||
    deps.getQueueState ||
    getLive2DMusicPublicState;
  const supportedSources = normalizeSupportedSources(deps.supportedSources);
  const defaultSource = normalizeYachiyoSource(
    deps.defaultSource,
    DEFAULT_YACHIYO_MUSIC_SOURCE
  );
  let commandTail = Promise.resolve();

  function assertSupportedSource(source) {
    if (!supportedSources.has(source)) {
      throw new Error(`Yachiyo music source "${source}" is not available in this build.`);
    }
  }

  async function resolveSettings() {
    if (typeof deps.getSettings === 'function') return await deps.getSettings();
    return deps.settings;
  }

  function serializeCommand(operation) {
    const next = commandTail.then(operation, operation);
    commandTail = next.then(() => undefined, () => undefined);
    return next;
  }

  async function search(request = {}, context = {}) {
    try {
      const input = typeof request === 'string' ? { query: request } : (request || {});
      assertNoLlmPlaybackUrl(input);
      const query = firstText(input.query, input.keyword);
      if (!query || EXTERNAL_URL_PATTERN.test(query)) {
        throw new Error('Yachiyo music search requires a non-URL query.');
      }
      const source = normalizeYachiyoSource(input.source || context.source, defaultSource);
      assertSupportedSource(source);
      const offset = Math.max(0, Math.round(asNumber(input.offset, 0)));
      const limit = Math.max(1, Math.min(50, Math.round(asNumber(input.limit, 20))));
      const fetchLimit = Math.min(50, offset + limit);
      const settings = await resolveSettings();
      const rawResult = await searchMusic(query, settings, {
        provider: yachiyoSourceToLive2DProvider(source),
        limit: fetchLimit
      });
      const rawTracks = Array.isArray(rawResult)
        ? rawResult
        : (Array.isArray(rawResult?.tracks) ? rawResult.tracks : []);
      const tracks = rawTracks
        .slice(offset, offset + limit)
        .map((track) => (
          track?.source && track?.name && Array.isArray(track?.artists)
            ? musicCandidateToYachiyoTrack(yachiyoTrackToMusicCandidate(track))
            : musicCandidateToYachiyoTrack(track, { source })
        ));
      return sanitizeYachiyoMusicToolResult({
        tracks,
        albums: [],
        artists: [],
        playlists: [],
        total: Math.max(tracks.length, Math.round(asNumber(rawResult?.total, rawTracks.length))),
        source
      });
    } catch (error) {
      throw safeToolError(error, 'Yachiyo music search failed.');
    }
  }

  function executeSerial(command) {
    return serializeCommand(async () => {
      try {
        const settings = await resolveSettings();
        const result = await executeMusicCommand(command, settings);
        return sanitizeYachiyoMusicToolResult(result);
      } catch (error) {
        throw safeToolError(error, 'Yachiyo music control failed.');
      }
    });
  }

  async function requestTrack(request = {}, context = {}) {
    const input = typeof request === 'string' ? { query: request } : (request || {});
    assertNoLlmPlaybackUrl(input);
    const nestedTrack = input.track && typeof input.track === 'object' ? input.track : null;
    const looksLikeTrack = input.id && input.source && (input.name || input.title);
    const track = nestedTrack || (looksLikeTrack ? input : null);
    const source = normalizeYachiyoSource(
      input.source || track?.source || context.source,
      defaultSource
    );
    assertSupportedSource(source);
    const requestedBy = firstText(
      context.requestedBy,
      input.requestedBy,
      input.by,
      track?.requestedBy,
      input.candidate?.requestedBy
    );
    const candidate = track
      ? yachiyoTrackToMusicCandidate(track, {
          source,
          query: input.query,
          requestedBy
        })
      : candidateFromSafeInput(input, source, requestedBy);
    const query = firstText(
      input.query,
      candidate?.query,
      candidate && [candidate.title, candidate.artist].filter(Boolean).join(' ')
    );
    if (!candidate && (!query || EXTERNAL_URL_PATTERN.test(query))) {
      throw new Error('Music request requires a search query or Yachiyo Track id.');
    }
    const requestedAction = normalizeAction(input.action, 'request');
    const action = REQUEST_ACTIONS.has(requestedAction) ? requestedAction : 'request';
    return executeSerial(compactObject({
      action,
      provider: yachiyoSourceToLive2DProvider(source),
      query,
      requestedBy,
      candidate
    }));
  }

  async function playTrack(request = {}, context = {}) {
    const input = typeof request === 'string' ? { query: request } : { ...(request || {}) };
    return requestTrack({ ...input, action: 'play_now' }, context);
  }

  async function control(request = {}, context = {}) {
    const input = typeof request === 'string' ? { action: request } : (request || {});
    assertNoLlmPlaybackUrl(input);
    const action = normalizeAction(input.action || input.command);
    if (!CONTROL_ACTIONS.has(action)) {
      throw new Error(`Unsupported Yachiyo music control action "${action || 'empty'}".`);
    }
    const source = normalizeYachiyoSource(input.source || context.source, defaultSource);
    assertSupportedSource(source);
    const requestedBy = firstText(context.requestedBy, input.requestedBy, input.by);
    return executeSerial(compactObject({
      action,
      provider: yachiyoSourceToLive2DProvider(source),
      requestedBy,
      removeId: firstText(input.removeId, input.queueId, input.id)
    }));
  }

  async function execute(request = {}, context = {}) {
    const input = typeof request === 'string'
      ? { action: 'request', query: request }
      : (request || {});
    const action = normalizeAction(input.action || input.command, 'request');
    if (REQUEST_ACTIONS.has(action)) {
      return requestTrack({ ...input, action }, context);
    }
    if (CONTROL_ACTIONS.has(action)) {
      return control({ ...input, action }, context);
    }
    throw new Error(`Unsupported Yachiyo music action "${action || 'empty'}".`);
  }

  async function getState() {
    try {
      return sanitizeYachiyoMusicToolResult(await readQueueState());
    } catch (error) {
      throw safeToolError(error, 'Unable to read Yachiyo music state.');
    }
  }

  async function callTool(callOrName, inputOrContext = {}, maybeContext = {}) {
    let name;
    let input;
    let context;
    if (typeof callOrName === 'string') {
      name = callOrName;
      input = inputOrContext;
      context = maybeContext;
    } else {
      const call = callOrName || {};
      name = firstText(call.name, call.tool, call.function?.name);
      input = parseToolArguments(call.arguments ?? call.input ?? call.function?.arguments);
      context = inputOrContext;
    }
    const toolName = asText(name).toLowerCase().replace(/[\s-]/g, '_');
    if (['search', 'search_music', 'music_search', 'yachiyo_search'].includes(toolName)) {
      return search(input, context);
    }
    if (['request', 'request_track', 'request_music', 'music_request'].includes(toolName)) {
      return requestTrack(input, context);
    }
    if (['play', 'play_track', 'play_music', 'music_play'].includes(toolName)) {
      return playTrack(input, context);
    }
    if (toolName === 'music_control') {
      return execute(input, context);
    }
    if (['control', 'queue', 'music_queue'].includes(toolName)) {
      const controlInput = toolName.includes('queue') ? { ...(input || {}), action: 'queue' } : input;
      return control(controlInput, context);
    }
    if (['state', 'music_state', 'get_music_state'].includes(toolName)) {
      return getState();
    }
    throw new Error(`Unknown Yachiyo music tool "${toolName || 'empty'}".`);
  }

  return Object.freeze({
    version: 1,
    contract: 'firefly20041001/yachiyo',
    capabilities: Object.freeze({
      sources: Object.freeze([...supportedSources]),
      search: true,
      request: true,
      playbackControl: true,
      acceptsPlaybackUrl: false
    }),
    search,
    request: requestTrack,
    requestTrack,
    play: playTrack,
    playTrack,
    control,
    execute,
    getState,
    callTool
  });
}

export const defaultYachiyoMusicAdapter = createYachiyoMusicAdapter();
export const yachiyoMusicAdapter = defaultYachiyoMusicAdapter;

export function installYachiyoMusicWindowApi(
  target = typeof window !== 'undefined' ? window : null,
  adapter = defaultYachiyoMusicAdapter,
  key = YACHIYO_MUSIC_WINDOW_API_KEY
) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    return null;
  }
  const api = Object.freeze({
    version: adapter.version,
    contract: adapter.contract,
    capabilities: adapter.capabilities,
    search: adapter.search,
    request: adapter.request,
    play: adapter.play,
    control: adapter.control,
    execute: adapter.execute,
    getState: adapter.getState,
    callTool: adapter.callTool
  });
  Object.defineProperty(target, asText(key) || YACHIYO_MUSIC_WINDOW_API_KEY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api
  });
  return api;
}

if (typeof window !== 'undefined') {
  installYachiyoMusicWindowApi(window);
}

export default defaultYachiyoMusicAdapter;
