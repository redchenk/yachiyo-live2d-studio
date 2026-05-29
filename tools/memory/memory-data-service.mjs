import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const DEFAULT_PORT = 3299;
const DEFAULT_COLLECTION = 'yachiyo_memory';
const DEFAULT_DIMENSION = 384;
const MAX_MEMORY_ROWS = 2000;
const MAX_NOTE_BYTES = 256 * 1024;
const MAX_WRITE_CHARS = 2400;

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

function resolveDatabasePath(inputPath) {
  const value = String(inputPath || '').trim();
  if (!value) return defaultDatabasePath();
  const expanded = value.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || '');
  const resolved = path.resolve(expanded);
  if (/\.(sqlite|sqlite3|db)$/i.test(resolved)) return resolved;
  return path.join(resolved, 'yachiyo-memory.sqlite');
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
    retrievalMode: asText(input.query?.retrievalMode || settings.retrievalMode || 'hybrid', 40).toLowerCase(),
    writeMode: asText(input.mode || settings.writeMode || 'auto-approved', 40).toLowerCase(),
    maxNotes: Math.round(asNumber(input.query?.maxNotes || settings.maxNotesPerTurn, 4, 1, 12)),
    milvusEnabled: asBoolean(settings.milvusEnabled || settings.useMilvus),
    milvusUrl: asText(settings.milvusUrl || settings.milvusEndpoint || 'http://127.0.0.1:19530', 300).replace(/\/+$/, ''),
    milvusToken: asText(settings.milvusToken || '', 1000),
    milvusCollection: asText(settings.milvusCollection || DEFAULT_COLLECTION, 80).replace(/[^a-zA-Z0-9_]/g, '_') || DEFAULT_COLLECTION,
    embeddingApiUrl: asText(settings.embeddingApiUrl || '', 300),
    embeddingApiKey: asText(settings.embeddingApiKey || '', 1000),
    embeddingModel: asText(settings.embeddingModel || 'text-embedding-3-small', 120),
    embeddingDimension: dimension
  };
}

function openStore(settings) {
  fs.mkdirSync(path.dirname(settings.databasePath), { recursive: true });
  const db = new Database(settings.databasePath);
  db.pragma('journal_mode = WAL');
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
  `);
  return db;
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

async function embeddingFor(text, settings) {
  if (!settings.embeddingApiUrl || !settings.embeddingApiKey) {
    return hashEmbedding(text, settings.embeddingDimension);
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
    return normalizeVector(vector, settings.embeddingDimension);
  } catch (_) {
    return hashEmbedding(text, settings.embeddingDimension);
  }
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
  const vector = await embeddingFor(noteEmbeddingText(note), settings);
  return {
    ...note,
    vector
  };
}

function upsertNote(db, note) {
  db.prepare(`
    INSERT INTO memories (
      id, title, type, scope, tags_json, summary, content, source, path,
      importance, confidence, disabled, deleted, review_status, updated, content_hash, vector_json
    )
    VALUES (
      @id, @title, @type, @scope, @tagsJson, @summary, @content, @source, @path,
      @importance, @confidence, @disabled, @deleted, @reviewStatus, @updated, @contentHash, @vectorJson
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
      vector_json = excluded.vector_json
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
    vectorJson: JSON.stringify(note.vector || [])
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
    vector
  };
}

function activeRows(db, includeDisabled = false, limit = MAX_MEMORY_ROWS) {
  const where = includeDisabled ? 'deleted = 0' : 'deleted = 0 AND disabled = 0';
  return db.prepare(`SELECT * FROM memories WHERE ${where} ORDER BY source, type, title LIMIT ?`).all(limit)
    .map(rowToNote)
    .filter(Boolean);
}

async function importSources(db, settings) {
  db.prepare("UPDATE memories SET deleted = 1 WHERE source IN ('seed', 'vault')").run();
  const imported = { seed: 0, vault: 0 };
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
  return imported;
}

async function milvusRequest(settings, apiPath, body) {
  if (!settings.milvusEnabled) return null;
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
  score += Math.min(0.16, Number(note.importance || 0) * 0.11 + Number(note.confidence || 0) * 0.05);
  if (note.source === 'seed' && ['profile', 'style', 'lore', 'policy'].includes(note.type)) score += 0.08;
  return score;
}

