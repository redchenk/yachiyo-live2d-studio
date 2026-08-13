import { readJson, writeJson } from './roomStorage';

export const ROOM_LLM_SETTINGS_KEY = 'roomLLMSettings';
export const ROOM_TTS_SETTINGS_KEY = 'roomTTSSettings';
export const ROOM_MODEL_SETTINGS_KEY = 'roomModelSettings';
export const ROOM_VTS_SETTINGS_KEY = 'roomVTubeStudioSettings';
export const ROOM_MEMORY_SETTINGS_KEY = 'roomMemorySettings';
export const ROOM_ASR_SETTINGS_KEY = 'roomASRSettings';
export const ROOM_MUSIC_SETTINGS_KEY = 'roomMusicSettings';
export const ROOM_BILIBILI_DANMAKU_SETTINGS_KEY = 'roomBilibiliDanmakuSettings';
export const ROOM_VISION_SETTINGS_KEY = 'roomVisionSettings';
export const ROOM_MINECRAFT_SETTINGS_KEY = 'roomMinecraftSettings';
const ROOM_MODEL_STAGE_DEFAULTS_MIGRATION_KEY = 'roomModelStageDefaultsMigratedV2';
const ROOM_MODEL_RENDER_DEFAULTS_MIGRATION_KEY = 'roomModelRenderDefaultsMigratedV2';
const ROOM_MEMORY_MANAGED_MILVUS_DEFAULTS_MIGRATION_KEY = 'roomMemoryManagedMilvusDefaultsMigratedV1';
const ROOM_MUSIC_LOCAL_DEFAULTS_MIGRATION_KEY = 'roomMusicLocalDefaultsMigratedV1';
const ROOM_MUSIC_NETEASE_DEFAULTS_MIGRATION_KEY = 'roomMusicNeteaseDefaultsMigratedV1';
const ROOM_MUSIC_ENABLED_DEFAULTS_MIGRATION_KEY = 'roomMusicEnabledDefaultsMigratedV1';
const ROOM_BILIBILI_REPLY_CAPACITY_MIGRATION_KEY = 'roomBilibiliReplyCapacityMigratedV1';
const LEGACY_ROOM_MODEL_STAGE_IDLE_SCALE = 0.9;
const LEGACY_ROOM_MODEL_STAGE_MOTION_SCALE = 0.75;
const LEGACY_ROOM_MODEL_RENDER_DPRS = [3, 4];

export const DEFAULT_GPT_SOVITS_GPT_WEIGHT = 'GPT_weights_v2ProPlus/yachiyo-v2pro-e15.ckpt';
export const DEFAULT_GPT_SOVITS_SOVITS_WEIGHT = 'SoVITS_weights_v2ProPlus/yachiyo-v2pro_e8_s456.pth';
export const DEFAULT_MIMO_TTS_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
export const DEFAULT_MIMO_TTS_MODEL = 'mimo-v2.5-tts';
export const DEFAULT_MIMO_TTS_VOICE = 'mimo_default';

export const ROOM_LLM_PROVIDER_PRESETS = {
  openai: {
    label: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    useProxy: true
  },
  openrouter: {
    label: 'OpenRouter',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openai/gpt-4o-mini',
    useProxy: true
  },
  deepseek: {
    label: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    useProxy: true
  },
  moonshot: {
    label: 'Moonshot / Kimi',
    apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    useProxy: true
  },
  siliconflow: {
    label: 'SiliconFlow',
    apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'deepseek-ai/DeepSeek-V3',
    useProxy: true
  },
  xai: {
    label: 'xAI',
    apiUrl: 'https://api.x.ai/v1/chat/completions',
    model: 'grok-2',
    useProxy: true
  },
  custom: {
    label: 'Custom Compatible',
    apiUrl: '',
    model: 'gpt-4o-mini',
    useProxy: true
  }
};

export const ROOM_LLM_PROVIDER_OPTIONS = Object.entries(ROOM_LLM_PROVIDER_PRESETS).map(([value, preset]) => ({
  value,
  label: preset.label
}));

export const ROOM_LLM_VISION_IMAGE_MODE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'off', label: 'Text only' },
  { value: 'force', label: 'Force image' }
];

export const DEFAULT_ROOM_LLM_SETTINGS = {
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  useProxy: true,
  visionImageMode: 'auto',
  systemPrompt: ''
};

export const DEFAULT_ROOM_TTS_SETTINGS = {
  enabled: true,
  provider: 'gpt-sovits',
  apiUrl: 'http://localhost:9880/tts',
  apiKey: '',
  model: 'auto',
  voice: '',
  refAudioPath: '',
  promptText: '',
  textLang: 'ja',
  promptLang: 'ja',
  gptWeightPath: DEFAULT_GPT_SOVITS_GPT_WEIGHT,
  sovitsWeightPath: DEFAULT_GPT_SOVITS_SOVITS_WEIGHT,
  useProxy: false
};

export const DEFAULT_ROOM_ASR_SETTINGS = {
  enabled: false,
  provider: 'vosk',
  modelPath: 'models/vosk/vosk-model-small-cn-0.22',
  sampleRate: 16000,
  maxRecordMs: 12000,
  endpoint: '/api/asr',
  words: false,
  inputGain: 1,
  vadThreshold: 0.012,
  continuousSilenceMs: 650,
  continuousMaxSegmentMs: 9000,
  minSpeechMs: 300,
  maxAlternatives: 3
};

