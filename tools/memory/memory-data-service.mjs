import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';

const DEFAULT_PORT = 3299;
const DEFAULT_COLLECTION = 'yachiyo_memory';
const DEFAULT_DIMENSION = 384;
const DEFAULT_MILVUS_IMAGE = 'milvusdb/milvus:latest';
const DEFAULT_MILVUS_URL = 'http://127.0.0.1:19530';
const DEFAULT_PERSONA_CORPUS_FILE = 'yachiyo_novel_detailed_corpus.txt';
const MANAGED_MILVUS_CONTAINER = 'yachiyo-milvus-standalone';
const MAX_MEMORY_ROWS = 50000;
const MAX_NOTE_BYTES = 256 * 1024;
const MAX_WRITE_CHARS = 2400;
const DOCKER_DAEMON_WAIT_MS = 120000;
const SESSION_ROLLUP_MAX_MESSAGES = 24;
const SESSION_ROLLUP_TURNS = 12;
const DEFAULT_GC_ARCHIVE_DAYS = 30;
const DEFAULT_GC_FORGET_DAYS = 120;
const DEFAULT_RAW_RETENTION_DAYS = 120;
const execFileAsync = promisify(execFile);
let managedMilvusPromise = null;
let managedMilvusStartupError = '';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, '..', '..');

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || process.env.YACHIYO_MEMORY_PORT || DEFAULT_PORT);
const repoRoot = path.resolve(args.repoRoot || args['repo-root'] || process.env.YACHIYO_REPO_ROOT || defaultRepoRoot);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] || '';
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 0) {
      result[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = 'true';
    }
  }
  return result;
}

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
  });
}

function appDataDir() {
  const root = process.env.LOCALAPPDATA || process.env.APPDATA || repoRoot;
  return path.join(root, 'YachiyoLive2DStudio', 'MemoryData');
}

function asText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function asNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function asBooleanDefault(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return asBoolean(value);
}

function readJsonValue(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch (_) {
    return fallback;
  }
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/u);
  return [...new Set(source
    .map((tag) => String(tag || '').trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean))]
    .slice(0, 16);
}

function textKeywords(text) {
  const value = String(text || '').toLowerCase();
  const cjk = value.match(/[\u3400-\u9fff]{2,}/gu) || [];
  const latin = value.match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
  return [...new Set([...cjk, ...latin])].slice(0, 16);
}

function safeSlug(text) {
  const slug = String(text || 'memory')
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'memory').slice(0, 80);
}

function sha1(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}

function defaultDatabasePath() {
  return path.join(appDataDir(), 'yachiyo-memory.sqlite');
}

function defaultPersonaCorpusPath() {
  const candidates = [
    process.env.YACHIYO_PERSONA_CORPUS_PATH,
    path.resolve(repoRoot, '..', DEFAULT_PERSONA_CORPUS_FILE),
    path.resolve(repoRoot, DEFAULT_PERSONA_CORPUS_FILE),
    'E:\\visualstudio\\yachiyo_novel_detailed_corpus.txt'
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || '';
}

function resolveDatabasePath(inputPath) {
  const value = String(inputPath || '').trim();
  if (!value) return defaultDatabasePath();
  const expanded = value.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || '');
  const resolved = path.resolve(expanded);
  if (/\.(sqlite|sqlite3|db)$/i.test(resolved)) return resolved;
  return path.join(resolved, 'yachiyo-memory.sqlite');
}

function resolveOptionalPath(inputPath, fallback = '') {
  const value = String(inputPath || fallback || '').trim();
  if (!value) return '';
  const expanded = value.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || '');
  return path.resolve(expanded);
}

function normalizeSettings(input = {}) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : input;
  const dimension = Math.round(asNumber(
    settings.embeddingDimension || settings.vectorDimension,
    DEFAULT_DIMENSION,
    32,
    4096
  ));
  return {
    databasePath: resolveDatabasePath(settings.databasePath || settings.dbPath || settings.sqlitePath),
    vaultPath: asText(settings.vaultPath || '', 1000),
    personaCorpusPath: resolveOptionalPath(settings.personaCorpusPath || settings.corpusPath, defaultPersonaCorpusPath()),
    retrievalMode: asText(input.query?.retrievalMode || settings.retrievalMode || 'hybrid', 40).toLowerCase(),
    writeMode: asText(input.mode || settings.writeMode || 'auto-approved', 40).toLowerCase(),
    maxNotes: Math.round(asNumber(input.query?.maxNotes || settings.maxNotesPerTurn, 4, 1, 12)),
    milvusEnabled: asBoolean(settings.milvusEnabled || settings.useMilvus),
    milvusManaged: asBoolean(settings.milvusManaged || settings.manageMilvus),
    milvusUrl: asText(settings.milvusUrl || settings.milvusEndpoint || process.env.YACHIYO_MEMORY_MILVUS_URL || DEFAULT_MILVUS_URL, 300).replace(/\/+$/, ''),
    milvusToken: asText(settings.milvusToken || '', 1000),
    milvusCollection: asText(settings.milvusCollection || DEFAULT_COLLECTION, 80).replace(/[^a-zA-Z0-9_]/g, '_') || DEFAULT_COLLECTION,
    milvusImage: asText(settings.milvusImage || process.env.YACHIYO_MEMORY_MILVUS_IMAGE || DEFAULT_MILVUS_IMAGE, 200),
    embeddingApiUrl: asText(settings.embeddingApiUrl || '', 300),
    embeddingApiKey: asText(settings.embeddingApiKey || '', 1000),
    embeddingModel: asText(settings.embeddingModel || 'text-embedding-3-small', 120),
    embeddingDimension: dimension,
    sessionRollupEnabled: asBooleanDefault(settings.sessionRollupEnabled, true),
    gcEnabled: asBooleanDefault(settings.gcEnabled, true),
    gcArchiveDays: Math.round(asNumber(settings.gcArchiveDays, DEFAULT_GC_ARCHIVE_DAYS, 1, 3650)),
    gcForgetDays: Math.round(asNumber(settings.gcForgetDays, DEFAULT_GC_FORGET_DAYS, 7, 3650)),
    rawRetentionDays: Math.round(asNumber(settings.rawRetentionDays, DEFAULT_RAW_RETENTION_DAYS, 7, 3650)),
    anchorImportanceThreshold: asNumber(settings.anchorImportanceThreshold, 0.72, 0.1, 1)
  };
}

