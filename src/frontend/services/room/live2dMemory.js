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
const MEMORY_OUTBOX_KEY = 'live2dMemoryDurableOutboxV1';
const MEMORY_OUTBOX_MAX_ITEMS = 2000;
const MEMORY_OUTBOX_BATCH_SIZE = 80;

let sessionSummaryInFlight = false;
let memoryOutboxFlushPromise = null;
let memoryOutboxTimer = 0;

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

function stablePayload(value) {
  if (Array.isArray(value)) return `[${value.map(stablePayload).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value ?? null);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stablePayload(value[key])}`).join(',')}}`;
}

function compactHash(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function trustedViewer(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const platform = asText(value.platform || value.source || 'bilibili', 40).toLowerCase();
  const userId = asText(value.userId || value.platformUserId || value.uid || value.id, 120);
  const userName = asText(value.userName || value.displayName || value.username || value.name, 120);
  if (!userId && !userName) return null;
  return { platform, userId, userName };
}

function readMemoryOutbox() {
  const items = readJson(MEMORY_OUTBOX_KEY, []);
  return Array.isArray(items) ? items.filter((item) => item?.id && item?.route && item?.payload).slice(-MEMORY_OUTBOX_MAX_ITEMS) : [];
}

function writeMemoryOutbox(items) {
  writeJson(MEMORY_OUTBOX_KEY, (Array.isArray(items) ? items : []).slice(-MEMORY_OUTBOX_MAX_ITEMS));
}

function enqueueMemoryOutbox(route, payload, explicitId = '') {
  const id = asText(explicitId, 160) || `memory-${compactHash(`${route}:${stablePayload(payload)}`)}`;
  const current = readMemoryOutbox();
  if (!current.some((item) => item.id === id)) {
    current.push({ id, route, payload, queuedAt: Date.now() });
    writeMemoryOutbox(current);
  }
  scheduleMemoryOutboxFlush(180);
  return id;
}

function scheduleMemoryOutboxFlush(delayMs = 1200) {
  if (typeof window === 'undefined' || memoryOutboxTimer) return;
  memoryOutboxTimer = window.setTimeout(() => {
    memoryOutboxTimer = 0;
    flushLive2DMemoryOutbox().catch(() => {});
  }, Math.max(0, Number(delayMs) || 0));
}

export async function flushLive2DMemoryOutbox() {
  if (memoryOutboxFlushPromise) return memoryOutboxFlushPromise;
  memoryOutboxFlushPromise = (async () => {
    const settings = readRoomMemorySettings();
    if (!settings.enabled || settings.writeMode === 'off') return { flushed: 0, pending: readMemoryOutbox().length };
    let flushed = 0;
    while (true) {
      const current = readMemoryOutbox();
      if (!current.length) break;
      const first = current[0];
      const batch = first.route === '/api/memory/record-turn'
        ? current.filter((item) => item.route === first.route).slice(0, MEMORY_OUTBOX_BATCH_SIZE)
        : [first];
      const body = first.route === '/api/memory/record-turn'
        ? { ...memoryApiSettings(settings), turns: batch.map((item) => item.payload) }
        : { ...memoryApiSettings(settings), ...first.payload };
      try {
        const response = await fetch(first.route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) break;
        const completedIds = new Set(batch.map((item) => item.id));
        writeMemoryOutbox(readMemoryOutbox().filter((item) => !completedIds.has(item.id)));
        flushed += completedIds.size;
      } catch (_) {
        break;
      }
    }
    const pending = readMemoryOutbox().length;
    if (pending) scheduleMemoryOutboxFlush(3000);
    return { flushed, pending };
  })();
  try {
    return await memoryOutboxFlushPromise;
  } finally {
    memoryOutboxFlushPromise = null;
  }
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
  await flushLive2DMemoryOutbox().catch(() => ({ flushed: 0, pending: readMemoryOutbox().length }));

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
          viewerIds: Array.isArray(options.viewerIds) ? options.viewerIds.map((id) => asText(id, 160)).filter(Boolean).slice(0, 8) : [],
          viewers: Array.isArray(options.viewers) ? options.viewers.map(trustedViewer).filter(Boolean).slice(0, 8) : [],
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
  if (Array.isArray(recollection?.viewers) && recollection.viewers.length) {
    lines.push('Trusted viewer profiles for this turn:');
    recollection.viewers.slice(0, 4).forEach((viewer) => {
      const name = asText(viewer.displayName || viewer.platformUserId || 'viewer', 80);
      const topics = Array.isArray(viewer.topics) ? viewer.topics.slice(-6).join(', ') : '';
      const preferences = Array.isArray(viewer.preferences) ? viewer.preferences.slice(-3).join(' | ') : '';
      lines.push(`- ${name}: ${asText(viewer.summary, 240)}`);
      if (topics) lines.push(`  Topics: ${asText(topics, 180)}`);
      if (preferences) lines.push(`  Preferences: ${asText(preferences, 240)}`);
    });
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
    tags: normalizeTags(memory.tags),
    idempotencyKey: asText(memory.idempotencyKey || memory.idempotency_key, 300),
    viewer: trustedViewer(memory.viewer || {})
  };
}

export function sanitizeMemoryWrites(memoryWrites) {
  return (Array.isArray(memoryWrites) ? memoryWrites : [])
    .map(sanitizeMemoryWrite)
    .filter(Boolean)
    .slice(0, 5);
}

export async function writePendingLive2DMemories(memoryWrites = [], options = {}) {
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
  const contextViewers = (Array.isArray(options.viewers) ? options.viewers : [])
    .map(trustedViewer)
    .filter(Boolean);
  const contextViewer = trustedViewer(options.viewer || {}) || (contextViewers.length === 1 ? contextViewers[0] : null);
  for (const rawMemory of memories) {
    const memory = {
      ...rawMemory,
      viewer: rawMemory.viewer || contextViewer || undefined,
      idempotencyKey: rawMemory.idempotencyKey || `llm-${compactHash(stablePayload({
        type: rawMemory.type,
        title: rawMemory.title,
        text: rawMemory.text,
        sourceTurnIds: rawMemory.sourceTurnIds,
        viewer: rawMemory.viewer || contextViewer
      }))}`
    };
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
      if (response.ok && result.success) {
        results.push(result);
      } else {
        enqueueMemoryOutbox('/api/memory/write', { mode: settings.writeMode, memory }, `write-${memory.idempotencyKey}`);
      }
    } catch (_) {
      enqueueMemoryOutbox('/api/memory/write', { mode: settings.writeMode, memory }, `write-${memory.idempotencyKey}`);
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
  const durableId = asText(turn.turnId || turn.turn_id, 120) || `turn-${compactHash(stablePayload(turn))}`;
  enqueueMemoryOutbox('/api/memory/record-turn', turn, `turn-${durableId}`);
}

export function recordLive2DViewerMemoryInteraction(turn = {}) {
  const settings = readRoomMemorySettings();
  if (!settings.enabled || settings.writeMode === 'off' || !settings.allowViewerMemory || !memoryDataProviderReady(settings)) return false;
  const viewer = trustedViewer(turn.viewer || turn);
  const input = asText(turn.input || turn.message || turn.text, 800);
  if (!viewer || !input) return false;
  const sessionId = readSessionMemoryId();
  const sourceId = asText(turn.turnId || turn.messageId || turn.id, 120);
  const turnId = sourceId
    ? `viewer-${viewer.platform}-${sourceId}`
    : `viewer-${compactHash(`${viewer.platform}:${viewer.userId || viewer.userName}:${turn.at || turn.timestamp || ''}:${input}`)}`;
  recordRawLive2DMemoryTurn(settings, {
    sessionId,
    turnId,
    at: turn.at || (Number(turn.timestamp) ? new Date(Number(turn.timestamp)).toISOString() : new Date().toISOString()),
    source: asText(turn.source || viewer.platform || 'audience', 40),
    input,
    emotion: asText(turn.emotion || 'neutral', 32),
    eventType: asText(turn.eventType || turn.messageType || turn.type || 'message', 40),
    giftName: asText(turn.giftName, 120),
    amount: Math.max(0, Number(turn.amount) || 0),
    price: Math.max(0, Number(turn.price) || 0),
    viewer
  });
  return true;
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
    emotion: asText(turn.emotion || 'neutral', 32),
    viewer: trustedViewer(turn.viewer || {}) || undefined
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

if (typeof window !== 'undefined') {
  if (readMemoryOutbox().length) scheduleMemoryOutboxFlush(250);
  window.addEventListener?.('online', () => scheduleMemoryOutboxFlush(0));
  window.addEventListener?.('beforeunload', () => {
    flushLive2DMemoryOutbox().catch(() => {});
  });
}
