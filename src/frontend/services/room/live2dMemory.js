import { readRoomMemorySettings } from './roomSettings';
import { readJson, writeJson } from './roomStorage';

const MEMORY_PROMPT_MAX_CHARS = 2200;
const NOTE_SUMMARY_MAX_CHARS = 360;
const MEMORY_WRITE_MAX_CHARS = 2000;
const SESSION_MEMORY_BUFFER_KEY = 'live2dMemorySessionBuffer';
const SESSION_MEMORY_LAST_SUMMARY_KEY = 'live2dMemoryLastSummaryAt';
const SESSION_MEMORY_ID_KEY = 'live2dMemorySessionId';
const SESSION_MEMORY_EVERY_TURNS = 10;
const SESSION_MEMORY_MAX_BUFFER = 24;

let sessionSummaryInFlight = false;

const ALLOWED_MEMORY_TYPES = new Set([
  'profile',
  'style',
  'lore',
  'viewer',
  'session',
  'joke',
  'scene',
  'sample',
  'policy',
  'running_joke',
  'system'
]);

const ALLOWED_MEMORY_SCOPES = new Set([
  'canon',
  'long_term',
  'session',
  'relationship',
  'temporary'
]);

function asText(value, maxLength = 240) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function asNumber(value, fallback = 0.5, min = 0, max = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeTags(value) {
  const tags = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
  return tags
    .map((tag) => String(tag || '').trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

function textKeywords(text) {
  const value = String(text || '').toLowerCase();
  const cjk = value.match(/[\u3400-\u9fff]{2,}/gu) || [];
  const latin = value.match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
  return [...new Set([...cjk, ...latin])].slice(0, 12);
}

function inferMemoryTags(text) {
  const value = String(text || '').toLowerCase();
  const tags = new Set();
  if (/vts|vtube|live2d|cubism|参数|动作|表情|模型/u.test(value)) tags.add('live2d');
  if (/tts|语音|声音|gpt-sovits|sovits|mimo/u.test(value)) tags.add('tts');
  if (/直播|观众|弹幕|chat/u.test(value)) tags.add('live-stream');
  if (/人格|记忆|obsidian|corpus|语料/u.test(value)) tags.add('personality');
  if (/紧张|害怕|焦虑|舞台/u.test(value)) tags.add('stage-fright');
  return [...tags];
}

function memorySettingsReady(settings) {
  if (!settings.enabled || settings.retrievalMode === 'off') return false;
  if (settings.provider === 'obsidian') return Boolean(settings.vaultPath);
  return settings.provider === 'sqlite-milvus' || settings.provider === 'sqlite';
}

function memoryApiSettings(settings) {
  return {
    provider: settings.provider,
    vaultPath: settings.vaultPath,
    databasePath: settings.databasePath,
    personaCorpusPath: settings.personaCorpusPath,
    milvusEnabled: settings.milvusEnabled,
    milvusManaged: settings.milvusManaged,
    milvusUrl: settings.milvusUrl,
    milvusToken: settings.milvusToken,
    milvusCollection: settings.milvusCollection,
    milvusImage: settings.milvusImage,
    embeddingApiUrl: settings.embeddingApiUrl,
    embeddingApiKey: settings.embeddingApiKey,
    embeddingModel: settings.embeddingModel,
    embeddingDimension: settings.embeddingDimension,
    writeMode: settings.writeMode,
    retrievalMode: settings.retrievalMode,
    maxNotesPerTurn: settings.maxNotesPerTurn,
    sessionRollupEnabled: settings.sessionRollupEnabled,
    gcEnabled: settings.gcEnabled,
    gcArchiveDays: settings.gcArchiveDays,
    gcForgetDays: settings.gcForgetDays,
    rawRetentionDays: settings.rawRetentionDays,
    anchorImportanceThreshold: settings.anchorImportanceThreshold
  };
}

function memoryDataProviderReady(settings) {
  return settings.provider === 'sqlite-milvus' || settings.provider === 'sqlite';
}

export async function searchLive2DMemory(inputText, options = {}) {
  const settings = readRoomMemorySettings();
  if (!memorySettingsReady(settings)) return [];

  const tags = [
    ...inferMemoryTags(inputText),
    ...normalizeTags(options.tags)
  ];
  const preferredTypes = Array.isArray(options.preferredTypes) && options.preferredTypes.length
    ? options.preferredTypes
    : ['profile', 'style', 'lore', 'policy', 'viewer', 'scene', 'sample', 'joke', 'session'];

  try {
    const response = await fetch('/api/memory/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...memoryApiSettings(settings),
        query: {
          text: String(inputText || ''),
          keywords: textKeywords(inputText),
          tags,
          preferredTypes,
          retrievalMode: settings.retrievalMode,
          maxNotes: Math.min(Number(options.maxNotes) || settings.maxNotesPerTurn, settings.maxNotesPerTurn)
        }
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success || !Array.isArray(result.notes)) return [];
    const notes = result.notes.slice(0, settings.maxNotesPerTurn);
    notes.recollection = result.recollection || null;
    return notes;
  } catch (_) {
    return [];
  }
}

export function formatMemoryPrompt(notes = []) {
  const usableNotes = Array.isArray(notes) ? notes.filter(Boolean).slice(0, 8) : [];
  if (!usableNotes.length) return '';

  const recollection = notes.recollection || null;
  const lines = ['Reconstructed long-term memory:'];
  if (recollection?.queryType) {
    lines.push(`Query type: ${recollection.queryType}. Sufficiency: ${recollection.isSufficient ? 'enough' : 'partial'}.`);
  }
  if (Array.isArray(recollection?.scenes) && recollection.scenes.length) {
    lines.push(`Scenes: ${recollection.scenes.slice(0, 3).map((scene) => asText(scene.title, 80)).filter(Boolean).join(' / ')}`);
  }
  usableNotes.forEach((note, index) => {
    const type = asText(note.type || 'memory', 32);
    const title = asText(note.title || note.path || `Memory ${index + 1}`, 80);
    const summary = asText(note.summary || note.content || '', NOTE_SUMMARY_MAX_CHARS);
    if (!summary) return;
    const scene = asText(note.sceneTitle || '', 80);
    lines.push(`${index + 1}. ${type}: ${title}${scene ? ` [${scene}]` : ''}`);
    lines.push(`   ${summary}`);
    if (Array.isArray(note.facts) && note.facts.length) {
      lines.push(`   Facts: ${note.facts.slice(0, 3).map((fact) => asText(fact, 120)).join(' | ')}`);
    }
    if (Array.isArray(note.foresight) && note.foresight.length) {
      lines.push(`   Foresight: ${note.foresight.slice(0, 2).map((item) => asText(item.content || item.text || item, 120)).join(' | ')}`);
    }
  });
  if (Array.isArray(recollection?.missingInformation) && recollection.missingInformation.length) {
    lines.push(`Memory gap: ${recollection.missingInformation.slice(0, 3).join(', ')}`);
  }

  return lines.join('\n').slice(0, MEMORY_PROMPT_MAX_CHARS);
}

export async function buildLive2DMemoryPrompt(inputText, options = {}) {
  const notes = await searchLive2DMemory(inputText, options);
  return formatMemoryPrompt(notes);
}

function normalizeMemoryType(type) {
  const token = asText(type, 40).toLowerCase().replace(/[\s-]+/g, '_');
  if (token === 'running_joke') return 'joke';
  return ALLOWED_MEMORY_TYPES.has(token) ? token : '';
}

function normalizeMemoryScope(scope) {
  const token = asText(scope, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return ALLOWED_MEMORY_SCOPES.has(token) ? token : 'session';
}

function looksUnsafeMemoryText(text) {
  const value = String(text || '');
  return /api[_ -]?key|token|password|passwd|secret|bearer\s+[a-z0-9._-]+|sk-[a-z0-9]{16,}|身份证|证件号|真实地址|住址|电话|手机号/iu.test(value);
}

function sanitizeMemoryWrite(memory) {
  if (!memory || typeof memory !== 'object') return null;
  const type = normalizeMemoryType(memory.type);
  const text = asText(memory.text || memory.content || memory.summary, MEMORY_WRITE_MAX_CHARS);
  const title = asText(memory.title || memory.name, 90);
  if (!type || !title || !text) return null;
  if (looksUnsafeMemoryText(`${title}\n${text}`)) return null;

  return {
    scope: normalizeMemoryScope(memory.scope),
    type,
    title,
    text,
    episode: asText(memory.episode || memory.summary || text, MEMORY_WRITE_MAX_CHARS),
    facts: Array.isArray(memory.facts) ? memory.facts.map((fact) => asText(fact, 240)).filter(Boolean).slice(0, 8) : [],
    foresight: Array.isArray(memory.foresight) ? memory.foresight.slice(0, 5) : [],
    sourceTurnIds: Array.isArray(memory.sourceTurnIds || memory.turn_ids || memory.turnIds)
      ? (memory.sourceTurnIds || memory.turn_ids || memory.turnIds).map((id) => asText(id, 120)).filter(Boolean).slice(0, 20)
      : [],
    importance: asNumber(memory.importance, 0.45),
    confidence: asNumber(memory.confidence, 0.65),
    tags: normalizeTags(memory.tags)
  };
}

export function sanitizeMemoryWrites(memoryWrites) {
  return (Array.isArray(memoryWrites) ? memoryWrites : [])
    .map(sanitizeMemoryWrite)
    .filter(Boolean)
    .slice(0, 5);
}

export async function writePendingLive2DMemories(memoryWrites = []) {
  const settings = readRoomMemorySettings();
  if (!settings.enabled || settings.writeMode === 'off') return [];
  if (settings.provider === 'obsidian' && !settings.vaultPath) return [];

  const memories = sanitizeMemoryWrites(memoryWrites)
    .filter((memory) => {
      if (memory.type === 'viewer' && !settings.allowViewerMemory) return false;
      if (memory.type === 'session' && !settings.allowSessionMemory) return false;
      return true;
    });
  if (!memories.length) return [];

  const results = [];
  for (const memory of memories) {
    try {
      const response = await fetch('/api/memory/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...memoryApiSettings(settings),
          mode: settings.writeMode,
          memory
        })
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.success) results.push(result);
    } catch (_) {
      // Memory write must never interrupt live speech.
    }
  }
  return results;
}

function sessionMemoryReady(settings) {
  if (!settings.enabled || settings.writeMode === 'off' || !settings.allowSessionMemory) return false;
  if (settings.provider === 'obsidian') return Boolean(settings.vaultPath);
  return settings.provider === 'sqlite-milvus' || settings.provider === 'sqlite';
}

function readSessionMemoryBuffer() {
  const buffer = readJson(SESSION_MEMORY_BUFFER_KEY, []);
  return Array.isArray(buffer) ? buffer.filter(Boolean).slice(-SESSION_MEMORY_MAX_BUFFER) : [];
}

function readSessionMemoryId() {
  const existing = asText(readJson(SESSION_MEMORY_ID_KEY, ''), 120);
  if (existing) return existing;
  const created = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  writeJson(SESSION_MEMORY_ID_KEY, created);
  return created;
}

function writeSessionMemoryBuffer(buffer) {
  writeJson(SESSION_MEMORY_BUFFER_KEY, (Array.isArray(buffer) ? buffer : []).slice(-SESSION_MEMORY_MAX_BUFFER));
}

function asCompactTranscript(turns) {
  return turns
    .map((turn, index) => {
      const input = asText(turn.input, 360);
      const reply = asText(turn.reply, 360);
      const emotion = asText(turn.emotion || 'neutral', 24);
      return [
        `Turn ${index + 1}`,
        input ? `Input: ${input}` : '',
        reply ? `Yachiyo: ${reply}` : '',
        `Emotion: ${emotion}`
      ].filter(Boolean).join('\n');
    })
    .join('\n\n')
    .slice(0, 6000);
}

function sessionSummaryPrompt() {
  return [
    'Summarize a short VTuber live-stream session segment into one safe long-term MemCell candidate.',
    'Output exactly one JSON object and nothing else.',
    'JSON schema: {"title":"short title","episode":"third-person concise Chinese event summary","facts":["atomic fact"],"foresight":[{"content":"future relevance","valid_until":"","confidence":0.55}],"tags":["session","live-stream"],"importance":0.45,"confidence":0.75}',
    'Keep only durable, low-risk information: stream topic, useful viewer preferences, confirmed running jokes, important decisions, and system events.',
    'Do not include raw chat dumps, API keys, secrets, private personal data, guesses about viewers, or negative personality labels.',
    'Do not add character canon or detailed persona content.'
  ].join('\n');
}

function fallbackSessionMemory(turns) {
  const topicHints = turns
    .flatMap((turn) => textKeywords(`${turn.input || ''} ${turn.reply || ''}`))
    .filter((keyword, index, list) => list.indexOf(keyword) === index)
    .slice(0, 10);
  const emotions = turns
    .map((turn) => normalizeEmotionTag(turn.emotion))
    .filter(Boolean)
    .filter((emotion, index, list) => list.indexOf(emotion) === index)
    .slice(0, 5);
  const lines = [
    `本段直播累计 ${turns.length} 轮互动。`,
    topicHints.length ? `近期主题线索：${topicHints.join('、')}。` : '',
    emotions.length ? `表现情绪：${emotions.join('、')}。` : '',
    '该条为后台自动 session 摘要草稿，可在 Obsidian 中继续整理。'
  ]
    .filter(Boolean)
    .join('\n');
  return {
    scope: 'session',
    type: 'session',
    title: `Live session ${new Date().toISOString().slice(0, 10)}`,
    text: lines,
    episode: lines,
    facts: topicHints.slice(0, 5).map((keyword) => `本段直播出现主题线索：${keyword}`),
    foresight: [],
    importance: 0.38,
    confidence: 0.55,
    tags: ['session', 'live-stream']
  };
}

function normalizeEmotionTag(value) {
  const token = asText(value, 24).toLowerCase().replace(/[\s-]+/g, '_');
  return /^[a-z0-9_]{2,24}$/.test(token) ? token : '';
}

function parseSessionSummary(rawText, turns) {
  const value = String(rawText || '').trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(value.slice(start, end + 1));
      const title = asText(data.title, 90);
      const text = asText(data.text || data.summary || data.episode, MEMORY_WRITE_MAX_CHARS);
      if (title && text) {
        return {
          scope: 'session',
          type: 'session',
          title,
          text,
          episode: asText(data.episode || text, MEMORY_WRITE_MAX_CHARS),
          facts: Array.isArray(data.facts) ? data.facts.map((fact) => asText(fact, 240)).filter(Boolean).slice(0, 8) : [],
          foresight: Array.isArray(data.foresight) ? data.foresight.slice(0, 5) : [],
          importance: asNumber(data.importance, 0.45),
          confidence: asNumber(data.confidence, 0.72),
          tags: normalizeTags(data.tags).length ? normalizeTags(data.tags) : ['session', 'live-stream']
        };
      }
    } catch (_) {
      // Fall back to a compact deterministic summary below.
    }
  }
  return fallbackSessionMemory(turns);
}

