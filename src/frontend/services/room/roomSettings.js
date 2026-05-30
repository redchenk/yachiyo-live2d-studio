import { readJson, writeJson } from './roomStorage';

export const ROOM_LLM_SETTINGS_KEY = 'roomLLMSettings';
export const ROOM_TTS_SETTINGS_KEY = 'roomTTSSettings';
export const ROOM_MODEL_SETTINGS_KEY = 'roomModelSettings';
export const ROOM_VTS_SETTINGS_KEY = 'roomVTubeStudioSettings';
export const ROOM_MEMORY_SETTINGS_KEY = 'roomMemorySettings';

export const DEFAULT_GPT_SOVITS_GPT_WEIGHT = 'GPT_weights_v2ProPlus/yachiyo-v2pro-e15.ckpt';
export const DEFAULT_GPT_SOVITS_SOVITS_WEIGHT = 'SoVITS_weights_v2ProPlus/yachiyo-v2pro_e8_s456.pth';
export const DEFAULT_MIMO_TTS_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
export const DEFAULT_MIMO_TTS_MODEL = 'mimo-v2.5-tts';
export const DEFAULT_MIMO_TTS_VOICE = 'mimo_default';

export const DEFAULT_ROOM_LLM_SETTINGS = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  useProxy: true,
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
  textLang: 'auto',
  promptLang: 'ja',
  gptWeightPath: DEFAULT_GPT_SOVITS_GPT_WEIGHT,
  sovitsWeightPath: DEFAULT_GPT_SOVITS_SOVITS_WEIGHT,
  useProxy: false
};

export const DEFAULT_ROOM_MODEL_SETTINGS = {
  lowQualityModel: false,
  renderDpr: 3,
  stageFloatEnabled: true,
  stageIdleScale: 1.35,
  stageMotionScale: 1,
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
  enabled: false,
  provider: 'obsidian',
  vaultPath: '',
  databasePath: '',
  milvusEnabled: false,
  milvusManaged: false,
  milvusUrl: 'http://127.0.0.1:19530',
  milvusToken: '',
  milvusCollection: 'yachiyo_memory',
  milvusImage: 'milvusdb/milvus:latest',
  embeddingApiUrl: '',
  embeddingApiKey: '',
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 384,
  writeMode: 'inbox-only',
  retrievalMode: 'tags',
  maxNotesPerTurn: 3,
  allowViewerMemory: true,
  allowSessionMemory: true
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
  return {
    apiUrl: asText(merged.apiUrl),
    apiKey: asText(merged.apiKey),
    model: asText(merged.model) || DEFAULT_ROOM_LLM_SETTINGS.model,
    useProxy: asBoolean(merged.useProxy),
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
    textLang: asText(merged.textLang) || 'auto',
    promptLang: asText(merged.promptLang) || 'ja',
    gptWeightPath: asText(merged.gptWeightPath) || DEFAULT_GPT_SOVITS_GPT_WEIGHT,
    sovitsWeightPath: asText(merged.sovitsWeightPath) || DEFAULT_GPT_SOVITS_SOVITS_WEIGHT,
    useProxy: localGptSovits ? false : asBoolean(merged.useProxy)
  };
}

export function normalizeRoomModelSettings(settings = {}) {
  const merged = { ...DEFAULT_ROOM_MODEL_SETTINGS, ...(settings || {}) };
  return {
    lowQualityModel: asBoolean(merged.lowQualityModel),
    renderDpr: asNumber(merged.renderDpr, DEFAULT_ROOM_MODEL_SETTINGS.renderDpr, 1, 3),
    stageFloatEnabled: asBoolean(merged.stageFloatEnabled),
    stageIdleScale: asNumber(merged.stageIdleScale, DEFAULT_ROOM_MODEL_SETTINGS.stageIdleScale, 0, 3),
    stageMotionScale: asNumber(merged.stageMotionScale, DEFAULT_ROOM_MODEL_SETTINGS.stageMotionScale, 0, 3),
    stageVerticalOffset: asNumber(merged.stageVerticalOffset, DEFAULT_ROOM_MODEL_SETTINGS.stageVerticalOffset, -180, 180)
  };
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
    allowSessionMemory: asBoolean(merged.allowSessionMemory)
  };
}

export function readRoomLLMSettings() {
  return normalizeRoomLLMSettings(readJson(ROOM_LLM_SETTINGS_KEY, clone(DEFAULT_ROOM_LLM_SETTINGS)));
}

export function readRoomTTSSettings() {
  return normalizeRoomTTSSettings(readJson(ROOM_TTS_SETTINGS_KEY, clone(DEFAULT_ROOM_TTS_SETTINGS)));
}

export function readRoomModelSettings() {
  return normalizeRoomModelSettings(readJson(ROOM_MODEL_SETTINGS_KEY, clone(DEFAULT_ROOM_MODEL_SETTINGS)));
}

export function readRoomVTubeStudioSettings() {
  return normalizeRoomVTubeStudioSettings(readJson(ROOM_VTS_SETTINGS_KEY, clone(DEFAULT_ROOM_VTS_SETTINGS)));
}

export function readRoomMemorySettings() {
  return normalizeRoomMemorySettings(readJson(ROOM_MEMORY_SETTINGS_KEY, clone(DEFAULT_ROOM_MEMORY_SETTINGS)));
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

export function readRoomStudioSettings() {
  return {
    llm: readRoomLLMSettings(),
    tts: readRoomTTSSettings(),
    model: readRoomModelSettings(),
    vts: readRoomVTubeStudioSettings(),
    memory: readRoomMemorySettings()
  };
}
