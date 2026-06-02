import {
  normalizeRoomMusicSettings,
  readRoomMusicSettings,
  writeRoomMusicSettings
} from './roomSettings';
import { appendRoomLive2DDebugEvent } from './live2dDebug';
import {
  addLive2DMusicHistory,
  clearLive2DMusicCurrent,
  clearLive2DMusicQueue,
  dequeueNextLive2DMusicCandidate,
  enqueueLive2DMusicCandidate,
  estimateLive2DMusicWaitMs,
  formatLive2DMusicWait,
  getLive2DMusicPublicState,
  normalizeMusicCandidate,
  pickLive2DMusicCandidate,
  readLive2DMusicQueueState,
  removeLive2DMusicQueueItem,
  setLive2DMusicCurrent,
  updateLive2DMusicCurrent
} from './live2dMusicQueue';

const MUSIC_KIT_SCRIPT_ID = 'yachiyo-musickit-js';
const MUSIC_KIT_SCRIPT_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
const APPLE_MUSIC_PROVIDER = 'apple-music';
const LOCAL_MUSIC_PROVIDER = 'local-library';
const LOCAL_MUSIC_SEARCH_ENDPOINT = '/api/music/local/search';
const DEFAULT_SEARCH_LIMIT = 25;
const PLAYABLE_ACTIONS = new Set([
  'play',
  'request',
  'play_next',
  'play_now',
  'pause',
  'resume',
  'stop',
  'skip',
  'clear',
  'remove',
  'queue',
  'authorize'
]);
const STATE_ONLY_ACTIONS = new Set(['queue', 'clear', 'remove']);

let musicKitScriptPromise = null;
let musicKitConfigurePromise = null;
let musicKitConfigureKey = '';
let playbackTimer = 0;
let localAudio = null;

function asText(value) {
  return String(value ?? '').trim();
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
  );
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function normalizeMusicAction(value) {
  const action = asText(value).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (action === 'start') return 'play';
  if (action === 'continue') return 'resume';
  if (action === 'halt') return 'stop';
  if (['order', 'song_request', 'songrequest', 'enqueue', 'append', 'request_song'].includes(action)) return 'request';
  if (['next', 'playnext', 'play_next_song', 'next_song'].includes(action)) return 'play_next';
  if (['immediate', 'playnow', 'play_now_song', 'cut_in'].includes(action)) return 'play_now';
  if (['cut', 'skip_song', 'next_track'].includes(action)) return 'skip';
  if (['list', 'status'].includes(action)) return 'queue';
  if (['clear_queue', 'clearqueue'].includes(action)) return 'clear';
  return PLAYABLE_ACTIONS.has(action) ? action : 'play';
}

function normalizeStorefront(value, fallback = 'cn') {
  return asText(value).toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || fallback;
}

export function normalizeLive2DMusicCommand(rawCommand = null) {
  if (!rawCommand) return null;

  const source = typeof rawCommand === 'string'
    ? { action: 'play', query: rawCommand }
    : (typeof rawCommand === 'object' ? rawCommand : null);
  if (!source) return null;

  const nested = source.music && typeof source.music === 'object' ? source.music : {};
  const action = normalizeMusicAction(source.action || source.command || source.type || nested.action || nested.command);
  const query = firstText(
    source.query,
    source.song,
    source.title,
    source.name,
    source.text,
    nested.query,
    nested.song,
    nested.title,
    nested.name,
    nested.text
  );
  const songId = firstText(
    source.songId,
    source.catalogId,
    source.appleMusicId,
    source.id,
    nested.songId,
    nested.catalogId,
    nested.appleMusicId,
    nested.id
  );
  const url = firstText(source.url, source.musicUrl, source.appleMusicUrl, nested.url, nested.musicUrl, nested.appleMusicUrl);
  const storefront = normalizeStorefront(source.storefront || source.storefrontId || nested.storefront || nested.storefrontId, '');
  const requestedBy = firstText(source.requestedBy, source.by, source.user, source.viewer, nested.requestedBy, nested.by, nested.user, nested.viewer);
  const removeId = firstText(source.removeId, source.queueId, source.uid, nested.removeId, nested.queueId, nested.uid);

  if (['play', 'request', 'play_next', 'play_now'].includes(action) && !query && !songId && !url) return null;
  if (action === 'remove' && !removeId && !songId) return null;

  return compactObject({
    action,
    query,
    songId,
    url,
    storefront,
    requestedBy,
    removeId
  });
}