export const DEFAULT_ROOM_MODEL_SETTINGS = {
  lowQualityModel: false,
  renderDpr: 6,
  stageFloatEnabled: true,
  stageIdleScale: 1.18,
  stageMotionScale: 1.16,
  stageVerticalOffset: 0
};

export const DEFAULT_ROOM_VTS_SETTINGS = {
  enabled: true,
  apiUrl: 'ws://127.0.0.1:8001',
  pluginName: 'Yachiyo Live2D Studio',
  pluginDeveloper: 'redchenk',
  injectFace: true,
  injectBody: true,
  injectMouth: true
};

export const DEFAULT_ROOM_MEMORY_SETTINGS = {
  enabled: true,
  provider: 'sqlite-milvus',
  vaultPath: '',
  databasePath: '',
  personaCorpusPath: 'E:\\visualstudio\\yachiyo_novel_detailed_corpus.txt',
  milvusEnabled: true,
  milvusManaged: true,
  milvusUrl: 'http://127.0.0.1:19530',
  milvusToken: '',
  milvusCollection: 'yachiyo_memory',
  milvusImage: 'milvusdb/milvus:latest',
  embeddingApiUrl: '',
  embeddingApiKey: '',
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 384,
  writeMode: 'auto-approved',
  retrievalMode: 'hybrid',
  maxNotesPerTurn: 4,
  allowViewerMemory: true,
  allowSessionMemory: true,
  sessionRollupEnabled: true,
  gcEnabled: true,
  gcArchiveDays: 30,
  gcForgetDays: 120,
  rawRetentionDays: 120,
  anchorImportanceThreshold: 0.72
};

export const DEFAULT_ROOM_MUSIC_SETTINGS = {
  enabled: true,
  songRequestsEnabled: true,
  volume: 1,
  provider: 'netease-cloud',
  developerToken: '',
  musicUserToken: '',
  storefront: 'cn',
  autoAuthorize: true,
  neteaseApiUrl: 'http://127.0.0.1:3302',
  neteaseCookie: '',
  neteaseCookiePath: '',
  neteaseQualityLevel: 'exhigh',
  neteaseBitrate: 320000,
  neteaseUnblock: false,
  neteaseUnblockSource: '',
  localLibraryPaths: '',
  localIncludeProjectMusic: true,
  localIncludeUserMusic: true,
  localMaxScanFiles: 3000,
  searchLimit: 25,
  smartPick: true,
  maxQueueSize: 30,
  dedupeEnabled: true,
  autoPlayRequests: true,
  filterShortSongs: true,
  minDurationMs: 60000,
  historyLimit: 50,
  blacklist: ''
};

export const DEFAULT_ROOM_BILIBILI_DANMAKU_SETTINGS = {
  enabled: false,
  roomId: '',
  autoConnect: false,
  autoForward: true,
  autoStartDirector: true,
  readAloud: true,
  readUserName: true,
  maxForwardPerMinute: 24,
  safetyFilterEnabled: true,
  safetyLevel: 'balanced',
  sensitiveWords: '',
  maskMildLanguage: true,
  platform: 'web',
  uid: 0,
  key: '',
  buvid: '',
  cookie: ''
};

export const DEFAULT_ROOM_VISION_SETTINGS = {
  enabled: true,
  includeScreenshot: true,
  includeFullScreen: false,
  cropSize: 768,
  detail: 'low',
  maxPromptChars: 1600
};

export const DEFAULT_ROOM_MINECRAFT_SETTINGS = {
  enabled: false,
  trustedServerAcknowledged: false,
  host: '127.0.0.1',
  port: 25565,
  username: 'Yachiyo',
  auth: 'offline',
  version: '',
  autonomousPlay: true,
  decisionIntervalMs: 6500,
  autoReconnect: true,
  maxRetries: 5,
  healthThreshold: 8
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asText(value) {
  return String(value ?? '').trim();
}

function asBoolean(value) {
  return Boolean(value);
}

function asNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeProviderKey(provider) {
  const key = asText(provider).toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROOM_LLM_PROVIDER_PRESETS, key) ? key : '';
}

function sameLlmDefaultModel(model) {
  const value = asText(model).toLowerCase();
  if (!value) return true;
  return Object.values(ROOM_LLM_PROVIDER_PRESETS).some((preset) => asText(preset.model).toLowerCase() === value);
}

function appendChatEndpoint(parsed, provider, model) {
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.replace(/\/+$/g, '');
  const text = `${provider || ''} ${host} ${model || ''}`;
  const knownOpenAICompatible = /deepseek|dashscope|aliyuncs|openai|openrouter|moonshot|kimi|bigmodel|zhipu|siliconflow|volces|ark|groq|mistral|together|perplexity|x\.ai|generativelanguage|xiaomimimo|token-plan-cn/i.test(text);
  if (!knownOpenAICompatible) return parsed.href.replace(/\/+$/g, '');
  if (/\/(chat\/completions|responses)$/i.test(pathname)) return parsed.href.replace(/\/+$/g, '');
  if (/(api\.openai\.com|api\.x\.ai)$/i.test(host) && (pathname === '' || pathname === '/v1')) {
    return `${parsed.origin}/v1/responses`;
  }
  if (pathname === '' || pathname === '/') {
    return `${parsed.origin}/v1/chat/completions`;
  }
  if (pathname === '/v1') {
    return `${parsed.origin}/v1/chat/completions`;
  }
  return `${parsed.origin}${pathname}/chat/completions`;
}

export function normalizeLLMApiUrl(apiUrl = '', model = '', provider = '') {
  const url = asText(apiUrl).replace(/\/+$/g, '');
  if (!url) return '';
  try {
    return appendChatEndpoint(new URL(url), provider, model);
  } catch (_) {
    return url;
  }
}

