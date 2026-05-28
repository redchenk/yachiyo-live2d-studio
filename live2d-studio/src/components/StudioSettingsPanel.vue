<script setup>
import { computed, onUnmounted, reactive, ref } from 'vue';
import TsIcon from '@frontend/components/TsIcon.vue';
import {
  DEFAULT_ROOM_LLM_SETTINGS,
  DEFAULT_ROOM_MEMORY_SETTINGS,
  DEFAULT_ROOM_MODEL_SETTINGS,
  DEFAULT_ROOM_TTS_SETTINGS,
  DEFAULT_ROOM_VTS_SETTINGS,
  DEFAULT_MIMO_TTS_API_URL,
  DEFAULT_MIMO_TTS_MODEL,
  DEFAULT_MIMO_TTS_VOICE,
  normalizeRoomLLMSettings,
  normalizeRoomMemorySettings,
  normalizeRoomModelSettings,
  normalizeRoomTTSSettings,
  normalizeRoomVTubeStudioSettings,
  readRoomLLMSettings,
  readRoomMemorySettings,
  readRoomModelSettings,
  readRoomTTSSettings,
  readRoomVTubeStudioSettings,
  writeRoomLLMSettings,
  writeRoomMemorySettings,
  writeRoomModelSettings,
  writeRoomTTSSettings,
  writeRoomVTubeStudioSettings
} from '@frontend/services/room/roomSettings';

defineEmits(['close']);

const tabs = [
  { id: 'llm', label: 'LLM' },
  { id: 'tts', label: 'TTS' },
  { id: 'model', label: 'Model' },
  { id: 'vts', label: 'VTS' },
  { id: 'memory', label: 'Memory' }
];

const providerOptions = [
  { value: 'gpt-sovits', label: 'GPT-SoVITS' },
  { value: 'mimo', label: 'Xiaomi MiMo' },
  { value: 'openai', label: 'OpenAI TTS' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'custom', label: 'Custom Proxy' }
];

const renderDprOptions = [
  { value: 1, label: '1x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
  { value: 2.5, label: '2.5x' },
  { value: 3, label: '3x' }
];

const languageOptions = [
  { value: 'auto', label: 'auto' },
  { value: 'zh', label: 'zh' },
  { value: 'ja', label: 'ja' },
  { value: 'en', label: 'en' },
  { value: 'ko', label: 'ko' },
  { value: 'yue', label: 'yue' }
];

const writeModeOptions = [
  { value: 'off', label: 'off' },
  { value: 'inbox-only', label: 'inbox-only' },
  { value: 'auto-approved', label: 'auto-approved' }
];

const retrievalModeOptions = [
  { value: 'off', label: 'off' },
  { value: 'tags', label: 'tags' },
  { value: 'index', label: 'index' }
];

const activeTab = ref('llm');
const status = ref('');
const llm = reactive(readRoomLLMSettings());
const tts = reactive(readRoomTTSSettings());
const model = reactive(readRoomModelSettings());
const vts = reactive(readRoomVTubeStudioSettings());
const memory = reactive(readRoomMemorySettings());

let statusTimer = 0;

const localTts = computed(() => tts.provider === 'gpt-sovits');
const ttsApiPlaceholder = computed(() => {
  if (tts.provider === 'openai') return 'https://api.openai.com/v1/audio/speech';
  if (tts.provider === 'mimo') return DEFAULT_MIMO_TTS_API_URL;
  if (tts.provider === 'gpt-sovits') return 'http://localhost:9880/tts';
  return 'https://api.example.com/v1/audio/speech';
});

function setStatus(text) {
  status.value = text;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    status.value = '';
  }, 2600);
}

function reloadSettings() {
  Object.assign(llm, readRoomLLMSettings());
  Object.assign(tts, readRoomTTSSettings());
  Object.assign(model, readRoomModelSettings());
  Object.assign(vts, readRoomVTubeStudioSettings());
  Object.assign(memory, readRoomMemorySettings());
  setStatus('Reloaded');
}

function resetCurrentTab() {
  if (activeTab.value === 'llm') {
    Object.assign(llm, normalizeRoomLLMSettings(DEFAULT_ROOM_LLM_SETTINGS));
  } else if (activeTab.value === 'tts') {
    Object.assign(tts, normalizeRoomTTSSettings(DEFAULT_ROOM_TTS_SETTINGS));
  } else if (activeTab.value === 'model') {
    Object.assign(model, normalizeRoomModelSettings(DEFAULT_ROOM_MODEL_SETTINGS));
  } else if (activeTab.value === 'vts') {
    Object.assign(vts, normalizeRoomVTubeStudioSettings(DEFAULT_ROOM_VTS_SETTINGS));
  } else {
    Object.assign(memory, normalizeRoomMemorySettings(DEFAULT_ROOM_MEMORY_SETTINGS));
  }
  setStatus('Defaults loaded');
}

