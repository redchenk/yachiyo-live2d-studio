import { readRoomMemorySettings } from './roomSettings';

const MEMORY_PROMPT_MAX_CHARS = 900;
const NOTE_SUMMARY_MAX_CHARS = 280;
const MEMORY_WRITE_MAX_CHARS = 2000;

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