export function inferRoomLLMProvider(settings = {}) {
  const apiUrl = typeof settings === 'string' ? settings : settings?.apiUrl;
  const model = typeof settings === 'string' ? '' : settings?.model;
  const text = `${apiUrl || ''} ${model || ''}`.toLowerCase();
  if (/openrouter\.ai/.test(text)) return 'openrouter';
  if (/deepseek/.test(text)) return 'deepseek';
  if (/moonshot|kimi/.test(text)) return 'moonshot';
  if (/siliconflow/.test(text)) return 'siliconflow';
  if (/api\.x\.ai|grok/.test(text)) return 'xai';
  if (/api\.openai\.com|gpt-4|gpt-5|openai/.test(text)) return 'openai';
  return 'custom';
}

export function applyRoomLLMProviderPreset(settings = {}, provider = '') {
  const key = normalizeProviderKey(provider) || 'custom';
  const preset = ROOM_LLM_PROVIDER_PRESETS[key] || ROOM_LLM_PROVIDER_PRESETS.custom;
  const current = { ...DEFAULT_ROOM_LLM_SETTINGS, ...(settings || {}) };
  const nextModel = sameLlmDefaultModel(current.model)
    ? preset.model || current.model
    : current.model;
  return normalizeRoomLLMSettings({
    ...current,
    provider: key,
    apiUrl: preset.apiUrl || current.apiUrl,
    model: nextModel,
    useProxy: preset.useProxy
  });
}

export function canAttachRoomLLMVisionImage(settings = {}) {
  const normalized = normalizeRoomLLMSettings(settings);
  if (normalized.visionImageMode === 'off') return false;
  if (normalized.visionImageMode === 'force') return true;
  const text = `${normalized.provider} ${normalized.apiUrl} ${normalized.model}`.toLowerCase();
  return /gpt-4o|gpt-4\.1|vision|qwen.*vl|vl-|llava|pixtral|gemini|claude|grok.*vision/.test(text);
}

function defaultTtsApiUrl(provider) {
  if (provider === 'gpt-sovits') return DEFAULT_ROOM_TTS_SETTINGS.apiUrl;
  if (provider === 'mimo') return DEFAULT_MIMO_TTS_API_URL;
  if (provider === 'openai' || provider === 'openai-compatible') return 'https://api.openai.com/v1/audio/speech';
  return '';
}

function defaultTtsModel(provider) {
  if (provider === 'gpt-sovits') return 'auto';
  if (provider === 'mimo') return DEFAULT_MIMO_TTS_MODEL;
  if (provider === 'openai' || provider === 'openai-compatible' || provider === 'custom') return 'tts-1';
  return '';
}

function defaultTtsVoice(provider) {
  if (provider === 'mimo') return DEFAULT_MIMO_TTS_VOICE;
  if (provider === 'openai' || provider === 'openai-compatible' || provider === 'custom') return 'alloy';
  return '';
}

export function normalizeRoomLLMSettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_LLM_SETTINGS, ...(settings || {}) };
  const provider = normalizeProviderKey(merged.provider) || inferRoomLLMProvider(merged);
  const preset = ROOM_LLM_PROVIDER_PRESETS[provider] || ROOM_LLM_PROVIDER_PRESETS.custom;
  const visionImageMode = ['auto', 'off', 'force'].includes(asText(merged.visionImageMode))
    ? asText(merged.visionImageMode)
    : DEFAULT_ROOM_LLM_SETTINGS.visionImageMode;
  return {
    provider,
    apiUrl: normalizeLLMApiUrl(asText(merged.apiUrl) || preset.apiUrl, merged.model, provider),
    apiKey: asText(merged.apiKey),
    model: asText(merged.model) || preset.model || DEFAULT_ROOM_LLM_SETTINGS.model,
    useProxy: asBoolean(merged.useProxy),
    visionImageMode,
    systemPrompt: String(merged.systemPrompt || '').trim()
  };
}

export function normalizeRoomTTSSettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_TTS_SETTINGS, ...(settings || {}) };
  const provider = asText(merged.provider) || DEFAULT_ROOM_TTS_SETTINGS.provider;
  const localGptSovits = provider === 'gpt-sovits';
  const providerDefaultUrl = defaultTtsApiUrl(provider);
  return {
    enabled: asBoolean(merged.enabled),
    provider,
    apiUrl: asText(merged.apiUrl) || providerDefaultUrl,
    apiKey: asText(merged.apiKey),
    model: asText(merged.model) || defaultTtsModel(provider),
    voice: asText(merged.voice) || defaultTtsVoice(provider),
    refAudioPath: asText(merged.refAudioPath),
    promptText: String(merged.promptText || '').trim(),
    textLang: 'ja',
    promptLang: 'ja',
    gptWeightPath: asText(merged.gptWeightPath) || DEFAULT_GPT_SOVITS_GPT_WEIGHT,
    sovitsWeightPath: asText(merged.sovitsWeightPath) || DEFAULT_GPT_SOVITS_SOVITS_WEIGHT,
    useProxy: localGptSovits ? false : asBoolean(merged.useProxy)
  };
}

