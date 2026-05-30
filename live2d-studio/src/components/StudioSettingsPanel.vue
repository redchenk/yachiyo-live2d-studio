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
import {
  deleteLive2DMemoryNote,
  initializeLive2DMemoryVault,
  listLive2DMemoryNotes,
  searchLive2DMemory,
  setLive2DMemoryNoteDisabled,
  rebuildLive2DMemoryIndex
} from '@frontend/services/room/live2dMemory';

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

const memoryProviderOptions = [
  { value: 'obsidian', label: 'Obsidian Vault' },
  { value: 'sqlite-milvus', label: 'SQLite + Milvus' }
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
  { value: 'index', label: 'index' },
  { value: 'hybrid', label: 'hybrid' },
  { value: 'vector', label: 'vector' }
];

const activeTab = ref('llm');
const status = ref('');
const memoryBusy = ref('');
const memoryManagePath = ref('');
const memorySearchQuery = ref('');
const memoryNotes = ref([]);
const memoryResultMode = ref('idle');
const llm = reactive(readRoomLLMSettings());
const tts = reactive(readRoomTTSSettings());
const model = reactive(readRoomModelSettings());
const vts = reactive(readRoomVTubeStudioSettings());
const memory = reactive(readRoomMemorySettings());

let statusTimer = 0;

const localTts = computed(() => tts.provider === 'gpt-sovits');
const sqliteMemory = computed(() => memory.provider === 'sqlite-milvus' || memory.provider === 'sqlite');
const memoryStats = computed(() => {
  const notes = Array.isArray(memoryNotes.value) ? memoryNotes.value : [];
  const disabled = notes.filter((note) => note?.disabled).length;
  const active = Math.max(0, notes.length - disabled);
  return {
    total: notes.length,
    active,
    disabled
  };
});
const selectedMemoryNote = computed(() => {
  const path = memoryManagePath.value.trim();
  if (!path) return null;
  return memoryNotes.value.find((note) => note?.path === path) || null;
});
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

function noteTitle(note) {
  return String(note?.title || note?.path || 'Memory note').trim();
}

function notePath(note) {
  return String(note?.path || '').trim();
}

function noteTypeLabel(note) {
  return [note?.type, note?.scope].map((item) => String(item || '').trim()).filter(Boolean).join(' / ') || 'memory';
}

function noteSummary(note) {
  return String(note?.summary || note?.content || '').replace(/\s+/g, ' ').trim();
}

function noteTags(note) {
  return Array.isArray(note?.tags) ? note.tags.filter(Boolean).slice(0, 5) : [];
}

function noteScoreLabel(note) {
  const importance = Number(note?.importance);
  const confidence = Number(note?.confidence);
  const parts = [];
  if (Number.isFinite(importance)) parts.push(`I ${importance.toFixed(2)}`);
  if (Number.isFinite(confidence)) parts.push(`C ${confidence.toFixed(2)}`);
  return parts.join(' · ');
}

function selectMemoryNote(note) {
  const path = notePath(note);
  if (path) memoryManagePath.value = path;
}

function setMemoryNotes(notes, mode) {
  memoryNotes.value = Array.isArray(notes) ? notes.filter(Boolean) : [];
  memoryResultMode.value = mode;
  if (!memoryManagePath.value.trim() && memoryNotes.value.length) {
    memoryManagePath.value = notePath(memoryNotes.value[0]);
  }
}

function updateMemoryNote(path, patch = {}) {
  memoryNotes.value = memoryNotes.value.map((note) => (
    notePath(note) === path ? { ...note, ...patch } : note
  ));
}

function removeMemoryNote(path) {
  memoryNotes.value = memoryNotes.value.filter((note) => notePath(note) !== path);
  if (memoryManagePath.value.trim() === path) {
    memoryManagePath.value = memoryNotes.value.length ? notePath(memoryNotes.value[0]) : '';
  }
}

