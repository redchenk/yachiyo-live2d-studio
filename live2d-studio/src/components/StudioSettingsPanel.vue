<script setup>
import { computed, onUnmounted, reactive, ref } from 'vue';
import TsIcon from '@frontend/components/TsIcon.vue';
import {
  DEFAULT_ROOM_LLM_SETTINGS,
  DEFAULT_ROOM_ASR_SETTINGS,
  DEFAULT_ROOM_MEMORY_SETTINGS,
  DEFAULT_ROOM_MINECRAFT_SETTINGS,
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
  normalizeRoomMinecraftSettings,
  normalizeRoomModelSettings,
  normalizeRoomMusicSettings,
  normalizeRoomTTSSettings,
  normalizeRoomVisionSettings,
  normalizeRoomVTubeStudioSettings,
  readRoomLLMSettings,
  readRoomASRSettings,
  readRoomMemorySettings,
  readRoomMinecraftSettings,
  readRoomModelSettings,
  readRoomMusicSettings,
  readRoomTTSSettings,
  readRoomVisionSettings,
  readRoomVTubeStudioSettings,
  writeRoomLLMSettings,
  writeRoomASRSettings,
  writeRoomMemorySettings,
  writeRoomMinecraftSettings,
  writeRoomModelSettings,
  writeRoomMusicSettings,
  writeRoomTTSSettings,
  writeRoomVisionSettings,
  writeRoomVTubeStudioSettings
} from '@frontend/services/room/roomSettings';
import { configureLive2DMinecraft } from '@frontend/services/room/live2dMinecraft';
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
const props = defineProps({ initialTab: { type: String, default: 'llm' } });

const tabs = [
  { id: 'llm', label: '对话模型' },
  { id: 'tts', label: '语音合成' },
  { id: 'asr', label: '语音识别' },
  { id: 'model', label: 'Live2D 模型' },
  { id: 'vts', label: 'VTube Studio' },
  { id: 'vision', label: '屏幕感知' },
  { id: 'music', label: '音乐' },
  { id: 'minecraft', label: 'Minecraft' },
  { id: 'memory', label: '长记忆' }
];

const providerOptions = [
  { value: 'gpt-sovits', label: 'GPT-SoVITS' },
  { value: 'mimo', label: 'Xiaomi MiMo' },
  { value: 'openai', label: 'OpenAI TTS' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'custom', label: 'Custom Proxy' }
];

const memoryProviderOptions = [
  { value: 'sqlite', label: '内置 SQLite 记忆' },
  { value: 'obsidian', label: 'Obsidian 知识库' },
  { value: 'sqlite-milvus', label: '外部 Milvus（可选）' }
].filter(option => !window.yachiyoDesktop?.embeddedMemory || option.value === 'sqlite');

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
  { value: 'ja', label: '日语 / ja' },
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

const activeTab = ref(props.initialTab);
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
const minecraft = reactive(readRoomMinecraftSettings());

let statusTimer = 0;