export function normalizeRoomASRSettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_ASR_SETTINGS, ...(settings || {}) };
  const provider = asText(merged.provider) || DEFAULT_ROOM_ASR_SETTINGS.provider;
  return {
    enabled: asBoolean(merged.enabled),
    provider: provider === 'vosk' ? provider : DEFAULT_ROOM_ASR_SETTINGS.provider,
    modelPath: String(merged.modelPath || '').trim() || DEFAULT_ROOM_ASR_SETTINGS.modelPath,
    sampleRate: Math.round(asNumber(merged.sampleRate, DEFAULT_ROOM_ASR_SETTINGS.sampleRate, 8000, 48000)),
    maxRecordMs: Math.round(asNumber(merged.maxRecordMs, DEFAULT_ROOM_ASR_SETTINGS.maxRecordMs, 1500, 60000)),
    endpoint: asText(merged.endpoint) || DEFAULT_ROOM_ASR_SETTINGS.endpoint,
    words: asBoolean(merged.words),
    inputGain: asNumber(merged.inputGain, DEFAULT_ROOM_ASR_SETTINGS.inputGain, 0, 4),
    vadThreshold: asNumber(merged.vadThreshold, DEFAULT_ROOM_ASR_SETTINGS.vadThreshold, 0.002, 0.2),
    continuousSilenceMs: Math.round(asNumber(
      merged.continuousSilenceMs,
      DEFAULT_ROOM_ASR_SETTINGS.continuousSilenceMs,
      250,
      3000
    )),
    continuousMaxSegmentMs: Math.round(asNumber(
      merged.continuousMaxSegmentMs,
      DEFAULT_ROOM_ASR_SETTINGS.continuousMaxSegmentMs,
      2000,
      30000
    )),
    minSpeechMs: Math.round(asNumber(merged.minSpeechMs, DEFAULT_ROOM_ASR_SETTINGS.minSpeechMs, 120, 3000)),
    maxAlternatives: Math.round(asNumber(
      merged.maxAlternatives,
      DEFAULT_ROOM_ASR_SETTINGS.maxAlternatives,
      0,
      10
    ))
  };
}

export function normalizeRoomModelSettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_MODEL_SETTINGS, ...(settings || {}) };
  return {
    lowQualityModel: asBoolean(merged.lowQualityModel),
    renderDpr: asNumber(merged.renderDpr, DEFAULT_ROOM_MODEL_SETTINGS.renderDpr, 1, 8),
    stageFloatEnabled: asBoolean(merged.stageFloatEnabled),
    stageIdleScale: asNumber(merged.stageIdleScale, DEFAULT_ROOM_MODEL_SETTINGS.stageIdleScale, 0, 3),
    stageMotionScale: asNumber(merged.stageMotionScale, DEFAULT_ROOM_MODEL_SETTINGS.stageMotionScale, 0, 3),
    stageVerticalOffset: asNumber(merged.stageVerticalOffset, DEFAULT_ROOM_MODEL_SETTINGS.stageVerticalOffset, -180, 180)
  };
}

function closeTo(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.001;
}

function upgradeLegacyRoomModelStageDefaults(settings) {
  if (typeof localStorage === 'undefined') return settings;
  try {
    const stageMigrated = localStorage.getItem(ROOM_MODEL_STAGE_DEFAULTS_MIGRATION_KEY) === '1';
    const renderMigrated = localStorage.getItem(ROOM_MODEL_RENDER_DEFAULTS_MIGRATION_KEY) === '1';
    if (stageMigrated && renderMigrated) return settings;
    const upgraded = { ...settings };
    let changed = false;
    if (!stageMigrated) {
      if (closeTo(upgraded.stageIdleScale, LEGACY_ROOM_MODEL_STAGE_IDLE_SCALE)) {
        upgraded.stageIdleScale = DEFAULT_ROOM_MODEL_SETTINGS.stageIdleScale;
        changed = true;
      }
      if (closeTo(upgraded.stageMotionScale, LEGACY_ROOM_MODEL_STAGE_MOTION_SCALE)) {
        upgraded.stageMotionScale = DEFAULT_ROOM_MODEL_SETTINGS.stageMotionScale;
        changed = true;
      }
      localStorage.setItem(ROOM_MODEL_STAGE_DEFAULTS_MIGRATION_KEY, '1');
    }
    if (!renderMigrated) {
      if (LEGACY_ROOM_MODEL_RENDER_DPRS.some((value) => closeTo(upgraded.renderDpr, value))) {
        upgraded.renderDpr = DEFAULT_ROOM_MODEL_SETTINGS.renderDpr;
        changed = true;
      }
      localStorage.setItem(ROOM_MODEL_RENDER_DEFAULTS_MIGRATION_KEY, '1');
    }
    if (changed) writeJson(ROOM_MODEL_SETTINGS_KEY, upgraded);
    return upgraded;
  } catch (_) {
    return settings;
  }
}

export function normalizeRoomVTubeStudioSettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_VTS_SETTINGS, ...(settings || {}) };
  return {
    enabled: asBoolean(merged.enabled),
    apiUrl: asText(merged.apiUrl) || DEFAULT_ROOM_VTS_SETTINGS.apiUrl,
    pluginName: asText(merged.pluginName) || DEFAULT_ROOM_VTS_SETTINGS.pluginName,
    pluginDeveloper: asText(merged.pluginDeveloper) || DEFAULT_ROOM_VTS_SETTINGS.pluginDeveloper,
    injectFace: asBoolean(merged.injectFace),
    injectBody: asBoolean(merged.injectBody),
    injectMouth: asBoolean(merged.injectMouth)
  };
}