function applyTtsProvider() {
  if (tts.provider === 'gpt-sovits') {
    Object.assign(tts, {
      apiUrl: DEFAULT_ROOM_TTS_SETTINGS.apiUrl,
      apiKey: '',
      model: 'auto',
      voice: '',
      useProxy: false,
      textLang: tts.textLang || 'auto',
      promptLang: tts.promptLang || 'ja'
    });
    return;
  }

  if (tts.provider === 'openai') {
    Object.assign(tts, {
      apiUrl: 'https://api.openai.com/v1/audio/speech',
      model: 'tts-1',
      voice: 'alloy',
      useProxy: true
    });
    return;
  }

  if (tts.provider === 'mimo') {
    Object.assign(tts, {
      apiUrl: DEFAULT_MIMO_TTS_API_URL,
      model: DEFAULT_MIMO_TTS_MODEL,
      voice: DEFAULT_MIMO_TTS_VOICE,
      useProxy: true
    });
    return;
  }

  Object.assign(tts, {
    apiUrl: 'https://api.example.com/v1/audio/speech',
    model: 'tts-1',
    voice: 'alloy',
    useProxy: true
  });
}

function saveSettings() {
  const savedLLM = writeRoomLLMSettings(llm);
  const savedTTS = writeRoomTTSSettings({
    ...tts,
    useProxy: tts.provider === 'gpt-sovits' ? false : true
  });
  const savedModel = writeRoomModelSettings(model);
  const savedVTS = writeRoomVTubeStudioSettings(vts);
  const savedMemory = writeRoomMemorySettings(memory);

  Object.assign(llm, savedLLM);
  Object.assign(tts, savedTTS);
  Object.assign(model, savedModel);
  Object.assign(vts, savedVTS);
  Object.assign(memory, savedMemory);
  window.dispatchEvent(new CustomEvent('tsukuyomi:studio-settings-saved', {
    detail: { llm: savedLLM, tts: savedTTS, model: savedModel, vts: savedVTS, memory: savedMemory }
  }));
  setStatus('Saved');
}

onUnmounted(() => {
  window.clearTimeout(statusTimer);
});
</script>