async function runMemoryTool(action, label) {
  if (memoryBusy.value) return;
  memoryBusy.value = action;
  let shouldRefreshNotes = false;
  try {
    const savedMemory = writeRoomMemorySettings(memory);
    Object.assign(memory, savedMemory);
    const result = action === 'init'
      ? await initializeLive2DMemoryVault(savedMemory)
      : await rebuildLive2DMemoryIndex(savedMemory);
    const detail = action === 'init'
      ? `${result.created || 0} created, ${result.indexed || 0} indexed`
      : `${result.indexed || 0} indexed`;
    setStatus(`${label}: ${detail}`);
    shouldRefreshNotes = true;
  } catch (error) {
    setStatus(error?.message || `${label} failed`);
  } finally {
    memoryBusy.value = '';
  }
  if (shouldRefreshNotes) await listMemoryNotes(true);
}

async function listMemoryNotes(silent = false) {
  if (memoryBusy.value) return;
  memoryBusy.value = 'list';
  try {
    const savedMemory = writeRoomMemorySettings(memory);
    Object.assign(memory, savedMemory);
    const result = await listLive2DMemoryNotes({ includeDisabled: true, maxNotes: 500 }, savedMemory);
    const disabledCount = (result.notes || []).filter((note) => note.disabled).length;
    setMemoryNotes(result.notes || [], 'list');
    if (!silent) setStatus(`Memory notes: ${(result.notes || []).length}, disabled: ${disabledCount}`);
  } catch (error) {
    setStatus(error?.message || 'List notes failed');
  } finally {
    memoryBusy.value = '';
  }
}

async function searchMemoryNotes() {
  if (memoryBusy.value) return;
  const query = memorySearchQuery.value.trim();
  if (!query) {
    await listMemoryNotes();
    return;
  }
  memoryBusy.value = 'search';
  try {
    const savedMemory = writeRoomMemorySettings(memory);
    Object.assign(memory, savedMemory);
    const notes = await searchLive2DMemory(query, {
      maxNotes: Math.max(1, Number(savedMemory.maxNotesPerTurn) || 3)
    });
    setMemoryNotes(notes, 'search');
    setStatus(`Search results: ${notes.length}`);
  } catch (error) {
    setStatus(error?.message || 'Search failed');
  } finally {
    memoryBusy.value = '';
  }
}

async function setManagedMemoryDisabled(disabled, targetPath = '') {
  const path = String(targetPath || memoryManagePath.value).trim();
  if (!path || memoryBusy.value) return;
  memoryBusy.value = disabled ? 'disable' : 'enable';
  try {
    const savedMemory = writeRoomMemorySettings(memory);
    Object.assign(memory, savedMemory);
    await setLive2DMemoryNoteDisabled(path, disabled, savedMemory);
    updateMemoryNote(path, { disabled });
    memoryManagePath.value = path;
    setStatus(disabled ? 'Memory note disabled' : 'Memory note enabled');
  } catch (error) {
    setStatus(error?.message || 'Memory update failed');
  } finally {
    memoryBusy.value = '';
  }
}