export function normalizeRoomMemorySettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_MEMORY_SETTINGS, ...(settings || {}) };
  const provider = ['obsidian', 'sqlite-milvus', 'sqlite'].includes(asText(merged.provider))
    ? asText(merged.provider)
    : DEFAULT_ROOM_MEMORY_SETTINGS.provider;
  const writeMode = ['off', 'inbox-only', 'auto-approved'].includes(asText(merged.writeMode))
    ? asText(merged.writeMode)
    : DEFAULT_ROOM_MEMORY_SETTINGS.writeMode;
  const retrievalMode = ['off', 'tags', 'index', 'hybrid', 'vector'].includes(asText(merged.retrievalMode))
    ? asText(merged.retrievalMode)
    : (provider === 'obsidian' ? DEFAULT_ROOM_MEMORY_SETTINGS.retrievalMode : 'hybrid');
  return {
    enabled: asBoolean(merged.enabled),
    provider,
    vaultPath: String(merged.vaultPath || '').trim(),
    databasePath: String(merged.databasePath || '').trim(),
    personaCorpusPath: String(merged.personaCorpusPath || '').trim() || DEFAULT_ROOM_MEMORY_SETTINGS.personaCorpusPath,
    milvusEnabled: asBoolean(merged.milvusEnabled),
    milvusManaged: asBoolean(merged.milvusManaged),
    milvusUrl: asText(merged.milvusUrl) || DEFAULT_ROOM_MEMORY_SETTINGS.milvusUrl,
    milvusToken: String(merged.milvusToken || '').trim(),
    milvusCollection: asText(merged.milvusCollection) || DEFAULT_ROOM_MEMORY_SETTINGS.milvusCollection,
    milvusImage: asText(merged.milvusImage) || DEFAULT_ROOM_MEMORY_SETTINGS.milvusImage,
    embeddingApiUrl: asText(merged.embeddingApiUrl),
    embeddingApiKey: String(merged.embeddingApiKey || '').trim(),
    embeddingModel: asText(merged.embeddingModel) || DEFAULT_ROOM_MEMORY_SETTINGS.embeddingModel,
    embeddingDimension: asNumber(merged.embeddingDimension, DEFAULT_ROOM_MEMORY_SETTINGS.embeddingDimension, 32, 4096),
    writeMode,
    retrievalMode,
    maxNotesPerTurn: asNumber(merged.maxNotesPerTurn, DEFAULT_ROOM_MEMORY_SETTINGS.maxNotesPerTurn, 1, 8),
    allowViewerMemory: asBoolean(merged.allowViewerMemory),
    allowSessionMemory: asBoolean(merged.allowSessionMemory),
    sessionRollupEnabled: asBoolean(merged.sessionRollupEnabled),
    gcEnabled: asBoolean(merged.gcEnabled),
    gcArchiveDays: asNumber(merged.gcArchiveDays, DEFAULT_ROOM_MEMORY_SETTINGS.gcArchiveDays, 1, 3650),
    gcForgetDays: asNumber(merged.gcForgetDays, DEFAULT_ROOM_MEMORY_SETTINGS.gcForgetDays, 7, 3650),
    rawRetentionDays: asNumber(merged.rawRetentionDays, DEFAULT_ROOM_MEMORY_SETTINGS.rawRetentionDays, 7, 3650),
    anchorImportanceThreshold: asNumber(merged.anchorImportanceThreshold, DEFAULT_ROOM_MEMORY_SETTINGS.anchorImportanceThreshold, 0.1, 1)
  };
}

export function normalizeRoomMusicSettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_MUSIC_SETTINGS, ...(settings || {}) };
  const providerText = asText(merged.provider);
  const provider = ['local-library', 'netease-cloud', 'apple-music'].includes(providerText)
    ? providerText
    : DEFAULT_ROOM_MUSIC_SETTINGS.provider;
  const storefront = asText(merged.storefront).toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) ||
    DEFAULT_ROOM_MUSIC_SETTINGS.storefront;
  const neteaseQualityLevel = [
    'standard',
    'higher',
    'exhigh',
    'lossless',
    'hires',
    'jyeffect',
    'sky',
    'jymaster'
  ].includes(asText(merged.neteaseQualityLevel).toLowerCase())
    ? asText(merged.neteaseQualityLevel).toLowerCase()
    : DEFAULT_ROOM_MUSIC_SETTINGS.neteaseQualityLevel;
  const blacklist = Array.isArray(merged.blacklist)
    ? merged.blacklist.map((item) => asText(item)).filter(Boolean).join('\n')
    : String(merged.blacklist || '');
  const rawNeteaseApiUrl = asText(merged.neteaseApiUrl).replace(/\/+$/g, '');
  const legacyManualDefaultNeteaseApi = /^http:\/\/(127\.0\.0\.1|localhost):3000$/i.test(rawNeteaseApiUrl);
  return {
    enabled: asBoolean(merged.enabled),
    songRequestsEnabled: merged.songRequestsEnabled === undefined
      ? DEFAULT_ROOM_MUSIC_SETTINGS.songRequestsEnabled
      : asBoolean(merged.songRequestsEnabled),
    volume: asNumber(merged.volume, DEFAULT_ROOM_MUSIC_SETTINGS.volume, 0, 1),
    provider,
    developerToken: String(merged.developerToken || '').trim(),
    musicUserToken: String(merged.musicUserToken || '').trim(),
    storefront,
    autoAuthorize: asBoolean(merged.autoAuthorize),
    neteaseApiUrl: legacyManualDefaultNeteaseApi
      ? DEFAULT_ROOM_MUSIC_SETTINGS.neteaseApiUrl
      : rawNeteaseApiUrl || DEFAULT_ROOM_MUSIC_SETTINGS.neteaseApiUrl,
    neteaseCookie: String(merged.neteaseCookie || '').trim(),
    neteaseCookiePath: String(merged.neteaseCookiePath || '').trim(),
    neteaseQualityLevel,
    neteaseBitrate: Math.round(asNumber(merged.neteaseBitrate, DEFAULT_ROOM_MUSIC_SETTINGS.neteaseBitrate, 96000, 999000)),
    neteaseUnblock: asBoolean(merged.neteaseUnblock),
    neteaseUnblockSource: asText(merged.neteaseUnblockSource),
    localLibraryPaths: Array.isArray(merged.localLibraryPaths)
      ? merged.localLibraryPaths.map((item) => String(item || '').trim()).filter(Boolean).join('\n')
      : String(merged.localLibraryPaths || '').trim(),
    localIncludeProjectMusic: asBoolean(merged.localIncludeProjectMusic),
    localIncludeUserMusic: asBoolean(merged.localIncludeUserMusic),
    localMaxScanFiles: Math.round(asNumber(merged.localMaxScanFiles, DEFAULT_ROOM_MUSIC_SETTINGS.localMaxScanFiles, 100, 20000)),
    searchLimit: Math.round(asNumber(merged.searchLimit, DEFAULT_ROOM_MUSIC_SETTINGS.searchLimit, 1, 50)),
    smartPick: asBoolean(merged.smartPick),
    maxQueueSize: Math.round(asNumber(merged.maxQueueSize, DEFAULT_ROOM_MUSIC_SETTINGS.maxQueueSize, 1, 100)),
    dedupeEnabled: asBoolean(merged.dedupeEnabled),
    autoPlayRequests: asBoolean(merged.autoPlayRequests),
    filterShortSongs: asBoolean(merged.filterShortSongs),
    minDurationMs: Math.round(asNumber(merged.minDurationMs, DEFAULT_ROOM_MUSIC_SETTINGS.minDurationMs, 0, 600000)),
    historyLimit: Math.round(asNumber(merged.historyLimit, DEFAULT_ROOM_MUSIC_SETTINGS.historyLimit, 1, 300)),
    blacklist
  };
}

export function normalizeRoomBilibiliDanmakuSettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_BILIBILI_DANMAKU_SETTINGS, ...(settings || {}) };
  const platform = asText(merged.platform).toLowerCase() || DEFAULT_ROOM_BILIBILI_DANMAKU_SETTINGS.platform;
  const safetyLevel = ['strict', 'balanced', 'relaxed'].includes(asText(merged.safetyLevel).toLowerCase())
    ? asText(merged.safetyLevel).toLowerCase()
    : DEFAULT_ROOM_BILIBILI_DANMAKU_SETTINGS.safetyLevel;
  return {
    enabled: asBoolean(merged.enabled),
    roomId: asText(merged.roomId).replace(/[^\d]/g, ''),
    autoConnect: asBoolean(merged.autoConnect),
    autoForward: asBoolean(merged.autoForward),
    autoStartDirector: asBoolean(merged.autoStartDirector),
    readAloud: asBoolean(merged.readAloud),
    readUserName: asBoolean(merged.readUserName),
    maxForwardPerMinute: Math.round(asNumber(
      merged.maxForwardPerMinute,
      DEFAULT_ROOM_BILIBILI_DANMAKU_SETTINGS.maxForwardPerMinute,
      0,
      120
    )),
    safetyFilterEnabled: asBoolean(merged.safetyFilterEnabled),
    safetyLevel,
    sensitiveWords: String(merged.sensitiveWords || '').slice(0, 20_000),
    maskMildLanguage: asBoolean(merged.maskMildLanguage),
    platform,
    uid: Math.round(asNumber(merged.uid, DEFAULT_ROOM_BILIBILI_DANMAKU_SETTINGS.uid, 0, Number.MAX_SAFE_INTEGER)),
    key: String(merged.key || '').trim(),
    buvid: String(merged.buvid || '').trim(),
    cookie: String(merged.cookie || '').trim()
  };
}

function upgradeLegacyRoomBilibiliDefaults(settings, rawSettings = {}) {
  if (typeof localStorage === 'undefined') return settings;
  try {
    if (localStorage.getItem(ROOM_BILIBILI_REPLY_CAPACITY_MIGRATION_KEY) === '1') {
      return settings;
    }
    localStorage.setItem(ROOM_BILIBILI_REPLY_CAPACITY_MIGRATION_KEY, '1');
    if (Number(rawSettings.maxForwardPerMinute) !== 12) return settings;

    const upgraded = normalizeRoomBilibiliDanmakuSettings({
      ...settings,
      maxForwardPerMinute: DEFAULT_ROOM_BILIBILI_DANMAKU_SETTINGS.maxForwardPerMinute
    });
    writeJson(ROOM_BILIBILI_DANMAKU_SETTINGS_KEY, upgraded);
    return upgraded;
  } catch (_) {
    return settings;
  }
}

