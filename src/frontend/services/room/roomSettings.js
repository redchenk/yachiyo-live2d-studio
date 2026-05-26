import { readJson, writeJson } from './roomStorage';

export const ROOM_LLM_SETTINGS_KEY = 'roomLLMSettings';
export const ROOM_TTS_SETTINGS_KEY = 'roomTTSSettings';
export const ROOM_MODEL_SETTINGS_KEY = 'roomModelSettings';

export const DEFAULT_GPT_SOVITS_GPT_WEIGHT = 'GPT_weights_v2ProPlus/yachiyo-v2pro-e15.ckpt';
export const DEFAULT_GPT_SOVITS_SOVITS_WEIGHT = 'SoVITS_weights_v2ProPlus/yachiyo-v2pro_e8_s456.pth';

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
  lowQualityModel: false
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
  return {
    enabled: asBoolean(merged.enabled),
    provider,
    apiUrl: asText(merged.apiUrl) || (localGptSovits ? DEFAULT_ROOM_TTS_SETTINGS.apiUrl : ''),
    apiKey: asText(merged.apiKey),
    model: asText(merged.model) || (localGptSovits ? 'auto' : ''),
    voice: asText(merged.voice),
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
    lowQualityModel: asBoolean(merged.lowQualityModel)
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

export function readRoomStudioSettings() {
  return {
    llm: readRoomLLMSettings(),
    tts: readRoomTTSSettings(),
    model: readRoomModelSettings()
  };
}
