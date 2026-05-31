import {
  normalizeRoomMusicSettings,
  readRoomMusicSettings,
  writeRoomMusicSettings
} from './roomSettings';
import { appendRoomLive2DDebugEvent } from './live2dDebug';

const MUSIC_KIT_SCRIPT_ID = 'yachiyo-musickit-js';
const MUSIC_KIT_SCRIPT_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
const DEFAULT_SEARCH_LIMIT = 1;
const PLAYABLE_ACTIONS = new Set(['play', 'pause', 'resume', 'stop', 'authorize']);

let musicKitScriptPromise = null;
let musicKitConfigurePromise = null;
let musicKitConfigureKey = '';

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
  const action = asText(value).toLowerCase().replace(/[^a-z_-]/g, '');
  if (action === 'start') return 'play';
  if (action === 'continue') return 'resume';
  if (action === 'halt') return 'stop';
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

  if (action === 'play' && !query && !songId && !url) return null;

  return compactObject({
    action,
    query,
    songId,
    url,
    storefront
  });
}

function musicErrorMessage(error, fallback = 'Apple Music failed') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  const dataError = Array.isArray(error?.data?.errors) ? error.data.errors[0] : null;
  const apiError = Array.isArray(error?.errors) ? error.errors[0] : null;
  return asText(dataError?.detail || dataError?.title || apiError?.detail || apiError?.title || error.message) || fallback;
}

function publishMusicDebug(type, detail = {}) {
  appendRoomLive2DDebugEvent(type, {
    source: 'apple-music',
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

function songLabel(song) {
  const attributes = song?.attributes || {};
  return [attributes.name, attributes.artistName].filter(Boolean).join(' - ') || song?.id || 'Apple Music song';
}

async function searchAppleMusicSong(query, settings, userToken = '') {
  const term = asText(query);
  if (!term) throw new Error('Apple Music song query is empty.');

  const storefront = normalizeStorefront(settings.storefront, 'cn');
  const params = new URLSearchParams({
    term,
    types: 'songs',
    limit: String(DEFAULT_SEARCH_LIMIT)
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
  const song = data?.results?.songs?.data?.[0] || null;
  if (!song?.id) throw new Error(`Apple Music did not find a song for "${term}".`);
  return song;
}

async function playAppleMusic(command, settings) {
  const { music, settings: normalizedSettings } = await configureAppleMusic(settings);
  const userToken = await ensureAuthorized(music, normalizedSettings);
  const playback = {
    command,
    song: null,
    id: command.songId || '',
    url: command.url || ''
  };

  if (!playback.id && !playback.url) {
    playback.song = await searchAppleMusicSong(command.query, normalizedSettings, userToken);
    playback.id = playback.song.id;
  }

  publishMusicDebug('music-play-request', {
    action: 'play',
    query: command.query,
    songId: playback.id,
    url: playback.url,
    storefront: command.storefront || normalizedSettings.storefront
  });

  if (playback.url) {
    await music.setQueue({ url: playback.url, startPlaying: false });
  } else {
    await music.setQueue({ song: playback.id, startPlaying: false });
  }
  await music.play();

  return {
    status: 'playing',
    provider: 'apple-music',
    songId: playback.id,
    title: playback.song ? songLabel(playback.song) : playback.id,
    storefront: normalizedSettings.storefront
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
  if (!normalizedSettings.enabled && command.action !== 'authorize') {
    publishMusicDebug('music-disabled', { action: command.action, query: command.query });
    return { status: 'disabled', provider: 'apple-music' };
  }

  try {
    if (command.action === 'authorize') {
      const saved = await authorizeLive2DMusic(normalizedSettings);
      return { status: 'authorized', provider: 'apple-music', settings: saved };
    }

    const { music } = await configureAppleMusic(normalizedSettings);
    if (command.action === 'pause') {
      await music.pause?.();
      publishMusicDebug('music-paused', { action: 'pause' });
      return { status: 'paused', provider: 'apple-music' };
    }
    if (command.action === 'resume') {
      await ensureAuthorized(music, normalizedSettings);
      await music.play();
      publishMusicDebug('music-resumed', { action: 'resume' });
      return { status: 'playing', provider: 'apple-music' };
    }
    if (command.action === 'stop') {
      if (typeof music.stop === 'function') await music.stop();
      else await music.pause?.();
      publishMusicDebug('music-stopped', { action: 'stop' });
      return { status: 'stopped', provider: 'apple-music' };
    }

    return await playAppleMusic(command, normalizedSettings);
  } catch (error) {
    const message = musicErrorMessage(error);
    publishMusicDebug('music-error', {
      action: command.action,
      query: command.query,
      message
    });
    throw new Error(message);
  }
}