function upgradeLegacyRoomMusicDefaults(settings, rawSettings = {}) {
  if (typeof localStorage === 'undefined') return settings;
  try {
    let upgraded = settings;
    let changed = false;

    const rawProvider = asText(rawSettings.provider);
    if (localStorage.getItem(ROOM_MUSIC_LOCAL_DEFAULTS_MIGRATION_KEY) !== '1') {
      localStorage.setItem(ROOM_MUSIC_LOCAL_DEFAULTS_MIGRATION_KEY, '1');
      const looksLikeOldAppleDefault = (!rawProvider || rawProvider === 'apple-music') &&
        !asText(rawSettings.developerToken) &&
        !asText(rawSettings.musicUserToken) &&
        !String(rawSettings.localLibraryPaths || '').trim();
      if (looksLikeOldAppleDefault) {
        upgraded = normalizeRoomMusicSettings({
          ...upgraded,
          provider: 'netease-cloud'
        });
        changed = true;
      }
    }

    if (localStorage.getItem(ROOM_MUSIC_NETEASE_DEFAULTS_MIGRATION_KEY) !== '1') {
      localStorage.setItem(ROOM_MUSIC_NETEASE_DEFAULTS_MIGRATION_KEY, '1');
      const looksLikeOldLocalDefault = rawProvider === 'local-library' &&
        !String(rawSettings.localLibraryPaths || '').trim() &&
        rawSettings.localIncludeProjectMusic !== false &&
        rawSettings.localIncludeUserMusic !== false &&
        !asText(rawSettings.developerToken) &&
        !asText(rawSettings.musicUserToken);
      if (looksLikeOldLocalDefault) {
        upgraded = normalizeRoomMusicSettings({
          ...upgraded,
          provider: 'netease-cloud'
        });
        changed = true;
      }
    }

    if (localStorage.getItem(ROOM_MUSIC_ENABLED_DEFAULTS_MIGRATION_KEY) !== '1') {
      localStorage.setItem(ROOM_MUSIC_ENABLED_DEFAULTS_MIGRATION_KEY, '1');
      const looksLikeOldDisabledDefault = rawSettings.enabled === false &&
        (!rawProvider || rawProvider === 'netease-cloud' || rawProvider === 'local-library') &&
        !String(rawSettings.localLibraryPaths || '').trim() &&
        !asText(rawSettings.developerToken) &&
        !asText(rawSettings.musicUserToken);
      if (looksLikeOldDisabledDefault) {
        upgraded = normalizeRoomMusicSettings({
          ...upgraded,
          enabled: true,
          provider: 'netease-cloud'
        });
        changed = true;
      }
    }

    if (!changed) return settings;
    writeJson(ROOM_MUSIC_SETTINGS_KEY, upgraded);
    return upgraded;
  } catch (_) {
    return settings;
  }
}

export function normalizeRoomVisionSettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_VISION_SETTINGS, ...(settings || {}) };
  const detail = ['low', 'high', 'auto'].includes(asText(merged.detail))
    ? asText(merged.detail)
    : DEFAULT_ROOM_VISION_SETTINGS.detail;
  return {
    enabled: asBoolean(merged.enabled),
    includeScreenshot: asBoolean(merged.includeScreenshot),
    includeFullScreen: asBoolean(merged.includeFullScreen),
    cropSize: Math.round(asNumber(merged.cropSize, DEFAULT_ROOM_VISION_SETTINGS.cropSize, 256, 1400)),
    detail,
    maxPromptChars: Math.round(asNumber(merged.maxPromptChars, DEFAULT_ROOM_VISION_SETTINGS.maxPromptChars, 400, 4000))
  };
}

function upgradeLegacyRoomMemoryDefaults(settings, rawSettings = {}) {
  if (typeof localStorage === 'undefined') return settings;
  try {
    if (localStorage.getItem(ROOM_MEMORY_MANAGED_MILVUS_DEFAULTS_MIGRATION_KEY) === '1') return settings;
    const rawProvider = asText(rawSettings.provider || 'obsidian') || 'obsidian';
    const looksLikeOldDefault = !asBoolean(rawSettings.enabled) &&
      rawProvider === 'obsidian' &&
      !rawSettings.vaultPath &&
      !rawSettings.databasePath &&
      !asBoolean(rawSettings.milvusEnabled) &&
      !asBoolean(rawSettings.milvusManaged);

    localStorage.setItem(ROOM_MEMORY_MANAGED_MILVUS_DEFAULTS_MIGRATION_KEY, '1');
    if (!looksLikeOldDefault) return settings;

    const upgraded = normalizeRoomMemorySettings({
      ...settings,
      enabled: true,
      provider: 'sqlite-milvus',
      milvusEnabled: true,
      milvusManaged: true,
      retrievalMode: 'hybrid',
      writeMode: 'auto-approved',
      maxNotesPerTurn: 4
    });
    writeJson(ROOM_MEMORY_SETTINGS_KEY, upgraded);
    return upgraded;
  } catch (_) {
    return settings;
  }
}

export function readRoomLLMSettings() {
  return normalizeRoomLLMSettings(readJson(ROOM_LLM_SETTINGS_KEY, clone(DEFAULT_ROOM_LLM_SETTINGS)));
}

export function readRoomTTSSettings() {
  return normalizeRoomTTSSettings(readJson(ROOM_TTS_SETTINGS_KEY, clone(DEFAULT_ROOM_TTS_SETTINGS)));
}

export function readRoomASRSettings() {
  return normalizeRoomASRSettings(readJson(ROOM_ASR_SETTINGS_KEY, clone(DEFAULT_ROOM_ASR_SETTINGS)));
}

export function readRoomModelSettings() {
  return upgradeLegacyRoomModelStageDefaults(
    normalizeRoomModelSettings(readJson(ROOM_MODEL_SETTINGS_KEY, clone(DEFAULT_ROOM_MODEL_SETTINGS)))
  );
}

export function readRoomVTubeStudioSettings() {
  return normalizeRoomVTubeStudioSettings(readJson(ROOM_VTS_SETTINGS_KEY, clone(DEFAULT_ROOM_VTS_SETTINGS)));
}