async function handleInit(input) {
  const settings = normalizeSettings(input);
  const db = openStore(settings);
  try {
    const imported = await importSources(db, settings);
    const notes = activeRows(db, false, MAX_MEMORY_ROWS);
    let milvus = { enabled: false };
    try {
      milvus = await syncMilvus(settings, notes);
    } catch (error) {
      milvus = { enabled: true, synced: 0, error: error.message };
    }
    return {
      success: true,
      provider: 'sqlite-milvus',
      databasePath: settings.databasePath,
      indexed: notes.length,
      imported,
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
    const includeDisabled = asBoolean(input.includeDisabled);
    const maxNotes = Math.round(asNumber(input.maxNotes, 200, 1, 1000));
    const notes = activeRows(db, includeDisabled, maxNotes).map((note) => {
      const { vector, ...publicNote } = note;
      return publicNote;
    });
    return { success: true, notes, databasePath: settings.databasePath };
  } finally {
    db.close();
  }
}

async function handleSearch(input) {
  const settings = normalizeSettings(input);
  if (settings.retrievalMode === 'off') return { success: true, notes: [] };
  const db = openStore(settings);
  try {
    let notes = activeRows(db, false, MAX_MEMORY_ROWS);
    if (!notes.length) {
      await importSources(db, settings);
      notes = activeRows(db, false, MAX_MEMORY_ROWS);
    }
    const query = input.query || {};
    const queryText = String(query.text || '').trim();
    const queryVector = await embeddingFor(queryText, settings);
    const milvusScores = settings.retrievalMode === 'vector' || settings.retrievalMode === 'hybrid' || settings.retrievalMode === 'index'
      ? await searchMilvus(settings, queryVector, Math.max(settings.maxNotes * 4, 12))
      : new Map();
    const scored = notes
      .map((note) => {
        const vectorScore = settings.retrievalMode === 'tags' ? 0 : cosine(queryVector, note.vector);
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
    return { success: true, notes: scored, databasePath: settings.databasePath };
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
  const type = asText(memory.type || 'session', 40).toLowerCase().replace(/[\s-]+/g, '_');
  const scope = asText(memory.scope || inferScopeFromType(type), 40).toLowerCase().replace(/[\s-]+/g, '_');
  const now = new Date().toISOString();
  const id = `runtime-${sha1(`${now}:${title}:${text}`).slice(0, 24)}`;
  const note = await prepareNoteForStore({
    id,
    title,
    type,
    scope,
    tags: normalizeTags(memory.tags || []),
    summary: asText(memory.summary || text, 420),
    content: text,
    source: 'runtime',
    path: `runtime/${now.slice(0, 10)}-${safeSlug(title)}.md`,
    importance: asNumber(memory.importance, 0.45, 0, 1),
    confidence: asNumber(memory.confidence, 0.65, 0, 1),
    disabled: 0,
    deleted: 0,
    reviewStatus: settings.writeMode === 'auto-approved' ? 'approved' : 'pending',
    updated: now,
    contentHash: sha1(`${title}\n${text}`)
  }, settings);
  const db = openStore(settings);
  try {
    upsertNote(db, note);
    let milvus = { enabled: false };
    try {
      milvus = await syncMilvus(settings, [note]);
    } catch (error) {
      milvus = { enabled: true, synced: 0, error: error.message };
    }
    return {
      success: true,
      approved: note.reviewStatus === 'approved',
      path: note.path,
      id: note.id,
      databasePath: settings.databasePath,
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
    return { success: true, path: key, deletedPath: key, changed: result.changes };
  } finally {
    db.close();
  }
}

async function dispatch(route, input) {
  if (route.endsWith('/init')) return handleInit(input);
  if (route.endsWith('/reindex')) return handleReindex(input);
  if (route.endsWith('/search')) return handleSearch(input);
  if (route.endsWith('/write')) return handleWrite(input);
  if (route.endsWith('/list')) return handleList(input);
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
      jsonResponse(res, 200, { success: true, service: 'yachiyo-memory-data', repoRoot });
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
});