async function summarizeSessionMemory(turns) {
  const settings = readJson('roomLLMSettings', {});
  if (!settings.apiKey || !settings.apiUrl) return fallbackSessionMemory(turns);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: asCompactTranscript(turns),
        conversation: [],
        apiKey: settings.apiKey,
        apiUrl: settings.apiUrl,
        model: settings.model,
        systemPrompt: sessionSummaryPrompt()
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) return fallbackSessionMemory(turns);
    return parseSessionSummary(result.data?.reply || '', turns);
  } catch (_) {
    return fallbackSessionMemory(turns);
  }
}

async function maybeWriteSessionSummary(buffer) {
  if (sessionSummaryInFlight) return;
  const lastSummaryAt = Number(readJson(SESSION_MEMORY_LAST_SUMMARY_KEY, 0)) || 0;
  if (buffer.length - lastSummaryAt < SESSION_MEMORY_EVERY_TURNS) return;
  sessionSummaryInFlight = true;
  try {
    const turns = buffer.slice(Math.max(0, buffer.length - SESSION_MEMORY_EVERY_TURNS));
    const memory = await summarizeSessionMemory(turns);
    if (memory) {
      await writePendingLive2DMemories([{
        ...memory,
        sourceTurnIds: turns.map((turn) => turn.turnId).filter(Boolean)
      }]);
      writeJson(SESSION_MEMORY_LAST_SUMMARY_KEY, buffer.length);
    }
  } finally {
    sessionSummaryInFlight = false;
  }
}