function musicErrorMessage(error, fallback = 'Music failed') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  const dataError = Array.isArray(error?.data?.errors) ? error.data.errors[0] : null;
  const apiError = Array.isArray(error?.errors) ? error.errors[0] : null;
  return asText(dataError?.detail || dataError?.title || apiError?.detail || apiError?.title || error.message) || fallback;
}

function publishMusicDebug(type, detail = {}, provider = '') {
  appendRoomLive2DDebugEvent(type, {
    source: provider || detail.provider || APPLE_MUSIC_PROVIDER,
    ...detail,
    developerToken: detail.developerToken ? '[configured]' : undefined,
    musicUserToken: detail.musicUserToken ? '[authorized]' : undefined
  });
}

function loadMusicKitScript() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Apple Music playback is only available in the studio window.'));
  }
  if (window.MusicKit?.configure) return Promise.resolve(window.MusicKit);
  if (musicKitScriptPromise) return musicKitScriptPromise;

  musicKitScriptPromise = new Promise((resolve, reject) => {
    const finish = () => {
      if (window.MusicKit?.configure) {
        resolve(window.MusicKit);
        return true;
      }
      return false;
    };
    if (finish()) return;

    const existing = document.getElementById(MUSIC_KIT_SCRIPT_ID);
    const script = existing || document.createElement('script');
    const timeout = window.setTimeout(() => {
      cleanup();
      musicKitScriptPromise = null;
      reject(new Error('MusicKit JS load timed out.'));
    }, 15000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      document.removeEventListener('musickitloaded', onMusicKitLoaded);
    };
    const resolveIfReady = () => {
      if (!finish()) return;
      cleanup();
    };
    function onMusicKitLoaded() {
      resolveIfReady();
    }

    script.addEventListener('load', resolveIfReady, { once: true });
    script.addEventListener('error', () => {
      cleanup();
      musicKitScriptPromise = null;
      reject(new Error('Unable to load MusicKit JS.'));
    }, { once: true });
    document.addEventListener('musickitloaded', onMusicKitLoaded);

    if (!existing) {
      script.id = MUSIC_KIT_SCRIPT_ID;
      script.async = true;
      script.src = MUSIC_KIT_SCRIPT_URL;
      document.head.appendChild(script);
    }
  });

  return musicKitScriptPromise;
}

async function configureAppleMusic(settings = readRoomMusicSettings()) {
  const normalized = normalizeRoomMusicSettings(settings);
  if (!normalized.developerToken) {
    throw new Error('Apple Music Developer Token is missing. Add it in Studio Settings > Music.');
  }

  const MusicKit = await loadMusicKitScript();
  const configureKey = [
    normalized.developerToken,
    normalized.musicUserToken,
    normalized.storefront
  ].join('|');

  if (!musicKitConfigurePromise || musicKitConfigureKey !== configureKey) {
    musicKitConfigureKey = configureKey;
    musicKitConfigurePromise = Promise.resolve(MusicKit.configure(compactObject({
      developerToken: normalized.developerToken,
      musicUserToken: normalized.musicUserToken || undefined,
      app: {
        name: 'Yachiyo Live2D Studio',
        build: '0.1.0'
      }
    }))).then(() => MusicKit.getInstance?.()).catch((error) => {
      musicKitConfigurePromise = null;
      musicKitConfigureKey = '';
      throw error;
    });
  }

  const music = await musicKitConfigurePromise;
  if (!music) throw new Error('MusicKit did not create a player instance.');
  if (normalized.musicUserToken && music.musicUserToken !== normalized.musicUserToken) {
    music.musicUserToken = normalized.musicUserToken;
  }
  return { music, settings: normalized };
}