const localTts = computed(() => tts.provider === 'gpt-sovits');
const sqliteMemory = computed(() => memory.provider === 'sqlite-milvus' || memory.provider === 'sqlite');
const musicAuthorized = computed(() => Boolean(music.musicUserToken));
const localMusicProvider = computed(() => music.provider === 'local-library');
const neteaseMusicProvider = computed(() => music.provider === 'netease-cloud');
const appleMusicProvider = computed(() => music.provider === 'apple-music');
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
  if (!memory.milvusEnabled) return '本地向量与关键词索引';
  return memory.milvusManaged ? 'Managed Milvus' : 'External Milvus';
});
const memoryStorageLabel = computed(() => (sqliteMemory.value ? '本机应用数据目录' : 'Obsidian 知识库'));
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
  Object.assign(minecraft, readRoomMinecraftSettings());
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
  } else if (activeTab.value === 'minecraft') {
    Object.assign(minecraft, normalizeRoomMinecraftSettings(DEFAULT_ROOM_MINECRAFT_SETTINGS));
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
  const savedMinecraft = writeRoomMinecraftSettings(minecraft);

  Object.assign(llm, savedLLM);
  Object.assign(tts, savedTTS);
  Object.assign(asr, savedASR);
  Object.assign(model, savedModel);
  Object.assign(vts, savedVTS);
  Object.assign(music, savedMusic);
  Object.assign(vision, savedVision);
  Object.assign(memory, savedMemory);
  Object.assign(minecraft, savedMinecraft);
  window.dispatchEvent(new CustomEvent('tsukuyomi:studio-settings-saved', {
    detail: { llm: savedLLM, tts: savedTTS, asr: savedASR, model: savedModel, vts: savedVTS, music: savedMusic, vision: savedVision, memory: savedMemory, minecraft: savedMinecraft }
  }));
  if (savedMinecraft.enabled || activeTab.value === 'minecraft') {
    configureLive2DMinecraft(savedMinecraft).catch((error) => setStatus(error?.message || 'Minecraft 配置失败'));
  }
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
        <strong>工作室设置</strong>
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
          <span>服务商</span>
          <select v-model="llm.provider" @change="applyLLMProvider">
            <option v-for="option in ROOM_LLM_PROVIDER_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>接口地址</span>
          <input v-model="llm.apiUrl" type="text" spellcheck="false" placeholder="https://api.deepseek.com/v1/chat/completions">
        </label>
        <label>
          <span>API 密钥</span>
          <input v-model="llm.apiKey" type="password" spellcheck="false" placeholder="sk-...">
        </label>
        <label>
          <span>模型名称</span>
          <input v-model="llm.model" type="text" spellcheck="false" placeholder="deepseek-flash">
        </label>
        <label class="studio-check-row">
          <input v-model="llm.useProxy" type="checkbox">
          <span>通过本地服务转发</span>
        </label>
        <label>
          <span>图像输入</span>
          <select v-model="llm.visionImageMode">
            <option v-for="option in ROOM_LLM_VISION_IMAGE_MODE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <div class="studio-persona-intro studio-wide-field"><TsIcon name="sparkles" :size="20" /><div><strong>八千代 · 月读空间人格</strong><p>轻快、俏皮，认真时直接说话。内置 101 条带来源的角色知识，按话题检索，默认不剧透。</p></div></div>
        <label><span>近期对话轮数</span><input v-model.number="llm.historyMaxTurns" type="number" min="4" max="64"></label>
        <label><span>对话上下文预算（字符）</span><input v-model.number="llm.historyMaxChars" type="number" min="4000" max="100000" step="1000"></label>
        <label class="studio-wide-field">
          <span>补充人格与回复要求</span>
          <textarea v-model="llm.systemPrompt" rows="5" spellcheck="false" placeholder="Optional extra behavior for Yachiyo"></textarea>
        </label>
      </section>

      <section v-else-if="activeTab === 'tts'" class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="tts.enabled" type="checkbox">
          <span>启用语音</span>
        </label>
        <label>
          <span>服务商</span>
          <select v-model="tts.provider" @change="applyTtsProvider">
            <option v-for="option in providerOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>接口地址</span>
          <input v-model="tts.apiUrl" type="text" spellcheck="false" :placeholder="ttsApiPlaceholder">
        </label>
        <label v-if="!localTts">
          <span>API 密钥</span>
          <input v-model="tts.apiKey" type="password" spellcheck="false" placeholder="sk-...">
        </label>
        <label>
          <span>{{ localTts ? '合成语言' : '模型名称' }}</span>
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
            <span>参考音频路径</span>
            <input v-model="tts.refAudioPath" type="text" spellcheck="false" placeholder="E:\visualstudio\tts\reference\yachiyo.wav">
          </label>
          <label class="studio-wide-field">
            <span>参考音频文本</span>
            <textarea v-model="tts.promptText" rows="2" spellcheck="false" placeholder="参考音频里的日语原文"></textarea>
          </label>
          <label>
            <span>参考音频语言</span>
            <select v-model="tts.promptLang">
              <option v-for="option in languageOptions" :key="`prompt-${option.value}`" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label class="studio-wide-field">
            <span>GPT 权重路径</span>
            <input v-model="tts.gptWeightPath" type="text" spellcheck="false" placeholder="GPT_weights_v2ProPlus/yachiyo-v2pro-e20.ckpt">
          </label>
          <label class="studio-wide-field">
            <span>SoVITS 权重路径</span>
            <input v-model="tts.sovitsWeightPath" type="text" spellcheck="false" placeholder="SoVITS_weights_v2ProPlus/yachiyo-v2pro_e12_s684.pth">
          </label>
        </template>
      </section>

      <section v-else-if="activeTab === 'asr'" class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="asr.enabled" type="checkbox">
          <span>Enable ASR</span>
        </label>
        <label>
          <span>服务商</span>
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
          <span>服务商</span>
          <select v-model="music.provider">
            <option value="local-library">Local Library</option>
            <option value="netease-cloud">NetEase Cloud</option>
            <option value="apple-music">Apple Music</option>
          </select>
        </label>
        <label v-if="localMusicProvider" class="studio-wide-field">
          <span>Local Library Paths</span>
          <textarea v-model="music.localLibraryPaths" rows="4" spellcheck="false" placeholder="E:\Music&#10;D:\Music"></textarea>
        </label>
        <label v-if="localMusicProvider" class="studio-check-row">
          <input v-model="music.localIncludeUserMusic" type="checkbox">
          <span>Scan Windows Music folder</span>
        </label>
        <label v-if="localMusicProvider" class="studio-check-row">
          <input v-model="music.localIncludeProjectMusic" type="checkbox">
          <span>Scan project music folders</span>
        </label>
        <label v-if="localMusicProvider">
          <span>Max Local Files</span>
          <input v-model.number="music.localMaxScanFiles" type="number" min="100" max="20000" step="100">
        </label>
        <label v-if="neteaseMusicProvider" class="studio-wide-field">
          <span>Managed api-enhanced URL</span>
          <input v-model="music.neteaseApiUrl" type="text" spellcheck="false" placeholder="http://127.0.0.1:3302">
        </label>
        <label v-if="neteaseMusicProvider" class="studio-wide-field">
          <span>NetEase Cookie</span>
          <input v-model="music.neteaseCookie" type="password" spellcheck="false" placeholder="Optional MUSIC_U / __csrf cookie">
        </label>
        <label v-if="neteaseMusicProvider" class="studio-wide-field">
          <span>Cookie File Path</span>
          <input v-model="music.neteaseCookiePath" type="text" spellcheck="false" placeholder="C:\Users\lenovo\Desktop\网易云cookie.txt">
        </label>
        <label v-if="neteaseMusicProvider">
          <span>Quality</span>
          <select v-model="music.neteaseQualityLevel">
            <option value="standard">standard</option>
            <option value="higher">higher</option>
            <option value="exhigh">exhigh</option>
            <option value="lossless">lossless</option>
            <option value="hires">hires</option>
            <option value="jyeffect">jyeffect</option>
            <option value="sky">sky</option>
            <option value="jymaster">jymaster</option>
          </select>
        </label>
        <label v-if="neteaseMusicProvider">
          <span>Fallback Bitrate</span>
          <input v-model.number="music.neteaseBitrate" type="number" min="96000" max="999000" step="1000">
        </label>
        <label v-if="neteaseMusicProvider" class="studio-check-row">
          <input v-model="music.neteaseUnblock" type="checkbox">
          <span>Request unblock source</span>
        </label>
        <label v-if="neteaseMusicProvider">
          <span>Unblock Source</span>
          <input v-model="music.neteaseUnblockSource" type="text" spellcheck="false" placeholder="Optional, e.g. kugou">
        </label>
        <label v-if="appleMusicProvider">
          <span>Storefront</span>
          <input v-model="music.storefront" type="text" maxlength="2" spellcheck="false" placeholder="cn">
        </label>
        <label v-if="appleMusicProvider" class="studio-check-row">
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
        <label v-if="appleMusicProvider" class="studio-wide-field">
          <span>Developer Token</span>
          <input v-model="music.developerToken" type="password" spellcheck="false" placeholder="JWT developer token">
        </label>
        <label v-if="appleMusicProvider" class="studio-wide-field">
          <span>Music User Token</span>
          <input v-model="music.musicUserToken" type="password" spellcheck="false" placeholder="Stored after authorization">
        </label>
        <div v-if="appleMusicProvider" class="studio-memory-actions studio-wide-field">
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

      <section v-else-if="activeTab === 'minecraft'" class="studio-settings-section">
        <label class="studio-check-row">
          <input v-model="minecraft.enabled" type="checkbox">
          <span>Enable Minecraft Java agent</span>
        </label>
        <label class="studio-check-row studio-wide-field">
          <input v-model="minecraft.trustedServerAcknowledged" type="checkbox">
          <span>I confirm this is my trusted/private server</span>
        </label>
        <label>
          <span>Server Host</span>
          <input v-model="minecraft.host" type="text" spellcheck="false" placeholder="127.0.0.1">
        </label>
        <label>
          <span>Server Port</span>
          <input v-model.number="minecraft.port" type="number" min="1" max="65535" step="1">
        </label>
        <label>
          <span>Bot Username</span>
          <input v-model="minecraft.username" type="text" spellcheck="false" placeholder="Yachiyo">
        </label>
        <label>
          <span>Authentication</span>
          <select v-model="minecraft.auth">
            <option value="offline">Offline / local server</option>
            <option value="microsoft">Microsoft account</option>
          </select>
        </label>
        <label>
          <span>Game Version</span>
          <input v-model="minecraft.version" type="text" spellcheck="false" placeholder="Auto detect">
        </label>
        <label class="studio-check-row">
          <input v-model="minecraft.autoReconnect" type="checkbox">
          <span>Auto reconnect</span>
        </label>
        <label class="studio-check-row">
          <input v-model="minecraft.autonomousPlay" type="checkbox">
          <span>LLM autonomous play</span>
        </label>
        <label class="studio-wide-field">
          <span>Persistent Gameplay Goal</span>
          <textarea v-model="minecraft.autonomousGoal" rows="3" spellcheck="false" placeholder="安全推进生存流程"></textarea>
        </label>
        <label>
          <span>Decision Interval (ms)</span>
          <input v-model.number="minecraft.decisionIntervalMs" type="number" min="3000" max="30000" step="500">
        </label>
        <label>
          <span>Reconnect Attempts</span>
          <input v-model.number="minecraft.maxRetries" type="number" min="0" max="20" step="1">
        </label>
        <label>
          <span>Low-health Stop</span>
          <input v-model.number="minecraft.healthThreshold" type="number" min="2" max="18" step="1">
        </label>
        <p class="studio-settings-note studio-wide-field">
          Microsoft 登录使用设备码并缓存在本机，不会交给 LLM。代理仅接受白名单动作，不执行聊天斜杠命令或任意代码。
        </p>
      </section>

      <section v-else class="studio-settings-section studio-memory-settings-section">
        <div class="studio-memory-console studio-wide-field">
          <div class="studio-memory-overview">
            <label class="studio-check-row">
              <input v-model="memory.enabled" type="checkbox">
              <span>启用长记忆</span>
            </label>
            <label class="studio-memory-provider-select">
              <span>服务商</span>
              <select v-model="memory.provider">
                <option v-for="option in memoryProviderOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
          </div>

          <div class="studio-memory-status-grid" aria-label="Memory status">
            <article class="studio-memory-status-card">
              <TsIcon name="note" :size="16" />
              <span>服务商</span>
              <strong>{{ memoryProviderLabel }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="package" :size="16" />
              <span>存储位置</span>
              <strong>{{ memoryStorageLabel }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="search" :size="16" />
              <span>检索方式</span>
              <strong>{{ memoryRetrievalLabel }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="wand" :size="16" />
              <span>写入</span>
              <strong>{{ memoryWriteLabel }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="radio" :size="16" />
              <span>Memory index</span>
              <strong>{{ memoryMilvusLabel }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="list" :size="16" />
              <span>记忆条目</span>
              <strong>{{ memoryStats.active }} / {{ memoryStats.total }}</strong>
            </article>
            <article class="studio-memory-status-card">
              <TsIcon name="star" :size="16" />
              <span>重点记忆</span>
              <strong>{{ memoryStats.anchors }}</strong>
            </article>
          </div>

          <div class="studio-memory-block">
            <header class="studio-memory-block-head">
              <TsIcon name="settings2" :size="16" />
              <h3>检索与注入</h3>
            </header>
            <div class="studio-memory-grid">
              <label>
                <span>检索方式</span>
                <select v-model="memory.retrievalMode">
                  <option v-for="option in retrievalModeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>写入方式</span>
                <select v-model="memory.writeMode">
                  <option v-for="option in writeModeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>每轮检索条数</span>
                <input v-model.number="memory.maxNotesPerTurn" type="number" min="1" max="16">
              </label>
            </div>
            <div class="studio-memory-grid studio-context-budgets">
              <label><span>记忆注入预算（字符）</span><input v-model.number="memory.contextMaxChars" type="number" min="2000" max="32000" step="1000"></label>
              <label><span>每条相关片段（字符）</span><input v-model.number="memory.snippetMaxChars" type="number" min="300" max="4000" step="100"></label>
            </div>
            <div class="studio-memory-switches">
              <label class="studio-check-row">
                <input v-model="memory.allowViewerMemory" type="checkbox">
                <span>观众记忆</span>
              </label>
              <label class="studio-check-row">
                <input v-model="memory.allowSessionMemory" type="checkbox">
                <span>会话记忆</span>
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
              <h3>存储位置</h3>
            </header>
            <label v-if="!sqliteMemory">
              <span>Vault Path</span>
              <input v-model="memory.vaultPath" type="text" spellcheck="false" placeholder="D:\Obsidian\YachiyoMemoryVault">
            </label>
            <template v-else>
              <label>
                <span>SQLite Path</span>
                <input v-model="memory.databasePath" type="text" spellcheck="false" placeholder="Automatic: application data directory">
              </label>
              <label>
                <span>Persona Corpus</span>
                <input v-model="memory.personaCorpusPath" type="text" spellcheck="false" placeholder="Optional corpus file; bundled memory seeds are included">
              </label>
              <label>
                <span>Import Vault Path</span>
                <input v-model="memory.vaultPath" type="text" spellcheck="false" placeholder="Optional Obsidian vault to import">
              </label>
            </template>
          </div>

          <div v-if="memory.provider === 'sqlite-milvus'" class="studio-memory-block">
            <header class="studio-memory-block-head">
              <TsIcon name="radio" :size="16" />
              <h3>Optional external index</h3>
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
              <h3>语义向量</h3>
            </header>
            <div class="studio-memory-grid">
              <label><span>向量维度</span><input v-model.number="memory.embeddingDimension" type="number" min="32" max="4096"></label>
              <label>
                <span>向量接口地址</span>
                <input v-model="memory.embeddingApiUrl" type="text" spellcheck="false" placeholder="Optional OpenAI-compatible embeddings endpoint">
              </label>
              <label>
                <span>向量模型</span>
                <input v-model="memory.embeddingModel" type="text" spellcheck="false" placeholder="text-embedding-3-small">
              </label>
              <label>
                <span>向量接口密钥</span>
                <input v-model="memory.embeddingApiKey" type="password" spellcheck="false" placeholder="Optional API key">
              </label>
            </div>
          </div>

          <p class="studio-settings-note">未配置向量接口时使用本地词项哈希与关键词检索。语义召回需填写兼容 embeddings 的接口；本地无鉴权服务可留空密钥。维度必须与返回向量一致。重建索引后新向量才会用于全部旧记忆。</p>
          <div class="studio-memory-block">
            <header class="studio-memory-block-head">
              <TsIcon name="refresh" :size="16" />
              <h3>记忆管理</h3>
            </header>
            <div class="studio-memory-actions">
              <button
                class="studio-secondary-btn"
                type="button"
                v-if="memory.provider === 'sqlite-milvus'"
                :disabled="Boolean(memoryBusy) || !memory.milvusEnabled || !memory.milvusManaged"
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
                <span>重点记忆</span>
              </button>
            </div>
          </div>

          <div class="studio-memory-block studio-memory-note-manager">
            <header class="studio-memory-block-head">
              <TsIcon name="note" :size="16" />
              <h3>记忆条目</h3>
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
        <button class="studio-secondary-btn" type="button" @click="reloadSettings">重新读取</button>
        <button class="studio-secondary-btn" type="button" @click="resetCurrentTab">Defaults</button>
        <button class="studio-primary-btn" type="submit">
          <TsIcon name="save" :size="16" />
          <span>保存设置</span>
        </button>
      </footer>
    </form>
  </aside>
</template>
