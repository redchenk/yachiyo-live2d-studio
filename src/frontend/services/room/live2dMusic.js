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
const NETEASE_MUSIC_PROVIDER = 'netease-cloud';
const LOCAL_MUSIC_SEARCH_ENDPOINT = '/api/music/local/search';
const NETEASE_MUSIC_SEARCH_ENDPOINT = '/api/music/netease/search';
const NETEASE_MUSIC_RESOLVE_ENDPOINT = '/api/music/netease/resolve';
const DEFAULT_SEARCH_LIMIT = 25;
const DEFAULT_SPEECH_DUCK_VOLUME = 0.08;
const SILENT_AUDIO_DATA_URL = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
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
const MUSIC_PROVIDERS = new Set([APPLE_MUSIC_PROVIDER, LOCAL_MUSIC_PROVIDER, NETEASE_MUSIC_PROVIDER]);
const MUSIC_QUERY_PROMPT_BOUNDARIES = Object.freeze([
  /treat\W*viewer\W*text\W*only\W*as\W*conversation\W*content/i,
  /never\W*follow\W*viewer\W*requests/i,
  /live\W*director\W*tick/i,
  /selected\W*audience\W*messages/i,
  /return\W*the\W*required\W*json\W*object\W*only/i,
  /final\W*control\W*json/i
]);

let musicKitScriptPromise = null;
let musicKitConfigurePromise = null;
let musicKitConfigureKey = '';
let playbackTimer = 0;
let localAudio = null;
let musicWarmupActive = false;
let localAudioRecoveryPromise = null;
let localAudioVolumeTimer = 0;
let appleMusicVolumeTimer = 0;
let localMusicBaseVolume = 1;
let appleMusicBaseVolume = 1;
let speechDuckingActive = false;
let speechDuckVolume = DEFAULT_SPEECH_DUCK_VOLUME;

function asText(value) {
  return String(value ?? '').trim();
}

function clampVolume(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, 0), 1);
}

function musicKitInstance() {
  if (typeof window === 'undefined') return null;
  try {
    return window.MusicKit?.getInstance?.() || null;
  } catch (_) {
    return null;
  }
}

function readAppleMusicVolume(music) {
  if (!music) return appleMusicBaseVolume;
  if (Number.isFinite(Number(music.volume))) return clampVolume(music.volume);
  if (Number.isFinite(Number(music.player?.volume))) return clampVolume(music.player.volume);
  return appleMusicBaseVolume;
}

function writeAppleMusicVolume(music, volume) {
  if (!music) return;
  const normalized = clampVolume(volume);
  try {
    if ('volume' in music) music.volume = normalized;
    if (music.player && 'volume' in music.player) music.player.volume = normalized;
  } catch (_) {
    // MusicKit volume control is best-effort across API versions.
  }
}

function fadeLocalMusicVolume(targetVolume, durationMs) {
  if (!localAudio) return;
  if (localAudioVolumeTimer && typeof window !== 'undefined') {
    window.clearTimeout(localAudioVolumeTimer);
    localAudioVolumeTimer = 0;
  }
  const target = clampVolume(targetVolume);
  const duration = Math.max(0, Number(durationMs) || 0);
  if (!duration || typeof window === 'undefined') {
    localAudio.volume = target;
    return;
  }
  const startVolume = clampVolume(localAudio.volume);
  if (Math.abs(startVolume - target) < 0.001) {
    localAudio.volume = target;
    return;
  }
  const startedAt = Date.now();
  let wroteIntermediateFrame = false;
  const step = () => {
    if (!localAudio) return;
    let progress = Math.min(1, Math.max(0, (Date.now() - startedAt) / duration));
    if (progress >= 1 && duration > 16 && !wroteIntermediateFrame) {
      progress = 0.5;
    }
    const eased = progress * progress * (3 - 2 * progress);
    localAudio.volume = progress >= 1
      ? target
      : clampVolume(startVolume + (target - startVolume) * eased);
    if (progress > 0 && progress < 1) wroteIntermediateFrame = true;
    if (progress < 1) {
      localAudioVolumeTimer = window.setTimeout(step, 16);
    } else {
      localAudioVolumeTimer = 0;
    }
  };
  localAudio.volume = startVolume;
  localAudioVolumeTimer = window.setTimeout(step, 16);
}

function fadeAppleMusicVolume(music, targetVolume, durationMs) {
  if (appleMusicVolumeTimer && typeof window !== 'undefined') {
    window.clearTimeout(appleMusicVolumeTimer);
    appleMusicVolumeTimer = 0;
  }
  if (!music) return;
  const target = clampVolume(targetVolume);
  const duration = Math.max(0, Number(durationMs) || 0);
  if (!duration || typeof window === 'undefined') {
    writeAppleMusicVolume(music, target);
    return;
  }
  const startVolume = readAppleMusicVolume(music);
  if (Math.abs(startVolume - target) < 0.001) {
    writeAppleMusicVolume(music, target);
    return;
  }
  const startedAt = Date.now();
  let wroteIntermediateFrame = false;
  const step = () => {
    let progress = Math.min(1, Math.max(0, (Date.now() - startedAt) / duration));
    if (progress >= 1 && duration > 16 && !wroteIntermediateFrame) {
      progress = 0.5;
    }
    const eased = progress * progress * (3 - 2 * progress);
    writeAppleMusicVolume(
      music,
      progress >= 1 ? target : startVolume + (target - startVolume) * eased
    );
    if (progress > 0 && progress < 1) wroteIntermediateFrame = true;
    if (progress < 1) {
      appleMusicVolumeTimer = window.setTimeout(step, 16);
    } else {
      appleMusicVolumeTimer = 0;
    }
  };
  writeAppleMusicVolume(music, startVolume);
  appleMusicVolumeTimer = window.setTimeout(step, 16);
}

