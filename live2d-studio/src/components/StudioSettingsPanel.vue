<script setup>
import { computed, onUnmounted, reactive, ref } from 'vue';
import TsIcon from '@frontend/components/TsIcon.vue';
import {
  DEFAULT_ROOM_LLM_SETTINGS,
  DEFAULT_ROOM_ASR_SETTINGS,
  DEFAULT_ROOM_MEMORY_SETTINGS,
  DEFAULT_ROOM_MODEL_SETTINGS,
  DEFAULT_ROOM_MUSIC_SETTINGS,
  DEFAULT_ROOM_TTS_SETTINGS,
  DEFAULT_ROOM_VISION_SETTINGS,
  DEFAULT_ROOM_VTS_SETTINGS,
  ROOM_LLM_PROVIDER_OPTIONS,
  ROOM_LLM_VISION_IMAGE_MODE_OPTIONS,
  DEFAULT_MIMO_TTS_API_URL,
  DEFAULT_MIMO_TTS_MODEL,
  DEFAULT_MIMO_TTS_VOICE,
  applyRoomLLMProviderPreset,
  normalizeRoomLLMSettings,
  normalizeRoomASRSettings,
  normalizeRoomMemorySettings,
  normalizeRoomModelSettings,
  normalizeRoomMusicSettings,
  normalizeRoomTTSSettings,
  normalizeRoomVisionSettings,
  normalizeRoomVTubeStudioSettings,
  readRoomLLMSettings,
  readRoomASRSettings,
  readRoomMemorySettings,
  readRoomModelSettings,
  readRoomMusicSettings,
  readRoomTTSSettings,
  readRoomVisionSettings,
  readRoomVTubeStudioSettings,
  writeRoomLLMSettings,
  writeRoomASRSettings,
  writeRoomMemorySettings,
  writeRoomModelSettings,
  writeRoomMusicSettings,
  writeRoomTTSSettings,
  writeRoomVisionSettings,
  writeRoomVTubeStudioSettings
} from '@frontend/services/room/roomSettings';
import {
  authorizeLive2DMusic,
  unauthorizeLive2DMusic
} from '@frontend/services/room/live2dMusic';
import {
  consolidateLive2DMemory,
  deleteLive2DMemoryNote,
  initializeLive2DMemoryVault,
  listLive2DMemoryAnchors,
  listLive2DMemoryNotes,
  readLive2DMemoryProfile,
  runLive2DMemoryGarbageCollection,
  searchLive2DMemory,
  setLive2DMemoryNoteDisabled,
  rebuildLive2DMemoryIndex,
  startManagedLive2DMemoryMilvus
} from '@frontend/services/room/live2dMemory';
import { readLive2DVisionContext } from '@frontend/services/room/live2dVision';

defineEmits(['close']);