async function recordRawLive2DMemoryTurn(settings, turn) {
  if (!settings.enabled || !memoryDataProviderReady(settings)) return;
  try {
    await fetch('/api/memory/record-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...memoryApiSettings(settings),
        ...turn
      })
    });
  } catch (_) {
    // Raw log writes must never interrupt the live loop.
  }
}

export function recordLive2DSessionMemoryTurn(turn = {}) {
  const settings = readRoomMemorySettings();
  if (!sessionMemoryReady(settings)) return;
  const input = asText(turn.input || turn.message || '', 800);
  const reply = asText(turn.reply || '', 800);
  if (!input && !reply) return;
  const sessionId = readSessionMemoryId();
  const turnId = asText(turn.turnId, 120) || `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const at = new Date().toISOString();
  recordRawLive2DMemoryTurn(settings, {
    sessionId,
    turnId,
    at,
    source: asText(turn.source || 'live2d', 40),
    input,
    reply,
    emotion: asText(turn.emotion || 'neutral', 32)
  });
  const buffer = readSessionMemoryBuffer();
  buffer.push({
    at,
    sessionId,
    turnId,
    source: asText(turn.source || 'live2d', 40),
    input,
    reply,
    emotion: asText(turn.emotion || 'neutral', 32)
  });
  writeSessionMemoryBuffer(buffer);
  maybeWriteSessionSummary(buffer).catch(() => {});
}

function configuredMemorySettings(overrides = {}) {
  const settings = {
    ...readRoomMemorySettings(),
    ...(overrides || {})
  };
  if (!['obsidian', 'sqlite-milvus', 'sqlite'].includes(settings.provider)) throw new Error('Unsupported memory provider.');
  if (settings.provider === 'obsidian' && !settings.vaultPath) throw new Error('Obsidian vault path is required.');
  return settings;
}

async function postMemoryTool(path, settingsOverrides = {}) {
  const settings = configuredMemorySettings(settingsOverrides);
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memoryApiSettings(settings))
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.message || `Memory tool failed: ${response.status}`);
  }
  return result;
}

async function postMemoryAction(path, payload = {}, settingsOverrides = {}) {
  const settings = configuredMemorySettings(settingsOverrides);
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...memoryApiSettings(settings),
      ...(payload || {})
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.message || `Memory action failed: ${response.status}`);
  }
  return result;
}

export function initializeLive2DMemoryVault(settingsOverrides = {}) {
  return postMemoryTool('/api/memory/init', settingsOverrides);
}

export function rebuildLive2DMemoryIndex(settingsOverrides = {}) {
  return postMemoryTool('/api/memory/reindex', settingsOverrides);
}

export function consolidateLive2DMemory(settingsOverrides = {}) {
  return postMemoryTool('/api/memory/consolidate', settingsOverrides);
}

export function startManagedLive2DMemoryMilvus(settingsOverrides = {}) {
  return postMemoryTool('/api/memory/managed-milvus/start', settingsOverrides);
}

export function readLive2DMemoryProfile(settingsOverrides = {}) {
  return postMemoryTool('/api/memory/profile', settingsOverrides);
}

export function listLive2DMemoryTraces(options = {}, settingsOverrides = {}) {
  return postMemoryAction('/api/memory/traces', {
    maxItems: Number(options.maxItems) || 30
  }, settingsOverrides);
}

export function listLive2DMemoryAnchors(options = {}, settingsOverrides = {}) {
  return postMemoryAction('/api/memory/anchors', {
    maxItems: Number(options.maxItems) || 80
  }, settingsOverrides);
}

export function runLive2DMemoryGarbageCollection(settingsOverrides = {}) {
  return postMemoryTool('/api/memory/gc', settingsOverrides);
}

export function listLive2DMemoryNotes(options = {}, settingsOverrides = {}) {
  return postMemoryAction('/api/memory/list', {
    includeDisabled: Boolean(options.includeDisabled),
    maxNotes: Number(options.maxNotes) || 200
  }, settingsOverrides);
}

export function setLive2DMemoryNoteDisabled(path, disabled = true, settingsOverrides = {}) {
  return postMemoryAction('/api/memory/disable', {
    path,
    disabled
  }, settingsOverrides);
}

export function deleteLive2DMemoryNote(path, settingsOverrides = {}) {
  return postMemoryAction('/api/memory/delete', {
    path
  }, settingsOverrides);
}