async function ensureAuthorized(music, settings) {
  if (music.musicUserToken) return music.musicUserToken;
  if (settings.musicUserToken) {
    music.musicUserToken = settings.musicUserToken;
    return settings.musicUserToken;
  }
  if (!settings.autoAuthorize) {
    throw new Error('Apple Music needs user authorization. Open Studio Settings > Music and authorize first.');
  }
  const token = await music.authorize();
  if (!token) throw new Error('Apple Music authorization did not return a user token.');
  writeRoomMusicSettings({ ...settings, musicUserToken: token });
  return token;
}

function appleArtworkUrl(artwork = null, size = 300) {
  const url = asText(artwork?.url);
  return url ? url.replace('{w}', String(size)).replace('{h}', String(size)) : '';
}

function appleMusicSongToCandidate(song, defaults = {}) {
  const attributes = song?.attributes || {};
  return normalizeMusicCandidate({
    provider: 'apple-music',
    songId: song?.id,
    title: attributes.name,
    artist: attributes.artistName,
    album: attributes.albumName,
    artworkUrl: appleArtworkUrl(attributes.artwork),
    durationMs: attributes.durationInMillis,
    storefront: defaults.storefront,
    query: defaults.query,
    requestedBy: defaults.requestedBy
  });
}

async function searchAppleMusicSongs(query, settings, userToken = '') {
  const term = asText(query);
  if (!term) throw new Error('Apple Music song query is empty.');

  const storefront = normalizeStorefront(settings.storefront, 'cn');
  const params = new URLSearchParams({
    term,
    types: 'songs',
    limit: String(settings.searchLimit || DEFAULT_SEARCH_LIMIT)
  });
  const response = await fetch(`https://api.music.apple.com/v1/catalog/${storefront}/search?${params.toString()}`, {
    headers: compactObject({
      Authorization: `Bearer ${settings.developerToken}`,
      'Music-User-Token': userToken || settings.musicUserToken || undefined
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(musicErrorMessage(data, `Apple Music search failed (${response.status}).`));
  }
  const songs = Array.isArray(data?.results?.songs?.data) ? data.results.songs.data : [];
  return songs.map((song) => appleMusicSongToCandidate(song, {
    storefront,
    query: term
  })).filter((song) => song.songId);
}

function localMusicFileUrl(songId = '') {
  const id = asText(songId);
  return id ? `/api/music/local/file?path=${encodeURIComponent(id)}` : '';
}

function localMusicSongToCandidate(song, defaults = {}) {
  return normalizeMusicCandidate({
    provider: LOCAL_MUSIC_PROVIDER,
    songId: song?.songId || song?.id,
    url: song?.url || localMusicFileUrl(song?.songId || song?.id),
    title: song?.title || song?.name || song?.fileName,
    artist: song?.artist || song?.artistName,
    album: song?.album || song?.albumName,
    artworkUrl: song?.artworkUrl,
    durationMs: song?.durationMs,
    query: defaults.query,
    requestedBy: defaults.requestedBy
  });
}

async function searchLocalMusicSongs(query, settings) {
  const term = asText(query);
  if (!term) throw new Error('Local music song query is empty.');
  const response = await fetch(LOCAL_MUSIC_SEARCH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      ...settings,
      provider: LOCAL_MUSIC_PROVIDER,
      query: term,
      limit: settings.searchLimit || DEFAULT_SEARCH_LIMIT
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(asText(data?.message) || `Local music search failed (${response.status}).`);
  }
  const songs = Array.isArray(data?.candidates) ? data.candidates : [];
  return songs.map((song) => localMusicSongToCandidate(song, {
    query: term
  })).filter((song) => song.songId || song.url);
}

function ensureLocalAudio() {
  if (typeof window === 'undefined') {
    throw new Error('Local music playback is only available in the studio window.');
  }
  if (localAudio) return localAudio;

  localAudio = new Audio();
  localAudio.preload = 'auto';
  localAudio.addEventListener('ended', () => {
    const settings = readRoomMusicSettings();
    if (settings.provider !== LOCAL_MUSIC_PROVIDER) return;
    playNextLocalMusic(settings).catch((error) => {
      publishMusicDebug('music-error', {
        action: 'auto-next',
        provider: LOCAL_MUSIC_PROVIDER,
        message: musicErrorMessage(error)
      }, LOCAL_MUSIC_PROVIDER);
    });
  });
  localAudio.addEventListener('loadedmetadata', () => {
    const durationMs = Math.round(Number(localAudio.duration || 0) * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    const current = readLive2DMusicQueueState().current;
    if (!current || current.provider !== LOCAL_MUSIC_PROVIDER) return;
    updateLive2DMusicCurrent({ durationMs });
  });
  localAudio.addEventListener('error', () => {
    const code = localAudio?.error?.code || 0;
    publishMusicDebug('music-error', {
      action: 'local-audio',
      provider: LOCAL_MUSIC_PROVIDER,
      message: `Local audio playback failed${code ? ` (${code})` : ''}.`
    }, LOCAL_MUSIC_PROVIDER);
  });
  return localAudio;
}

function clearPlaybackTimer() {
  if (!playbackTimer || typeof window === 'undefined') return;
  window.clearTimeout(playbackTimer);
  playbackTimer = 0;
}

function schedulePlaybackTimer(settings) {
  clearPlaybackTimer();
  if (typeof window === 'undefined') return;
  const state = readLive2DMusicQueueState();
  const current = state.current;
  if (!current || current.status !== 'playing') return;
  const durationMs = current.durationMs || 240000;
  const elapsedMs = Math.max(0, Date.now() - (current.startedAt || Date.now()) - (current.elapsedPausedMs || 0));
  const delayMs = Math.max(15000, durationMs - elapsedMs + 1200);
  const playbackToken = current.playbackToken;
  playbackTimer = window.setTimeout(() => {
    const latest = readLive2DMusicQueueState().current;
    if (!latest || latest.playbackToken !== playbackToken || latest.status !== 'playing') return;
    playNextAppleMusic(settings).catch((error) => {
      publishMusicDebug('music-error', {
        action: 'auto-next',
        message: musicErrorMessage(error)
      });
    });
  }, Math.min(delayMs, 4 * 60 * 60 * 1000));
}

async function playAppleMusicCandidate(candidate, music, settings) {
  const normalizedCandidate = normalizeMusicCandidate(candidate, {
    provider: 'apple-music',
    storefront: settings.storefront
  });

  publishMusicDebug('music-play-request', {
    action: 'play',
    query: normalizedCandidate.query,
    songId: normalizedCandidate.songId,
    url: normalizedCandidate.url,
    storefront: normalizedCandidate.storefront || settings.storefront
  });

  if (normalizedCandidate.url) {
    await music.setQueue({ url: normalizedCandidate.url, startPlaying: false });
  } else {
    await music.setQueue({ song: normalizedCandidate.songId, startPlaying: false });
  }
  await music.play();

  const state = setLive2DMusicCurrent(normalizedCandidate, {
    status: 'playing',
    startedAt: Date.now()
  });
  addLive2DMusicHistory(normalizedCandidate, { settings, state });
  schedulePlaybackTimer(settings);

  return {
    status: 'playing',
    provider: 'apple-music',
    songId: normalizedCandidate.songId,
    queueId: normalizedCandidate.uid,
    title: [normalizedCandidate.title, normalizedCandidate.artist].filter(Boolean).join(' - ') ||
      normalizedCandidate.songId ||
      normalizedCandidate.url,
    storefront: settings.storefront,
    current: normalizedCandidate,
    queueLength: state.queue.length
  };
}

async function playNextAppleMusic(settings) {
  const { music, settings: normalizedSettings } = await configureAppleMusic(settings);
  await ensureAuthorized(music, normalizedSettings);
  const { candidate, state } = dequeueNextLive2DMusicCandidate();
  if (!candidate) {
    clearPlaybackTimer();
    clearLive2DMusicCurrent(state);
    return { status: 'ended', provider: 'apple-music', queueLength: 0 };
  }
  return playAppleMusicCandidate(candidate, music, normalizedSettings);
}

function pickKnownMusicCandidate(command, settings) {
  const state = readLive2DMusicQueueState();
  const provider = asText(settings.provider) || APPLE_MUSIC_PROVIDER;
  const known = [...state.favorites, ...state.history].filter((item) => (
    !item.provider || item.provider === provider
  ));
  if (!known.length || !command.query) return null;
  return pickLive2DMusicCandidate(command.query, known, settings).candidate;
}

async function resolveAppleMusicCandidate(command, settings, userToken = '') {
  if (command.songId || command.url) {
    return normalizeMusicCandidate({
      provider: 'apple-music',
      songId: command.songId,
      url: command.url,
      title: command.songId || command.url,
      query: command.query,
      storefront: command.storefront || settings.storefront,
      requestedBy: command.requestedBy
    });
  }

  const known = pickKnownMusicCandidate(command, settings);
  if (known) {
    return normalizeMusicCandidate({
      ...known,
      query: command.query,
      requestedBy: command.requestedBy,
      requestedAt: Date.now()
    });
  }

  const candidates = await searchAppleMusicSongs(command.query, settings, userToken);
  const picked = pickLive2DMusicCandidate(command.query, candidates, settings);
  if (!picked.candidate) throw new Error(`Apple Music did not find a song for "${command.query}".`);
  publishMusicDebug('music-search-selected', {
    action: command.action,
    query: command.query,
    selected: picked.candidate.title,
    artist: picked.candidate.artist,
    candidates: picked.scored.length,
    reason: picked.scored[0]?.reason
  });
  return normalizeMusicCandidate({
    ...picked.candidate,
    requestedBy: command.requestedBy,
    requestedAt: Date.now()
  });
}

async function requestAppleMusic(command, settings) {
  const { music, settings: normalizedSettings } = await configureAppleMusic(settings);
  const userToken = await ensureAuthorized(music, normalizedSettings);
  const candidate = await resolveAppleMusicCandidate(command, normalizedSettings, userToken);
  let state = readLive2DMusicQueueState();
  if (state.current?.status === 'playing' && !playbackTimer) {
    state = clearLive2DMusicCurrent(state);
  }
  const mode = command.action === 'play_next' ? 'next' : command.action === 'play_now' ? 'immediate' : 'append';

  if (mode === 'immediate') {
    return playAppleMusicCandidate(candidate, music, normalizedSettings);
  }

  const enqueueResult = enqueueLive2DMusicCandidate(candidate, {
    mode,
    settings: normalizedSettings,
    state
  });

  if (enqueueResult.status === 'duplicate') {
    publishMusicDebug('music-duplicate', {
      action: command.action,
      query: command.query,
      title: candidate.title,
      reason: enqueueResult.reason
    });
    return {
      status: 'duplicate',
      provider: 'apple-music',
      title: [candidate.title, candidate.artist].filter(Boolean).join(' - ') || candidate.songId,
      songId: candidate.songId,
      reason: enqueueResult.reason,
      queueLength: enqueueResult.state.queue.length
    };
  }

  if (enqueueResult.status === 'full') {
    return {
      status: 'queue-full',
      provider: 'apple-music',
      title: [candidate.title, candidate.artist].filter(Boolean).join(' - ') || candidate.songId,
      queueLength: enqueueResult.state.queue.length
    };
  }

  if (normalizedSettings.autoPlayRequests && !enqueueResult.state.current) {
    return playNextAppleMusic(normalizedSettings);
  }

  const waitMs = estimateLive2DMusicWaitMs(candidate, enqueueResult.state);
  return {
    status: 'queued',
    provider: 'apple-music',
    title: [candidate.title, candidate.artist].filter(Boolean).join(' - ') || candidate.songId,
    songId: candidate.songId,
    queueId: candidate.uid,
    position: enqueueResult.position,
    waitMs,
    waitLabel: formatLive2DMusicWait(waitMs),
    queueLength: enqueueResult.state.queue.length
  };
}

async function playLocalMusicCandidate(candidate, settings) {
  const sourceCandidate = normalizeMusicCandidate(candidate, {
    provider: LOCAL_MUSIC_PROVIDER
  });
  const normalizedCandidate = normalizeMusicCandidate({
    ...sourceCandidate,
    provider: LOCAL_MUSIC_PROVIDER,
    url: sourceCandidate.url || localMusicFileUrl(sourceCandidate.songId)
  });
  if (!normalizedCandidate.url) {
    throw new Error('Local music candidate has no playable file URL.');
  }

  publishMusicDebug('music-play-request', {
    action: 'play',
    provider: LOCAL_MUSIC_PROVIDER,
    query: normalizedCandidate.query,
    songId: normalizedCandidate.songId,
    url: normalizedCandidate.url
  }, LOCAL_MUSIC_PROVIDER);

  const audio = ensureLocalAudio();
  audio.pause();
  audio.src = normalizedCandidate.url;
  audio.currentTime = 0;
  await audio.play();

  const state = setLive2DMusicCurrent(normalizedCandidate, {
    status: 'playing',
    startedAt: Date.now()
  });
  addLive2DMusicHistory(normalizedCandidate, { settings, state });

  return {
    status: 'playing',
    provider: LOCAL_MUSIC_PROVIDER,
    songId: normalizedCandidate.songId,
    queueId: normalizedCandidate.uid,
    title: [normalizedCandidate.title, normalizedCandidate.artist].filter(Boolean).join(' - ') ||
      normalizedCandidate.songId ||
      normalizedCandidate.url,
    current: normalizedCandidate,
    queueLength: state.queue.length
  };
}

async function playNextLocalMusic(settings) {
  const { candidate, state } = dequeueNextLive2DMusicCandidate();
  if (!candidate) {
    if (localAudio) {
      localAudio.pause();
      localAudio.removeAttribute('src');
      localAudio.load?.();
    }
    clearLive2DMusicCurrent(state);
    return { status: 'ended', provider: LOCAL_MUSIC_PROVIDER, queueLength: 0 };
  }
  return playLocalMusicCandidate(candidate, settings);
}

async function resolveLocalMusicCandidate(command, settings) {
  if (command.songId || command.url) {
    return normalizeMusicCandidate({
      provider: LOCAL_MUSIC_PROVIDER,
      songId: command.songId,
      url: command.url || localMusicFileUrl(command.songId),
      title: command.query || command.songId || command.url,
      query: command.query,
      requestedBy: command.requestedBy
    });
  }

  const known = pickKnownMusicCandidate(command, settings);
  if (known) {
    return normalizeMusicCandidate({
      ...known,
      provider: LOCAL_MUSIC_PROVIDER,
      url: known.url || localMusicFileUrl(known.songId),
      query: command.query,
      requestedBy: command.requestedBy,
      requestedAt: Date.now()
    });
  }

  const candidates = await searchLocalMusicSongs(command.query, settings);
  const picked = pickLive2DMusicCandidate(command.query, candidates, settings);
  if (!picked.candidate) {
    throw new Error(`Local music library did not find a song for "${command.query}". Add folders in Studio Settings > Music > Local Library Paths.`);
  }
  publishMusicDebug('music-search-selected', {
    action: command.action,
    provider: LOCAL_MUSIC_PROVIDER,
    query: command.query,
    selected: picked.candidate.title,
    artist: picked.candidate.artist,
    candidates: picked.scored.length,
    reason: picked.scored[0]?.reason
  }, LOCAL_MUSIC_PROVIDER);
  return normalizeMusicCandidate({
    ...picked.candidate,
    provider: LOCAL_MUSIC_PROVIDER,
    url: picked.candidate.url || localMusicFileUrl(picked.candidate.songId),
    requestedBy: command.requestedBy,
    requestedAt: Date.now()
  });
}

async function requestLocalMusic(command, settings) {
  const candidate = await resolveLocalMusicCandidate(command, settings);
  let state = readLive2DMusicQueueState();
  if (state.current?.status === 'playing' && (!localAudio || !localAudio.src || localAudio.paused)) {
    state = clearLive2DMusicCurrent(state);
  }
  const mode = command.action === 'play_next' ? 'next' : command.action === 'play_now' ? 'immediate' : 'append';

  if (mode === 'immediate') {
    return playLocalMusicCandidate(candidate, settings);
  }

  const enqueueResult = enqueueLive2DMusicCandidate(candidate, {
    mode,
    settings,
    state
  });

  if (enqueueResult.status === 'duplicate') {
    publishMusicDebug('music-duplicate', {
      action: command.action,
      provider: LOCAL_MUSIC_PROVIDER,
      query: command.query,
      title: candidate.title,
      reason: enqueueResult.reason
    }, LOCAL_MUSIC_PROVIDER);
    return {
      status: 'duplicate',
      provider: LOCAL_MUSIC_PROVIDER,
      title: [candidate.title, candidate.artist].filter(Boolean).join(' - ') || candidate.songId,
      songId: candidate.songId,
      reason: enqueueResult.reason,
      queueLength: enqueueResult.state.queue.length
    };
  }

  if (enqueueResult.status === 'full') {
    return {
      status: 'queue-full',
      provider: LOCAL_MUSIC_PROVIDER,
      title: [candidate.title, candidate.artist].filter(Boolean).join(' - ') || candidate.songId,
      queueLength: enqueueResult.state.queue.length
    };
  }

  if (settings.autoPlayRequests && !enqueueResult.state.current) {
    return playNextLocalMusic(settings);
  }

  const waitMs = estimateLive2DMusicWaitMs(candidate, enqueueResult.state);
  return {
    status: 'queued',
    provider: LOCAL_MUSIC_PROVIDER,
    title: [candidate.title, candidate.artist].filter(Boolean).join(' - ') || candidate.songId,
    songId: candidate.songId,
    queueId: candidate.uid,
    position: enqueueResult.position,
    waitMs,
    waitLabel: formatLive2DMusicWait(waitMs),
    queueLength: enqueueResult.state.queue.length
  };
}

export async function authorizeLive2DMusic(settings = readRoomMusicSettings()) {
  const { music, settings: normalizedSettings } = await configureAppleMusic(settings);
  const token = await music.authorize();
  if (!token) throw new Error('Apple Music authorization did not return a user token.');
  const saved = writeRoomMusicSettings({ ...normalizedSettings, musicUserToken: token });
  publishMusicDebug('music-authorized', { action: 'authorize', musicUserToken: token });
  return saved;
}

export async function unauthorizeLive2DMusic(settings = readRoomMusicSettings()) {
  const { music, settings: normalizedSettings } = await configureAppleMusic(settings);
  await music.unauthorize?.();
  const saved = writeRoomMusicSettings({ ...normalizedSettings, musicUserToken: '' });
  music.musicUserToken = '';
  publishMusicDebug('music-unauthorized', { action: 'unauthorize' });
  return saved;
}

export async function executeLive2DMusicCommand(rawCommand, settings = readRoomMusicSettings()) {
  const command = normalizeLive2DMusicCommand(rawCommand);
  if (!command) return null;

  const normalizedSettings = normalizeRoomMusicSettings({
    ...settings,
    storefront: command.storefront || settings.storefront
  });
  const provider = normalizedSettings.provider || LOCAL_MUSIC_PROVIDER;
  if (!normalizedSettings.enabled && command.action !== 'authorize' && !STATE_ONLY_ACTIONS.has(command.action)) {
    publishMusicDebug('music-disabled', { action: command.action, query: command.query, provider }, provider);
    return { status: 'disabled', provider };
  }

  try {
    if (provider === LOCAL_MUSIC_PROVIDER) {
      if (command.action === 'authorize') {
        return { status: 'ready', provider: LOCAL_MUSIC_PROVIDER, settings: normalizedSettings };
      }
      if (command.action === 'queue') {
        return { status: 'queue', provider: LOCAL_MUSIC_PROVIDER, state: getLive2DMusicPublicState() };
      }
      if (command.action === 'clear') {
        const state = clearLive2DMusicQueue();
        return { status: 'cleared', provider: LOCAL_MUSIC_PROVIDER, queueLength: state.queue.length };
      }
      if (command.action === 'remove') {
        const state = removeLive2DMusicQueueItem(command.removeId || command.songId);
        return { status: 'removed', provider: LOCAL_MUSIC_PROVIDER, queueLength: state.queue.length };
      }

      const audio = ensureLocalAudio();
      if (command.action === 'pause') {
        audio.pause();
        const current = readLive2DMusicQueueState().current;
        if (current) updateLive2DMusicCurrent({ status: 'paused', pausedAt: Date.now() });
        publishMusicDebug('music-paused', { action: 'pause', provider }, provider);
        return { status: 'paused', provider: LOCAL_MUSIC_PROVIDER };
      }
      if (command.action === 'resume') {
        const current = readLive2DMusicQueueState().current;
        if (!current) return playNextLocalMusic(normalizedSettings);
        if (!audio.src && current.url) audio.src = current.url;
        await audio.play();
        const pausedAt = Number(current.pausedAt) || Date.now();
        updateLive2DMusicCurrent({
          status: 'playing',
          pausedAt: 0,
          elapsedPausedMs: (Number(current.elapsedPausedMs) || 0) + Math.max(0, Date.now() - pausedAt)
        });
        publishMusicDebug('music-resumed', { action: 'resume', provider }, provider);
        return { status: 'resumed', provider: LOCAL_MUSIC_PROVIDER };
      }
      if (command.action === 'stop') {
        audio.pause();
        audio.removeAttribute('src');
        audio.load?.();
        clearLive2DMusicCurrent();
        publishMusicDebug('music-stopped', { action: 'stop', provider }, provider);
        return { status: 'stopped', provider: LOCAL_MUSIC_PROVIDER };
      }
      if (command.action === 'skip') {
        audio.pause();
        return await playNextLocalMusic(normalizedSettings);
      }

      return await requestLocalMusic(command, normalizedSettings);
    }

    if (command.action === 'authorize') {
      const saved = await authorizeLive2DMusic(normalizedSettings);
      return { status: 'authorized', provider: APPLE_MUSIC_PROVIDER, settings: saved };
    }

    if (command.action === 'queue') {
      return { status: 'queue', provider: APPLE_MUSIC_PROVIDER, state: getLive2DMusicPublicState() };
    }
    if (command.action === 'clear') {
      const state = clearLive2DMusicQueue();
      return { status: 'cleared', provider: APPLE_MUSIC_PROVIDER, queueLength: state.queue.length };
    }
    if (command.action === 'remove') {
      const state = removeLive2DMusicQueueItem(command.removeId || command.songId);
      return { status: 'removed', provider: APPLE_MUSIC_PROVIDER, queueLength: state.queue.length };
    }

    const { music } = await configureAppleMusic(normalizedSettings);
    if (command.action === 'pause') {
      await music.pause?.();
      clearPlaybackTimer();
      const current = readLive2DMusicQueueState().current;
      if (current) updateLive2DMusicCurrent({ status: 'paused', pausedAt: Date.now() });
      publishMusicDebug('music-paused', { action: 'pause' });
      return { status: 'paused', provider: APPLE_MUSIC_PROVIDER };
    }
    if (command.action === 'resume') {
      await ensureAuthorized(music, normalizedSettings);
      await music.play();
      const current = readLive2DMusicQueueState().current;
      if (current) {
        const pausedAt = Number(current.pausedAt) || Date.now();
        updateLive2DMusicCurrent({
          status: 'playing',
          pausedAt: 0,
          elapsedPausedMs: (Number(current.elapsedPausedMs) || 0) + Math.max(0, Date.now() - pausedAt)
        });
        schedulePlaybackTimer(normalizedSettings);
      }
      publishMusicDebug('music-resumed', { action: 'resume' });
      return { status: 'resumed', provider: APPLE_MUSIC_PROVIDER };
    }
    if (command.action === 'stop') {
      if (typeof music.stop === 'function') await music.stop();
      else await music.pause?.();
      clearPlaybackTimer();
      clearLive2DMusicCurrent();
      publishMusicDebug('music-stopped', { action: 'stop' });
      return { status: 'stopped', provider: APPLE_MUSIC_PROVIDER };
    }
    if (command.action === 'skip') {
      clearPlaybackTimer();
      if (typeof music.stop === 'function') await music.stop();
      else await music.pause?.();
      return await playNextAppleMusic(normalizedSettings);
    }

    return await requestAppleMusic(command, normalizedSettings);
  } catch (error) {
    const message = musicErrorMessage(error);
    publishMusicDebug('music-error', {
      action: command.action,
      query: command.query,
      provider,
      message
    }, provider);
    throw new Error(message);
  }
}