const tabs = [
  { id: 'llm', label: 'LLM' },
  { id: 'tts', label: 'TTS' },
  { id: 'asr', label: 'ASR' },
  { id: 'model', label: 'Model' },
  { id: 'vts', label: 'VTS' },
  { id: 'vision', label: 'Vision' },
  { id: 'music', label: 'Music' },
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
  { value: 3, label: '3x' },
  { value: 4, label: '4x' },
  { value: 5, label: '5x' },
  { value: 6, label: '6x' },
  { value: 7, label: '7x' },
  { value: 8, label: '8x' }
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
const musicBusy = ref('');
const visionBusy = ref('');
const visionLastContext = ref(null);
const memoryCells = ref([]);
const memoryScenes = ref([]);
const memoryAnchors = ref([]);
const memoryProfile = ref([]);
const memoryConflicts = ref([]);
const memoryRecollection = ref(null);
const memoryResultMode = ref('idle');
const llm = reactive(readRoomLLMSettings());
const tts = reactive(readRoomTTSSettings());
const asr = reactive(readRoomASRSettings());
const model = reactive(readRoomModelSettings());
const vts = reactive(readRoomVTubeStudioSettings());
const music = reactive(readRoomMusicSettings());
const vision = reactive(readRoomVisionSettings());
const memory = reactive(readRoomMemorySettings());

let statusTimer = 0;

const localTts = computed(() => tts.provider === 'gpt-sovits');
const sqliteMemory = computed(() => memory.provider === 'sqlite-milvus' || memory.provider === 'sqlite');
const musicAuthorized = computed(() => Boolean(music.musicUserToken));
const memoryStats = computed(() => {
  const notes = Array.isArray(memoryNotes.value) ? memoryNotes.value : [];
  const disabled = notes.filter((note) => note?.disabled).length;
  const active = Math.max(0, notes.length - disabled);
  return {
    total: notes.length,
    active,
    disabled,
    cells: memoryCells.value.length,
    scenes: memoryScenes.value.length,
    anchors: memoryAnchors.value.length,
    profile: memoryProfile.value.length,
    conflicts: memoryConflicts.value.length
  };
});
const memoryProviderLabel = computed(() => (
  memoryProviderOptions.find((option) => option.value === memory.provider)?.label || memory.provider || 'Memory'
));
const memoryRetrievalLabel = computed(() => (
  retrievalModeOptions.find((option) => option.value === memory.retrievalMode)?.label || memory.retrievalMode || 'off'
));
const memoryWriteLabel = computed(() => (
  writeModeOptions.find((option) => option.value === memory.writeMode)?.label || memory.writeMode || 'off'
));
const memoryMilvusLabel = computed(() => {
  if (!sqliteMemory.value) return 'Obsidian only';
  if (!memory.milvusEnabled) return 'Milvus off';
  return memory.milvusManaged ? 'Managed Milvus' : 'External Milvus';
});
const memoryStorageLabel = computed(() => (sqliteMemory.value ? 'SQLite primary' : 'Obsidian vault'));
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
  Object.assign(asr, readRoomASRSettings());
  Object.assign(model, readRoomModelSettings());
  Object.assign(vts, readRoomVTubeStudioSettings());
  Object.assign(music, readRoomMusicSettings());
  Object.assign(vision, readRoomVisionSettings());
  Object.assign(memory, readRoomMemorySettings());
  setStatus('Reloaded');
}

function resetCurrentTab() {
  if (activeTab.value === 'llm') {
    Object.assign(llm, normalizeRoomLLMSettings(DEFAULT_ROOM_LLM_SETTINGS));
  } else if (activeTab.value === 'tts') {
    Object.assign(tts, normalizeRoomTTSSettings(DEFAULT_ROOM_TTS_SETTINGS));
  } else if (activeTab.value === 'asr') {
    Object.assign(asr, normalizeRoomASRSettings(DEFAULT_ROOM_ASR_SETTINGS));
  } else if (activeTab.value === 'model') {
    Object.assign(model, normalizeRoomModelSettings(DEFAULT_ROOM_MODEL_SETTINGS));
  } else if (activeTab.value === 'vts') {
    Object.assign(vts, normalizeRoomVTubeStudioSettings(DEFAULT_ROOM_VTS_SETTINGS));
  } else if (activeTab.value === 'music') {
    Object.assign(music, normalizeRoomMusicSettings(DEFAULT_ROOM_MUSIC_SETTINGS));
  } else if (activeTab.value === 'vision') {
    Object.assign(vision, normalizeRoomVisionSettings(DEFAULT_ROOM_VISION_SETTINGS));
  } else {
    Object.assign(memory, normalizeRoomMemorySettings(DEFAULT_ROOM_MEMORY_SETTINGS));
  }
  setStatus('Defaults loaded');
}