export function setLive2DMusicSpeechDucking(active, options = {}) {
  const nextActive = Boolean(active);
  const requestedDuckVolume = clampVolume(
    options.duckVolume,
    DEFAULT_SPEECH_DUCK_VOLUME
  );
  const requestedFadeMs = Number(options.fadeMs);
  const fadeMs = Number.isFinite(requestedFadeMs)
    ? Math.max(0, requestedFadeMs)
    : (nextActive ? 220 : 620);

  if (nextActive && !speechDuckingActive) {
    if (localAudio && !localAudioVolumeTimer) {
      localMusicBaseVolume = clampVolume(localAudio.volume, localMusicBaseVolume);
    }
    const music = musicKitInstance();
    if (music && !appleMusicVolumeTimer) {
      appleMusicBaseVolume = readAppleMusicVolume(music);
    }
  }
  speechDuckingActive = nextActive;
  speechDuckVolume = requestedDuckVolume;

  const localTarget = nextActive
    ? Math.min(localMusicBaseVolume, speechDuckVolume)
    : localMusicBaseVolume;
  fadeLocalMusicVolume(localTarget, fadeMs);

  const music = musicKitInstance();
  if (music) {
    const appleTarget = nextActive
      ? Math.min(appleMusicBaseVolume, speechDuckVolume)
      : appleMusicBaseVolume;
    fadeAppleMusicVolume(music, appleTarget, fadeMs);
  } else if (appleMusicVolumeTimer && typeof window !== 'undefined') {
    window.clearTimeout(appleMusicVolumeTimer);
    appleMusicVolumeTimer = 0;
  }

  return {
    active: speechDuckingActive,
    duckVolume: speechDuckVolume,
    targetVolume: localTarget
  };
}

export function syncLive2DMusicSpeechDucking(status, options = {}) {
  return setLive2DMusicSpeechDucking(
    String(status || '').trim().toLowerCase() === 'playing',
    options
  );
}

export function sanitizeLive2DMusicQuery(value) {
  let query = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!query) return '';

  let boundaryIndex = query.length;
  for (const pattern of MUSIC_QUERY_PROMPT_BOUNDARIES) {
    const match = pattern.exec(query);
    if (match && match.index < boundaryIndex) boundaryIndex = match.index;
  }
  if (boundaryIndex < query.length) {
    query = query
      .slice(0, boundaryIndex)
      .replace(/[\s"'`\\}\])>:;,]+$/g, '')
      .trim();
  }

  if (query.length > 180) {
    query = query.slice(0, 180).replace(/\s+\S*$/g, '').trim();
  }
  if (!query || !/[\p{L}\p{N}]/u.test(query)) return '';
  return query;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
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

function textList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      return firstText(item?.name, item?.artistName, item?.title, item?.text);
    }).map(asText).filter(Boolean).join(' ');
  }
  return asText(value);
}

function normalizeMusicAction(value) {
  const rawAction = asText(value).toLowerCase();
  if (/清空|清除|clear/.test(rawAction)) return 'clear';
  if (/队列|歌单|列表|状态|queue|list|status/.test(rawAction)) return 'queue';
  if (/删除|移除|remove|delete/.test(rawAction)) return 'remove';
  if (/暂停|停一下|pause/.test(rawAction)) return 'pause';
  if (/继续|恢复|接着|resume|continue/.test(rawAction)) return 'resume';
  if (/停止|别放|stop|halt/.test(rawAction)) return 'stop';
  if (/切歌|跳过|下一曲|skip|next_track/.test(rawAction)) return 'skip';
  if (/下一首|下首|插队|优先|play_next|playnext|next_song/.test(rawAction)) return 'play_next';
  if (/马上|立刻|立即|现在播放|播放|放歌|播一下|给我放|play_now|playnow|immediate|cut_in/.test(rawAction)) return 'play_now';
  if (/点歌|来一首|加歌|排歌|song_request|request_song|request|order|enqueue|append/.test(rawAction)) return 'request';
  if (/play|start/.test(rawAction)) return 'play';

  const action = rawAction.replace(/[^a-z0-9_-]/g, '');
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

function normalizeMusicProvider(value, fallback = '') {
  const rawProvider = asText(value).toLowerCase();
  if (!rawProvider) return fallback;
  if (/网易|網易|netease|163|cloud\s*music|ncm/.test(rawProvider)) return NETEASE_MUSIC_PROVIDER;
  if (/本地|local|library|file|folder/.test(rawProvider)) return LOCAL_MUSIC_PROVIDER;
  if (/apple|music\s*kit|itunes/.test(rawProvider)) return APPLE_MUSIC_PROVIDER;
  const provider = rawProvider.replace(/[^a-z0-9_-]/g, '');
  return MUSIC_PROVIDERS.has(provider) ? provider : fallback;
}

function compactMusicIntentText(value) {
  return asText(value).replace(/\s+/g, '');
}

function audienceMusicIntentText(value) {
  let text = asText(value)
    .normalize('NFKC')
    .replace(/^(?:\[(?:SC|醒目留言|礼物|gift)[^\]]*\]\s*)+/giu, '')
    .replace(/^@\S+\s+/u, '')
    .trim();
  const labeledMessage = text.match(/^([^:：\n]{1,48})[:：]\s*(.+)$/u);
  if (labeledMessage) {
    const label = labeledMessage[1];
    const message = labeledMessage[2];
    const intentPattern = /点歌|点一首|点首|想点|来一首|来首|唱一首|唱首|播放|放一首|放首|想听|要听|听一首|听首|加歌|排歌|play|queue|request|song/iu;
    if (!intentPattern.test(label) && intentPattern.test(message)) text = message;
  }
  return text.trim();
}

