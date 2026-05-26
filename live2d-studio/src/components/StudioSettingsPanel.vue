<script setup>
import { computed, onUnmounted, reactive, ref } from 'vue';
import TsIcon from '@frontend/components/TsIcon.vue';
import {
  DEFAULT_ROOM_LLM_SETTINGS,
  DEFAULT_ROOM_MODEL_SETTINGS,
  DEFAULT_ROOM_TTS_SETTINGS,
  normalizeRoomLLMSettings,
  normalizeRoomModelSettings,
  normalizeRoomTTSSettings,
  readRoomLLMSettings,
  readRoomModelSettings,
  readRoomTTSSettings,
  writeRoomLLMSettings,
  writeRoomModelSettings,
  writeRoomTTSSettings
} from '@frontend/services/room/roomSettings';

defineEmits(['close']);

const tabs = [
  { id: 'llm', label: 'LLM' },
  { id: 'tts', label: 'TTS' },
  { id: 'model', label: 'Model' }
];

const providerOptions = [
  { value: 'gpt-sovits', label: 'GPT-SoVITS' },
  { value: 'openai', label: 'OpenAI TTS' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'custom', label: 'Custom Proxy' }
];

const languageOptions = [
  { value: 'auto', label: 'auto' },
  { value: 'zh', label: 'zh' },
  { value: 'ja', label: 'ja' },
  { value: 'en', label: 'en' },
  { value: 'ko', label: 'ko' },
  { value: 'yue', label: 'yue' }
];

const activeTab = ref('llm');
const status = ref('');
const llm = reactive(readRoomLLMSettings());
const tts = reactive(readRoomTTSSettings());
const model = reactive(readRoomModelSettings());

let statusTimer = 0;

const localTts = computed(() => tts.provider === 'gpt-sovits');
const ttsApiPlaceholder = computed(() => {
  if (tts.provider === 'openai') return 'https://api.openai.com/v1/audio/speech';
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
  setStatus('Reloaded');
}

function resetCurrentTab() {
  if (activeTab.value === 'llm') {
    Object.assign(llm, normalizeRoomLLMSettings(DEFAULT_ROOM_LLM_SETTINGS));
  } else if (activeTab.value === 'tts') {
    Object.assign(tts, normalizeRoomTTSSettings(DEFAULT_ROOM_TTS_SETTINGS));
  } else {
    Object.assign(model, normalizeRoomModelSettings(DEFAULT_ROOM_MODEL_SETTINGS));
  }
  setStatus('Defaults loaded');
}

function applyTtsProvider() {
  if (tts.provider === 'gpt-sovits') {
    Object.assign(tts, {
      apiUrl: tts.apiUrl || DEFAULT_ROOM_TTS_SETTINGS.apiUrl,
      apiKey: '',
      model: 'auto',
      useProxy: false,
      textLang: tts.textLang || 'auto',
      promptLang: tts.promptLang || 'ja'
    });
    return;
  }

  if (tts.provider === 'openai') {
    Object.assign(tts, {
      apiUrl: tts.apiUrl || 'https://api.openai.com/v1/audio/speech',
      model: tts.model && tts.model !== 'auto' ? tts.model : 'tts-1',
      voice: tts.voice || 'alloy',
      useProxy: true
    });
    return;
  }

  Object.assign(tts, {
    model: tts.model && tts.model !== 'auto' ? tts.model : 'tts-1',
    voice: tts.voice || 'alloy',
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

  Object.assign(llm, savedLLM);
  Object.assign(tts, savedTTS);
  Object.assign(model, savedModel);
  window.dispatchEvent(new CustomEvent('tsukuyomi:studio-settings-saved', {
    detail: { llm: savedLLM, tts: savedTTS, model: savedModel }
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

      <section v-else class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="model.lowQualityModel" type="checkbox">
          <span>Low quality model</span>
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