function applyLLMProvider() {
  Object.assign(llm, applyRoomLLMProviderPreset(llm, llm.provider));
  setStatus('LLM provider loaded');
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
  const savedASR = writeRoomASRSettings(asr);
  const savedModel = writeRoomModelSettings(model);
  const savedVTS = writeRoomVTubeStudioSettings(vts);
  const savedMusic = writeRoomMusicSettings(music);
  const savedVision = writeRoomVisionSettings(vision);
  const savedMemory = writeRoomMemorySettings(memory);

  Object.assign(llm, savedLLM);
  Object.assign(tts, savedTTS);
  Object.assign(asr, savedASR);
  Object.assign(model, savedModel);
  Object.assign(vts, savedVTS);
  Object.assign(music, savedMusic);
  Object.assign(vision, savedVision);
  Object.assign(memory, savedMemory);
  window.dispatchEvent(new CustomEvent('tsukuyomi:studio-settings-saved', {
    detail: { llm: savedLLM, tts: savedTTS, asr: savedASR, model: savedModel, vts: savedVTS, music: savedMusic, vision: savedVision, memory: savedMemory }
  }));
  setStatus('Saved');
}

async function authorizeMusic() {
  if (musicBusy.value) return;
  musicBusy.value = 'authorize';
  try {
    const savedMusic = writeRoomMusicSettings(music);
    Object.assign(music, savedMusic);
    const authorized = await authorizeLive2DMusic(savedMusic);
    Object.assign(music, authorized);
    setStatus('Apple Music authorized');
  } catch (error) {
    setStatus(error?.message || 'Apple Music authorization failed');
  } finally {
    musicBusy.value = '';
  }
}

async function disconnectMusic() {
  if (musicBusy.value) return;
  musicBusy.value = 'disconnect';
  try {
    const savedMusic = writeRoomMusicSettings(music);
    Object.assign(music, savedMusic);
    const disconnected = await unauthorizeLive2DMusic(savedMusic);
    Object.assign(music, disconnected);
    setStatus('Apple Music disconnected');
  } catch (error) {
    setStatus(error?.message || 'Apple Music disconnect failed');
  } finally {
    musicBusy.value = '';
  }
}

async function probeVisionContext() {
  if (visionBusy.value) return;
  visionBusy.value = 'probe';
  try {
    const savedVision = writeRoomVisionSettings(vision);
    Object.assign(vision, savedVision);
    const result = await readLive2DVisionContext(savedVision);
    visionLastContext.value = result;
    const title = result.pointerWindow?.title || result.foregroundWindow?.title || 'desktop';
    setStatus(result.redacted ? 'Vision redacted sensitive window' : `Vision: ${title}`);
  } catch (error) {
    setStatus(error?.message || 'Vision probe failed');
  } finally {
    visionBusy.value = '';
  }
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
  memoryRecollection.value = notes?.recollection || null;
  memoryResultMode.value = mode;
  if (!memoryManagePath.value.trim() && memoryNotes.value.length) {
    memoryManagePath.value = notePath(memoryNotes.value[0]);
  }
}

function setMemoryLifecycle(result = {}) {
  memoryCells.value = Array.isArray(result.cells) ? result.cells.filter(Boolean) : [];
  memoryScenes.value = Array.isArray(result.scenes) ? result.scenes.filter(Boolean) : [];
  memoryAnchors.value = Array.isArray(result.anchors) ? result.anchors.filter(Boolean) : [];
  memoryProfile.value = Array.isArray(result.profile) ? result.profile.filter(Boolean) : [];
  memoryConflicts.value = Array.isArray(result.conflicts) ? result.conflicts.filter(Boolean) : [];
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
      : action === 'consolidate'
        ? await consolidateLive2DMemory(savedMemory)
        : await rebuildLive2DMemoryIndex(savedMemory);
    const lifecycle = result.lifecycle || {};
    const detail = action === 'init'
      ? `${result.created || 0} created, ${result.indexed || 0} indexed, ${lifecycle.scenes || 0} scenes`
      : action === 'consolidate'
        ? `${lifecycle.cellsCreated || 0} cells, ${lifecycle.scenes || 0} scenes, ${lifecycle.profile || 0} profile`
        : `${result.indexed || 0} indexed, ${lifecycle.scenes || 0} scenes`;
    setStatus(`${label}: ${detail}`);
    shouldRefreshNotes = true;
  } catch (error) {
    setStatus(error?.message || `${label} failed`);
  } finally {
    memoryBusy.value = '';
  }
  if (shouldRefreshNotes) await listMemoryNotes(true);
}