async function deleteManagedMemoryNote(targetPath = '') {
  const path = String(targetPath || memoryManagePath.value).trim();
  if (!path || memoryBusy.value) return;
  if (!window.confirm(`Move this memory note to 00_Inbox/deleted?\n${path}`)) return;
  memoryBusy.value = 'delete';
  try {
    const savedMemory = writeRoomMemorySettings(memory);
    Object.assign(memory, savedMemory);
    const result = await deleteLive2DMemoryNote(path, savedMemory);
    removeMemoryNote(path);
    setStatus(`Memory note moved: ${result.deletedPath}`);
  } catch (error) {
    setStatus(error?.message || 'Delete note failed');
  } finally {
    memoryBusy.value = '';
  }
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
        <label class="studio-check-row">
          <input v-model="model.stageFloatEnabled" type="checkbox">
          <span>Stage float</span>
        </label>
        <label>
          <span>Render Scale</span>
          <select v-model.number="model.renderDpr">
            <option v-for="option in renderDprOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>Idle Float</span>
          <input v-model.number="model.stageIdleScale" type="number" min="0" max="3" step="0.1">
        </label>
        <label>
          <span>Motion Float</span>
          <input v-model.number="model.stageMotionScale" type="number" min="0" max="3" step="0.1">
        </label>
        <label>
          <span>Vertical Offset</span>
          <input v-model.number="model.stageVerticalOffset" type="number" min="-180" max="180" step="1">
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
        <div class="studio-memory-console studio-wide-field">
          <div class="studio-memory-toolbar">
            <label class="studio-check-row">
              <input v-model="memory.enabled" type="checkbox">
              <span>Enable memory</span>
            </label>
            <div class="studio-memory-stats" aria-label="Memory note counts">
              <span>{{ memoryStats.active }} Active</span>
              <span>{{ memoryStats.disabled }} Disabled</span>
              <span>{{ memoryStats.total }} Total</span>
            </div>
          </div>

          <label>
            <span>Provider</span>
            <select v-model="memory.provider">
              <option v-for="option in memoryProviderOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>

          <label v-if="!sqliteMemory">
            <span>Vault Path</span>
            <input v-model="memory.vaultPath" type="text" spellcheck="false" placeholder="D:\Obsidian\YachiyoMemoryVault">
          </label>

          <template v-else>
            <label>
              <span>SQLite Path</span>
              <input v-model="memory.databasePath" type="text" spellcheck="false" placeholder="%LOCALAPPDATA%\YachiyoLive2DStudio\MemoryData\yachiyo-memory.sqlite">
            </label>
            <label>
              <span>Import Vault Path</span>
              <input v-model="memory.vaultPath" type="text" spellcheck="false" placeholder="Optional Obsidian vault to import">
            </label>
            <div class="studio-memory-switches">
              <label class="studio-check-row">
                <input v-model="memory.milvusEnabled" type="checkbox">
                <span>Milvus vector index</span>
              </label>
              <label class="studio-check-row">
                <input v-model="memory.milvusManaged" type="checkbox">
                <span>Managed Milvus</span>
              </label>
            </div>
            <div class="studio-memory-grid">
              <label>
                <span>Milvus URL</span>
                <input v-model="memory.milvusUrl" type="text" spellcheck="false" placeholder="http://127.0.0.1:19530">
              </label>
              <label>
                <span>Collection</span>
                <input v-model="memory.milvusCollection" type="text" spellcheck="false" placeholder="yachiyo_memory">
              </label>
              <label>
                <span>Vector Dim</span>
                <input v-model.number="memory.embeddingDimension" type="number" min="32" max="4096">
              </label>
            </div>
            <label>
              <span>Milvus Image</span>
              <input v-model="memory.milvusImage" type="text" spellcheck="false" placeholder="milvusdb/milvus:latest">
            </label>
            <label>
              <span>Milvus Token</span>
              <input v-model="memory.milvusToken" type="password" spellcheck="false" placeholder="Optional, e.g. root:Milvus">
            </label>
            <div class="studio-memory-grid">
              <label>
                <span>Embedding URL</span>
                <input v-model="memory.embeddingApiUrl" type="text" spellcheck="false" placeholder="Optional OpenAI-compatible embeddings endpoint">
              </label>
              <label>
                <span>Embedding Model</span>
                <input v-model="memory.embeddingModel" type="text" spellcheck="false" placeholder="text-embedding-3-small">
              </label>
            </div>
            <label>
              <span>Embedding Key</span>
              <input v-model="memory.embeddingApiKey" type="password" spellcheck="false" placeholder="Optional API key">
            </label>
          </template>

          <div class="studio-memory-grid">
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
          </div>

          <div class="studio-memory-switches">
            <label class="studio-check-row">
              <input v-model="memory.allowViewerMemory" type="checkbox">
              <span>Viewer memory</span>
            </label>
            <label class="studio-check-row">
              <input v-model="memory.allowSessionMemory" type="checkbox">
              <span>Session memory</span>
            </label>
          </div>

          <div class="studio-memory-actions">
            <button
              class="studio-secondary-btn"
              type="button"
              :disabled="Boolean(memoryBusy)"
              @click="runMemoryTool('init', 'Vault initialized')"
            >
              Initialize Vault
            </button>
            <button
              class="studio-secondary-btn"
              type="button"
              :disabled="Boolean(memoryBusy)"
              @click="runMemoryTool('reindex', 'Index rebuilt')"
            >
              Rebuild Index
            </button>
            <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy)" @click="listMemoryNotes()">
              List Notes
            </button>
          </div>

          <div class="studio-memory-search">
            <label>
              <span>Search Memory</span>
              <input
                v-model="memorySearchQuery"
                type="search"
                spellcheck="false"
                placeholder="stage fright, live2d, viewer..."
                @keydown.enter.prevent="searchMemoryNotes"
              >
            </label>
            <button class="studio-primary-btn" type="button" :disabled="Boolean(memoryBusy)" @click="searchMemoryNotes">
              Search
            </button>
          </div>

          <label>
            <span>Selected Note Path</span>
            <input v-model="memoryManagePath" type="text" spellcheck="false" placeholder="03_Viewers/viewer-redchenk.md">
          </label>

          <div class="studio-memory-actions">
            <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy) || !memoryManagePath.trim()" @click="setManagedMemoryDisabled(true)">
              Disable
            </button>
            <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy) || !memoryManagePath.trim()" @click="setManagedMemoryDisabled(false)">
              Enable
            </button>
            <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy) || !memoryManagePath.trim()" @click="deleteManagedMemoryNote()">
              Delete
            </button>
          </div>

          <div class="studio-memory-results" aria-live="polite">
            <div class="studio-memory-results-head">
              <span>{{ memoryResultMode === 'search' ? 'Search Results' : 'Vault Notes' }}</span>
              <small>{{ memoryNotes.length }} notes</small>
            </div>
            <div v-if="memoryNotes.length" class="studio-memory-note-list">
              <article
                v-for="note in memoryNotes"
                :key="notePath(note)"
                class="studio-memory-note"
                :class="{ selected: memoryManagePath.trim() === notePath(note), disabled: note.disabled }"
                @click="selectMemoryNote(note)"
              >
                <header>
                  <div>
                    <strong>{{ noteTitle(note) }}</strong>
                    <span>{{ noteTypeLabel(note) }}</span>
                  </div>
                  <em v-if="note.disabled">Disabled</em>
                </header>
                <code>{{ notePath(note) }}</code>
                <p v-if="noteSummary(note)">{{ noteSummary(note) }}</p>
                <footer>
                  <div class="studio-memory-tags">
                    <span v-for="tag in noteTags(note)" :key="`${notePath(note)}-${tag}`">#{{ tag }}</span>
                  </div>
                  <small>{{ noteScoreLabel(note) }}</small>
                </footer>
                <div class="studio-memory-note-actions">
                  <button
                    class="studio-secondary-btn"
                    type="button"
                    :disabled="Boolean(memoryBusy)"
                    @click.stop="setManagedMemoryDisabled(!note.disabled, notePath(note))"
                  >
                    {{ note.disabled ? 'Enable' : 'Disable' }}
                  </button>
                  <button
                    class="studio-secondary-btn"
                    type="button"
                    :disabled="Boolean(memoryBusy)"
                    @click.stop="deleteManagedMemoryNote(notePath(note))"
                  >
                    Delete
                  </button>
                </div>
              </article>
            </div>
            <div v-else class="studio-memory-empty">
              {{ memoryBusy ? 'Loading memory...' : 'No memory notes loaded' }}
            </div>
          </div>

          <div v-if="selectedMemoryNote" class="studio-memory-selected">
            <span>Selected</span>
            <strong>{{ noteTitle(selectedMemoryNote) }}</strong>
          </div>
        </div>
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