function cleanInferredMusicQuery(value) {
  let query = compactMusicIntentText(value)
    .replace(/^[\uff0c,\uff1a:\-—]+/u, '')
    .replace(/[\uff0c,.\u3002\uff01!\uff1f?\uff1b;\uff1a:].*$/u, '')
    .replace(/(?:\u8c22\u8c22|\u611f\u8c22|thanks?|thankyou)+$/iu, '')
    .replace(/(?:\u597d\u4e0d\u597d|\u53ef\u4ee5\u5417|\u884c\u4e0d\u884c)$/u, '')
    .replace(/[\u5427\u5566\u554a\u5440\u5462\u54e6\u561b\u5457\u5417\u4e48\u561b]+$/u, '')
    .replace(/^[\u300a\u300c\u300e"'\u201c\u2018]+/u, '')
    .replace(/[\u300b\u300d\u300f"'\u201d\u2019]+$/u, '')
    .replace(/^(?:\u4e00\u9996|\u9996|\u4e00\u4e0b|\u70b9|\u70b9\u513f|\u70b9\u4e00\u4e0b|\u6765\u70b9)/u, '')
    .replace(/(?:\u7684)?(?:\u8fd9\u9996|\u4e00\u9996)?(?:\u6b4c|\u6b4c\u66f2|\u97f3\u4e50|\u6b4c\u513f|\u66f2\u5b50)$/u, '')
    .replace(/\u7684$/u, '');
  query = asText(query);
  if (!query || /^(?:\u6b4c|\u6b4c\u66f2|\u97f3\u4e50|\u66f2\u5b50)$/u.test(query)) return '';
  if (/^(?:\u4f60|\u59b3)?(?:\u8bf4|\u8bb2|\u804a|\u89e3\u91ca|\u4ecb\u7ecd|\u544a\u8bc9|\u56de\u7b54|\u8bc4\u4ef7|\u5ff5)/u.test(query)) return '';
  return query;
}

export function inferLive2DMusicCommandFromText(rawText = '') {
  const sourceText = audienceMusicIntentText(rawText);
  const text = compactMusicIntentText(sourceText);
  if (!text) return null;

  const chinesePatterns = [
    {
      action: 'play_next',
      pattern: /^(?:(?:\u8bf7|\u9ebb\u70e6|\u62dc\u6258)?(?:\u628a)?)(?:\u4e0b\u4e00\u9996|\u4e0b\u9996|\u63d2\u961f|\u4f18\u5148)(?:\u64ad\u653e|\u64ad|\u653e)?(.+)$/u
    },
    {
      action: 'request',
      pattern: /^(?:\u968f\u4fbf|\u53ef\u4ee5|\u53ef\u4e0d\u53ef\u4ee5|\u80fd\u4e0d\u80fd|\u80fd\u5426|\u80fd|\u6c42|\u8bf7\u4f60?|\u9ebb\u70e6\u4f60?|\u62dc\u6258|\u5e2e\u6211|\u7ed9\u6211|\u6211\u60f3\u8981|\u6211\u60f3|\u6211\u8981|\u60f3\u8981|\u60f3|\u8981|\u6765|\u6574|\u9a6c\u4e0a|\u7acb\u523b|\u7acb\u5373|\u73b0\u5728)?(?:\u542c\u542c|\u542c\u4e00\u4e0b|\u542c\u4e00\u9996|\u542c\u9996|\u542c|\u64ad\u653e\u4e00\u4e0b|\u64ad\u653e|\u653e\u4e00\u4e0b|\u653e\u4e00\u9996|\u653e\u9996|\u653e\u4e2a|\u653e|\u5531\u4e00\u9996|\u5531\u9996|\u5531\u4e00\u4e0b|\u5531\u4e2a|\u5531|\u70b9\u6b4c|\u70b9\u4e00\u9996|\u70b9\u9996|\u70b9\u4e2a|\u70b9\u4e00\u4e0b|\u60f3\u70b9|\u6765\u4e00\u9996|\u6765\u9996|\u6765\u4e2a|\u6765\u70b9|\u6765\u4e9b|\u6574\u4e00\u9996|\u6c42\u4e00\u9996|\u52a0\u6b4c|\u6392\u6b4c)(.+)$/u
    }
  ];

  for (const { action, pattern } of chinesePatterns) {
    const match = text.match(pattern);
    const query = sanitizeLive2DMusicQuery(cleanInferredMusicQuery(match?.[1] || ''));
    if (query) {
      return {
        action,
        provider: NETEASE_MUSIC_PROVIDER,
        query
      };
    }
  }

  const englishMatch = sourceText.match(
    /^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?(?:play|queue|request|add)(?:\s+the\s+song)?\s+(.+?)\s*[?!.]*$/iu
  );
  const englishQuery = sanitizeLive2DMusicQuery(
    asText(englishMatch?.[1]).replace(/\s+by\s+/giu, ' ')
  );
  if (englishQuery) {
    return {
      action: 'request',
      provider: NETEASE_MUSIC_PROVIDER,
      query: englishQuery
    };
  }
  return null;
}

function compactMusicRequesterMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * Resolves an LLM music command back to trusted audience metadata.
 * requestIndex is preferred; query/intent matching is only a fallback.
 */
export function resolveLive2DMusicRequester(lines = [], rawCommand = null) {
  const audienceLines = Array.isArray(lines) ? lines : [];
  if (!audienceLines.length) return '';

  const command = rawCommand && typeof rawCommand === 'object' ? rawCommand : {};
  const requestedIndex = Math.round(Number(
    command.requestIndex ??
    command.request_index ??
    command.music?.requestIndex ??
    0
  ));
  if (requestedIndex >= 1 && requestedIndex <= audienceLines.length) {
    const indexedLine = audienceLines[requestedIndex - 1];
    return indexedLine?.userName || indexedLine?.userId || '';
  }

  const normalizedCommand = normalizeLive2DMusicCommand(rawCommand);
  const compactQuery = compactMusicRequesterMatchText(normalizedCommand?.query || '');
  const queryTerms = String(normalizedCommand?.query || '')
    .toLowerCase()
    .split(/[\s,，/·_-]+/u)
    .map(compactMusicRequesterMatchText)
    .filter((term) => term.length >= 2);
  const musicIntentPattern = /(?:点歌|点一首|来一首|加歌|排歌|播放|放歌|听歌|想听|我要听|music|song|play|listen|request|queue)/iu;

  const ranked = audienceLines
    .map((line, index) => {
      const text = String(line?.text || '');
      const compactText = compactMusicRequesterMatchText(text);
      let score = 0;
      if (inferLive2DMusicCommandFromText(text)) score += 40;
      if (musicIntentPattern.test(text)) score += 20;
      if (compactQuery && compactText.includes(compactQuery)) score += 100;
      for (const term of queryTerms) {
        if (compactText.includes(term)) score += 18;
      }
      return { line, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const best = ranked[0];
  if (!best || best.score <= 0) {
    if (!rawCommand || audienceLines.length !== 1) return '';
    const onlyLine = audienceLines[0];
    return onlyLine?.userName || onlyLine?.userId || '';
  }
  return best.line?.userName || best.line?.userId || '';
}

function musicQueryFromParts(source = {}, nested = {}) {
  const directQuery = firstText(
    source.query,
    source.keyword,
    source.keywords,
    source.search,
    source.text,
    source['查询'],
    source['关键词'],
    nested.query,
    nested.keyword,
    nested.keywords,
    nested.search,
    nested.text,
    nested['查询'],
    nested['关键词']
  );
  if (directQuery) return directQuery;

  const title = firstText(
    source.song,
    source.title,
    source.name,
    source.songName,
    source.track,
    source['歌曲'],
    source['歌名'],
    nested.song,
    nested.title,
    nested.name,
    nested.songName,
    nested.track,
    nested['歌曲'],
    nested['歌名']
  );
  const artist = firstText(
    textList(source.artist),
    textList(source.artistName),
    textList(source.singer),
    textList(source.singers),
    textList(source.artists),
    source.byArtist,
    source['歌手'],
    source['艺人'],
    textList(nested.artist),
    textList(nested.artistName),
    textList(nested.singer),
    textList(nested.singers),
    textList(nested.artists),
    nested.byArtist,
    nested['歌手'],
    nested['艺人']
  );
  return [title, artist].map(asText).filter(Boolean).join(' ');
}

export function normalizeLive2DMusicCommand(rawCommand = null) {
  if (!rawCommand) return null;

  const source = typeof rawCommand === 'string'
    ? { action: 'play', query: rawCommand }
    : (typeof rawCommand === 'object' ? rawCommand : null);
  if (!source) return null;

  const nested = source.music && typeof source.music === 'object' ? source.music : {};
  const rawTrack = [
    source.track,
    source.candidate,
    nested.track,
    nested.candidate
  ].find((value) => value && typeof value === 'object' && !Array.isArray(value)) || null;
  const action = normalizeMusicAction(
    source.action ||
    source.command ||
    source.type ||
    source.intent ||
    source['动作'] ||
    nested.action ||
    nested.command ||
    nested.type ||
    nested.intent ||
    nested['动作']
  );
  const requestedBy = firstText(
    source.requestedBy,
    source.by,
    source.user,
    source.viewer,
    nested.requestedBy,
    nested.by,
    nested.user,
    nested.viewer,
    rawTrack?.requestedBy
  );
  const songId = firstText(
    source.songId,
    source.catalogId,
    source.appleMusicId,
    source.id,
    nested.songId,
    nested.catalogId,
    nested.appleMusicId,
    nested.id,
    rawTrack?.songId,
    rawTrack?.id
  );
  const url = firstText(
    source.url,
    source.musicUrl,
    source.appleMusicUrl,
    nested.url,
    nested.musicUrl,
    nested.appleMusicUrl,
    rawTrack?.url
  );
  const provider = normalizeMusicProvider(
    firstText(
      source.provider,
      source.platform,
      source.service,
      source.source,
      source.engine,
      source['平台'],
      source['来源'],
      nested.provider,
      nested.platform,
      nested.service,
      nested.source,
      nested.engine,
      nested['平台'],
      nested['来源'],
      rawTrack?.provider,
      rawTrack?.source
    ),
    ''
  );
  const trackTitle = firstText(rawTrack?.title, rawTrack?.name);
  const trackArtist = firstText(rawTrack?.artist, rawTrack?.artistName, textList(rawTrack?.artists));
  const query = sanitizeLive2DMusicQuery(
    musicQueryFromParts(source, nested) ||
    [trackTitle, trackArtist].map(asText).filter(Boolean).join(' ')
  );
  const storefront = normalizeStorefront(source.storefront || source.storefrontId || nested.storefront || nested.storefrontId, '');
  const removeId = firstText(source.removeId, source.queueId, source.uid, nested.removeId, nested.queueId, nested.uid);
  const rawRequestIndex = source.requestIndex ??
    source.request_index ??
    nested.requestIndex ??
    nested.request_index;
  const requestIndex = Number.isFinite(Number(rawRequestIndex)) && Number(rawRequestIndex) > 0
    ? Math.round(Number(rawRequestIndex))
    : 0;
  const candidate = rawTrack
    ? normalizeMusicCandidate({
        provider,
        songId,
        url,
        title: trackTitle,
        artist: trackArtist,
        album: firstText(rawTrack.album, rawTrack.albumName),
        artworkUrl: firstText(rawTrack.artworkUrl, rawTrack.albumCoverUrl, rawTrack.coverUrl),
        durationMs: rawTrack.durationMs ?? rawTrack.duration,
        query,
        requestedBy
      })
    : null;

  if (['play', 'request', 'play_next', 'play_now'].includes(action) && !query && !songId && !url) return null;
  if (action === 'remove' && !removeId && !songId) return null;

  return compactObject({
    action,
    provider,
    query,
    songId,
    url,
    storefront,
    requestedBy,
    requestIndex: requestIndex || undefined,
    removeId,
    candidate
  });
}

export function reconcileLive2DMusicCommandWithAudience(rawCommand = null, audienceLines = []) {
  const command = normalizeLive2DMusicCommand(rawCommand);
  if (!command || !['play', 'request', 'play_next', 'play_now'].includes(command.action)) return command;
  const lines = Array.isArray(audienceLines) ? audienceLines : [];
  if (!lines.length) return null;

  let trustedLine = null;
  if (command.requestIndex >= 1 && command.requestIndex <= lines.length) {
    trustedLine = lines[command.requestIndex - 1];
  } else {
    const inferredLines = lines
      .map((line) => ({ line, command: inferLive2DMusicCommandFromText(line?.text || '') }))
      .filter((item) => item.command?.query && !item.line?.musicRequestHandled);
    const compactQuery = compactMusicRequesterMatchText(command.query || '');
    const exactMatches = compactQuery
      ? inferredLines.filter((item) => (
          compactMusicRequesterMatchText(item.command.query) === compactQuery
        ))
      : [];
    if (exactMatches.length === 1) {
      trustedLine = exactMatches[0].line;
    } else if (inferredLines.length === 1) {
      trustedLine = inferredLines[0].line;
    }
  }

  if (trustedLine?.musicRequestHandled) return null;
  const trustedCommand = inferLive2DMusicCommandFromText(trustedLine?.text || '');
  if (!trustedCommand?.query) return null;
  const reconciled = {
    ...command,
    action: trustedCommand.action === 'play_next' ? 'play_next' : 'request',
    query: trustedCommand.query
  };
  delete reconciled.candidate;
  delete reconciled.songId;
  delete reconciled.url;
  return reconciled;
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

function browserPlaybackErrorMessage(error) {
  const name = asText(error?.name);
  if (name === 'NotAllowedError') {
    return 'Music playback was blocked by the studio window. Click Send, Start Live, or a music button once, then ask again.';
  }
  return musicErrorMessage(error, 'Music audio playback failed.');
}

async function playBrowserAudio(audio, detail = {}, provider = '') {
  try {
    await audio.play();
  } catch (error) {
    const message = browserPlaybackErrorMessage(error);
    publishMusicDebug('music-error', {
      action: detail.action || 'audio-play',
      query: detail.query,
      songId: detail.songId,
      provider: provider || detail.provider,
      message
    }, provider || detail.provider);
    throw new Error(message);
  }
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
  if (speechDuckingActive) {
    writeAppleMusicVolume(music, Math.min(appleMusicBaseVolume, speechDuckVolume));
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

function neteaseMusicSongToCandidate(song, defaults = {}) {
  return normalizeMusicCandidate({
    provider: NETEASE_MUSIC_PROVIDER,
    songId: song?.songId || song?.id,
    title: song?.title || song?.name,
    artist: song?.artist || song?.artistName,
    album: song?.album || song?.albumName,
    artworkUrl: song?.artworkUrl || song?.picUrl,
    durationMs: song?.durationMs || song?.duration,
    query: defaults.query,
    requestedBy: defaults.requestedBy
  });
}

async function searchNeteaseMusicSongs(query, settings) {
  const term = asText(query);
  if (!term) throw new Error('NetEase Cloud Music song query is empty.');
  const response = await fetch(NETEASE_MUSIC_SEARCH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      ...settings,
      provider: NETEASE_MUSIC_PROVIDER,
      query: term,
      limit: settings.searchLimit || DEFAULT_SEARCH_LIMIT
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(asText(data?.message) || `NetEase Cloud Music search failed (${response.status}).`);
  }
  const songs = Array.isArray(data?.candidates) ? data.candidates : [];
  return songs.map((song) => neteaseMusicSongToCandidate(song, {
    query: term
  })).filter((song) => song.songId || song.url);
}

export async function searchLive2DMusic(query, settings = readRoomMusicSettings(), options = {}) {
  const term = asText(query);
  if (!term) throw new Error('Music search query is empty.');

  const provider = normalizeMusicProvider(options.provider || settings?.provider, LOCAL_MUSIC_PROVIDER);
  const requestedLimit = Number(options.limit ?? settings?.searchLimit ?? DEFAULT_SEARCH_LIMIT);
  const searchLimit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? Math.round(requestedLimit) : DEFAULT_SEARCH_LIMIT));
  const normalizedSettings = normalizeRoomMusicSettings({
    ...settings,
    provider,
    searchLimit
  });

  let tracks = [];
  if (provider === LOCAL_MUSIC_PROVIDER) {
    tracks = await searchLocalMusicSongs(term, normalizedSettings);
  } else if (provider === NETEASE_MUSIC_PROVIDER) {
    tracks = await searchNeteaseMusicSongs(term, normalizedSettings);
  } else {
    tracks = await searchAppleMusicSongs(
      term,
      normalizedSettings,
      normalizedSettings.musicUserToken
    );
  }

  return {
    query: term,
    provider,
    tracks: tracks.slice(0, searchLimit),
    total: tracks.length
  };
}

async function resolveNeteasePlayableCandidate(candidate, settings) {
  const sourceCandidate = normalizeMusicCandidate(candidate, {
    provider: NETEASE_MUSIC_PROVIDER
  });
  if (sourceCandidate.url && !sourceCandidate.songId) {
    return sourceCandidate;
  }
  if (!sourceCandidate.songId) {
    throw new Error('NetEase Cloud Music candidate has no song ID.');
  }

  const response = await fetch(NETEASE_MUSIC_RESOLVE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      ...settings,
      provider: NETEASE_MUSIC_PROVIDER,
      candidate: sourceCandidate,
      songId: sourceCandidate.songId
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(asText(data?.message) || `NetEase Cloud Music resolve failed (${response.status}).`);
  }
  const resolved = data?.candidate || data?.song || {};
  return normalizeMusicCandidate({
    ...sourceCandidate,
    ...resolved,
    provider: NETEASE_MUSIC_PROVIDER,
    songId: resolved.songId || resolved.id || sourceCandidate.songId,
    url: resolved.url || sourceCandidate.url
  });
}

function ensureLocalAudio() {
  if (typeof window === 'undefined') {
    throw new Error('Browser music playback is only available in the studio window.');
  }
  if (localAudio) return localAudio;

  localAudio = new Audio();
  localAudio.preload = 'auto';
  if (speechDuckingActive) {
    localMusicBaseVolume = clampVolume(localAudio.volume, localMusicBaseVolume);
    localAudio.volume = Math.min(localMusicBaseVolume, speechDuckVolume);
  }
  localAudio.addEventListener('ended', () => {
    if (musicWarmupActive) return;
    const settings = readRoomMusicSettings();
    const current = readLive2DMusicQueueState().current;
    const provider = current?.provider || settings.provider;
    if (provider !== LOCAL_MUSIC_PROVIDER && provider !== NETEASE_MUSIC_PROVIDER) return;
    const playNext = provider === NETEASE_MUSIC_PROVIDER ? playNextNeteaseMusic : playNextLocalMusic;
    playNext({ ...settings, provider }).catch((error) => {
      publishMusicDebug('music-error', {
        action: 'auto-next',
        provider,
        message: musicErrorMessage(error)
      }, provider);
    });
  });
  localAudio.addEventListener('loadedmetadata', () => {
    const durationMs = Math.round(Number(localAudio.duration || 0) * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    const current = readLive2DMusicQueueState().current;
    if (!current || (current.provider !== LOCAL_MUSIC_PROVIDER && current.provider !== NETEASE_MUSIC_PROVIDER)) return;
    updateLive2DMusicCurrent({ durationMs });
  });
  localAudio.addEventListener('error', () => {
    if (musicWarmupActive) return;
    const code = localAudio?.error?.code || 0;
    const current = readLive2DMusicQueueState().current;
    const provider = current?.provider || readRoomMusicSettings().provider || LOCAL_MUSIC_PROVIDER;
    publishMusicDebug('music-error', {
      action: 'local-audio',
      provider,
      message: `Music audio playback failed${code ? ` (${code})` : ''}.`
    }, provider);
    if (current && (provider === LOCAL_MUSIC_PROVIDER || provider === NETEASE_MUSIC_PROVIDER)) {
      startLocalAudioRecovery(provider, current);
    }
  });
  return localAudio;
}

function resetLocalAudioSource() {
  if (!localAudio) return;
  localAudio.pause();
  localAudio.removeAttribute('src');
  localAudio.load?.();
}

async function waitForLocalAudioRecovery() {
  if (!localAudioRecoveryPromise) return;
  await localAudioRecoveryPromise;
}

function startLocalAudioRecovery(provider, failedCurrent) {
  if (localAudioRecoveryPromise) return localAudioRecoveryPromise;
  const failedToken = failedCurrent?.playbackToken || '';
  const task = Promise.resolve().then(async () => {
    const latestCurrent = readLive2DMusicQueueState().current;
    if (!latestCurrent || (failedToken && latestCurrent.playbackToken !== failedToken)) return null;
    publishMusicDebug('music-auto-recover', {
      action: 'audio-error-next',
      provider,
      songId: latestCurrent.songId,
      title: latestCurrent.title
    }, provider);
    const settings = { ...readRoomMusicSettings(), provider };
    return provider === NETEASE_MUSIC_PROVIDER
      ? playNextNeteaseMusic(settings)
      : playNextLocalMusic(settings);
  }).catch((error) => {
    publishMusicDebug('music-error', {
      action: 'audio-error-next',
      provider,
      message: musicErrorMessage(error)
    }, provider);
    return null;
  });
  localAudioRecoveryPromise = task;
  task.finally(() => {
    if (localAudioRecoveryPromise === task) localAudioRecoveryPromise = null;
  });
  return task;
}

export async function warmupLive2DMusicPlayback() {
  if (typeof window === 'undefined') return false;
  const audio = ensureLocalAudio();
  if (audio.src && !audio.ended) return !audio.paused;

  const previousMuted = audio.muted;
  const previousVolume = Number.isFinite(Number(audio.volume)) ? audio.volume : 1;
  musicWarmupActive = true;
  try {
    audio.pause();
    audio.muted = false;
    audio.volume = 0;
    audio.src = SILENT_AUDIO_DATA_URL;
    audio.currentTime = 0;
    await audio.play();
    audio.pause();
    audio.removeAttribute('src');
    audio.load?.();
    return true;
  } catch (error) {
    publishMusicDebug('music-warmup-failed', {
      action: 'warmup',
      message: musicErrorMessage(error, 'Music warmup failed.')
    }, readRoomMusicSettings().provider);
    return false;
  } finally {
    audio.muted = previousMuted;
    audio.volume = previousVolume;
    musicWarmupActive = false;
  }
}

function localAudioHasActiveSource() {
  return Boolean(localAudio && localAudio.src && !localAudio.ended);
}

function localAudioIsPlaying() {
  return Boolean(localAudioHasActiveSource() && !localAudio.paused);
}

function reconcileBrowserMusicCurrent(state, provider) {
  const current = state?.current;
  if (!current || (provider !== LOCAL_MUSIC_PROVIDER && provider !== NETEASE_MUSIC_PROVIDER)) return state;
  if (current.provider && current.provider !== LOCAL_MUSIC_PROVIDER && current.provider !== NETEASE_MUSIC_PROVIDER) {
    return state;
  }
  if (localAudioIsPlaying()) return state;
  if (current.status === 'paused' && localAudioHasActiveSource()) return state;

  publishMusicDebug('music-stale-current-cleared', {
    action: 'reconcile-current',
    provider,
    staleProvider: current.provider,
    status: current.status,
    songId: current.songId,
    title: current.title
  }, provider);
  return clearLive2DMusicCurrent(state);
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
  if (command.candidate || command.songId || command.url) {
    return normalizeMusicCandidate({
      ...(command.candidate || {}),
      provider: 'apple-music',
      songId: command.songId || command.candidate?.songId,
      url: command.url || command.candidate?.url,
      title: command.candidate?.title || command.query || command.songId || command.url,
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
  await playBrowserAudio(audio, {
    action: 'play',
    provider: LOCAL_MUSIC_PROVIDER,
    query: normalizedCandidate.query,
    songId: normalizedCandidate.songId
  }, LOCAL_MUSIC_PROVIDER);

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
  resetLocalAudioSource();
  let state = clearLive2DMusicCurrent();
  while (true) {
    const next = dequeueNextLive2DMusicCandidate(state);
    const candidate = next.candidate;
    state = next.state;
    if (!candidate) {
      clearLive2DMusicCurrent(state);
      return { status: 'ended', provider: LOCAL_MUSIC_PROVIDER, queueLength: 0 };
    }
    try {
      return await playLocalMusicCandidate(candidate, settings);
    } catch (error) {
      resetLocalAudioSource();
      state = clearLive2DMusicCurrent(readLive2DMusicQueueState());
      publishMusicDebug('music-queue-item-skipped', {
        action: 'auto-next',
        provider: LOCAL_MUSIC_PROVIDER,
        songId: candidate.songId,
        title: candidate.title,
        message: musicErrorMessage(error)
      }, LOCAL_MUSIC_PROVIDER);
      if (!state.queue.length) throw error;
    }
  }
}

async function resolveLocalMusicCandidate(command, settings) {
  if (command.candidate || command.songId || command.url) {
    return normalizeMusicCandidate({
      ...(command.candidate || {}),
      provider: LOCAL_MUSIC_PROVIDER,
      songId: command.songId || command.candidate?.songId,
      url: command.url || command.candidate?.url || localMusicFileUrl(command.songId || command.candidate?.songId),
      title: command.candidate?.title || command.query || command.songId || command.url,
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
  await waitForLocalAudioRecovery();
  let state = reconcileBrowserMusicCurrent(readLive2DMusicQueueState(), LOCAL_MUSIC_PROVIDER);
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

async function playNeteaseMusicCandidate(candidate, settings) {
  const normalizedCandidate = await resolveNeteasePlayableCandidate(candidate, settings);
  if (!normalizedCandidate.url) {
    throw new Error('NetEase Cloud Music did not return a playable stream URL.');
  }

  publishMusicDebug('music-play-request', {
    action: 'play',
    provider: NETEASE_MUSIC_PROVIDER,
    query: normalizedCandidate.query,
    songId: normalizedCandidate.songId,
    url: normalizedCandidate.url,
    quality: settings.neteaseQualityLevel
  }, NETEASE_MUSIC_PROVIDER);

  const audio = ensureLocalAudio();
  audio.pause();
  audio.src = normalizedCandidate.url;
  audio.currentTime = 0;
  await playBrowserAudio(audio, {
    action: 'play',
    provider: NETEASE_MUSIC_PROVIDER,
    query: normalizedCandidate.query,
    songId: normalizedCandidate.songId
  }, NETEASE_MUSIC_PROVIDER);

  const state = setLive2DMusicCurrent(normalizedCandidate, {
    status: 'playing',
    startedAt: Date.now()
  });
  addLive2DMusicHistory(normalizedCandidate, { settings, state });

  return {
    status: 'playing',
    provider: NETEASE_MUSIC_PROVIDER,
    songId: normalizedCandidate.songId,
    queueId: normalizedCandidate.uid,
    title: [normalizedCandidate.title, normalizedCandidate.artist].filter(Boolean).join(' - ') ||
      normalizedCandidate.songId ||
      normalizedCandidate.url,
    current: normalizedCandidate,
    queueLength: state.queue.length
  };
}

async function playNextNeteaseMusic(settings) {
  resetLocalAudioSource();
  let state = clearLive2DMusicCurrent();
  while (true) {
    const next = dequeueNextLive2DMusicCandidate(state);
    const candidate = next.candidate;
    state = next.state;
    if (!candidate) {
      clearLive2DMusicCurrent(state);
      return { status: 'ended', provider: NETEASE_MUSIC_PROVIDER, queueLength: 0 };
    }
    try {
      return await playNeteaseMusicCandidate(candidate, settings);
    } catch (error) {
      resetLocalAudioSource();
      state = clearLive2DMusicCurrent(readLive2DMusicQueueState());
      publishMusicDebug('music-queue-item-skipped', {
        action: 'auto-next',
        provider: NETEASE_MUSIC_PROVIDER,
        songId: candidate.songId,
        title: candidate.title,
        message: musicErrorMessage(error)
      }, NETEASE_MUSIC_PROVIDER);
      if (!state.queue.length) throw error;
    }
  }
}

async function resolveNeteaseMusicCandidate(command, settings) {
  if (command.candidate || command.songId || command.url) {
    return normalizeMusicCandidate({
      ...(command.candidate || {}),
      provider: NETEASE_MUSIC_PROVIDER,
      songId: command.songId || command.candidate?.songId,
      url: command.url || command.candidate?.url,
      title: command.candidate?.title || command.query || command.songId || command.url,
      query: command.query,
      requestedBy: command.requestedBy
    });
  }

  const candidates = await searchNeteaseMusicSongs(command.query, settings);
  const picked = pickLive2DMusicCandidate(command.query, candidates, settings);
  if (!picked.candidate) {
    throw new Error(`NetEase Cloud Music did not find a song for "${command.query}". Check api-enhanced is running and the song is available.`);
  }
  publishMusicDebug('music-search-selected', {
    action: command.action,
    provider: NETEASE_MUSIC_PROVIDER,
    query: command.query,
    selected: picked.candidate.title,
    artist: picked.candidate.artist,
    candidates: picked.scored.length,
    reason: picked.scored[0]?.reason
  }, NETEASE_MUSIC_PROVIDER);
  return normalizeMusicCandidate({
    ...picked.candidate,
    provider: NETEASE_MUSIC_PROVIDER,
    url: '',
    requestedBy: command.requestedBy,
    requestedAt: Date.now()
  });
}

async function requestNeteaseMusic(command, settings) {
  const candidate = await resolveNeteaseMusicCandidate(command, settings);
  await waitForLocalAudioRecovery();
  let state = reconcileBrowserMusicCurrent(readLive2DMusicQueueState(), NETEASE_MUSIC_PROVIDER);
  const mode = command.action === 'play_next' ? 'next' : command.action === 'play_now' ? 'immediate' : 'append';

  if (mode === 'immediate') {
    return playNeteaseMusicCandidate(candidate, settings);
  }

  const enqueueResult = enqueueLive2DMusicCandidate(candidate, {
    mode,
    settings,
    state
  });

  if (enqueueResult.status === 'duplicate') {
    publishMusicDebug('music-duplicate', {
      action: command.action,
      provider: NETEASE_MUSIC_PROVIDER,
      query: command.query,
      title: candidate.title,
      reason: enqueueResult.reason
    }, NETEASE_MUSIC_PROVIDER);
    return {
      status: 'duplicate',
      provider: NETEASE_MUSIC_PROVIDER,
      title: [candidate.title, candidate.artist].filter(Boolean).join(' - ') || candidate.songId,
      songId: candidate.songId,
      reason: enqueueResult.reason,
      queueLength: enqueueResult.state.queue.length
    };
  }

  if (enqueueResult.status === 'full') {
    return {
      status: 'queue-full',
      provider: NETEASE_MUSIC_PROVIDER,
      title: [candidate.title, candidate.artist].filter(Boolean).join(' - ') || candidate.songId,
      queueLength: enqueueResult.state.queue.length
    };
  }

  if (settings.autoPlayRequests && !enqueueResult.state.current) {
    return playNextNeteaseMusic(settings);
  }

  const waitMs = estimateLive2DMusicWaitMs(candidate, enqueueResult.state);
  return {
    status: 'queued',
    provider: NETEASE_MUSIC_PROVIDER,
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

export async function executeLive2DMusicCommand(rawCommand, settings = readRoomMusicSettings(), options = {}) {
  let command = normalizeLive2DMusicCommand(rawCommand);
  if (!command) return null;
  if (options.playRequestsImmediately && ['play', 'request'].includes(command.action)) {
    command = { ...command, action: 'play_now' };
  }

  const providerOverride = normalizeMusicProvider(command.provider, '');
  const normalizedSettings = normalizeRoomMusicSettings({
    ...settings,
    provider: providerOverride || settings.provider,
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
        await playBrowserAudio(audio, {
          action: 'resume',
          provider: LOCAL_MUSIC_PROVIDER,
          songId: current.songId
        }, provider);
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

    if (provider === NETEASE_MUSIC_PROVIDER) {
      if (command.action === 'authorize') {
        return { status: 'ready', provider: NETEASE_MUSIC_PROVIDER, settings: normalizedSettings };
      }
      if (command.action === 'queue') {
        return { status: 'queue', provider: NETEASE_MUSIC_PROVIDER, state: getLive2DMusicPublicState() };
      }
      if (command.action === 'clear') {
        const state = clearLive2DMusicQueue();
        return { status: 'cleared', provider: NETEASE_MUSIC_PROVIDER, queueLength: state.queue.length };
      }
      if (command.action === 'remove') {
        const state = removeLive2DMusicQueueItem(command.removeId || command.songId);
        return { status: 'removed', provider: NETEASE_MUSIC_PROVIDER, queueLength: state.queue.length };
      }

      const audio = ensureLocalAudio();
      if (command.action === 'pause') {
        audio.pause();
        const current = readLive2DMusicQueueState().current;
        if (current) updateLive2DMusicCurrent({ status: 'paused', pausedAt: Date.now() });
        publishMusicDebug('music-paused', { action: 'pause', provider }, provider);
        return { status: 'paused', provider: NETEASE_MUSIC_PROVIDER };
      }
      if (command.action === 'resume') {
        const current = readLive2DMusicQueueState().current;
        if (!current) return playNextNeteaseMusic(normalizedSettings);
        if (!audio.src && current.url) audio.src = current.url;
        await playBrowserAudio(audio, {
          action: 'resume',
          provider: NETEASE_MUSIC_PROVIDER,
          songId: current.songId
        }, provider);
        const pausedAt = Number(current.pausedAt) || Date.now();
        updateLive2DMusicCurrent({
          status: 'playing',
          pausedAt: 0,
          elapsedPausedMs: (Number(current.elapsedPausedMs) || 0) + Math.max(0, Date.now() - pausedAt)
        });
        publishMusicDebug('music-resumed', { action: 'resume', provider }, provider);
        return { status: 'resumed', provider: NETEASE_MUSIC_PROVIDER };
      }
      if (command.action === 'stop') {
        audio.pause();
        audio.removeAttribute('src');
        audio.load?.();
        clearLive2DMusicCurrent();
        publishMusicDebug('music-stopped', { action: 'stop', provider }, provider);
        return { status: 'stopped', provider: NETEASE_MUSIC_PROVIDER };
      }
      if (command.action === 'skip') {
        audio.pause();
        return await playNextNeteaseMusic(normalizedSettings);
      }

      return await requestNeteaseMusic(command, normalizedSettings);
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