async function startMemoryMilvus() {
  if (memoryBusy.value || !sqliteMemory.value || !memory.milvusEnabled || !memory.milvusManaged) return;
  memoryBusy.value = 'milvus';
  try {
    const savedMemory = writeRoomMemorySettings(memory);
    Object.assign(memory, savedMemory);
    const result = await startManagedLive2DMemoryMilvus(savedMemory);
    const collection = result.collection?.collection || savedMemory.milvusCollection || 'yachiyo_memory';
    setStatus(`Milvus ready: ${collection}`);
  } catch (error) {
    setStatus(error?.message || 'Milvus start failed');
  } finally {
    memoryBusy.value = '';
  }
}

async function listMemoryNotes(silent = false) {
  if (memoryBusy.value) return;
  memoryBusy.value = 'list';
  try {
    const savedMemory = writeRoomMemorySettings(memory);
    Object.assign(memory, savedMemory);
    const result = await listLive2DMemoryNotes({ includeDisabled: true, maxNotes: 500 }, savedMemory);
    const disabledCount = (result.notes || []).filter((note) => note.disabled).length;
    setMemoryLifecycle(result);
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
    memoryCells.value = notes.recollection?.cells || [];
    memoryScenes.value = notes.recollection?.scenes || [];
    memoryAnchors.value = notes.recollection?.anchors || [];
    memoryProfile.value = notes.recollection?.profile || [];
    memoryConflicts.value = [];
    setMemoryNotes(notes, 'search');
    setStatus(`Search results: ${notes.length}`);
  } catch (error) {
    setStatus(error?.message || 'Search failed');
  } finally {
    memoryBusy.value = '';
  }
}

async function loadMemoryProfile() {
  if (memoryBusy.value) return;
  memoryBusy.value = 'profile';
  try {
    const savedMemory = writeRoomMemorySettings(memory);
    Object.assign(memory, savedMemory);
    const result = await readLive2DMemoryProfile(savedMemory);
    setMemoryLifecycle(result);
    setStatus(`Memory profile: ${(result.profile || []).length}, scenes: ${(result.scenes || []).length}`);
  } catch (error) {
    setStatus(error?.message || 'Profile load failed');
  } finally {
    memoryBusy.value = '';
  }
}

async function loadMemoryAnchors() {
  if (memoryBusy.value) return;
  memoryBusy.value = 'anchors';
  try {
    const savedMemory = writeRoomMemorySettings(memory);
    Object.assign(memory, savedMemory);
    const result = await listLive2DMemoryAnchors({ maxItems: 120 }, savedMemory);
    memoryAnchors.value = result.anchors || [];
    setStatus(`Memory anchors: ${(result.anchors || []).length}`);
  } catch (error) {
    setStatus(error?.message || 'Anchor load failed');
  } finally {
    memoryBusy.value = '';
  }
}