export function readRoomMemorySettings() {
  const raw = readJson(ROOM_MEMORY_SETTINGS_KEY, clone(DEFAULT_ROOM_MEMORY_SETTINGS));
  return upgradeLegacyRoomMemoryDefaults(
    normalizeRoomMemorySettings(raw),
    raw
  );
}

export function readRoomMusicSettings() {
  const raw = readJson(ROOM_MUSIC_SETTINGS_KEY, clone(DEFAULT_ROOM_MUSIC_SETTINGS));
  return upgradeLegacyRoomMusicDefaults(
    normalizeRoomMusicSettings(raw),
    raw
  );
}

export function readRoomBilibiliDanmakuSettings() {
  const raw = readJson(
    ROOM_BILIBILI_DANMAKU_SETTINGS_KEY,
    clone(DEFAULT_ROOM_BILIBILI_DANMAKU_SETTINGS)
  );
  return upgradeLegacyRoomBilibiliDefaults(
    normalizeRoomBilibiliDanmakuSettings(raw),
    raw
  );
}

export function normalizeRoomMinecraftSettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_MINECRAFT_SETTINGS, ...(settings || {}) };
  return {
    enabled: asBoolean(merged.enabled),
    trustedServerAcknowledged: asBoolean(merged.trustedServerAcknowledged),
    host: asText(merged.host).slice(0, 255) || DEFAULT_ROOM_MINECRAFT_SETTINGS.host,
    port: Math.round(asNumber(merged.port, DEFAULT_ROOM_MINECRAFT_SETTINGS.port, 1, 65535)),
    username: asText(merged.username).slice(0, 80) || DEFAULT_ROOM_MINECRAFT_SETTINGS.username,
    auth: asText(merged.auth).toLowerCase() === 'microsoft' ? 'microsoft' : 'offline',
    version: asText(merged.version).slice(0, 32),
    autonomousPlay: merged.autonomousPlay !== false,
    decisionIntervalMs: Math.round(asNumber(merged.decisionIntervalMs, DEFAULT_ROOM_MINECRAFT_SETTINGS.decisionIntervalMs, 3000, 30000)),
    autoReconnect: merged.autoReconnect !== false,
    maxRetries: Math.round(asNumber(merged.maxRetries, DEFAULT_ROOM_MINECRAFT_SETTINGS.maxRetries, 0, 20)),
    healthThreshold: Math.round(asNumber(merged.healthThreshold, DEFAULT_ROOM_MINECRAFT_SETTINGS.healthThreshold, 2, 18))
  };
}

export function readRoomVisionSettings() {
  return normalizeRoomVisionSettings(readJson(ROOM_VISION_SETTINGS_KEY, clone(DEFAULT_ROOM_VISION_SETTINGS)));
}

export function readRoomMinecraftSettings() {
  return normalizeRoomMinecraftSettings(readJson(ROOM_MINECRAFT_SETTINGS_KEY, clone(DEFAULT_ROOM_MINECRAFT_SETTINGS)));
}

export function writeRoomLLMSettings(settings) {
  const normalized = normalizeRoomLLMSettings(settings);
  writeJson(ROOM_LLM_SETTINGS_KEY, normalized);
  return normalized;
}

export function writeRoomTTSSettings(settings) {
  const normalized = normalizeRoomTTSSettings(settings);
  writeJson(ROOM_TTS_SETTINGS_KEY, normalized);
  return normalized;
}

export function writeRoomASRSettings(settings) {
  const normalized = normalizeRoomASRSettings(settings);
  writeJson(ROOM_ASR_SETTINGS_KEY, normalized);
  return normalized;
}

export function writeRoomModelSettings(settings) {
  const normalized = normalizeRoomModelSettings(settings);
  writeJson(ROOM_MODEL_SETTINGS_KEY, normalized);
  return normalized;
}

export function writeRoomVTubeStudioSettings(settings) {
  const normalized = normalizeRoomVTubeStudioSettings(settings);
  writeJson(ROOM_VTS_SETTINGS_KEY, normalized);
  return normalized;
}

export function writeRoomMemorySettings(settings) {
  const normalized = normalizeRoomMemorySettings(settings);
  writeJson(ROOM_MEMORY_SETTINGS_KEY, normalized);
  return normalized;
}

export function writeRoomMusicSettings(settings) {
  const normalized = normalizeRoomMusicSettings(settings);
  writeJson(ROOM_MUSIC_SETTINGS_KEY, normalized);
  return normalized;
}

export function writeRoomBilibiliDanmakuSettings(settings) {
  const normalized = normalizeRoomBilibiliDanmakuSettings(settings);
  writeJson(ROOM_BILIBILI_DANMAKU_SETTINGS_KEY, normalized);
  return normalized;
}

export function writeRoomVisionSettings(settings) {
  const normalized = normalizeRoomVisionSettings(settings);
  writeJson(ROOM_VISION_SETTINGS_KEY, normalized);
  return normalized;
}

export function writeRoomMinecraftSettings(settings) {
  const normalized = normalizeRoomMinecraftSettings(settings);
  writeJson(ROOM_MINECRAFT_SETTINGS_KEY, normalized);
  return normalized;
}

export function readRoomStudioSettings() {
  return {
    llm: readRoomLLMSettings(),
    tts: readRoomTTSSettings(),
    asr: readRoomASRSettings(),
    model: readRoomModelSettings(),
    vts: readRoomVTubeStudioSettings(),
    memory: readRoomMemorySettings(),
    music: readRoomMusicSettings(),
    bilibiliDanmaku: readRoomBilibiliDanmakuSettings(),
    vision: readRoomVisionSettings(),
    minecraft: readRoomMinecraftSettings()
  };
}