<template>
  <aside class="studio-settings-panel" role="dialog" aria-label="Studio settings">
    <header class="studio-settings-header">
      <div>
        <span>Yachiyo Studio</span>
        <strong>Settings</strong>
      </div>
      <button class="studio-icon-btn" type="button" title="Close settings" aria-label="Close settings" @click="$emit('close')">
        <TsIcon name="x" :size="18" />
      </button>
    </header>

    <nav class="studio-settings-tabs" aria-label="Settings sections">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>

    <form class="studio-settings-form" @submit.prevent="saveSettings">
      <section v-if="activeTab === 'llm'" class="studio-settings-section">
        <label>
          <span>API URL</span>
          <input v-model="llm.apiUrl" type="text" spellcheck="false" placeholder="https://api.openai.com/v1/chat/completions">
        </label>
        <label>
          <span>API Key</span>
          <input v-model="llm.apiKey" type="password" spellcheck="false" placeholder="sk-...">
        </label>
        <label>
          <span>Model</span>
          <input v-model="llm.model" type="text" spellcheck="false" placeholder="gpt-4o-mini">
        </label>
        <label class="studio-check-row">
          <input v-model="llm.useProxy" type="checkbox">
          <span>Use local proxy</span>
        </label>
        <label class="studio-wide-field">
          <span>System Prompt</span>
          <textarea v-model="llm.systemPrompt" rows="5" spellcheck="false" placeholder="Optional extra behavior for Yachiyo"></textarea>
        </label>
      </section>

      <section v-else-if="activeTab === 'tts'" class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="tts.enabled" type="checkbox">
          <span>Enable voice</span>
        </label>
        <label>
          <span>Provider</span>
          <select v-model="tts.provider" @change="applyTtsProvider">
            <option v-for="option in providerOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>API URL</span>
          <input v-model="tts.apiUrl" type="text" spellcheck="false" :placeholder="ttsApiPlaceholder">
        </label>
        <label v-if="!localTts">
          <span>API Key</span>
          <input v-model="tts.apiKey" type="password" spellcheck="false" placeholder="sk-...">
        </label>
        <label>
          <span>{{ localTts ? 'Text Lang' : 'Model' }}</span>
          <select v-if="localTts" v-model="tts.textLang">
            <option v-for="option in languageOptions" :key="`text-${option.value}`" :value="option.value">{{ option.label }}</option>
          </select>
          <input v-else v-model="tts.model" type="text" spellcheck="false" placeholder="tts-1">
        </label>
        <label v-if="!localTts">
          <span>Voice</span>
          <input v-model="tts.voice" type="text" spellcheck="false" placeholder="alloy">
        </label>

        <template v-if="localTts">
          <label>
            <span>Ref Audio</span>
            <input v-model="tts.refAudioPath" type="text" spellcheck="false" placeholder="E:\visualstudio\tts\reference\yachiyo.wav">
          </label>
          <label>
            <span>Prompt Text</span>
            <input v-model="tts.promptText" type="text" spellcheck="false" placeholder="Reference audio text">
          </label>
          <label>
            <span>Prompt Lang</span>
            <select v-model="tts.promptLang">
              <option v-for="option in languageOptions" :key="`prompt-${option.value}`" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label>
            <span>GPT Weight</span>
            <input v-model="tts.gptWeightPath" type="text" spellcheck="false" placeholder="GPT_weights_v2ProPlus/yachiyo-v2pro-e15.ckpt">
          </label>
          <label>
            <span>SoVITS Weight</span>
            <input v-model="tts.sovitsWeightPath" type="text" spellcheck="false" placeholder="SoVITS_weights_v2ProPlus/yachiyo-v2pro_e8_s456.pth">
          </label>
        </template>
      </section>

      <section v-else-if="activeTab === 'model'" class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="model.lowQualityModel" type="checkbox">
          <span>Low quality model</span>
        </label>
        <label>
          <span>Render Scale</span>
          <select v-model.number="model.renderDpr">
            <option v-for="option in renderDprOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
      </section>

      <section v-else-if="activeTab === 'vts'" class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="vts.enabled" type="checkbox">
          <span>Use VTube Studio as output</span>
        </label>
        <label>
          <span>WebSocket URL</span>
          <input v-model="vts.apiUrl" type="text" spellcheck="false" placeholder="ws://127.0.0.1:8001">
        </label>
        <label>
          <span>Plugin Name</span>
          <input v-model="vts.pluginName" type="text" spellcheck="false" placeholder="Yachiyo Live2D Studio">
        </label>
        <label>
          <span>Developer</span>
          <input v-model="vts.pluginDeveloper" type="text" spellcheck="false" placeholder="redchenk">
        </label>
        <label class="studio-check-row">
          <input v-model="vts.injectFace" type="checkbox">
          <span>Face tracking</span>
        </label>
        <label class="studio-check-row">
          <input v-model="vts.injectBody" type="checkbox">
          <span>Body motion</span>
        </label>
        <label class="studio-check-row">
          <input v-model="vts.injectMouth" type="checkbox">
          <span>Mouth sync</span>
        </label>
      </section>

      <section v-else class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="memory.enabled" type="checkbox">
          <span>Enable Obsidian memory</span>
        </label>
        <label>
          <span>Vault Path</span>
          <input v-model="memory.vaultPath" type="text" spellcheck="false" placeholder="D:\Obsidian\YachiyoMemoryVault">
        </label>
        <label>
          <span>Retrieval</span>
          <select v-model="memory.retrievalMode">
            <option v-for="option in retrievalModeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>Write Mode</span>
          <select v-model="memory.writeMode">
            <option v-for="option in writeModeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>Max Notes</span>
          <input v-model.number="memory.maxNotesPerTurn" type="number" min="1" max="8">
        </label>
        <label class="studio-check-row">
          <input v-model="memory.allowViewerMemory" type="checkbox">
          <span>Viewer memory</span>
        </label>
        <label class="studio-check-row">
          <input v-model="memory.allowSessionMemory" type="checkbox">
          <span>Session memory</span>
        </label>
      </section>

      <footer class="studio-settings-actions">
        <span class="studio-settings-status" aria-live="polite">{{ status }}</span>
        <button class="studio-secondary-btn" type="button" @click="reloadSettings">Reload</button>
        <button class="studio-secondary-btn" type="button" @click="resetCurrentTab">Defaults</button>
        <button class="studio-primary-btn" type="submit">
          <TsIcon name="save" :size="16" />
          <span>Save</span>
        </button>
      </footer>
    </form>
  </aside>
</template>