async function runMemoryGc() {
  if (memoryBusy.value) return;
  memoryBusy.value = 'gc';
  try {
    const savedMemory = writeRoomMemorySettings(memory);
    Object.assign(memory, savedMemory);
    const result = await runLive2DMemoryGarbageCollection(savedMemory);
    const gc = result.gc || {};
    setStatus(`GC: ${gc.archived || 0} archived, ${gc.forgotten || 0} forgotten`);
    memoryBusy.value = '';
    await listMemoryNotes(true);
  } catch (error) {
    setStatus(error?.message || 'Memory GC failed');
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
          <span>Provider</span>
          <select v-model="llm.provider" @change="applyLLMProvider">
            <option v-for="option in ROOM_LLM_PROVIDER_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
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
        <label>
          <span>Vision Images</span>
          <select v-model="llm.visionImageMode">
            <option v-for="option in ROOM_LLM_VISION_IMAGE_MODE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
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

      <section v-else-if="activeTab === 'asr'" class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="asr.enabled" type="checkbox">
          <span>Enable ASR</span>
        </label>
        <label>
          <span>Provider</span>
          <select v-model="asr.provider">
            <option value="vosk">Vosk local</option>
          </select>
        </label>
        <label class="studio-wide-field">
          <span>Model Path</span>
          <input v-model="asr.modelPath" type="text" spellcheck="false" placeholder="models/vosk/vosk-model-small-cn-0.22">
        </label>
        <label>
          <span>Sample Rate</span>
          <input v-model.number="asr.sampleRate" type="number" min="8000" max="48000" step="1000">
        </label>
        <label>
          <span>Max Record</span>
          <input v-model.number="asr.maxRecordMs" type="number" min="1500" max="60000" step="500">
        </label>
        <label>
          <span>Endpoint</span>
          <input v-model="asr.endpoint" type="text" spellcheck="false" placeholder="/api/asr">
        </label>
        <label class="studio-check-row">
          <input v-model="asr.words" type="checkbox">
          <span>Word timestamps</span>
        </label>
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

      <section v-else-if="activeTab === 'vision'" class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="vision.enabled" type="checkbox">
          <span>Enable desktop vision</span>
        </label>
        <label class="studio-check-row">
          <input v-model="vision.includeScreenshot" type="checkbox">
          <span>Attach cursor screenshot</span>
        </label>
        <label class="studio-check-row">
          <input v-model="vision.includeFullScreen" type="checkbox">
          <span>Include full screen</span>
        </label>
        <label>
          <span>Crop Size</span>
          <input v-model.number="vision.cropSize" type="number" min="256" max="1400" step="64">
        </label>
        <label>
          <span>Image Detail</span>
          <select v-model="vision.detail">
            <option value="low">low</option>
            <option value="auto">auto</option>
            <option value="high">high</option>
          </select>
        </label>
        <label>
          <span>Prompt Limit</span>
          <input v-model.number="vision.maxPromptChars" type="number" min="400" max="4000" step="100">
        </label>
        <div class="studio-memory-actions studio-wide-field">
          <button class="studio-primary-btn" type="button" :disabled="Boolean(visionBusy)" @click="probeVisionContext">
            <TsIcon name="image" :size="16" />
            <span>Probe Vision</span>
          </button>
        </div>
        <div v-if="visionLastContext" class="studio-memory-selected studio-wide-field">
          <span>{{ visionLastContext.redacted ? 'Redacted' : 'Last capture' }}</span>
          <strong>{{ visionLastContext.pointerWindow?.title || visionLastContext.foregroundWindow?.title || 'Desktop' }}</strong>
        </div>
      </section>

      <section v-else-if="activeTab === 'music'" class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="music.enabled" type="checkbox">
          <span>Enable music control</span>
        </label>
        <label>
          <span>Provider</span>
          <select v-model="music.provider">
            <option value="apple-music">Apple Music</option>
          </select>
        </label>
        <label>
          <span>Storefront</span>
          <input v-model="music.storefront" type="text" maxlength="2" spellcheck="false" placeholder="cn">
        </label>
        <label class="studio-check-row">
          <input v-model="music.autoAuthorize" type="checkbox">
          <span>Auto authorize</span>
        </label>
        <label class="studio-check-row">
          <input v-model="music.autoPlayRequests" type="checkbox">
          <span>Auto play queued requests</span>
        </label>
        <label class="studio-check-row">
          <input v-model="music.smartPick" type="checkbox">
          <span>Smart candidate selection</span>
        </label>
        <label class="studio-check-row">
          <input v-model="music.dedupeEnabled" type="checkbox">
          <span>Prevent duplicate requests</span>
        </label>
        <label class="studio-check-row">
          <input v-model="music.filterShortSongs" type="checkbox">
          <span>Filter short tracks</span>
        </label>
        <label>
          <span>Search Limit</span>
          <input v-model.number="music.searchLimit" type="number" min="1" max="50" step="1">
        </label>
        <label>
          <span>Queue Limit</span>
          <input v-model.number="music.maxQueueSize" type="number" min="1" max="100" step="1">
        </label>
        <label>
          <span>Min Duration Ms</span>
          <input v-model.number="music.minDurationMs" type="number" min="0" max="600000" step="1000">
        </label>
        <label>
          <span>History Limit</span>
          <input v-model.number="music.historyLimit" type="number" min="1" max="300" step="1">
        </label>
        <label class="studio-wide-field">
          <span>Blacklist</span>
          <textarea v-model="music.blacklist" rows="4" spellcheck="false" placeholder="One keyword per line, e.g. live, remix, cover"></textarea>
        </label>
        <label class="studio-wide-field">
          <span>Developer Token</span>
          <input v-model="music.developerToken" type="password" spellcheck="false" placeholder="JWT developer token">
        </label>
        <label class="studio-wide-field">
          <span>Music User Token</span>
          <input v-model="music.musicUserToken" type="password" spellcheck="false" placeholder="Stored after authorization">
        </label>
        <div class="studio-memory-actions studio-wide-field">
          <button
            class="studio-primary-btn"
            type="button"
            :disabled="Boolean(musicBusy) || !music.developerToken.trim()"
            @click="authorizeMusic"
          >
            <TsIcon name="music" :size="16" />
            <span>{{ musicAuthorized ? 'Reauthorize' : 'Authorize' }}</span>
          </button>
          <button
            class="studio-secondary-btn"
            type="button"
            :disabled="Boolean(musicBusy) || !musicAuthorized"
            @click="disconnectMusic"
          >
            Disconnect
          </button>
        </div>
      </section>

      <section v-else class="studio-settings-section studio-memory-settings-section">
        <div class="studio-memory-console studio-wide-field">
          <div class="studio-memory-overview">
            <label class="studio-check-row">
              <input v-model="memory.enabled" type="checkbox">
              <span>Enable memory</span>
            </label>
            <label class="studio-memory-provider-select">
              <span>Provider</span>
              <select v-model="memory.provider">
                <option v-for="option in memoryProviderOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
          </div>

          <div class="studio-memory-status-grid" aria-label="Memory status">
            <article class="studio-memory-status-card">
              <TsIcon name="note" :size="16" />
              <span>Provider</span>
              <strong>{{ memoryProviderLabel }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="package" :size="16" />
              <span>Storage</span>
              <strong>{{ memoryStorageLabel }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="search" :size="16" />
              <span>Retrieval</span>
              <strong>{{ memoryRetrievalLabel }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="wand" :size="16" />
              <span>Write</span>
              <strong>{{ memoryWriteLabel }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="radio" :size="16" />
              <span>Milvus</span>
              <strong>{{ memoryMilvusLabel }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="list" :size="16" />
              <span>Notes</span>
              <strong>{{ memoryStats.active }} / {{ memoryStats.total }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="star" :size="16" />
              <span>Anchors</span>
              <strong>{{ memoryStats.anchors }}</strong>
            </article>
          </div>

          <div class="studio-memory-block">
            <header class="studio-memory-block-head">
              <TsIcon name="settings2" :size="16" />
              <h3>Routing</h3>
            </header>
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
          </div>

          <div v-if="sqliteMemory" class="studio-memory-block">
            <header class="studio-memory-block-head">
              <TsIcon name="star" :size="16" />
              <h3>Lifecycle</h3>
            </header>
            <div class="studio-memory-switches">
              <label class="studio-check-row">
                <input v-model="memory.sessionRollupEnabled" type="checkbox">
                <span>Session rollup</span>
              </label>
              <label class="studio-check-row">
                <input v-model="memory.gcEnabled" type="checkbox">
                <span>Selective GC</span>
              </label>
            </div>
            <div class="studio-memory-grid">
              <label>
                <span>Archive Days</span>
                <input v-model.number="memory.gcArchiveDays" type="number" min="1" max="3650">
              </label>
              <label>
                <span>Forget Days</span>
                <input v-model.number="memory.gcForgetDays" type="number" min="7" max="3650">
              </label>
              <label>
                <span>Anchor Score</span>
                <input v-model.number="memory.anchorImportanceThreshold" type="number" min="0.1" max="1" step="0.01">
              </label>
            </div>
          </div>

          <div class="studio-memory-block">
            <header class="studio-memory-block-head">
              <TsIcon name="folder" :size="16" />
              <h3>Storage</h3>
            </header>
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
                <span>Persona Corpus</span>
                <input v-model="memory.personaCorpusPath" type="text" spellcheck="false" placeholder="E:\visualstudio\yachiyo_novel_detailed_corpus.txt">
              </label>
              <label>
                <span>Import Vault Path</span>
                <input v-model="memory.vaultPath" type="text" spellcheck="false" placeholder="Optional Obsidian vault to import">
              </label>
            </template>
          </div>

          <div v-if="sqliteMemory" class="studio-memory-block">
            <header class="studio-memory-block-head">
              <TsIcon name="radio" :size="16" />
              <h3>Milvus</h3>
            </header>
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
            <details class="studio-memory-advanced">
              <summary>Advanced</summary>
              <div class="studio-memory-grid">
                <label>
                  <span>Milvus Image</span>
                  <input v-model="memory.milvusImage" type="text" spellcheck="false" placeholder="milvusdb/milvus:latest">
                </label>
                <label>
                  <span>Milvus Token</span>
                  <input v-model="memory.milvusToken" type="password" spellcheck="false" placeholder="Optional, e.g. root:Milvus">
                </label>
              </div>
            </details>
          </div>

          <div v-if="sqliteMemory" class="studio-memory-block">
            <header class="studio-memory-block-head">
              <TsIcon name="sparkles" :size="16" />
              <h3>Embedding</h3>
            </header>
            <div class="studio-memory-grid">
              <label>
                <span>Embedding URL</span>
                <input v-model="memory.embeddingApiUrl" type="text" spellcheck="false" placeholder="Optional OpenAI-compatible embeddings endpoint">
              </label>
              <label>
                <span>Embedding Model</span>
                <input v-model="memory.embeddingModel" type="text" spellcheck="false" placeholder="text-embedding-3-small">
              </label>
              <label>
                <span>Embedding Key</span>
                <input v-model="memory.embeddingApiKey" type="password" spellcheck="false" placeholder="Optional API key">
              </label>
            </div>
          </div>

          <div class="studio-memory-block">
            <header class="studio-memory-block-head">
              <TsIcon name="refresh" :size="16" />
              <h3>Tools</h3>
            </header>
            <div class="studio-memory-actions">
              <button
                class="studio-secondary-btn"
                type="button"
                :disabled="Boolean(memoryBusy) || !sqliteMemory || !memory.milvusEnabled || !memory.milvusManaged"
                @click="startMemoryMilvus"
              >
                <TsIcon name="radio" :size="15" />
                <span>Start Milvus</span>
              </button>
              <button
                class="studio-secondary-btn"
                type="button"
                :disabled="Boolean(memoryBusy)"
                @click="runMemoryTool('init', 'Vault initialized')"
              >
                <TsIcon name="folder" :size="15" />
                <span>Initialize</span>
              </button>
              <button
                class="studio-secondary-btn"
                type="button"
                :disabled="Boolean(memoryBusy)"
                @click="runMemoryTool('reindex', 'Index rebuilt')"
              >
                <TsIcon name="refresh" :size="15" />
                <span>Rebuild</span>
              </button>
              <button
                class="studio-secondary-btn"
                type="button"
                :disabled="Boolean(memoryBusy)"
                @click="runMemoryTool('consolidate', 'Memory consolidated')"
              >
                <TsIcon name="sparkles" :size="15" />
                <span>Consolidate</span>
              </button>
              <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy) || !sqliteMemory" @click="runMemoryGc">
                <TsIcon name="trash" :size="15" />
                <span>Run GC</span>
              </button>
              <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy)" @click="listMemoryNotes()">
                <TsIcon name="list" :size="15" />
                <span>List Notes</span>
              </button>
              <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy)" @click="loadMemoryProfile">
                <TsIcon name="userRound" :size="15" />
                <span>Profile</span>
              </button>
              <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy)" @click="loadMemoryAnchors">
                <TsIcon name="star" :size="15" />
                <span>Anchors</span>
              </button>
            </div>
          </div>

          <div class="studio-memory-block studio-memory-note-manager">
            <header class="studio-memory-block-head">
              <TsIcon name="note" :size="16" />
              <h3>Notes</h3>
              <div class="studio-memory-stats" aria-label="Memory note counts">
                <span>{{ memoryStats.active }} Active</span>
                <span>{{ memoryStats.disabled }} Disabled</span>
                <span>{{ memoryStats.total }} Total</span>
              </div>
            </header>

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
                <TsIcon name="search" :size="15" />
                <span>Search</span>
              </button>
            </div>

            <label>
              <span>Selected Note Path</span>
              <input v-model="memoryManagePath" type="text" spellcheck="false" placeholder="03_Viewers/viewer-redchenk.md">
            </label>

            <div class="studio-memory-actions">
              <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy) || !memoryManagePath.trim()" @click="setManagedMemoryDisabled(true)">
                <TsIcon name="eyeOff" :size="15" />
                <span>Disable</span>
              </button>
              <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy) || !memoryManagePath.trim()" @click="setManagedMemoryDisabled(false)">
                <TsIcon name="badgeCheck" :size="15" />
                <span>Enable</span>
              </button>
              <button class="studio-secondary-btn" type="button" :disabled="Boolean(memoryBusy) || !memoryManagePath.trim()" @click="deleteManagedMemoryNote()">
                <TsIcon name="trash" :size="15" />
                <span>Delete</span>
              </button>
            </div>

            <div class="studio-memory-results" aria-live="polite">
              <div class="studio-memory-results-head">
                <span>{{ memoryResultMode === 'search' ? 'Search Results' : 'Vault Notes' }}</span>
                <small>{{ memoryStats.total }} notes · {{ memoryStats.cells }} cells · {{ memoryStats.scenes }} scenes</small>
              </div>
              <div v-if="memoryRecollection" class="studio-memory-stats">
                <span>{{ memoryRecollection.queryType }}</span>
                <span>{{ memoryRecollection.isSufficient ? 'sufficient' : 'partial' }}</span>
                <span v-if="memoryStats.anchors">{{ memoryStats.anchors }} anchors</span>
                <span v-if="memoryStats.profile">{{ memoryStats.profile }} profile</span>
                <span v-if="memoryStats.conflicts">{{ memoryStats.conflicts }} conflicts</span>
              </div>
              <div v-else-if="memoryStats.anchors" class="studio-memory-stats">
                <span>{{ memoryStats.anchors }} anchors</span>
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
                      <TsIcon :name="note.disabled ? 'badgeCheck' : 'eyeOff'" :size="15" />
                      <span>{{ note.disabled ? 'Enable' : 'Disable' }}</span>
                    </button>
                    <button
                      class="studio-secondary-btn"
                      type="button"
                      :disabled="Boolean(memoryBusy)"
                      @click.stop="deleteManagedMemoryNote(notePath(note))"
                    >
                      <TsIcon name="trash" :size="15" />
                      <span>Delete</span>
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