function openStore(settings) {
  fs.mkdirSync(path.dirname(settings.databasePath), { recursive: true });
  const db = new Database(settings.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      scope TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'runtime',
      path TEXT NOT NULL DEFAULT '',
      importance REAL NOT NULL DEFAULT 0.45,
      confidence REAL NOT NULL DEFAULT 0.65,
      disabled INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'approved',
      updated TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      vector_json TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_memories_path ON memories(path);
    CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(disabled, deleted);

    CREATE TABLE IF NOT EXISTS raw_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL DEFAULT '',
      turn_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'live2d',
      emotion TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_raw_messages_session ON raw_messages(session_id, created);
    CREATE INDEX IF NOT EXISTS idx_raw_messages_turn ON raw_messages(turn_id);

    CREATE TABLE IF NOT EXISTS mem_cells (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'memory',
      scope TEXT NOT NULL DEFAULT 'long_term',
      episode TEXT NOT NULL DEFAULT '',
      facts_json TEXT NOT NULL DEFAULT '[]',
      foresight_json TEXT NOT NULL DEFAULT '[]',
      source_turn_ids_json TEXT NOT NULL DEFAULT '[]',
      source_memory_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'runtime',
      scene_id TEXT NOT NULL DEFAULT '',
      importance REAL NOT NULL DEFAULT 0.45,
      confidence REAL NOT NULL DEFAULT 0.65,
      status TEXT NOT NULL DEFAULT 'active',
      valid_from TEXT NOT NULL DEFAULT '',
      valid_until TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      vector_json TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_mem_cells_scene ON mem_cells(scene_id);
    CREATE INDEX IF NOT EXISTS idx_mem_cells_source_memory ON mem_cells(source_memory_id);
    CREATE INDEX IF NOT EXISTS idx_mem_cells_status ON mem_cells(status, valid_until);

    CREATE TABLE IF NOT EXISTS mem_scenes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      centroid_vector_json TEXT NOT NULL DEFAULT '[]',
      cell_count INTEGER NOT NULL DEFAULT 0,
      importance REAL NOT NULL DEFAULT 0.45,
      confidence REAL NOT NULL DEFAULT 0.65,
      status TEXT NOT NULL DEFAULT 'active',
      created TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT '',
      last_cell_id TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_mem_scenes_status ON mem_scenes(status, updated);

    CREATE TABLE IF NOT EXISTS scene_cell_links (
      scene_id TEXT NOT NULL,
      cell_id TEXT NOT NULL,
      created TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (scene_id, cell_id)
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0.5,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'candidate',
      valid_from TEXT NOT NULL DEFAULT '',
      valid_until TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_user_profile_category ON user_profile(category, status);

    CREATE TABLE IF NOT EXISTS memory_conflicts (
      id TEXT PRIMARY KEY,
      left_cell_id TEXT NOT NULL,
      right_cell_id TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      severity REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'active',
      created TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS retrieval_traces (
      id TEXT PRIMARY KEY,
      query_text TEXT NOT NULL DEFAULT '',
      query_type TEXT NOT NULL DEFAULT 'general',
      scene_ids_json TEXT NOT NULL DEFAULT '[]',
      cell_ids_json TEXT NOT NULL DEFAULT '[]',
      note_ids_json TEXT NOT NULL DEFAULT '[]',
      sufficient INTEGER NOT NULL DEFAULT 0,
      missing_json TEXT NOT NULL DEFAULT '[]',
      created TEXT NOT NULL DEFAULT '',
      context_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_retrieval_traces_created ON retrieval_traces(created);
  `);
  migrateStore(db);
  return db;
}

function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}

function ensureColumn(db, tableName, columnSql) {
  const name = String(columnSql || '').trim().split(/\s+/)[0];
  if (!name || tableColumns(db, tableName).has(name)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
}

function migrateStore(db) {
  ensureColumn(db, 'memories', "last_recalled TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'memories', 'recall_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'memories', "viewer_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'memories', "embedding_signature TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'memories', 'vector_dimension INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'mem_cells', 'pinned INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'mem_cells', 'decay_score REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'mem_cells', "last_recalled TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'mem_cells', 'recall_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'mem_cells', "viewer_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'mem_cells', "embedding_signature TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'mem_cells', 'vector_dimension INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'mem_scenes', "viewer_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'mem_scenes', "embedding_signature TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'mem_scenes', 'vector_dimension INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'raw_messages', "viewer_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'raw_messages', "compacted_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'user_profile', "viewer_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'retrieval_traces', "viewer_ids_json TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'retrieval_traces', "embedding_signature TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'retrieval_traces', 'vector_degraded INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_anchors (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL DEFAULT 'cell',
      target_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      importance REAL NOT NULL DEFAULT 0.72,
      created TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT '',
      last_recalled TEXT NOT NULL DEFAULT '',
      recall_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_memory_anchors_target ON memory_anchors(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_memory_anchors_updated ON memory_anchors(updated);

    CREATE TABLE IF NOT EXISTS memory_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS viewer_profiles (
      id TEXT PRIMARY KEY,
      identity_key TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL DEFAULT '',
      platform_user_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      topics_json TEXT NOT NULL DEFAULT '[]',
      preferences_json TEXT NOT NULL DEFAULT '[]',
      evidence_turn_ids_json TEXT NOT NULL DEFAULT '[]',
      first_seen TEXT NOT NULL DEFAULT '',
      last_seen TEXT NOT NULL DEFAULT '',
      interaction_count INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      gift_count INTEGER NOT NULL DEFAULT 0,
      superchat_count INTEGER NOT NULL DEFAULT 0,
      guard_count INTEGER NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      last_message TEXT NOT NULL DEFAULT '',
      last_event_type TEXT NOT NULL DEFAULT '',
      last_session_id TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_viewer_profiles_platform_user ON viewer_profiles(platform, platform_user_id);
    CREATE INDEX IF NOT EXISTS idx_viewer_profiles_last_seen ON viewer_profiles(last_seen DESC);

    CREATE TABLE IF NOT EXISTS memory_segments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      viewer_id TEXT NOT NULL DEFAULT '',
      segment_index INTEGER NOT NULL DEFAULT 0,
      first_turn_id TEXT NOT NULL DEFAULT '',
      last_turn_id TEXT NOT NULL DEFAULT '',
      turn_count INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      transcript_gzip BLOB NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      sealed INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT '',
      UNIQUE(session_id, viewer_id, segment_index)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_segments_session ON memory_segments(session_id, viewer_id, segment_index);
    CREATE INDEX IF NOT EXISTS idx_memory_segments_updated ON memory_segments(updated DESC);

    CREATE INDEX IF NOT EXISTS idx_memories_viewer ON memories(viewer_id, disabled, deleted);
    CREATE INDEX IF NOT EXISTS idx_mem_cells_viewer ON mem_cells(viewer_id, status, updated DESC);
    CREATE INDEX IF NOT EXISTS idx_mem_scenes_viewer ON mem_scenes(viewer_id, status, updated DESC);
    CREATE INDEX IF NOT EXISTS idx_raw_messages_viewer ON raw_messages(viewer_id, session_id, created);
    CREATE INDEX IF NOT EXISTS idx_user_profile_viewer ON user_profile(viewer_id, category, status);
  `);
}

function stripMarkdown(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^[#>*\-\s]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFrontmatter(markdown) {
  const text = String(markdown || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.startsWith('---\n')) return { frontmatter: {}, content: text };
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return { frontmatter: {}, content: text };
  const yaml = text.slice(4, end);
  const content = text.slice(end + 5);
  const frontmatter = {};
  let listKey = '';
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const listItem = line.match(/^\s*-\s*(.+)$/);
    if (listItem && listKey) {
      frontmatter[listKey] = Array.isArray(frontmatter[listKey]) ? frontmatter[listKey] : [];
      frontmatter[listKey].push(listItem[1].trim());
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    listKey = match[1].toLowerCase();
    const value = match[2].trim();
    frontmatter[listKey] = value ? value.replace(/^["']|["']$/g, '') : [];
  }
  return { frontmatter, content };
}

function frontmatterTags(frontmatter) {
  const tags = frontmatter.tags;
  if (Array.isArray(tags)) return normalizeTags(tags);
  return normalizeTags(tags || '');
}

function markdownTitle(content, fallback) {
  const match = String(content || '').match(/^\s*#\s+(.+)$/m);
  return asText(match ? match[1] : fallback, 120) || 'Memory';
}

function parseMarkdownNote(root, file, source) {
  const info = fs.statSync(file);
  if (!info.isFile() || info.size > MAX_NOTE_BYTES) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const { frontmatter, content } = parseFrontmatter(raw);
  const relative = path.relative(root, file).replace(/\\/g, '/');
  const clean = stripMarkdown(content);
  const title = markdownTitle(content, path.basename(file, path.extname(file)));
  const summary = asText(frontmatter.summary || clean, 420);
  const tags = frontmatterTags(frontmatter);
  const type = asText(frontmatter.type || inferTypeFromPath(relative), 40).toLowerCase() || 'memory';
  const scope = asText(frontmatter.scope || inferScopeFromType(type), 40).toLowerCase() || 'long_term';
  return {
    id: sha1(`${source}:${relative}`),
    title,
    type,
    scope,
    tags,
    summary,
    content: asText(clean, 2800),
    source,
    path: `${source}:${relative}`,
    importance: asNumber(frontmatter.importance, source === 'seed' ? 0.72 : 0.48, 0, 1),
    confidence: asNumber(frontmatter.confidence, source === 'seed' ? 0.82 : 0.66, 0, 1),
    disabled: 0,
    deleted: 0,
    reviewStatus: 'approved',
    updated: asText(frontmatter.updated || info.mtime.toISOString(), 80),
    contentHash: sha1(raw)
  };
}

function chunkPlainText(rawText, maxChars = 1800) {
  const paragraphs = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
    } else if ((current.length + paragraph.length + 2) <= maxChars) {
      current = `${current}\n\n${paragraph}`;
    } else {
      chunks.push(current);
      current = paragraph;
    }
    if (chunks.length >= MAX_MEMORY_ROWS) break;
  }
  if (current && chunks.length < MAX_MEMORY_ROWS) chunks.push(current);
  return chunks.length ? chunks : [String(rawText || '').trim()].filter(Boolean);
}

function inferPersonaType(content) {
  const value = String(content || '').toLowerCase();
  if (/style|voice|tone|speech|口癖|语气|说话|台词/u.test(value)) return 'style';
  if (/policy|rule|constraint|must|never|禁止|规则|不能|不要/u.test(value)) return 'policy';
  if (/profile|personality|人格|性格|身份|角色/u.test(value)) return 'profile';
  return 'lore';
}

function personaChunkTitle(content, index) {
  const firstLine = String(content || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);
  const title = firstLine ? firstLine.replace(/^#+\s*/, '') : `Yachiyo persona ${index + 1}`;
  return asText(title, 88) || `Yachiyo persona ${index + 1}`;
}

function parseTextCorpus(file, source = 'persona') {
  if (!file || !fs.existsSync(file)) return [];
  const info = fs.statSync(file);
  if (!info.isFile() || info.size > MAX_NOTE_BYTES * 4) return [];
  const raw = fs.readFileSync(file, 'utf8');
  const resolved = path.resolve(file);
  return chunkPlainText(raw)
    .map((content, index) => {
      const type = inferPersonaType(content);
      return {
        id: sha1(`${source}:${resolved}:${index}`),
        title: personaChunkTitle(content, index),
        type,
        scope: inferScopeFromType(type),
        tags: normalizeTags(['persona', 'yachiyo', type]),
        summary: asText(stripMarkdown(content), 420),
        content: asText(stripMarkdown(content), 2800),
        source,
        path: `${source}:${path.basename(file)}#${String(index + 1).padStart(3, '0')}`,
        importance: type === 'policy' ? 0.9 : 0.82,
        confidence: 0.86,
        disabled: 0,
        deleted: 0,
        reviewStatus: 'approved',
        updated: info.mtime.toISOString(),
        contentHash: sha1(`${resolved}:${index}:${content}`)
      };
    })
    .filter((note) => note.content);
}

function inferTypeFromPath(relative) {
  const value = String(relative || '').toLowerCase();
  if (value.includes('profile')) return 'profile';
  if (value.includes('lore')) return 'lore';
  if (value.includes('viewer')) return 'viewer';
  if (value.includes('session')) return 'session';
  if (value.includes('joke')) return 'joke';
  if (value.includes('scene')) return 'scene';
  if (value.includes('sample')) return 'sample';
  if (value.includes('system') || value.includes('policy') || value.includes('rules')) return 'policy';
  return 'memory';
}

function inferScopeFromType(type) {
  if (['profile', 'lore', 'policy', 'style'].includes(type)) return 'canon';
  if (type === 'viewer') return 'relationship';
  if (type === 'session') return 'session';
  return 'long_term';
}

function isIgnoredVaultPath(file) {
  const value = file.replace(/\\/g, '/').toLowerCase();
  return value.includes('/.obsidian/') ||
    value.includes('/.trash/') ||
    value.includes('/.yachiyo-index/') ||
    value.includes('/00_inbox/') ||
    value.includes('/00-inbox/');
}

function walkMarkdown(root) {
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !isIgnoredVaultPath(fullPath)) {
        files.push(fullPath);
      }
      if (files.length >= MAX_MEMORY_ROWS) return;
    }
  };
  visit(root);
  return files;
}

function hashEmbedding(text, dimension = DEFAULT_DIMENSION) {
  const dims = Math.max(32, Math.min(4096, Math.round(Number(dimension) || DEFAULT_DIMENSION)));
  const vector = new Array(dims).fill(0);
  const value = String(text || '').toLowerCase();
  const terms = textKeywords(value);
  const chars = Array.from(value.replace(/\s+/g, ''));
  for (const term of terms) addHashedTerm(vector, term, 2.2);
  for (let index = 0; index < chars.length; index += 1) {
    addHashedTerm(vector, chars.slice(index, index + 3).join(''), 0.6);
  }
  let norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!norm) {
    vector[0] = 1;
    norm = 1;
  }
  return vector.map((item) => Number((item / norm).toFixed(6)));
}

function addHashedTerm(vector, term, weight) {
  if (!term) return;
  const digest = crypto.createHash('sha256').update(term).digest();
  const index = digest.readUInt32BE(0) % vector.length;
  const sign = digest[4] % 2 === 0 ? 1 : -1;
  vector[index] += sign * weight;
}

function configuredEmbeddingSignature(settings) {
  const dimension = Math.max(32, Math.min(4096, Math.round(Number(settings.embeddingDimension) || DEFAULT_DIMENSION)));
  if (!settings.embeddingApiUrl || !settings.embeddingApiKey) return `hash-v2:${dimension}`;
  return `api:${sha1(settings.embeddingApiUrl).slice(0, 12)}:${settings.embeddingModel}:${dimension}`;
}

async function embeddingForDetailed(text, settings) {
  const hashSignature = `hash-v2:${settings.embeddingDimension}`;
  if (!settings.embeddingApiUrl || !settings.embeddingApiKey) {
    return {
      vector: hashEmbedding(text, settings.embeddingDimension),
      signature: hashSignature,
      degraded: false,
      provider: 'hash'
    };
  }
  try {
    const response = await fetch(settings.embeddingApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.embeddingApiKey}`
      },
      body: JSON.stringify({
        model: settings.embeddingModel,
        input: String(text || '').slice(0, 8000),
        dimensions: settings.embeddingDimension
      })
    });
    if (!response.ok) throw new Error(`embedding ${response.status}`);
    const payload = await response.json();
    const vector = payload?.data?.[0]?.embedding || payload?.embedding;
    if (!Array.isArray(vector) || !vector.length) throw new Error('empty embedding');
    return {
      vector: normalizeVector(vector, settings.embeddingDimension),
      signature: configuredEmbeddingSignature(settings),
      degraded: false,
      provider: 'api'
    };
  } catch (error) {
    return {
      vector: hashEmbedding(text, settings.embeddingDimension),
      signature: `${hashSignature}:fallback`,
      degraded: true,
      provider: 'hash',
      error: error.message || 'Embedding API unavailable.'
    };
  }
}

async function embeddingFor(text, settings) {
  return (await embeddingForDetailed(text, settings)).vector;
}

function vectorIsValid(vector, dimension) {
  if (!Array.isArray(vector) || vector.length !== Number(dimension)) return false;
  if (vector.some((item) => !Number.isFinite(Number(item)))) return false;
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + Number(item) * Number(item), 0));
  return Number.isFinite(norm) && norm > 0.92 && norm < 1.08;
}

function embeddingsCompatible(leftSignature, rightSignature, leftVector, rightVector) {
  return Boolean(
    leftSignature &&
    rightSignature &&
    leftSignature === rightSignature &&
    Array.isArray(leftVector) &&
    Array.isArray(rightVector) &&
    leftVector.length === rightVector.length
  );
}

function normalizeVector(vector, dimension) {
  const dims = Math.max(32, Math.min(4096, Math.round(Number(dimension) || vector.length || DEFAULT_DIMENSION)));
  const resized = new Array(dims).fill(0);
  for (let index = 0; index < vector.length; index += 1) {
    resized[index % dims] += Number(vector[index]) || 0;
  }
  let norm = Math.sqrt(resized.reduce((sum, item) => sum + item * item, 0));
  if (!norm) {
    resized[0] = 1;
    norm = 1;
  }
  return resized.map((item) => Number((item / norm).toFixed(6)));
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let index = 0; index < length; index += 1) {
    dot += (Number(a[index]) || 0) * (Number(b[index]) || 0);
  }
  return Math.max(0, Math.min(1, (dot + 1) / 2));
}

function noteEmbeddingText(note) {
  return [note.title, note.type, note.scope, (note.tags || []).join(' '), note.summary, note.content]
    .filter(Boolean)
    .join('\n')
    .slice(0, 6000);
}

async function prepareNoteForStore(note, settings) {
  const embedding = await embeddingForDetailed(noteEmbeddingText(note), settings);
  return {
    ...note,
    vector: embedding.vector,
    embeddingSignature: embedding.signature,
    vectorDimension: embedding.vector.length,
    embeddingDegraded: embedding.degraded
  };
}

function upsertNote(db, note) {
  db.prepare(`
    INSERT INTO memories (
      id, title, type, scope, tags_json, summary, content, source, path,
      importance, confidence, disabled, deleted, review_status, updated, content_hash, vector_json,
      viewer_id, embedding_signature, vector_dimension
    )
    VALUES (
      @id, @title, @type, @scope, @tagsJson, @summary, @content, @source, @path,
      @importance, @confidence, @disabled, @deleted, @reviewStatus, @updated, @contentHash, @vectorJson,
      @viewerId, @embeddingSignature, @vectorDimension
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      type = excluded.type,
      scope = excluded.scope,
      tags_json = excluded.tags_json,
      summary = excluded.summary,
      content = excluded.content,
      source = excluded.source,
      path = excluded.path,
      importance = excluded.importance,
      confidence = excluded.confidence,
      deleted = 0,
      review_status = excluded.review_status,
      updated = excluded.updated,
      content_hash = excluded.content_hash,
      vector_json = excluded.vector_json,
      viewer_id = excluded.viewer_id,
      embedding_signature = excluded.embedding_signature,
      vector_dimension = excluded.vector_dimension
  `).run({
    id: note.id,
    title: note.title,
    type: note.type,
    scope: note.scope,
    tagsJson: JSON.stringify(note.tags || []),
    summary: note.summary || '',
    content: note.content || '',
    source: note.source || 'runtime',
    path: note.path || note.id,
    importance: Number(note.importance) || 0.45,
    confidence: Number(note.confidence) || 0.65,
    disabled: note.disabled ? 1 : 0,
    deleted: note.deleted ? 1 : 0,
    reviewStatus: note.reviewStatus || 'approved',
    updated: note.updated || new Date().toISOString(),
    contentHash: note.contentHash || sha1(`${note.title}\n${note.content}`),
    vectorJson: JSON.stringify(note.vector || []),
    viewerId: note.viewerId || '',
    embeddingSignature: note.embeddingSignature || '',
    vectorDimension: Number(note.vectorDimension) || (note.vector || []).length
  });
}

function rowToNote(row) {
  if (!row) return null;
  let tags = [];
  let vector = [];
  try { tags = JSON.parse(row.tags_json || '[]'); } catch (_) { tags = []; }
  try { vector = JSON.parse(row.vector_json || '[]'); } catch (_) { vector = []; }
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    scope: row.scope,
    tags,
    summary: row.summary,
    content: row.content,
    source: row.source,
    path: row.path,
    importance: Number(row.importance) || 0,
    confidence: Number(row.confidence) || 0,
    disabled: Boolean(row.disabled),
    deleted: Boolean(row.deleted),
    reviewStatus: row.review_status,
    updated: row.updated,
    contentHash: row.content_hash,
    lastRecalled: row.last_recalled || '',
    recallCount: Number(row.recall_count) || 0,
    viewerId: row.viewer_id || '',
    embeddingSignature: row.embedding_signature || '',
    vectorDimension: Number(row.vector_dimension) || vector.length,
    vector
  };
}

function activeRows(db, includeDisabled = false, limit = MAX_MEMORY_ROWS) {
  const where = includeDisabled ? 'deleted = 0' : 'deleted = 0 AND disabled = 0';
  return db.prepare(`SELECT * FROM memories WHERE ${where} ORDER BY source, type, title LIMIT ?`).all(limit)
    .map(rowToNote)
    .filter(Boolean);
}

function normalizeFactList(value, fallbackText = '') {
  const source = Array.isArray(value) ? value : String(value || '')
    .split(/[。.!?；;\n]+/u)
    .map((item) => item.trim());
  const facts = source
    .map((item) => asText(item, 320))
    .filter((item) => item.length >= 4)
    .slice(0, 8);
  if (facts.length) return facts;
  const fallback = asText(fallbackText, 320);
  return fallback ? [fallback] : [];
}

function normalizeForesightList(value, fallbackDate = '') {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        return {
          content: asText(item, 360),
          valid_from: fallbackDate,
          valid_until: '',
          confidence: 0.55,
          evidence: []
        };
      }
      if (!item || typeof item !== 'object') return null;
      const content = asText(item.content || item.text || item.summary, 360);
      if (!content) return null;
      return {
        content,
        valid_from: asText(item.valid_from || item.validFrom || fallbackDate, 80),
        valid_until: asText(item.valid_until || item.validUntil || '', 80),
        confidence: asNumber(item.confidence, 0.55, 0, 1),
        evidence: normalizeFactList(item.evidence || [], '')
      };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeTurnIds(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/u);
  return [...new Set(source.map((item) => asText(item, 120)).filter(Boolean))].slice(0, 20);
}

function cellEmbeddingText(cell) {
  return [
    cell.title,
    cell.type,
    cell.scope,
    cell.episode,
    ...(cell.facts || []),
    ...(cell.foresight || []).map((item) => item.content)
  ].filter(Boolean).join('\n').slice(0, 6000);
}

async function prepareCellForStore(cell, settings) {
  const embedding = await embeddingForDetailed(cellEmbeddingText(cell), settings);
  return {
    ...cell,
    vector: embedding.vector,
    embeddingSignature: embedding.signature,
    vectorDimension: embedding.vector.length,
    embeddingDegraded: embedding.degraded
  };
}

function rowToCell(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    scope: row.scope,
    episode: row.episode,
    facts: readJsonValue(row.facts_json, []),
    foresight: readJsonValue(row.foresight_json, []),
    sourceTurnIds: readJsonValue(row.source_turn_ids_json, []),
    sourceMemoryId: row.source_memory_id,
    source: row.source,
    sceneId: row.scene_id,
    importance: Number(row.importance) || 0,
    confidence: Number(row.confidence) || 0,
    status: row.status,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    created: row.created,
    updated: row.updated,
    contentHash: row.content_hash,
    pinned: Boolean(row.pinned),
    decayScore: Number(row.decay_score) || 0,
    lastRecalled: row.last_recalled || '',
    recallCount: Number(row.recall_count) || 0,
    viewerId: row.viewer_id || '',
    embeddingSignature: row.embedding_signature || '',
    vectorDimension: Number(row.vector_dimension) || readJsonValue(row.vector_json, []).length,
    vector: readJsonValue(row.vector_json, [])
  };
}

function rowToAnchor(row) {
  if (!row) return null;
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    label: row.label,
    keywords: readJsonValue(row.keywords_json, []),
    importance: Number(row.importance) || 0,
    created: row.created,
    updated: row.updated,
    lastRecalled: row.last_recalled || '',
    recallCount: Number(row.recall_count) || 0,
    metadata: readJsonValue(row.metadata_json, {})
  };
}

function rowToScene(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    keywords: readJsonValue(row.keywords_json, []),
    centroidVector: readJsonValue(row.centroid_vector_json, []),
    cellCount: Number(row.cell_count) || 0,
    importance: Number(row.importance) || 0,
    confidence: Number(row.confidence) || 0,
    status: row.status,
    created: row.created,
    updated: row.updated,
    lastCellId: row.last_cell_id,
    viewerId: row.viewer_id || '',
    embeddingSignature: row.embedding_signature || '',
    vectorDimension: Number(row.vector_dimension) || readJsonValue(row.centroid_vector_json, []).length
  };
}

function rowToProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    value: row.value,
    confidence: Number(row.confidence) || 0,
    evidence: readJsonValue(row.evidence_json, []),
    status: row.status,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    viewerId: row.viewer_id || '',
    updated: row.updated
  };
}

function normalizeViewerIdentity(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const platform = asText(value.platform || value.source || 'bilibili', 40).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const platformUserId = asText(value.platformUserId || value.userId || value.uid || value.id, 120);
  const displayName = asText(value.displayName || value.userName || value.username || value.name, 120);
  if (!platformUserId && !displayName) return null;
  const identityKey = platformUserId
    ? `${platform}:${platformUserId}`
    : `${platform}:name:${displayName.normalize('NFKC').toLowerCase()}`;
  return {
    id: `viewer-${sha1(identityKey).slice(0, 24)}`,
    identityKey,
    platform,
    platformUserId,
    displayName: displayName || platformUserId
  };
}

function rowToViewerProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    identityKey: row.identity_key,
    platform: row.platform,
    platformUserId: row.platform_user_id,
    displayName: row.display_name,
    aliases: readJsonValue(row.aliases_json, []),
    summary: row.summary,
    topics: readJsonValue(row.topics_json, []),
    preferences: readJsonValue(row.preferences_json, []),
    evidenceTurnIds: readJsonValue(row.evidence_turn_ids_json, []),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    interactionCount: Number(row.interaction_count) || 0,
    messageCount: Number(row.message_count) || 0,
    giftCount: Number(row.gift_count) || 0,
    superchatCount: Number(row.superchat_count) || 0,
    guardCount: Number(row.guard_count) || 0,
    totalAmount: Number(row.total_amount) || 0,
    lastMessage: row.last_message,
    lastEventType: row.last_event_type,
    lastSessionId: row.last_session_id,
    updated: row.updated
  };
}

function preferenceHints(text) {
  const value = asText(text, 600);
  if (!value || !/(喜欢|最爱|想听|我要听|点歌|偏好|讨厌|favorite|prefer|like|love|request)/iu.test(value)) return [];
  return [value];
}

function upsertViewerProfile(db, viewer, event = {}) {
  if (!viewer) return null;
  const existing = rowToViewerProfile(db.prepare('SELECT * FROM viewer_profiles WHERE id = ?').get(viewer.id));
  const now = asText(event.at || event.created || new Date().toISOString(), 80);
  const message = asText(event.input || event.message || event.text, 600);
  const eventType = asText(event.eventType || event.messageType || event.type || 'message', 40).toLowerCase();
  const topics = [...new Set([...(existing?.topics || []), ...textKeywords(message)])].slice(-32);
  const preferences = [...new Set([...(existing?.preferences || []), ...preferenceHints(message)])].slice(-20);
  const aliases = [...new Set([...(existing?.aliases || []), existing?.displayName, viewer.displayName].filter(Boolean))].slice(-12);
  const evidenceTurnIds = [...new Set([...(existing?.evidenceTurnIds || []), asText(event.turnId || event.turn_id, 120)].filter(Boolean))].slice(-100);
  const interactionCount = (existing?.interactionCount || 0) + 1;
  const summary = [
    `${viewer.displayName} is a ${viewer.platform} viewer with ${interactionCount} recorded interaction(s).`,
    topics.length ? `Recent durable topics: ${topics.slice(-8).join(', ')}.` : '',
    preferences.length ? `Confirmed preference evidence: ${preferences.slice(-3).join(' | ')}` : ''
  ].filter(Boolean).join(' ');
  const amount = Math.max(0, Number(event.price ?? event.amount) || 0);
  db.prepare(`
    INSERT INTO viewer_profiles (
      id, identity_key, platform, platform_user_id, display_name, aliases_json,
      summary, topics_json, preferences_json, evidence_turn_ids_json, first_seen,
      last_seen, interaction_count, message_count, gift_count, superchat_count,
      guard_count, total_amount, last_message, last_event_type, last_session_id, updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      identity_key = excluded.identity_key,
      platform = excluded.platform,
      platform_user_id = CASE WHEN excluded.platform_user_id != '' THEN excluded.platform_user_id ELSE viewer_profiles.platform_user_id END,
      display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE viewer_profiles.display_name END,
      aliases_json = excluded.aliases_json,
      summary = excluded.summary,
      topics_json = excluded.topics_json,
      preferences_json = excluded.preferences_json,
      evidence_turn_ids_json = excluded.evidence_turn_ids_json,
      last_seen = excluded.last_seen,
      interaction_count = excluded.interaction_count,
      message_count = excluded.message_count,
      gift_count = excluded.gift_count,
      superchat_count = excluded.superchat_count,
      guard_count = excluded.guard_count,
      total_amount = excluded.total_amount,
      last_message = excluded.last_message,
      last_event_type = excluded.last_event_type,
      last_session_id = excluded.last_session_id,
      updated = excluded.updated
  `).run(
    viewer.id,
    viewer.identityKey,
    viewer.platform,
    viewer.platformUserId,
    viewer.displayName,
    stableJson(aliases),
    summary,
    stableJson(topics),
    stableJson(preferences),
    stableJson(evidenceTurnIds),
    existing?.firstSeen || now,
    now,
    interactionCount,
    (existing?.messageCount || 0) + (eventType === 'message' || eventType === 'danmu' ? 1 : 0),
    (existing?.giftCount || 0) + (eventType === 'gift' ? 1 : 0),
    (existing?.superchatCount || 0) + (eventType === 'superchat' ? 1 : 0),
    (existing?.guardCount || 0) + (eventType === 'guard' ? 1 : 0),
    (existing?.totalAmount || 0) + amount,
    message || existing?.lastMessage || '',
    eventType,
    asText(event.sessionId || event.session_id, 120),
    now
  );
  return rowToViewerProfile(db.prepare('SELECT * FROM viewer_profiles WHERE id = ?').get(viewer.id));
}

function viewerLookupValues(input = {}) {
  const query = input.query && typeof input.query === 'object' ? input.query : {};
  const values = [
    ...(Array.isArray(input.viewerIds) ? input.viewerIds : []),
    ...(Array.isArray(query.viewerIds) ? query.viewerIds : []),
    ...(Array.isArray(input.viewers) ? input.viewers : []),
    ...(Array.isArray(query.viewers) ? query.viewers : [])
  ];
  if (input.viewer) values.push(input.viewer);
  if (query.viewer) values.push(query.viewer);
  return values;
}

function resolveViewerProfiles(db, input = {}) {
  const all = db.prepare('SELECT * FROM viewer_profiles ORDER BY last_seen DESC').all().map(rowToViewerProfile).filter(Boolean);
  const lookups = viewerLookupValues(input);
  if (!lookups.length) return [];
  const requested = new Set();
  for (const lookup of lookups) {
    if (lookup && typeof lookup === 'object') {
      const identity = normalizeViewerIdentity(lookup);
      if (identity) {
        requested.add(identity.id);
        requested.add(identity.identityKey);
      }
      continue;
    }
    const token = asText(lookup, 160);
    if (token) requested.add(token);
  }
  return all.filter((viewer) => (
    requested.has(viewer.id) ||
    requested.has(viewer.identityKey) ||
    requested.has(viewer.platformUserId)
  ));
}

function cellPublic(cell, score = undefined, scene = null) {
  const { vector, ...publicCell } = cell;
  return {
    ...publicCell,
    sceneTitle: scene?.title || '',
    ...(score === undefined ? {} : { score: Number(score.toFixed(4)) })
  };
}

function scenePublic(scene, score = undefined) {
  const { centroidVector, ...publicScene } = scene;
  return {
    ...publicScene,
    ...(score === undefined ? {} : { score: Number(score.toFixed(4)) })
  };
}

function memoryNoteToCell(note, settings) {
  const now = new Date().toISOString();
  const episode = asText(note.episode || note.summary || note.content, 900);
  const facts = normalizeFactList(note.facts || [], note.summary || note.content);
  const foresight = normalizeForesightList(note.foresight || [], note.updated || now);
  const sourceMemoryId = note.id || '';
  return {
    id: `cell-${sha1(sourceMemoryId || `${note.title}:${episode}`).slice(0, 24)}`,
    title: asText(note.title || 'Memory event', 140),
    type: asText(note.type || 'memory', 40).toLowerCase().replace(/[\s-]+/g, '_'),
    scope: asText(note.scope || inferScopeFromType(note.type), 40).toLowerCase().replace(/[\s-]+/g, '_'),
    episode,
    facts,
    foresight,
    sourceTurnIds: normalizeTurnIds(note.sourceTurnIds || note.turnIds || []),
    sourceMemoryId,
    source: asText(note.source || 'runtime', 60),
    sceneId: '',
    importance: asNumber(note.importance, 0.45, 0, 1),
    confidence: asNumber(note.confidence, 0.65, 0, 1),
    status: note.disabled || note.deleted ? 'archived' : 'active',
    validFrom: asText(note.validFrom || note.valid_from || note.updated || now, 80),
    validUntil: asText(note.validUntil || note.valid_until || '', 80),
    created: asText(note.created || now, 80),
    updated: asText(note.updated || now, 80),
    contentHash: note.contentHash || sha1(`${note.title}\n${note.content || note.summary}`),
    vector: [],
    pinned: Boolean(note.pinned || ['seed', 'persona'].includes(note.source)),
    decayScore: 0,
    lastRecalled: '',
    recallCount: 0,
    viewerId: note.viewerId || '',
    settingsDimension: settings.embeddingDimension
  };
}

function cellKeywords(cell) {
  return [...new Set([
    cell.type,
    cell.scope,
    ...normalizeTags(cell.tags || []),
    ...textKeywords(`${cell.title} ${cell.episode} ${(cell.facts || []).join(' ')}`)
  ].filter(Boolean))].slice(0, 20);
}

function keywordOverlapScore(left = [], right = []) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (!leftSet.size || !rightSet.size) return 0;
  let hits = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) hits += 1;
  }
  return hits / Math.max(leftSet.size, rightSet.size);
}

function sceneTitleFromCell(cell) {
  const keywords = cellKeywords(cell).filter((item) => !['memory', 'long_term', 'session'].includes(item));
  const topic = keywords.slice(0, 3).join(' / ') || cell.type || 'memory';
  return `${topic} memory`;
}

function averageVectors(vectors = [], dimension = DEFAULT_DIMENSION) {
  const valid = vectors.filter((vector) => Array.isArray(vector) && vector.length);
  if (!valid.length) return [];
  const size = Math.max(...valid.map((vector) => vector.length), dimension);
  const sum = new Array(size).fill(0);
  for (const vector of valid) {
    for (let index = 0; index < size; index += 1) {
      sum[index] += Number(vector[index % vector.length]) || 0;
    }
  }
  let norm = Math.sqrt(sum.reduce((total, item) => total + item * item, 0));
  if (!norm) norm = 1;
  return sum.map((item) => Number((item / norm).toFixed(6)));
}

function upsertCell(db, cell) {
  db.prepare(`
    INSERT INTO mem_cells (
      id, title, type, scope, episode, facts_json, foresight_json, source_turn_ids_json,
      source_memory_id, source, scene_id, importance, confidence, status, valid_from,
      valid_until, created, updated, content_hash, vector_json, pinned, decay_score,
      last_recalled, recall_count, viewer_id, embedding_signature, vector_dimension
    )
    VALUES (
      @id, @title, @type, @scope, @episode, @factsJson, @foresightJson, @sourceTurnIdsJson,
      @sourceMemoryId, @source, @sceneId, @importance, @confidence, @status, @validFrom,
      @validUntil, @created, @updated, @contentHash, @vectorJson, @pinned, @decayScore,
      @lastRecalled, @recallCount, @viewerId, @embeddingSignature, @vectorDimension
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      type = excluded.type,
      scope = excluded.scope,
      episode = excluded.episode,
      facts_json = excluded.facts_json,
      foresight_json = excluded.foresight_json,
      source_turn_ids_json = excluded.source_turn_ids_json,
      source_memory_id = excluded.source_memory_id,
      source = excluded.source,
      scene_id = excluded.scene_id,
      importance = excluded.importance,
      confidence = excluded.confidence,
      status = excluded.status,
      valid_from = excluded.valid_from,
      valid_until = excluded.valid_until,
      updated = excluded.updated,
      content_hash = excluded.content_hash,
      vector_json = excluded.vector_json,
      viewer_id = excluded.viewer_id,
      embedding_signature = excluded.embedding_signature,
      vector_dimension = excluded.vector_dimension,
      pinned = CASE WHEN mem_cells.pinned > excluded.pinned THEN mem_cells.pinned ELSE excluded.pinned END,
      decay_score = excluded.decay_score
  `).run({
    id: cell.id,
    title: cell.title,
    type: cell.type,
    scope: cell.scope,
    episode: cell.episode,
    factsJson: stableJson(cell.facts || []),
    foresightJson: stableJson(cell.foresight || []),
    sourceTurnIdsJson: stableJson(cell.sourceTurnIds || []),
    sourceMemoryId: cell.sourceMemoryId || '',
    source: cell.source || 'runtime',
    sceneId: cell.sceneId || '',
    importance: Number(cell.importance) || 0.45,
    confidence: Number(cell.confidence) || 0.65,
    status: cell.status || 'active',
    validFrom: cell.validFrom || '',
    validUntil: cell.validUntil || '',
    created: cell.created || new Date().toISOString(),
    updated: cell.updated || new Date().toISOString(),
    contentHash: cell.contentHash || sha1(cellEmbeddingText(cell)),
    vectorJson: stableJson(cell.vector || []),
    pinned: cell.pinned ? 1 : 0,
    decayScore: Number(cell.decayScore) || 0,
    lastRecalled: cell.lastRecalled || '',
    recallCount: Number(cell.recallCount) || 0,
    viewerId: cell.viewerId || '',
    embeddingSignature: cell.embeddingSignature || '',
    vectorDimension: Number(cell.vectorDimension) || (cell.vector || []).length
  });
}

function activeScenes(db) {
  return db.prepare("SELECT * FROM mem_scenes WHERE status = 'active' ORDER BY updated DESC LIMIT ?").all(MAX_MEMORY_ROWS)
    .map(rowToScene)
    .filter(Boolean);
}

function activeCells(db) {
  return db.prepare("SELECT * FROM mem_cells WHERE status IN ('active', 'candidate') ORDER BY updated DESC LIMIT ?").all(MAX_MEMORY_ROWS)
    .map(rowToCell)
    .filter(Boolean);
}

function chooseSceneForCell(db, cell) {
  const keywords = cellKeywords(cell);
  const scenes = activeScenes(db).filter((scene) => scene.viewerId === (cell.viewerId || ''));
  let best = null;
  for (const scene of scenes) {
    const vectorScore = embeddingsCompatible(
      cell.embeddingSignature,
      scene.embeddingSignature,
      cell.vector,
      scene.centroidVector
    ) ? cosine(cell.vector, scene.centroidVector) : 0;
    const score = vectorScore * 0.74 + keywordOverlapScore(keywords, scene.keywords) * 0.26;
    if (!best || score > best.score) best = { scene, score };
  }
  if (best && best.score >= 0.62) return best.scene;
  const now = new Date().toISOString();
  const id = `scene-${safeSlug(sceneTitleFromCell(cell)).slice(0, 48)}-${sha1(cell.id).slice(0, 8)}`;
  const scene = {
    id,
    title: sceneTitleFromCell(cell),
    summary: asText(cell.episode, 640),
    keywords,
    centroidVector: cell.vector || [],
    cellCount: 0,
    importance: cell.importance,
    confidence: cell.confidence,
    status: 'active',
    created: now,
    updated: now,
    lastCellId: cell.id,
    viewerId: cell.viewerId || '',
    embeddingSignature: cell.embeddingSignature || '',
    vectorDimension: Number(cell.vectorDimension) || (cell.vector || []).length
  };
  db.prepare(`
    INSERT OR IGNORE INTO mem_scenes (
      id, title, summary, keywords_json, centroid_vector_json, cell_count,
      importance, confidence, status, created, updated, last_cell_id,
      viewer_id, embedding_signature, vector_dimension
    )
    VALUES (@id, @title, @summary, @keywordsJson, @centroidVectorJson, @cellCount,
      @importance, @confidence, @status, @created, @updated, @lastCellId,
      @viewerId, @embeddingSignature, @vectorDimension)
  `).run({
    ...scene,
    keywordsJson: stableJson(scene.keywords),
    centroidVectorJson: stableJson(scene.centroidVector)
  });
  return scene;
}

function recomputeScene(db, sceneId, settings) {
  const rows = db.prepare(`
    SELECT * FROM mem_cells
    WHERE scene_id = ? AND status IN ('active', 'candidate')
    ORDER BY updated DESC
    LIMIT ?
  `).all(sceneId, MAX_MEMORY_ROWS).map(rowToCell).filter(Boolean);
  if (!rows.length) return null;
  const scene = db.prepare('SELECT * FROM mem_scenes WHERE id = ?').get(sceneId);
  const keywords = [...new Set(rows.flatMap(cellKeywords))].slice(0, 30);
  const summary = rows
    .slice(0, 5)
    .map((cell) => cell.episode)
    .filter(Boolean)
    .join(' ')
    .slice(0, 900);
  const centroid = averageVectors(rows.map((cell) => cell.vector), settings.embeddingDimension);
  const importance = rows.reduce((max, cell) => Math.max(max, Number(cell.importance) || 0), 0.45);
  const confidence = rows.reduce((sum, cell) => sum + (Number(cell.confidence) || 0), 0) / rows.length;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE mem_scenes SET
      summary = ?, keywords_json = ?, centroid_vector_json = ?, cell_count = ?,
      importance = ?, confidence = ?, updated = ?, last_cell_id = ?,
      viewer_id = ?, embedding_signature = ?, vector_dimension = ?
    WHERE id = ?
  `).run(summary || scene?.summary || '', stableJson(keywords), stableJson(centroid), rows.length,
    importance, confidence, now, rows[0].id, rows[0].viewerId || '',
    rows[0].embeddingSignature || '', centroid.length, sceneId);
  return rowToScene(db.prepare('SELECT * FROM mem_scenes WHERE id = ?').get(sceneId));
}

function linkCellToScene(db, sceneId, cellId) {
  db.prepare('INSERT OR IGNORE INTO scene_cell_links (scene_id, cell_id, created) VALUES (?, ?, ?)')
    .run(sceneId, cellId, new Date().toISOString());
}

function profileCategoryForCell(cell) {
  if (cell.type === 'viewer') return 'viewer';
  if (cell.type === 'profile') return 'explicit_fact';
  if (cell.type === 'style') return 'preference';
  if (cell.type === 'policy') return 'constraint';
  if (cell.scope === 'temporary' || cell.type === 'session') return 'time_varying_state';
  return '';
}

function updateProfileFromCell(db, cell) {
  const category = profileCategoryForCell(cell);
  if (!category || cell.confidence < 0.58) return null;
  const name = safeSlug(cell.title || cell.type).slice(0, 80) || cell.type;
  const id = `profile-${category}-${sha1(`${cell.viewerId || 'global'}:${name}`).slice(0, 16)}`;
  const existing = rowToProfile(db.prepare('SELECT * FROM user_profile WHERE id = ?').get(id));
  const evidence = [...new Set([...(existing?.evidence || []), cell.id])].slice(-12);
  const confidence = Math.min(1, Math.max(existing?.confidence || 0, cell.confidence) + Math.max(0, evidence.length - 1) * 0.04);
  const status = evidence.length >= 2 || cell.confidence >= 0.78 ? 'active' : 'candidate';
  db.prepare(`
    INSERT INTO user_profile (
      id, category, name, value, confidence, evidence_json, status, valid_from, valid_until, updated,
      viewer_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      value = excluded.value,
      confidence = excluded.confidence,
      evidence_json = excluded.evidence_json,
      status = excluded.status,
      valid_from = excluded.valid_from,
      valid_until = excluded.valid_until,
      viewer_id = excluded.viewer_id,
      updated = excluded.updated
  `).run(id, category, name, cell.episode, confidence, stableJson(evidence), status,
    cell.validFrom || cell.created || '', cell.validUntil || '', new Date().toISOString(), cell.viewerId || '');
  return rowToProfile(db.prepare('SELECT * FROM user_profile WHERE id = ?').get(id));
}

function looksNegativeConstraint(text) {
  return /(不要|不能|不再|避免|禁止|停止|暂停|过期|临时|正在服用|antibiotic|avoid|stop|cannot|don't|do not)/iu.test(text || '');
}

function detectConflictsForCell(db, cell) {
  const text = `${cell.title}\n${cell.episode}\n${(cell.facts || []).join('\n')}`;
  if (!looksNegativeConstraint(text)) return [];
  const keywords = cellKeywords(cell).filter((item) => item.length >= 3);
  if (!keywords.length) return [];
  const candidates = activeCells(db)
    .filter((other) => other.id !== cell.id && other.status === 'active')
    .filter((other) => keywordOverlapScore(keywords, cellKeywords(other)) >= 0.18)
    .slice(0, 3);
  const conflicts = [];
  for (const other of candidates) {
    const id = `conflict-${sha1([cell.id, other.id].sort().join(':')).slice(0, 20)}`;
    const description = `Potential time-sensitive conflict between "${cell.title}" and "${other.title}".`;
    db.prepare(`
      INSERT INTO memory_conflicts (id, left_cell_id, right_cell_id, description, severity, status, created, updated)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(id) DO UPDATE SET description = excluded.description, updated = excluded.updated
    `).run(id, cell.id, other.id, description, 0.62, new Date().toISOString(), new Date().toISOString());
    conflicts.push({ id, leftCellId: cell.id, rightCellId: other.id, description, severity: 0.62, status: 'active' });
  }
  return conflicts;
}

function keyEventScoreForCell(cell, settings) {
  const text = `${cell.title}\n${cell.type}\n${cell.scope}\n${cell.episode}\n${(cell.facts || []).join('\n')}`.toLowerCase();
  let score = Number(cell.importance || 0) * 0.48 + Number(cell.confidence || 0) * 0.22;
  if (['persona', 'seed'].includes(cell.source) && ['profile', 'style', 'lore', 'policy'].includes(cell.type)) score += 0.28;
  if (['profile', 'viewer', 'policy'].includes(cell.type)) score += 0.2;
  if (['style', 'lore'].includes(cell.type) && cell.scope === 'canon') score += 0.14;
  if (/(anchor|key event|milestone|decision|remember|preference|重要|关键|决定|记住|偏好|喜欢|讨厌|必须|不能|项目|完成|修复|设定|人格)/iu.test(text)) {
    score += 0.18;
  }
  if ((cell.facts || []).length >= 3) score += 0.05;
  return Math.min(1, score);
}

function upsertAnchorForCell(db, cell, settings, reason = 'importance') {
  const score = keyEventScoreForCell(cell, settings);
  if (score < settings.anchorImportanceThreshold && !cell.pinned) return null;
  const now = new Date().toISOString();
  const keywords = cellKeywords(cell);
  const id = `anchor-${sha1(cell.id).slice(0, 24)}`;
  const metadata = {
    reason,
    source: cell.source || '',
    type: cell.type || '',
    scope: cell.scope || '',
    sceneId: cell.sceneId || '',
    viewerId: cell.viewerId || ''
  };
  db.prepare(`
    INSERT INTO memory_anchors (
      id, target_type, target_id, label, keywords_json, importance,
      created, updated, metadata_json
    )
    VALUES (?, 'cell', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      target_type = excluded.target_type,
      target_id = excluded.target_id,
      label = excluded.label,
      keywords_json = excluded.keywords_json,
      importance = excluded.importance,
      updated = excluded.updated,
      metadata_json = excluded.metadata_json
  `).run(id, cell.id, cell.title || cell.id, stableJson(keywords), Math.max(score, Number(cell.importance) || 0.72),
    now, now, stableJson(metadata));
  return rowToAnchor(db.prepare('SELECT * FROM memory_anchors WHERE id = ?').get(id));
}

async function consolidateNoteToCell(db, note, settings) {
  let cell = await prepareCellForStore(memoryNoteToCell(note, settings), settings);
  const scene = chooseSceneForCell(db, cell);
  cell = { ...cell, sceneId: scene.id };
  upsertCell(db, cell);
  linkCellToScene(db, scene.id, cell.id);
  const updatedScene = recomputeScene(db, scene.id, settings) || scene;
  const profile = updateProfileFromCell(db, cell);
  const conflicts = detectConflictsForCell(db, cell);
  const anchor = upsertAnchorForCell(db, cell, settings);
  return { cell: cellPublic(cell, undefined, updatedScene), scene: scenePublic(updatedScene), profile, conflicts, anchor };
}

async function ensureLifecycleForNotes(db, notes, settings) {
  let created = 0;
  let updated = 0;
  let anchored = 0;
  for (const note of notes) {
    const existing = db.prepare('SELECT content_hash FROM mem_cells WHERE source_memory_id = ?').get(note.id);
    if (existing && existing.content_hash === note.contentHash) continue;
    const lifecycle = await consolidateNoteToCell(db, note, settings);
    if (lifecycle.anchor) anchored += 1;
    if (existing) updated += 1;
    else created += 1;
  }
  return {
    cellsCreated: created,
    cellsUpdated: updated,
    anchors: db.prepare('SELECT COUNT(*) AS count FROM memory_anchors').get().count || anchored,
    scenes: db.prepare("SELECT COUNT(*) AS count FROM mem_scenes WHERE status = 'active'").get().count || 0,
    profile: db.prepare("SELECT COUNT(*) AS count FROM user_profile WHERE status IN ('candidate', 'active')").get().count || 0,
    conflicts: db.prepare("SELECT COUNT(*) AS count FROM memory_conflicts WHERE status = 'active'").get().count || 0
  };
}

async function repairVectorItems(items, batchSize, prepare, store) {
  let repaired = 0;
  let degraded = 0;
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize);
    const prepared = await Promise.all(batch.map((item) => prepare(item)));
    for (const item of prepared) {
      store(item);
      repaired += 1;
      if (item.embeddingDegraded) degraded += 1;
    }
  }
  return { repaired, degraded };
}

async function auditAndRepairVectorIndex(db, settings, options = {}) {
  const repair = options.repair !== false;
  const expectedSignature = configuredEmbeddingSignature(settings);
  const notes = activeRows(db, true, MAX_MEMORY_ROWS);
  const cells = db.prepare('SELECT * FROM mem_cells ORDER BY updated DESC LIMIT ?')
    .all(MAX_MEMORY_ROWS)
    .map(rowToCell)
    .filter(Boolean);
  const invalidNoteRows = notes.filter((note) => (
    !vectorIsValid(note.vector, settings.embeddingDimension) ||
    note.embeddingSignature !== expectedSignature
  ));
  const invalidCellRows = cells.filter((cell) => (
    !vectorIsValid(cell.vector, settings.embeddingDimension) ||
    cell.embeddingSignature !== expectedSignature
  ));
  let repairedNotes = 0;
  let repairedCells = 0;
  let degraded = 0;

  if (repair && invalidNoteRows.length) {
    const result = await repairVectorItems(
      invalidNoteRows,
      8,
      (note) => prepareNoteForStore(note, settings),
      (note) => upsertNote(db, note)
    );
    repairedNotes = result.repaired;
    degraded += result.degraded;
  }
  if (repair && invalidCellRows.length) {
    const result = await repairVectorItems(
      invalidCellRows,
      8,
      (cell) => prepareCellForStore(cell, settings),
      (cell) => upsertCell(db, cell)
    );
    repairedCells = result.repaired;
    degraded += result.degraded;
    const sceneIds = [...new Set(invalidCellRows.map((cell) => cell.sceneId).filter(Boolean))];
    for (const sceneId of sceneIds) recomputeScene(db, sceneId, settings);
  }

  const remainingInvalidNotes = db.prepare('SELECT vector_json, embedding_signature FROM memories WHERE deleted = 0')
    .all()
    .filter((row) => (
      !vectorIsValid(readJsonValue(row.vector_json, []), settings.embeddingDimension) ||
      row.embedding_signature !== expectedSignature
    )).length;
  const remainingInvalidCells = db.prepare("SELECT vector_json, embedding_signature FROM mem_cells WHERE status != 'forgotten'")
    .all()
    .filter((row) => (
      !vectorIsValid(readJsonValue(row.vector_json, []), settings.embeddingDimension) ||
      row.embedding_signature !== expectedSignature
    )).length;
  const health = {
    signature: expectedSignature,
    dimension: settings.embeddingDimension,
    checkedAt: new Date().toISOString(),
    notes: notes.length,
    cells: cells.length,
    repairedNotes,
    repairedCells,
    invalidNotes: remainingInvalidNotes,
    invalidCells: remainingInvalidCells,
    degraded,
    compatible: remainingInvalidNotes === 0 && remainingInvalidCells === 0
  };
  setMeta(db, 'vector-health', health);
  return health;
}

function memoryOrganizationStatus(db) {
  const integrityRows = db.pragma('quick_check');
  const integrity = integrityRows.every((row) => String(row.quick_check || '').toLowerCase() === 'ok') ? 'ok' : 'error';
  return {
    integrity,
    viewers: Number(db.prepare('SELECT COUNT(*) AS count FROM viewer_profiles').get()?.count) || 0,
    segments: Number(db.prepare('SELECT COUNT(*) AS count FROM memory_segments').get()?.count) || 0,
    sealedSegments: Number(db.prepare('SELECT COUNT(*) AS count FROM memory_segments WHERE sealed = 1').get()?.count) || 0,
    rawMessages: Number(db.prepare('SELECT COUNT(*) AS count FROM raw_messages').get()?.count) || 0,
    activeCells: Number(db.prepare("SELECT COUNT(*) AS count FROM mem_cells WHERE status IN ('active', 'candidate')").get()?.count) || 0,
    anchors: Number(db.prepare('SELECT COUNT(*) AS count FROM memory_anchors').get()?.count) || 0
  };
}

function vectorMetadataNeedsRepair(db, settings) {
  const signature = configuredEmbeddingSignature(settings);
  const dimension = Number(settings.embeddingDimension) || DEFAULT_DIMENSION;
  const invalidNotes = db.prepare(`
    SELECT COUNT(*) AS count FROM memories
    WHERE deleted = 0 AND (
      embedding_signature != ? OR vector_dimension != ? OR length(vector_json) < 4
    )
  `).get(signature, dimension)?.count || 0;
  const invalidCells = db.prepare(`
    SELECT COUNT(*) AS count FROM mem_cells
    WHERE status != 'forgotten' AND (
      embedding_signature != ? OR vector_dimension != ? OR length(vector_json) < 4
    )
  `).get(signature, dimension)?.count || 0;
  return invalidNotes > 0 || invalidCells > 0;
}

function setMeta(db, key, value) {
  const serialized = value && typeof value === 'object' ? stableJson(value) : String(value || '');
  db.prepare(`
    INSERT INTO memory_meta (key, value, updated)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated
  `).run(key, serialized, new Date().toISOString());
}

function getMeta(db, key) {
  return db.prepare('SELECT value FROM memory_meta WHERE key = ?').get(key)?.value || '';
}

function maybeRunAutomaticMaintenance(db, settings, minimumIntervalMs = 15 * 60 * 1000) {
  const now = Date.now();
  const lastRun = Number(getMeta(db, 'last-auto-maintenance-at')) || 0;
  if (lastRun > 0 && now - lastRun < minimumIntervalMs) return { skipped: true };
  const gc = garbageCollectMemory(db, settings);
  db.pragma('optimize');
  db.pragma('wal_checkpoint(PASSIVE)');
  setMeta(db, 'last-auto-maintenance-at', now);
  return { skipped: false, gc, at: new Date(now).toISOString() };
}

function fileSignature(file) {
  if (!file || !fs.existsSync(file)) return '';
  const info = fs.statSync(file);
  if (!info.isFile()) return '';
  return sha1(`${path.resolve(file)}:${info.size}:${info.mtimeMs}`);
}

function countActiveSource(db, source) {
  return db.prepare('SELECT COUNT(*) AS count FROM memories WHERE source = ? AND deleted = 0').get(source)?.count || 0;
}

function sourcesNeedImport(db, settings) {
  const seedRoot = path.join(repoRoot, 'memory-seeds', 'obsidian');
  if (fs.existsSync(seedRoot) && !countActiveSource(db, 'seed')) return true;
  if (settings.vaultPath && fs.existsSync(settings.vaultPath) && !countActiveSource(db, 'vault')) return true;
  if (settings.personaCorpusPath && fs.existsSync(settings.personaCorpusPath)) {
    const signature = fileSignature(settings.personaCorpusPath);
    if (!countActiveSource(db, 'persona')) return true;
    if (signature && getMeta(db, 'source:persona:signature') !== signature) return true;
  }
  return false;
}

async function importSources(db, settings) {
  db.prepare("UPDATE memories SET deleted = 1 WHERE source IN ('seed', 'vault', 'persona')").run();
  const imported = { seed: 0, vault: 0, persona: 0 };
  const roots = [
    { source: 'seed', root: path.join(repoRoot, 'memory-seeds', 'obsidian') },
    ...(settings.vaultPath && fs.existsSync(settings.vaultPath) ? [{ source: 'vault', root: path.resolve(settings.vaultPath) }] : [])
  ];
  for (const item of roots) {
    for (const file of walkMarkdown(item.root)) {
      const parsed = parseMarkdownNote(item.root, file, item.source);
      if (!parsed) continue;
      const note = await prepareNoteForStore(parsed, settings);
      upsertNote(db, note);
      imported[item.source] += 1;
    }
  }
  if (settings.personaCorpusPath && fs.existsSync(settings.personaCorpusPath)) {
    const personaNotes = parseTextCorpus(settings.personaCorpusPath, 'persona');
    for (const parsed of personaNotes) {
      const note = await prepareNoteForStore(parsed, settings);
      upsertNote(db, note);
      imported.persona += 1;
    }
    const signature = fileSignature(settings.personaCorpusPath);
    if (signature) setMeta(db, 'source:persona:signature', signature);
  }
  return imported;
}

async function ensureImportedSources(db, settings, options = {}) {
  if (options.force || sourcesNeedImport(db, settings)) return importSources(db, settings);
  return { seed: 0, vault: 0, persona: 0, skipped: true };
}

function milvusHostPort(settings, fallback = 19530) {
  try {
    const url = new URL(settings.milvusUrl || 'http://127.0.0.1:19530');
    if (url.port) return Number(url.port) || fallback;
    return url.protocol === 'https:' ? 443 : 19530;
  } catch (_) {
    return fallback;
  }
}

async function rawMilvusRequest(settings, apiPath, body) {
  const response = await fetch(`${settings.milvusUrl}${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.milvusToken ? { Authorization: `Bearer ${settings.milvusToken}` } : {})
    },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code && payload.code !== 0) {
    throw new Error(payload.message || payload.msg || `Milvus ${response.status}`);
  }
  return payload;
}

async function milvusRequest(settings, apiPath, body) {
  if (!settings.milvusEnabled) return null;
  await ensureManagedMilvus(settings);
  return rawMilvusRequest(settings, apiPath, body);
}

async function isMilvusReady(settings) {
  try {
    await rawMilvusRequest(settings, '/v2/vectordb/collections/list', {});
    return true;
  } catch (_) {
    return false;
  }
}

async function runDocker(args, timeout = 60000) {
  return execFileAsync('docker', args, {
    timeout,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
}

function ensureManagedMilvusConfigFiles(volumePath) {
  const embedEtcdPath = path.join(volumePath, 'embedEtcd.yaml');
  const userConfigPath = path.join(volumePath, 'user.yaml');
  fs.writeFileSync(embedEtcdPath, [
    'listen-client-urls: http://0.0.0.0:2379',
    'advertise-client-urls: http://0.0.0.0:2379',
    'quota-backend-bytes: 4294967296',
    'auto-compaction-mode: revision',
    "auto-compaction-retention: '1000'",
    ''
  ].join('\n'));
  if (!fs.existsSync(userConfigPath)) {
    fs.writeFileSync(userConfigPath, '# Extra config to override default milvus.yaml\n');
  }
  return { embedEtcdPath, userConfigPath };
}

async function isDockerDaemonReady(timeout = 8000) {
  try {
    await runDocker(['info', '--format', '{{.ServerVersion}}'], timeout);
    return true;
  } catch (_) {
    return false;
  }
}

function dockerDesktopCandidates() {
  if (process.platform !== 'win32') return [];
  return [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Docker', 'Docker', 'Docker Desktop.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Docker', 'Docker', 'Docker Desktop.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Docker', 'Docker Desktop.exe')
  ].filter(Boolean);
}

function tryLaunchDockerDesktop() {
  for (const candidate of dockerDesktopCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    const child = execFile(candidate, [], { windowsHide: true, detached: true }, () => {});
    child.unref();
    return candidate;
  }
  return '';
}

async function ensureDockerDaemon() {
  if (await isDockerDaemonReady()) return { ready: true };
  const launched = tryLaunchDockerDesktop();
  const startedAt = Date.now();
  while (Date.now() - startedAt < DOCKER_DAEMON_WAIT_MS) {
    if (await isDockerDaemonReady(10000)) return { ready: true, launched };
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (launched) {
    throw new Error(`Docker Desktop was launched but Docker did not become ready in ${Math.round(DOCKER_DAEMON_WAIT_MS / 1000)}s.`);
  }
  throw new Error('Docker is required for managed Milvus, but Docker is not running or is not installed.');
}

async function inspectManagedMilvusContainer() {
  try {
    const inspect = await runDocker(['inspect', MANAGED_MILVUS_CONTAINER], 8000);
    const info = JSON.parse(inspect.stdout || '[]')?.[0];
    const env = Array.isArray(info?.Config?.Env) ? info.Config.Env : [];
    const mounts = Array.isArray(info?.Mounts) ? info.Mounts : [];
    return {
      exists: Boolean(info),
      running: Boolean(info?.State?.Running),
      embeddedEtcd: env.includes('ETCD_USE_EMBED=true') &&
        mounts.some((mount) => mount?.Destination === '/milvus/configs/embedEtcd.yaml')
    };
  } catch (_) {
    return { exists: false, running: false, embeddedEtcd: false };
  }
}

async function ensureManagedMilvus(settings) {
  if (!settings.milvusEnabled || !settings.milvusManaged) return;
  if (await isMilvusReady(settings)) return;
  if (managedMilvusPromise) return managedMilvusPromise;
  managedMilvusPromise = startManagedMilvus(settings)
    .finally(() => {
      managedMilvusPromise = null;
    });
  return managedMilvusPromise;
}

async function startManagedMilvus(settings) {
  await ensureDockerDaemon();
  const hostPort = milvusHostPort(settings, 19530);
  const healthPort = hostPort === 9091 ? 9092 : 9091;
  const volumePath = path.join(appDataDir(), 'managed-milvus');
  fs.mkdirSync(volumePath, { recursive: true });
  const { embedEtcdPath, userConfigPath } = ensureManagedMilvusConfigFiles(volumePath);

  let container = await inspectManagedMilvusContainer();
  if (container.exists && !container.embeddedEtcd) {
    if (container.running) await runDocker(['stop', MANAGED_MILVUS_CONTAINER], 120000);
    await runDocker(['rm', MANAGED_MILVUS_CONTAINER], 120000);
    container = { exists: false, running: false, embeddedEtcd: true };
  }

  if (container.exists && !container.running) {
    await runDocker(['start', MANAGED_MILVUS_CONTAINER], 120000);
  } else if (!container.exists) {
    await runDocker([
      'run',
      '-d',
      '--name',
      MANAGED_MILVUS_CONTAINER,
      '--security-opt',
      'seccomp:unconfined',
      '-e',
      'ETCD_USE_EMBED=true',
      '-e',
      'ETCD_DATA_DIR=/var/lib/milvus/etcd',
      '-e',
      'ETCD_CONFIG_PATH=/milvus/configs/embedEtcd.yaml',
      '-e',
      'COMMON_STORAGETYPE=local',
      '-e',
      'DEPLOY_MODE=STANDALONE',
      '-p',
      `${hostPort}:19530`,
      '-p',
      `${healthPort}:9091`,
      '-v',
      `${volumePath}:/var/lib/milvus`,
      '-v',
      `${embedEtcdPath}:/milvus/configs/embedEtcd.yaml`,
      '-v',
      `${userConfigPath}:/milvus/configs/user.yaml`,
      '--health-cmd',
      'curl -f http://localhost:9091/healthz',
      '--health-interval',
      '30s',
      '--health-start-period',
      '90s',
      '--health-timeout',
      '20s',
      '--health-retries',
      '3',
      settings.milvusImage || DEFAULT_MILVUS_IMAGE,
      'milvus',
      'run',
      'standalone'
    ], 10 * 60 * 1000);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 90000) {
    if (await isMilvusReady(settings)) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Managed Milvus container started but did not become ready.');
}

async function stopManagedMilvusContainer() {
  if (!(await isDockerDaemonReady())) {
    return { enabled: true, stopped: false, dockerReady: false };
  }

  let exists = false;
  let running = false;
  try {
    const inspect = await runDocker(['inspect', '-f', '{{.State.Running}}', MANAGED_MILVUS_CONTAINER], 8000);
    exists = true;
    running = String(inspect.stdout || '').trim().toLowerCase() === 'true';
  } catch (_) {
    exists = false;
  }

  if (!exists) return { enabled: true, stopped: false, exists: false };
  if (!running) return { enabled: true, stopped: false, exists: true, running: false };
  await runDocker(['stop', MANAGED_MILVUS_CONTAINER], 120000);
  return { enabled: true, stopped: true, exists: true, running: false };
}

function managedMilvusSettings(input = {}) {
  return normalizeSettings({
    ...(input || {}),
    provider: 'sqlite-milvus',
    milvusEnabled: true,
    milvusManaged: true,
    milvusUrl: input.milvusUrl || process.env.YACHIYO_MEMORY_MILVUS_URL || DEFAULT_MILVUS_URL,
    milvusImage: input.milvusImage || process.env.YACHIYO_MEMORY_MILVUS_IMAGE || DEFAULT_MILVUS_IMAGE,
    milvusCollection: input.milvusCollection || DEFAULT_COLLECTION,
    embeddingDimension: input.embeddingDimension || DEFAULT_DIMENSION
  });
}

async function handleManagedMilvusStart(input = {}) {
  const settings = managedMilvusSettings(input);
  await ensureManagedMilvus(settings);
  const collection = await ensureMilvusCollection(settings);
  managedMilvusStartupError = '';
  return {
    success: true,
    managed: true,
    url: settings.milvusUrl,
    image: settings.milvusImage,
    collection
  };
}

async function ensureMilvusCollection(settings) {
  if (!settings.milvusEnabled) return { enabled: false };
  try {
    await milvusRequest(settings, '/v2/vectordb/collections/create', {
      collectionName: settings.milvusCollection,
      dimension: settings.embeddingDimension,
      metricType: 'COSINE',
      primaryFieldName: 'id',
      vectorFieldName: 'vector',
      idType: 'VarChar',
      autoID: false,
      params: { max_length: '128' }
    });
  } catch (error) {
    if (!/exist|already/i.test(error.message || '')) throw error;
  }
  try {
    await milvusRequest(settings, '/v2/vectordb/collections/load', {
      collectionName: settings.milvusCollection
    });
  } catch (_) {
    // Some Milvus deployments auto-load small collections.
  }
  return { enabled: true, collection: settings.milvusCollection };
}

async function syncMilvus(settings, notes) {
  if (!settings.milvusEnabled) return { enabled: false, synced: 0 };
  await ensureMilvusCollection(settings);
  let synced = 0;
  const batchSize = 100;
  for (let index = 0; index < notes.length; index += batchSize) {
    const batch = notes.slice(index, index + batchSize)
      .filter((note) => note.vector?.length)
      .map((note) => ({ id: note.id, vector: note.vector }));
    if (!batch.length) continue;
    await milvusRequest(settings, '/v2/vectordb/entities/upsert', {
      collectionName: settings.milvusCollection,
      data: batch
    });
    synced += batch.length;
  }
  return { enabled: true, collection: settings.milvusCollection, synced };
}

function readMilvusHits(payload) {
  const raw = payload?.data || payload?.results || [];
  const flat = Array.isArray(raw?.[0]) ? raw.flat() : raw;
  const scores = new Map();
  for (const hit of Array.isArray(flat) ? flat : []) {
    const id = String(hit.id || hit.primaryKey || hit.pk || hit.entity?.id || '').trim();
    if (!id) continue;
    const rawScore = Number(hit.score ?? hit.distance ?? hit.similarity ?? 0);
    const score = rawScore > 1 ? 1 / (1 + rawScore) : Math.max(0, Math.min(1, rawScore));
    scores.set(id, Math.max(scores.get(id) || 0, score || 0.5));
  }
  return scores;
}

async function searchMilvus(settings, queryVector, limit) {
  if (!settings.milvusEnabled || !queryVector?.length) return new Map();
  try {
    await ensureMilvusCollection(settings);
    const payload = await milvusRequest(settings, '/v2/vectordb/entities/search', {
      collectionName: settings.milvusCollection,
      data: [queryVector],
      limit,
      outputFields: ['id']
    });
    return readMilvusHits(payload);
  } catch (_) {
    return new Map();
  }
}

function scoreNote(note, query, options = {}) {
  const queryText = String(query.text || '').toLowerCase();
  const queryTags = normalizeTags(query.tags || []);
  const queryKeywords = normalizeTags([...(query.keywords || []), ...textKeywords(queryText)]);
  const preferredTypes = normalizeTags(query.preferredTypes || []);
  const haystack = [note.title, note.type, note.scope, note.summary, note.content, ...(note.tags || [])]
    .join('\n')
    .toLowerCase();
  let score = 0;

  if (preferredTypes.includes(String(note.type || '').toLowerCase())) score += 0.18;
  for (const tag of queryTags) {
    if ((note.tags || []).includes(tag)) score += 0.18;
    else if (haystack.includes(tag)) score += 0.08;
  }
  for (const keyword of queryKeywords) {
    if (!keyword) continue;
    if (String(note.title || '').toLowerCase().includes(keyword)) score += 0.16;
    else if (String(note.summary || '').toLowerCase().includes(keyword)) score += 0.11;
    else if (haystack.includes(keyword)) score += 0.07;
  }
  if (queryText && haystack.includes(queryText.slice(0, 80))) score += 0.16;
  if (options.vectorScore !== undefined) score += Number(options.vectorScore) * 0.34;
  if (options.milvusScore !== undefined) score += Number(options.milvusScore) * 0.42;
  if (options.viewerMatch) score += 0.34;
  if (note.viewerId && note.type === 'viewer') score += 0.2;
  score += Math.min(0.16, Number(note.importance || 0) * 0.11 + Number(note.confidence || 0) * 0.05);
  if (note.source === 'seed' && ['profile', 'style', 'lore', 'policy'].includes(note.type)) score += 0.08;
  return score;
}

function queryTypeFor(queryText) {
  const text = String(queryText || '').toLowerCase();
  if (/现在|当前|today|currently|right now|最近/u.test(text)) return 'current_state';
  if (/喜欢|偏好|prefer|favorite|style/u.test(text)) return 'preference';
  if (/为什么|原因|决策|建议|应该|how should|recommend/u.test(text)) return 'decision';
  if (/什么时候|时间|之前|以后|timeline|when/u.test(text)) return 'time_reasoning';
  if (/项目|任务|进度|计划|workflow|architecture|架构/u.test(text)) return 'project_context';
  if (/我是谁|用户|画像|profile/u.test(text)) return 'profile';
  return 'fact_recall';
}

function isCellExpired(cell, now = new Date()) {
  if (!cell.validUntil) return false;
  const until = Date.parse(cell.validUntil);
  return Number.isFinite(until) && until < now.getTime();
}

function scoreScene(scene, queryEmbedding, queryKeywords) {
  const vectorScore = embeddingsCompatible(
    queryEmbedding.signature,
    scene.embeddingSignature,
    queryEmbedding.vector,
    scene.centroidVector
  ) ? cosine(queryEmbedding.vector, scene.centroidVector) : 0;
  return vectorScore * 0.72 +
    keywordOverlapScore(queryKeywords, scene.keywords) * 0.22 +
    Math.min(0.06, Number(scene.importance || 0) * 0.06) +
    (scene.viewerId ? 0.26 : 0);
}

function scoreCell(cell, query, queryEmbedding, sceneBoost = 0) {
  const queryText = String(query.text || '').toLowerCase();
  const queryTags = normalizeTags(query.tags || []);
  const queryKeywords = normalizeTags([...(query.keywords || []), ...textKeywords(queryText)]);
  const haystack = [cell.title, cell.type, cell.scope, cell.episode, ...(cell.facts || []), ...(cell.foresight || []).map((item) => item.content)]
    .join('\n')
    .toLowerCase();
  const vectorScore = embeddingsCompatible(
    queryEmbedding.signature,
    cell.embeddingSignature,
    queryEmbedding.vector,
    cell.vector
  ) ? cosine(queryEmbedding.vector, cell.vector) : 0;
  let score = vectorScore * 0.42 + sceneBoost;
  score += keywordOverlapScore(queryKeywords, textKeywords(haystack)) * 0.18;
  for (const tag of queryTags) {
    if (haystack.includes(tag)) score += 0.06;
  }
  if (queryText && haystack.includes(queryText.slice(0, 80))) score += 0.08;
  if (cell.scope === 'temporary' || cell.type === 'session') score += 0.03;
  if (cell.viewerId) score += cell.type === 'viewer' ? 0.38 : 0.28;
  score += Math.min(0.14, Number(cell.importance || 0) * 0.08 + Number(cell.confidence || 0) * 0.06);
  if (isCellExpired(cell)) score *= 0.18;
  return score;
}

function activeAnchors(db, limit = MAX_MEMORY_ROWS) {
  return db.prepare('SELECT * FROM memory_anchors ORDER BY importance DESC, updated DESC LIMIT ?').all(limit)
    .map(rowToAnchor)
    .filter(Boolean);
}

function anchorPublic(anchor, score = undefined) {
  const { metadata, ...publicAnchor } = anchor;
  return {
    ...publicAnchor,
    reason: metadata?.reason || '',
    source: metadata?.source || '',
    type: metadata?.type || '',
    sceneId: metadata?.sceneId || '',
    viewerId: metadata?.viewerId || '',
    ...(score === undefined ? {} : { score: Number(score.toFixed(4)) })
  };
}

function scoreAnchor(anchor, queryText, queryKeywords) {
  const haystack = `${anchor.label || ''} ${(anchor.keywords || []).join(' ')}`.toLowerCase();
  let score = keywordOverlapScore(queryKeywords, textKeywords(haystack)) * 0.46;
  if (queryText && haystack.includes(queryText.slice(0, 80))) score += 0.22;
  score += Math.min(0.22, Number(anchor.importance || 0) * 0.22);
  if (anchor.recallCount) score += Math.min(0.08, Number(anchor.recallCount) * 0.01);
  return score;
}

function markRecalled(db, target) {
  const now = new Date().toISOString();
  const cellIds = [...new Set(target.cellIds || [])].filter(Boolean);
  const noteIds = [...new Set(target.noteIds || [])].filter(Boolean);
  const anchorIds = [...new Set(target.anchorIds || [])].filter(Boolean);
  const updateCell = db.prepare('UPDATE mem_cells SET last_recalled = ?, recall_count = recall_count + 1 WHERE id = ?');
  const updateNote = db.prepare('UPDATE memories SET last_recalled = ?, recall_count = recall_count + 1 WHERE id = ?');
  const updateAnchor = db.prepare('UPDATE memory_anchors SET last_recalled = ?, recall_count = recall_count + 1 WHERE id = ?');
  for (const id of cellIds) updateCell.run(now, id);
  for (const id of noteIds) updateNote.run(now, id);
  for (const id of anchorIds) updateAnchor.run(now, id);
  return { cells: cellIds.length, notes: noteIds.length, anchors: anchorIds.length };
}

function relevantProfileRows(db, queryText, limit = 6, viewerIds = new Set()) {
  const queryKeywords = textKeywords(queryText);
  return db.prepare("SELECT * FROM user_profile WHERE status IN ('active', 'candidate') ORDER BY confidence DESC, updated DESC LIMIT ?")
    .all(80)
    .map(rowToProfile)
    .filter(Boolean)
    .filter((profile) => !profile.viewerId || viewerIds.has(profile.viewerId))
    .map((profile) => {
      const haystack = `${profile.category} ${profile.name} ${profile.value}`.toLowerCase();
      const score = keywordOverlapScore(queryKeywords, textKeywords(haystack)) + Number(profile.confidence || 0) * 0.36;
      return { profile, score };
    })
    .filter((item) => item.score > 0.12 || !queryKeywords.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.profile);
}

function missingInformationFor(queryType) {
  if (queryType === 'project_context') return ['project goal', 'current constraints', 'recent decisions'];
  if (queryType === 'decision') return ['current state', 'active constraints', 'stable preferences'];
  if (queryType === 'profile') return ['confirmed profile evidence'];
  return ['more directly relevant memory evidence'];
}

function cellAsNote(cell, scene, score) {
  return {
    id: cell.id,
    title: cell.title,
    type: cell.type,
    scope: cell.scope,
    tags: cellKeywords(cell).slice(0, 8),
    summary: cell.episode,
    content: (cell.facts || []).join('\n'),
    source: 'memcell',
    path: cell.id,
    importance: cell.importance,
    confidence: cell.confidence,
    disabled: false,
    deleted: false,
    reviewStatus: cell.status,
    updated: cell.updated,
    score: Number(score.toFixed(4)),
    sceneId: scene?.id || cell.sceneId,
    sceneTitle: scene?.title || '',
    facts: cell.facts || [],
    foresight: cell.foresight || []
  };
}

function insertRetrievalTrace(db, trace) {
  const id = `trace-${sha1(`${Date.now()}:${trace.queryText}:${stableJson(trace.cellIds)}`).slice(0, 24)}`;
  const created = new Date().toISOString();
  db.prepare(`
    INSERT INTO retrieval_traces (
      id, query_text, query_type, scene_ids_json, cell_ids_json, note_ids_json,
      sufficient, missing_json, created, context_json, viewer_ids_json,
      embedding_signature, vector_degraded
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, trace.queryText || '', trace.queryType || 'general', stableJson(trace.sceneIds || []),
    stableJson(trace.cellIds || []), stableJson(trace.noteIds || []), trace.sufficient ? 1 : 0,
    stableJson(trace.missing || []), created, stableJson(trace.context || {}),
    stableJson(trace.viewerIds || []), trace.embeddingSignature || '', trace.vectorDegraded ? 1 : 0);
  return id;
}

async function buildRecollection(db, settings, input, legacyNotes, providedQueryEmbedding = null) {
  const query = input.query || {};
  const queryText = String(query.text || '').trim();
  const queryType = queryTypeFor(queryText);
  const queryEmbedding = providedQueryEmbedding || await embeddingForDetailed(queryText, settings);
  const viewers = resolveViewerProfiles(db, input);
  const viewerIds = new Set(viewers.map((viewer) => viewer.id));
  let cells = activeCells(db).filter((cell) => !cell.viewerId || viewerIds.has(cell.viewerId));
  if (!cells.length) {
    const notes = activeRows(db, false, MAX_MEMORY_ROWS);
    await ensureLifecycleForNotes(db, notes, settings);
    cells = activeCells(db).filter((cell) => !cell.viewerId || viewerIds.has(cell.viewerId));
  }
  const scenes = activeScenes(db).filter((scene) => !scene.viewerId || viewerIds.has(scene.viewerId));
  const allowedCellIds = new Set(cells.map((cell) => cell.id));
  const queryKeywords = normalizeTags([...(query.keywords || []), ...textKeywords(queryText), ...(query.tags || [])]);
  const anchorScores = activeAnchors(db)
    .filter((anchor) => anchor.targetType !== 'cell' || allowedCellIds.has(anchor.targetId))
    .map((anchor) => ({ anchor, score: scoreAnchor(anchor, queryText.toLowerCase(), queryKeywords) }))
    .filter((item) => item.score > 0.16 || !queryText)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const anchorTargetScores = new Map(anchorScores
    .filter((item) => item.anchor.targetType === 'cell')
    .map((item) => [item.anchor.targetId, item.score]));
  const sceneScores = scenes
    .map((scene) => ({ scene, score: scoreScene(scene, queryEmbedding, queryKeywords) }))
    .filter((item) => item.score > 0.22 || !queryText)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const sceneMap = new Map(scenes.map((scene) => [scene.id, scene]));
  const candidateSceneIds = new Set(sceneScores.map((item) => item.scene.id));
  const cellScores = cells
    .filter((cell) => !candidateSceneIds.size || candidateSceneIds.has(cell.sceneId) || anchorTargetScores.has(cell.id) || queryText.length < 2)
    .map((cell) => {
      const sceneScore = sceneScores.find((item) => item.scene.id === cell.sceneId)?.score || 0;
      const anchorBoost = Math.min(0.18, anchorTargetScores.get(cell.id) || 0);
      return { cell, score: scoreCell(cell, query, queryEmbedding, sceneScore * 0.18) + anchorBoost };
    })
    .filter((item) => item.score > 0.18 || !queryText)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(settings.maxNotes, 6));

  const profile = relevantProfileRows(db, queryText, 6, viewerIds);
  const topScore = cellScores[0]?.score || legacyNotes[0]?.score || 0;
  const sufficient = Boolean(topScore > 0.42 && (cellScores.length || legacyNotes.length));
  const missing = sufficient ? [] : missingInformationFor(queryType);
  const traceId = insertRetrievalTrace(db, {
    queryText,
    queryType,
    sceneIds: sceneScores.map((item) => item.scene.id),
    cellIds: cellScores.map((item) => item.cell.id),
    noteIds: legacyNotes.map((note) => note.id).filter(Boolean),
    sufficient,
    missing,
    context: {
      maxNotes: settings.maxNotes,
      profile: profile.map((item) => item.id),
      anchors: anchorScores.map((item) => item.anchor.id)
    },
    viewerIds: [...viewerIds],
    embeddingSignature: queryEmbedding.signature,
    vectorDegraded: queryEmbedding.degraded
  });
  const recalled = markRecalled(db, {
    cellIds: cellScores.map((item) => item.cell.id),
    noteIds: legacyNotes.map((note) => note.id).filter(Boolean),
    anchorIds: anchorScores
      .filter((item) => cellScores.some((cellScore) => cellScore.cell.id === item.anchor.targetId))
      .map((item) => item.anchor.id)
  });
  return {
    traceId,
    queryType,
    isSufficient: sufficient,
    missingInformation: missing,
    scenes: sceneScores.map((item) => scenePublic(item.scene, item.score)),
    cells: cellScores.map((item) => cellPublic(item.cell, item.score, sceneMap.get(item.cell.sceneId))),
    anchors: anchorScores.map((item) => anchorPublic(item.anchor, item.score)),
    viewers,
    profile,
    recalled,
    notesFromCells: cellScores.map((item) => cellAsNote(item.cell, sceneMap.get(item.cell.sceneId), item.score))
  };
}

function looksUnsafeMemoryText(text) {
  return /api[_ -]?key|token|password|passwd|secret|bearer\s+[a-z0-9._-]+|sk-[a-z0-9]{16,}|身份证|证件号|真实地址|住址|电话|手机号/iu.test(text || '');
}

function rawTurnIdsForIdentity(db, sessionId, viewerId = '') {
  return db.prepare(`
    SELECT turn_id, MIN(created) AS first_created
    FROM raw_messages
    WHERE session_id = ? AND viewer_id = ?
    GROUP BY turn_id
    ORDER BY first_created, turn_id
  `).all(sessionId, viewerId).map((row) => row.turn_id).filter(Boolean);
}

function rawRowsForSegment(db, sessionId, viewerId, segmentIndex) {
  const turnIds = rawTurnIdsForIdentity(db, sessionId, viewerId)
    .slice(segmentIndex * SESSION_ROLLUP_TURNS, (segmentIndex + 1) * SESSION_ROLLUP_TURNS);
  if (!turnIds.length) return [];
  const placeholders = turnIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT * FROM raw_messages
    WHERE session_id = ? AND viewer_id = ? AND turn_id IN (${placeholders})
    ORDER BY created, CASE role WHEN 'user' THEN 0 ELSE 1 END, id
    LIMIT ?
  `).all(sessionId, viewerId, ...turnIds, SESSION_ROLLUP_MAX_MESSAGES);
}

function compactRawMessage(row) {
  const role = row.role === 'assistant' ? 'Yachiyo' : 'User';
  return `${role}: ${asText(row.content, 260)}`;
}

function archiveTranscriptSegment(db, sessionId, viewerId, segmentIndex, rows) {
  if (!rows.length) return null;
  const turnIds = [...new Set(rows.map((row) => row.turn_id).filter(Boolean))];
  const transcript = rows.map((row) => {
    const metadata = readJsonValue(row.metadata_json, {});
    return stableJson({
      id: row.id,
      turnId: row.turn_id,
      role: row.role,
      content: row.content,
      source: row.source,
      emotion: row.emotion,
      created: row.created,
      metadata
    });
  }).join('\n');
  const now = new Date().toISOString();
  const id = `segment-${sha1(`${sessionId}:${viewerId}:${segmentIndex}`).slice(0, 24)}`;
  const sealed = turnIds.length >= SESSION_ROLLUP_TURNS;
  db.prepare(`
    INSERT INTO memory_segments (
      id, session_id, viewer_id, segment_index, first_turn_id, last_turn_id,
      turn_count, message_count, transcript_gzip, content_hash, sealed, created, updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      first_turn_id = excluded.first_turn_id,
      last_turn_id = excluded.last_turn_id,
      turn_count = excluded.turn_count,
      message_count = excluded.message_count,
      transcript_gzip = excluded.transcript_gzip,
      content_hash = excluded.content_hash,
      sealed = CASE WHEN memory_segments.sealed = 1 THEN 1 ELSE excluded.sealed END,
      updated = excluded.updated
  `).run(id, sessionId, viewerId, segmentIndex, turnIds[0] || '', turnIds.at(-1) || '',
    turnIds.length, rows.length, gzipSync(Buffer.from(transcript, 'utf8')), sha1(transcript), sealed ? 1 : 0,
    now, now);
  if (sealed) {
    const placeholders = rows.map(() => '?').join(', ');
    db.prepare(`UPDATE raw_messages SET compacted_at = ? WHERE id IN (${placeholders})`)
      .run(now, ...rows.map((row) => row.id));
  }
  return { id, sessionId, viewerId, segmentIndex, turnCount: turnIds.length, messageCount: rows.length, sealed };
}

function keyEventDetected(text) {
  return /(anchor|key event|milestone|decision|remember|preference|important|project|fix|done|decide|记住|关键|重要|决定|偏好|喜欢|讨厌|必须|不能|项目|完成|修复|设置|人格)/iu.test(text || '');
}

async function upsertSessionRollupFromRawTurn(db, settings, turn) {
  if (!settings.sessionRollupEnabled) return null;
  const sessionId = asText(turn.sessionId || turn.session_id || 'live2d-default', 120);
  if (!sessionId) return null;
  const viewerId = asText(turn.viewerId || turn.viewer_id, 120);
  const allTurnIds = rawTurnIdsForIdentity(db, sessionId, viewerId);
  const segmentIndex = Number.isFinite(Number(turn.segmentIndex))
    ? Math.max(0, Math.floor(Number(turn.segmentIndex)))
    : Math.max(0, Math.floor((allTurnIds.length - 1) / SESSION_ROLLUP_TURNS));
  const rows = rawRowsForSegment(db, sessionId, viewerId, segmentIndex);
  if (!rows.length) return null;
  const segment = archiveTranscriptSegment(db, sessionId, viewerId, segmentIndex, rows);
  const transcript = rows.map(compactRawMessage).join('\n');
  if (!transcript || looksUnsafeMemoryText(transcript)) return null;
  const day = asText((turn.at || turn.created || rows[rows.length - 1]?.created || new Date().toISOString()).slice(0, 10), 10);
  const turnIds = [...new Set(rows.map((row) => row.turn_id).filter(Boolean))].slice(-SESSION_ROLLUP_TURNS);
  const topics = textKeywords(transcript).slice(0, 10);
  const important = keyEventDetected(transcript);
  const latestUser = rows.filter((row) => row.role === 'user').slice(-1)[0]?.content || '';
  const latestAssistant = rows.filter((row) => row.role === 'assistant').slice(-1)[0]?.content || '';
  const viewer = viewerId ? rowToViewerProfile(db.prepare('SELECT * FROM viewer_profiles WHERE id = ?').get(viewerId)) : null;
  const title = viewer
    ? `${viewer.displayName} interaction segment ${day} #${segmentIndex + 1}`
    : `Live session segment ${day} #${segmentIndex + 1}`;
  const episode = [
    `Persistent ${viewer ? `viewer interaction for ${viewer.displayName}` : 'session'} segment for ${sessionId} on ${day}.`,
    topics.length ? `Topics: ${topics.join(', ')}.` : '',
    latestUser ? `Latest user intent: ${asText(latestUser, 180)}.` : '',
    latestAssistant ? `Latest Yachiyo response: ${asText(latestAssistant, 180)}.` : ''
  ].filter(Boolean).join(' ');
  const facts = [
    `Recorded ${turnIds.length} turn(s) and ${rows.length} raw message(s) in immutable segment ${segmentIndex + 1}.`,
    topics.length ? `Durable topic keywords: ${topics.slice(0, 6).join(', ')}` : '',
    important ? 'This segment contains a possible key event or decision.' : ''
  ].filter(Boolean);
  const now = new Date().toISOString();
  const id = `rollup-${sha1(`${sessionId}:${viewerId}:${segmentIndex}`).slice(0, 24)}`;
  const note = await prepareNoteForStore({
    id,
    title,
    type: 'session',
    scope: 'session',
    tags: normalizeTags(['session', 'live-stream', ...(viewer ? ['viewer'] : []), ...(important ? ['key-event'] : []), ...topics.slice(0, 4)]),
    summary: asText(episode, 420),
    content: asText(`${episode}\n\n${transcript}`, 2800),
    source: 'runtime',
    path: `runtime/rollups/${day}-${safeSlug(sessionId)}-${safeSlug(viewerId || 'global')}-${segmentIndex + 1}.md`,
    importance: important ? 0.72 : 0.48,
    confidence: important ? 0.76 : 0.62,
    disabled: 0,
    deleted: 0,
    reviewStatus: 'approved',
    updated: now,
    contentHash: sha1(`${episode}\n${turnIds.join(',')}\n${transcript}`),
    viewerId
  }, settings);
  upsertNote(db, note);
  const lifecycle = await consolidateNoteToCell(db, {
    ...note,
    episode,
    facts,
    foresight: important ? [{
      content: 'Recall this session segment when later questions mention its decision, preference, or project topic.',
      valid_from: now,
      valid_until: '',
      confidence: 0.62,
      evidence: turnIds
    }] : [],
    sourceTurnIds: turnIds
  }, settings);
  return { ...lifecycle, segment };
}

function ageDays(iso, now = new Date()) {
  const timestamp = Date.parse(iso || '');
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, (now.getTime() - timestamp) / 86400000);
}

function cellProtectedFromGc(cell, anchoredCellIds) {
  if (!cell || cell.pinned || anchoredCellIds.has(cell.id)) return true;
  if (['seed', 'persona', 'vault'].includes(cell.source)) return true;
  if (['profile', 'viewer', 'policy', 'lore', 'style'].includes(cell.type)) return true;
  return false;
}

function garbageCollectMemory(db, settings, options = {}) {
  if (!settings.gcEnabled && !options.force) return { skipped: true, archived: 0, forgotten: 0, rawDeleted: 0, tracesDeleted: 0 };
  const now = new Date();
  const archiveDays = Math.max(1, Number(settings.gcArchiveDays) || DEFAULT_GC_ARCHIVE_DAYS);
  const forgetDays = Math.max(archiveDays + 1, Number(settings.gcForgetDays) || DEFAULT_GC_FORGET_DAYS);
  const rawRetentionDays = Math.max(7, Number(settings.rawRetentionDays) || DEFAULT_RAW_RETENTION_DAYS);
  const anchoredCellIds = new Set(activeAnchors(db).filter((anchor) => anchor.targetType === 'cell').map((anchor) => anchor.targetId));
  const cells = db.prepare("SELECT * FROM mem_cells WHERE status IN ('active', 'candidate')").all().map(rowToCell).filter(Boolean);
  let archived = 0;
  let forgotten = 0;
  const archiveCell = db.prepare("UPDATE mem_cells SET status = 'archived', decay_score = ?, updated = ? WHERE id = ?");
  const forgetCell = db.prepare("UPDATE mem_cells SET status = 'forgotten', decay_score = ?, updated = ? WHERE id = ?");
  const disableNote = db.prepare('UPDATE memories SET disabled = 1 WHERE id = ? AND source = ?');
  const forgetNote = db.prepare('UPDATE memories SET deleted = 1 WHERE id = ? AND source = ?');
  for (const cell of cells) {
    if (cellProtectedFromGc(cell, anchoredCellIds)) continue;
    const age = ageDays(cell.updated || cell.created || cell.validFrom, now);
    const recallCount = Number(cell.recallCount) || 0;
    const quality = Number(cell.importance || 0) * 0.52 + Number(cell.confidence || 0) * 0.34 + Math.min(0.14, recallCount * 0.025);
    const expired = isCellExpired(cell, now);
    const decayScore = Math.min(1, age / forgetDays + Math.max(0, 0.52 - quality));
    if ((expired && quality < 0.74) || (age >= forgetDays && recallCount === 0 && quality < 0.42)) {
      forgetCell.run(decayScore, now.toISOString(), cell.id);
      if (cell.sourceMemoryId) forgetNote.run(cell.sourceMemoryId, cell.source || 'runtime');
      forgotten += 1;
    } else if (age >= archiveDays && recallCount === 0 && quality < 0.55) {
      archiveCell.run(decayScore, now.toISOString(), cell.id);
      if (cell.sourceMemoryId) disableNote.run(cell.sourceMemoryId, cell.source || 'runtime');
      archived += 1;
    } else if (expired) {
      archiveCell.run(decayScore, now.toISOString(), cell.id);
      archived += 1;
    }
  }
  const rawCutoff = new Date(now.getTime() - rawRetentionDays * 86400000).toISOString();
  const traceCutoff = new Date(now.getTime() - Math.min(rawRetentionDays, 90) * 86400000).toISOString();
  const rawDeleted = db.prepare("DELETE FROM raw_messages WHERE created < ? AND compacted_at != ''").run(rawCutoff).changes || 0;
  const tracesDeleted = db.prepare('DELETE FROM retrieval_traces WHERE created < ?').run(traceCutoff).changes || 0;
  return { skipped: false, archived, forgotten, rawDeleted, tracesDeleted };
}

async function handleInit(input) {
  const settings = normalizeSettings(input);
  const db = openStore(settings);
  try {
    const imported = await ensureImportedSources(db, settings, { force: true });
    let notes = activeRows(db, false, MAX_MEMORY_ROWS);
    const lifecycle = await ensureLifecycleForNotes(db, notes, settings);
    const vectorHealth = await auditAndRepairVectorIndex(db, settings, { repair: true });
    notes = activeRows(db, false, MAX_MEMORY_ROWS);
    let milvus = { enabled: false };
    try {
      milvus = await syncMilvus(settings, notes);
    } catch (error) {
      milvus = { enabled: true, synced: 0, error: error.message };
    }
    const gc = garbageCollectMemory(db, settings);
    db.pragma('optimize');
    db.pragma('wal_checkpoint(PASSIVE)');
    return {
      success: true,
      provider: 'sqlite-milvus',
      databasePath: settings.databasePath,
      indexed: notes.length,
      imported,
      lifecycle,
      vectorHealth,
      organization: memoryOrganizationStatus(db),
      gc,
      milvus
    };
  } finally {
    db.close();
  }
}

async function handleReindex(input) {
  return handleInit(input);
}

async function handleList(input) {
  const settings = normalizeSettings(input);
  const db = openStore(settings);
  try {
    await ensureImportedSources(db, settings);
    const includeDisabled = asBoolean(input.includeDisabled);
    const maxNotes = Math.round(asNumber(input.maxNotes, 200, 1, 1000));
    const notes = activeRows(db, includeDisabled, maxNotes).map((note) => {
      const { vector, ...publicNote } = note;
      return publicNote;
    });
    const cells = activeCells(db).slice(0, maxNotes).map((cell) => cellPublic(cell));
    const scenes = activeScenes(db).slice(0, maxNotes).map((scene) => scenePublic(scene));
    const anchors = activeAnchors(db, Math.min(maxNotes, 500)).map((anchor) => anchorPublic(anchor));
    const viewers = db.prepare('SELECT * FROM viewer_profiles ORDER BY last_seen DESC LIMIT ?')
      .all(Math.min(maxNotes, 500))
      .map(rowToViewerProfile)
      .filter(Boolean);
    const profile = db.prepare("SELECT * FROM user_profile WHERE status IN ('candidate', 'active') ORDER BY updated DESC LIMIT ?")
      .all(Math.min(maxNotes, 200))
      .map(rowToProfile)
      .filter(Boolean);
    const conflicts = db.prepare("SELECT * FROM memory_conflicts WHERE status = 'active' ORDER BY updated DESC LIMIT ?")
      .all(Math.min(maxNotes, 200))
      .map((row) => ({
        id: row.id,
        leftCellId: row.left_cell_id,
        rightCellId: row.right_cell_id,
        description: row.description,
        severity: Number(row.severity) || 0,
        status: row.status,
        created: row.created,
        updated: row.updated
      }));
    return {
      success: true,
      notes,
      cells,
      scenes,
      anchors,
      profile,
      viewers,
      conflicts,
      organization: memoryOrganizationStatus(db),
      databasePath: settings.databasePath
    };
  } finally {
    db.close();
  }
}

async function handleSearch(input) {
  const settings = normalizeSettings(input);
  if (settings.retrievalMode === 'off') return { success: true, notes: [] };
  const db = openStore(settings);
  try {
    await ensureImportedSources(db, settings);
    const storedVectorHealth = readJsonValue(getMeta(db, 'vector-health'), null);
    const healthCheckAge = storedVectorHealth?.checkedAt
      ? Date.now() - Date.parse(storedVectorHealth.checkedAt)
      : Number.POSITIVE_INFINITY;
    const vectorRepairNeeded = (
      !storedVectorHealth ||
      storedVectorHealth.signature !== configuredEmbeddingSignature(settings) ||
      vectorMetadataNeedsRepair(db, settings) ||
      (
        healthCheckAge >= 15 * 60 * 1000 &&
        (Number(storedVectorHealth.invalidNotes) > 0 || Number(storedVectorHealth.invalidCells) > 0)
      )
    );
    if (vectorRepairNeeded) {
      await auditAndRepairVectorIndex(db, settings, { repair: true });
    }
    const viewers = resolveViewerProfiles(db, input);
    const viewerIds = new Set(viewers.map((viewer) => viewer.id));
    let notes = activeRows(db, false, MAX_MEMORY_ROWS)
      .filter((note) => !note.viewerId || viewerIds.has(note.viewerId));
    if (!notes.length) {
      await ensureImportedSources(db, settings, { force: true });
      notes = activeRows(db, false, MAX_MEMORY_ROWS)
        .filter((note) => !note.viewerId || viewerIds.has(note.viewerId));
    }
    const query = input.query || {};
    const queryText = String(query.text || '').trim();
    const queryEmbedding = await embeddingForDetailed(queryText, settings);
    const milvusScores = settings.retrievalMode === 'vector' || settings.retrievalMode === 'hybrid' || settings.retrievalMode === 'index'
      ? (queryEmbedding.degraded
          ? new Map()
          : await searchMilvus(settings, queryEmbedding.vector, Math.max(settings.maxNotes * 4, 12)))
      : new Map();
    const scored = notes
      .map((note) => {
        const vectorScore = settings.retrievalMode === 'tags' || !embeddingsCompatible(
          queryEmbedding.signature,
          note.embeddingSignature,
          queryEmbedding.vector,
          note.vector
        ) ? 0 : cosine(queryEmbedding.vector, note.vector);
        const score = scoreNote(note, query, {
          vectorScore,
          milvusScore: milvusScores.get(note.id)
        });
        const { vector, ...publicNote } = note;
        return { ...publicNote, score };
      })
      .filter((note) => note.score > 0.08 || !queryText)
      .sort((a, b) => b.score - a.score)
      .slice(0, settings.maxNotes)
      .map((note) => {
        const { score, ...publicNote } = note;
        return { ...publicNote, score: Number(score.toFixed(4)) };
      });
    await ensureLifecycleForNotes(db, notes, settings);
    const recollection = await buildRecollection(db, settings, input, scored, queryEmbedding);
    const noteIds = new Set();
    const merged = [...recollection.notesFromCells, ...scored]
      .filter((note) => {
        const key = note.id || note.path;
        if (!key || noteIds.has(key)) return false;
        noteIds.add(key);
        return true;
      })
      .slice(0, settings.maxNotes);
    const { notesFromCells, ...publicRecollection } = recollection;
    return {
      success: true,
      notes: merged,
      recollection: publicRecollection,
      vectorHealth: {
        signature: queryEmbedding.signature,
        dimension: queryEmbedding.vector.length,
        degraded: queryEmbedding.degraded,
        compatible: notes.every((note) => (
          !note.embeddingSignature || note.embeddingSignature === queryEmbedding.signature
        ))
      },
      databasePath: settings.databasePath
    };
  } finally {
    db.close();
  }
}

async function handleWrite(input) {
  const settings = normalizeSettings(input);
  if (settings.writeMode === 'off') {
    return { success: false, message: 'Memory write is off.' };
  }
  const memory = input.memory && typeof input.memory === 'object' ? input.memory : {};
  const text = asText(memory.text || memory.content || memory.summary, MAX_WRITE_CHARS);
  const title = asText(memory.title || memory.name, 120);
  if (!title || !text) throw new Error('Memory title and text are required.');
  if (looksUnsafeMemoryText(`${title}\n${text}`)) throw new Error('Memory payload looks sensitive and was rejected.');
  const type = asText(memory.type || 'session', 40).toLowerCase().replace(/[\s-]+/g, '_');
  const scope = asText(memory.scope || inferScopeFromType(type), 40).toLowerCase().replace(/[\s-]+/g, '_');
  const now = new Date().toISOString();
  const viewer = normalizeViewerIdentity(memory.viewer || input.viewer || {});
  const idempotencyKey = asText(memory.idempotencyKey || memory.idempotency_key || input.idempotencyKey, 300);
  const id = `runtime-${sha1(idempotencyKey || `${now}:${title}:${text}`).slice(0, 24)}`;
  const note = await prepareNoteForStore({
    id,
    title,
    type,
    scope,
    tags: normalizeTags(memory.tags || []),
    summary: asText(memory.summary || text, 420),
    content: text,
    source: 'runtime',
    path: `runtime/${now.slice(0, 10)}-${safeSlug(viewer?.id || 'global')}-${safeSlug(title)}.md`,
    importance: asNumber(memory.importance, 0.45, 0, 1),
    confidence: asNumber(memory.confidence, 0.65, 0, 1),
    pinned: asBoolean(memory.pinned),
    disabled: 0,
    deleted: 0,
    reviewStatus: settings.writeMode === 'auto-approved' ? 'approved' : 'pending',
    updated: now,
    contentHash: sha1(`${title}\n${text}`),
    viewerId: viewer?.id || ''
  }, settings);
  const db = openStore(settings);
  try {
    if (viewer && !db.prepare('SELECT 1 FROM viewer_profiles WHERE id = ?').get(viewer.id)) {
      upsertViewerProfile(db, viewer, {
        turnId: `memory-${note.id}`,
        input: text,
        eventType: 'memory',
        source: viewer.platform,
        at: now
      });
    }
    upsertNote(db, note);
    let milvus = { enabled: false };
    try {
      milvus = await syncMilvus(settings, [note]);
    } catch (error) {
      milvus = { enabled: true, synced: 0, error: error.message };
    }
    const lifecycle = await consolidateNoteToCell(db, {
      ...note,
      episode: memory.episode,
      facts: memory.facts,
      foresight: memory.foresight,
      sourceTurnIds: memory.sourceTurnIds || memory.turnIds,
      pinned: memory.pinned,
      validFrom: memory.validFrom || memory.valid_from,
      validUntil: memory.validUntil || memory.valid_until
    }, settings);
    const maintenance = maybeRunAutomaticMaintenance(db, settings);
    return {
      success: true,
      approved: note.reviewStatus === 'approved',
      path: note.path,
      id: note.id,
      databasePath: settings.databasePath,
      lifecycle,
      maintenance,
      milvus
    };
  } finally {
    db.close();
  }
}

async function handleDisable(input) {
  const settings = normalizeSettings(input);
  const key = asText(input.path || input.id, 500);
  if (!key) throw new Error('Memory note path is required.');
  const disabled = asBoolean(input.disabled ?? true) ? 1 : 0;
  const db = openStore(settings);
  try {
    const result = db.prepare('UPDATE memories SET disabled = ? WHERE path = ? OR id = ?').run(disabled, key, key);
    db.prepare("UPDATE mem_cells SET status = ? WHERE source_memory_id IN (SELECT id FROM memories WHERE path = ? OR id = ?)")
      .run(disabled ? 'archived' : 'active', key, key);
    return { success: true, path: key, disabled: Boolean(disabled), changed: result.changes };
  } finally {
    db.close();
  }
}

async function handleDelete(input) {
  const settings = normalizeSettings(input);
  const key = asText(input.path || input.id, 500);
  if (!key) throw new Error('Memory note path is required.');
  const db = openStore(settings);
  try {
    const result = db.prepare('UPDATE memories SET deleted = 1 WHERE path = ? OR id = ?').run(key, key);
    db.prepare("UPDATE mem_cells SET status = 'archived' WHERE source_memory_id IN (SELECT id FROM memories WHERE path = ? OR id = ?)")
      .run(key, key);
    return { success: true, path: key, deletedPath: key, changed: result.changes };
  } finally {
    db.close();
  }
}

async function handleRecordTurn(input) {
  const settings = normalizeSettings(input);
  const db = openStore(settings);
  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO raw_messages (
        id, session_id, turn_id, role, content, source, emotion, created, metadata_json,
        viewer_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const turns = (Array.isArray(input.turns) ? input.turns : [input])
      .filter((turn) => turn && typeof turn === 'object')
      .slice(0, 200);
    const affected = new Map();
    const persisted = [];
    let viewerProfilesUpdated = 0;

    db.transaction(() => {
      for (const turn of turns) {
        const now = asText(turn.at || turn.created || new Date().toISOString(), 80);
        const sessionId = asText(turn.sessionId || turn.session_id || 'live2d-default', 120);
        const turnId = asText(
          turn.turnId || turn.turn_id || `turn-${sha1(`${sessionId}:${now}:${turn.input || ''}`).slice(0, 16)}`,
          120
        );
        const source = asText(turn.source || 'live2d', 60);
        const emotion = asText(turn.emotion || '', 40);
        const viewer = normalizeViewerIdentity(turn.viewer || {});
        const metadata = {
          model: asText(turn.model || '', 120),
          mode: asText(turn.mode || '', 80),
          tags: normalizeTags(turn.tags || []),
          eventType: asText(turn.eventType || turn.messageType || turn.type || '', 40),
          giftName: asText(turn.giftName || '', 120),
          amount: Math.max(0, Number(turn.amount) || 0),
          price: Math.max(0, Number(turn.price) || 0),
          viewerIdentityKey: viewer?.identityKey || ''
        };
        const rows = [
          { role: 'user', content: asText(turn.input || turn.message || '', 2400) },
          { role: 'assistant', content: asText(turn.reply || turn.response || '', 2400) }
        ].filter((row) => row.content);
        const rawIds = [];
        let recorded = 0;
        for (const row of rows) {
          const id = `raw-${sha1(`${sessionId}:${turnId}:${row.role}:${row.content}`).slice(0, 24)}`;
          const result = insert.run(
            id,
            sessionId,
            turnId,
            row.role,
            row.content,
            source,
            emotion,
            now,
            stableJson(metadata),
            viewer?.id || ''
          );
          if (result.changes) {
            rawIds.push(id);
            recorded += 1;
          }
        }
        if (recorded > 0) {
          const key = `${sessionId}\u0000${viewer?.id || ''}`;
          affected.set(key, { sessionId, viewerId: viewer?.id || '', at: now });
          if (viewer && rows.some((row) => row.role === 'user')) {
            upsertViewerProfile(db, viewer, { ...turn, sessionId, turnId, at: now });
            viewerProfilesUpdated += 1;
          }
        }
        persisted.push({ sessionId, turnId, rawIds, recorded, viewerId: viewer?.id || '' });
      }
    })();

    const rollups = [];
    if (settings.sessionRollupEnabled) {
      for (const identity of affected.values()) {
        const totalTurns = rawTurnIdsForIdentity(db, identity.sessionId, identity.viewerId).length;
        const segmentCount = Math.ceil(totalTurns / SESSION_ROLLUP_TURNS);
        const existingSegments = new Map(db.prepare(`
          SELECT segment_index, turn_count, sealed
          FROM memory_segments
          WHERE session_id = ? AND viewer_id = ?
        `).all(identity.sessionId, identity.viewerId).map((row) => [Number(row.segment_index), row]));
        for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
          const rows = rawRowsForSegment(db, identity.sessionId, identity.viewerId, segmentIndex);
          if (!rows.length) continue;
          const turnCount = new Set(rows.map((row) => row.turn_id)).size;
          const existing = existingSegments.get(segmentIndex);
          const segment = archiveTranscriptSegment(db, identity.sessionId, identity.viewerId, segmentIndex, rows);
          const shouldRefreshRollup = !existing || segment.sealed || turnCount % 4 === 0;
          if (!shouldRefreshRollup) continue;
          try {
            const rollup = await upsertSessionRollupFromRawTurn(db, settings, {
              ...identity,
              segmentIndex
            });
            if (rollup) rollups.push(rollup);
          } catch (_) {
            // Raw rows and their compressed segment are already durable; consolidation can retry later.
          }
        }
      }
    }
    const first = persisted[0] || { sessionId: '', turnId: '', rawIds: [], recorded: 0 };
    const maintenance = maybeRunAutomaticMaintenance(db, settings);
    return {
      success: true,
      sessionId: first.sessionId,
      turnId: first.turnId,
      rawIds: persisted.flatMap((turn) => turn.rawIds),
      recorded: persisted.reduce((sum, turn) => sum + turn.recorded, 0),
      turns: persisted,
      viewerProfilesUpdated,
      rollup: rollups[0] || null,
      rollups,
      maintenance,
      databasePath: settings.databasePath
    };
  } finally {
    db.close();
  }
}

async function handleConsolidate(input) {
  const settings = normalizeSettings(input);
  const db = openStore(settings);
  try {
    await ensureImportedSources(db, settings);
    let notes = activeRows(db, false, MAX_MEMORY_ROWS);
    if (!notes.length) {
      await ensureImportedSources(db, settings, { force: true });
      notes = activeRows(db, false, MAX_MEMORY_ROWS);
    }
    const lifecycle = await ensureLifecycleForNotes(db, notes, settings);
    const pendingSegments = db.prepare('SELECT session_id, viewer_id, segment_index FROM memory_segments WHERE sealed = 0 ORDER BY updated')
      .all();
    let rollupsRefreshed = 0;
    for (const segment of pendingSegments) {
      try {
        const rollup = await upsertSessionRollupFromRawTurn(db, settings, {
          sessionId: segment.session_id,
          viewerId: segment.viewer_id,
          segmentIndex: segment.segment_index
        });
        if (rollup) rollupsRefreshed += 1;
      } catch (_) {
        // The compressed source segment remains available for the next maintenance pass.
      }
    }
    const vectorHealth = await auditAndRepairVectorIndex(db, settings, { repair: true });
    const gc = garbageCollectMemory(db, settings);
    db.pragma('optimize');
    db.pragma('wal_checkpoint(PASSIVE)');
    return {
      success: true,
      lifecycle,
      rollupsRefreshed,
      vectorHealth,
      gc,
      organization: memoryOrganizationStatus(db),
      databasePath: settings.databasePath
    };
  } finally {
    db.close();
  }
}

async function handleProfile(input) {
  const settings = normalizeSettings(input);
  const db = openStore(settings);
  try {
    const maxItems = Math.round(asNumber(input.maxItems || input.maxNotes, 80, 1, 500));
    const requestedViewers = resolveViewerProfiles(db, input);
    const requestedViewerIds = new Set(requestedViewers.map((viewer) => viewer.id));
    const hasViewerFilter = viewerLookupValues(input).length > 0;
    const viewers = hasViewerFilter
      ? requestedViewers
      : db.prepare('SELECT * FROM viewer_profiles ORDER BY last_seen DESC LIMIT ?')
        .all(maxItems)
        .map(rowToViewerProfile)
        .filter(Boolean);
    const profile = db.prepare("SELECT * FROM user_profile WHERE status IN ('candidate', 'active') ORDER BY category, confidence DESC, updated DESC LIMIT ?")
      .all(maxItems)
      .map(rowToProfile)
      .filter(Boolean)
      .filter((item) => !hasViewerFilter || !item.viewerId || requestedViewerIds.has(item.viewerId));
    const scenes = activeScenes(db)
      .filter((scene) => !hasViewerFilter || !scene.viewerId || requestedViewerIds.has(scene.viewerId))
      .slice(0, maxItems)
      .map((scene) => scenePublic(scene));
    const anchors = activeAnchors(db, maxItems)
      .filter((anchor) => !hasViewerFilter || !anchor.metadata?.viewerId || requestedViewerIds.has(anchor.metadata.viewerId))
      .map((anchor) => anchorPublic(anchor));
    const conflicts = db.prepare("SELECT * FROM memory_conflicts WHERE status = 'active' ORDER BY severity DESC, updated DESC LIMIT ?")
      .all(maxItems)
      .map((row) => ({
        id: row.id,
        leftCellId: row.left_cell_id,
        rightCellId: row.right_cell_id,
        description: row.description,
        severity: Number(row.severity) || 0,
        status: row.status,
        created: row.created,
        updated: row.updated
      }));
    return {
      success: true,
      viewers,
      profile,
      scenes,
      anchors,
      conflicts,
      organization: memoryOrganizationStatus(db),
      databasePath: settings.databasePath
    };
  } finally {
    db.close();
  }
}

async function handleTraces(input) {
  const settings = normalizeSettings(input);
  const db = openStore(settings);
  try {
    const maxItems = Math.round(asNumber(input.maxItems || input.maxNotes, 30, 1, 200));
    const traces = db.prepare('SELECT * FROM retrieval_traces ORDER BY created DESC LIMIT ?')
      .all(maxItems)
      .map((row) => ({
        id: row.id,
        queryText: row.query_text,
        queryType: row.query_type,
        sceneIds: readJsonValue(row.scene_ids_json, []),
        cellIds: readJsonValue(row.cell_ids_json, []),
        noteIds: readJsonValue(row.note_ids_json, []),
        isSufficient: Boolean(row.sufficient),
        missingInformation: readJsonValue(row.missing_json, []),
        viewerIds: readJsonValue(row.viewer_ids_json, []),
        embeddingSignature: row.embedding_signature || '',
        vectorDegraded: Boolean(row.vector_degraded),
        created: row.created,
        context: readJsonValue(row.context_json, {})
      }));
    return { success: true, traces, databasePath: settings.databasePath };
  } finally {
    db.close();
  }
}

async function handleAnchors(input) {
  const settings = normalizeSettings(input);
  const db = openStore(settings);
  try {
    await ensureImportedSources(db, settings);
    const maxItems = Math.round(asNumber(input.maxItems || input.maxNotes, 80, 1, 500));
    const anchors = activeAnchors(db, maxItems).map((anchor) => anchorPublic(anchor));
    return { success: true, anchors, databasePath: settings.databasePath };
  } finally {
    db.close();
  }
}

async function handleGc(input) {
  const settings = normalizeSettings(input);
  const db = openStore(settings);
  try {
    const gc = garbageCollectMemory(db, settings, { force: true });
    return { success: true, gc, databasePath: settings.databasePath };
  } finally {
    db.close();
  }
}

async function handleShutdown(input) {
  let milvus = { enabled: true, stopped: false };
  try {
    const shouldStopMilvus = asBoolean(input.stopMilvus ?? true);
    if (shouldStopMilvus) milvus = await stopManagedMilvusContainer();
  } catch (error) {
    milvus = { enabled: true, stopped: false, error: error.message };
  }

  setTimeout(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  }, 50).unref();

  return { success: true, shuttingDown: true, milvus };
}

async function dispatch(route, input) {
  if (route.endsWith('/managed-milvus/start')) return handleManagedMilvusStart(input);
  if (route.endsWith('/shutdown')) return handleShutdown(input);
  if (route.endsWith('/init')) return handleInit(input);
  if (route.endsWith('/reindex')) return handleReindex(input);
  if (route.endsWith('/consolidate')) return handleConsolidate(input);
  if (route.endsWith('/search')) return handleSearch(input);
  if (route.endsWith('/write')) return handleWrite(input);
  if (route.endsWith('/record-turn')) return handleRecordTurn(input);
  if (route.endsWith('/list')) return handleList(input);
  if (route.endsWith('/profile')) return handleProfile(input);
  if (route.endsWith('/traces')) return handleTraces(input);
  if (route.endsWith('/anchors')) return handleAnchors(input);
  if (route.endsWith('/gc')) return handleGc(input);
  if (route.endsWith('/disable')) return handleDisable(input);
  if (route.endsWith('/delete')) return handleDelete(input);
  throw new Error('Unknown memory route.');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      jsonResponse(res, 200, { success: true });
      return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      jsonResponse(res, 200, {
        success: true,
        service: 'yachiyo-memory-data',
        repoRoot,
        managedMilvus: {
          autostart: asBoolean(process.env.YACHIYO_MEMORY_AUTOSTART_MANAGED_MILVUS),
          error: managedMilvusStartupError
        }
      });
      return;
    }
    if (req.method !== 'POST' || !url.pathname.startsWith('/api/memory/')) {
      jsonResponse(res, 404, { success: false, message: 'Not found' });
      return;
    }
    const input = await readRequestJson(req);
    const payload = await dispatch(url.pathname, input);
    jsonResponse(res, payload?.success === false ? 400 : 200, payload);
  } catch (error) {
    jsonResponse(res, 500, {
      success: false,
      message: error.message || 'Memory data service failed.'
    });
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Yachiyo memory data service listening on http://127.0.0.1:${port}\n`);
  if (asBoolean(process.env.YACHIYO_MEMORY_AUTOSTART_MANAGED_MILVUS)) {
    handleManagedMilvusStart({})
      .catch((error) => {
        managedMilvusStartupError = error.message || 'Managed Milvus failed to start.';
        process.stderr.write(`Managed Milvus startup failed: ${managedMilvusStartupError}\n`);
      });
  }
});
