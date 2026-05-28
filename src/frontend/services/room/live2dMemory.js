import { readRoomMemorySettings } from './roomSettings';
import { readJson, writeJson } from './roomStorage';

const MEMORY_PROMPT_MAX_CHARS = 900;
const NOTE_SUMMARY_MAX_CHARS = 280;
const MEMORY_WRITE_MAX_CHARS = 2000;
const SESSION_MEMORY_BUFFER_KEY = 'live2dMemorySessionBuffer';
const SESSION_MEMORY_LAST_SUMMARY_KEY = 'live2dMemoryLastSummaryAt';
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
  return Boolean(
    settings.enabled &&
    settings.provider === 'obsidian' &&
    settings.vaultPath &&
    settings.retrievalMode !== 'off'
  );
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
    : ['viewer', 'scene', 'sample', 'joke', 'session', 'style', 'policy'];

  try {
    const response = await fetch('/api/memory/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vaultPath: settings.vaultPath,
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
    return result.notes.slice(0, settings.maxNotesPerTurn);
  } catch (_) {
    return [];
  }
}

export function formatMemoryPrompt(notes = []) {
  const usableNotes = Array.isArray(notes) ? notes.filter(Boolean).slice(0, 8) : [];
  if (!usableNotes.length) return '';

  const lines = ['Relevant long-term memory:'];
  usableNotes.forEach((note, index) => {
    const type = asText(note.type || 'memory', 32);
    const title = asText(note.title || note.path || `Memory ${index + 1}`, 80);
    const summary = asText(note.summary || note.content || '', NOTE_SUMMARY_MAX_CHARS);
    if (!summary) return;
    lines.push(`${index + 1}. ${type}: ${title}`);
    lines.push(`   ${summary}`);
  });

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
  if (!settings.enabled || !settings.vaultPath || settings.writeMode === 'off') return [];

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
          vaultPath: settings.vaultPath,
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
  return Boolean(
    settings.enabled &&
    settings.provider === 'obsidian' &&
    settings.vaultPath &&
    settings.writeMode !== 'off' &&
    settings.allowSessionMemory
  );
}

function readSessionMemoryBuffer() {
  const buffer = readJson(SESSION_MEMORY_BUFFER_KEY, []);
  return Array.isArray(buffer) ? buffer.filter(Boolean).slice(-SESSION_MEMORY_MAX_BUFFER) : [];
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
    'Summarize a short VTuber live-stream session segment into one safe long-term memory candidate.',
    'Output exactly one JSON object and nothing else.',
    'JSON schema: {"title":"short title","text":"concise Chinese session summary","tags":["session","live-stream"],"importance":0.45,"confidence":0.75}',
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
      const text = asText(data.text || data.summary, MEMORY_WRITE_MAX_CHARS);
      if (title && text) {
        return {
          scope: 'session',
          type: 'session',
          title,
          text,
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
      await writePendingLive2DMemories([memory]);
      writeJson(SESSION_MEMORY_LAST_SUMMARY_KEY, buffer.length);
    }
  } finally {
    sessionSummaryInFlight = false;
  }
}

export function recordLive2DSessionMemoryTurn(turn = {}) {
  const settings = readRoomMemorySettings();
  if (!sessionMemoryReady(settings)) return;
  const input = asText(turn.input || turn.message || '', 800);
  const reply = asText(turn.reply || '', 800);
  if (!input && !reply) return;
  const buffer = readSessionMemoryBuffer();
  buffer.push({
    at: new Date().toISOString(),
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
  if (settings.provider !== 'obsidian') throw new Error('Only Obsidian memory is supported.');
  if (!settings.vaultPath) throw new Error('Obsidian vault path is required.');
  return settings;
}

async function postMemoryTool(path, settingsOverrides = {}) {
  const settings = configuredMemorySettings(settingsOverrides);
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vaultPath: settings.vaultPath })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.message || `Memory tool failed: ${response.status}`);
  }
  return result;
}

export function initializeLive2DMemoryVault(settingsOverrides = {}) {
  return postMemoryTool('/api/memory/init', settingsOverrides);
}

export function rebuildLive2DMemoryIndex(settingsOverrides = {}) {
  return postMemoryTool('/api/memory/reindex', settingsOverrides);
}
