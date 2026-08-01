import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const serviceScript = path.join(repoRoot, 'tools', 'memory', 'memory-data-service.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-segment-stability-'));
const dbPath = path.join(tempRoot, 'memory.sqlite');
const port = 39200 + Math.floor(Math.random() * 500);

// Seed the pre-sequence schema to verify that a real existing database is upgraded in place.
{
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE raw_messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL DEFAULT '', turn_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'live2d',
      emotion TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}',
      viewer_id TEXT NOT NULL DEFAULT '', compacted_at TEXT NOT NULL DEFAULT '',
      ingest_sequence INTEGER NOT NULL DEFAULT 0, segment_index INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE memory_segments (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, viewer_id TEXT NOT NULL DEFAULT '',
      segment_index INTEGER NOT NULL DEFAULT 0, first_turn_id TEXT NOT NULL DEFAULT '',
      last_turn_id TEXT NOT NULL DEFAULT '', turn_count INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0, transcript_gzip BLOB NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '', sealed INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL DEFAULT '',
      UNIQUE(session_id, viewer_id, segment_index)
    );
    CREATE TABLE memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL DEFAULT '');
    INSERT INTO memory_meta (key, value, updated)
    VALUES ('raw_segment_sequence_v1', '1', '2025-01-01T00:00:00.000Z');
  `);
  const insertLegacy = legacy.prepare(`
    INSERT INTO raw_messages (id, session_id, turn_id, role, content, created)
    VALUES (?, 'legacy-session', ?, 'user', ?, ?)
  `);
  insertLegacy.run('legacy-c', 'legacy-c', 'third by timestamp', '2024-01-03T00:00:00.000Z');
  insertLegacy.run('legacy-a', 'legacy-a', 'first by timestamp', '2024-01-01T00:00:00.000Z');
  insertLegacy.run('legacy-b', 'legacy-b', 'second by timestamp', '2024-01-02T00:00:00.000Z');
  const archivedTranscript = [...Array(12).keys()].map((number) => JSON.stringify({
    id: `archived-raw-${number}`,
    turnId: `archived-turn-${number}`,
    role: 'user',
    content: `archived message ${number}`,
    created: '2023-01-01T00:00:00.000Z',
    metadata: {}
  })).join('\n');
  legacy.prepare(`
    INSERT INTO memory_segments (
      id, session_id, viewer_id, segment_index, first_turn_id, last_turn_id,
      turn_count, message_count, transcript_gzip, content_hash, sealed, created, updated
    ) VALUES (?, 'archived-only-session', '', 0, 'archived-turn-0', 'archived-turn-11',
      12, 12, ?, 'preserved-sealed-hash', 1, '2023-01-01T00:00:00.000Z', '2023-01-01T00:00:00.000Z')
  `).run('archived-only-segment-0', gzipSync(Buffer.from(archivedTranscript, 'utf8')));

  const retainedSegmentZeroTranscript = [...Array(12).keys()].map((number) => JSON.stringify({
    id: `retained-archived-${number}`,
    turnId: `retained-turn-${number}`,
    role: 'user',
    content: `retained archived message ${number}`,
    created: '2023-02-01T00:00:00.000Z',
    metadata: {}
  })).join('\n');
  const retainedOpenTranscript = JSON.stringify({
    id: 'retained-live-user',
    turnId: 'retained-turn-12',
    role: 'user',
    content: 'retained open message',
    created: '2025-02-01T00:00:00.000Z',
    metadata: {}
  });
  const insertSegment = legacy.prepare(`
    INSERT INTO memory_segments (
      id, session_id, viewer_id, segment_index, first_turn_id, last_turn_id,
      turn_count, message_count, transcript_gzip, content_hash, sealed, created, updated
    ) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, '2023-02-01T00:00:00.000Z', '2023-02-01T00:00:00.000Z')
  `);
  insertSegment.run('retained-segment-0', 'retained-raw-session', 0, 'retained-turn-0', 'retained-turn-11',
    12, 12, gzipSync(Buffer.from(retainedSegmentZeroTranscript, 'utf8')), 'retained-segment-zero-hash', 1);
  insertSegment.run('retained-segment-1', 'retained-raw-session', 1, 'retained-turn-12', 'retained-turn-12',
    1, 1, gzipSync(Buffer.from(retainedOpenTranscript, 'utf8')), 'retained-segment-one-hash', 0);
  legacy.prepare(`
    INSERT INTO raw_messages (
      id, session_id, turn_id, role, content, created, viewer_id, ingest_sequence, segment_index
    ) VALUES ('retained-live-user', 'retained-raw-session', 'retained-turn-12', 'user',
      'retained open message', '2025-02-01T00:00:00.000Z', '', 0, 0)
  `).run();

  insertSegment.run('corrupt-segment-0', 'corrupt-archive-session', 0, 'corrupt-turn-0', 'corrupt-turn-11',
    12, 12, Buffer.from('not-a-valid-gzip'), 'corrupt-segment-zero-hash', 1);
  legacy.prepare(`
    INSERT INTO raw_messages (
      id, session_id, turn_id, role, content, created, viewer_id, ingest_sequence, segment_index
    ) VALUES ('corrupt-retained-user', 'corrupt-archive-session', 'corrupt-retained-turn', 'user',
      'retained after corrupt archive', '2025-03-01T00:00:00.000Z', '', 0, 0)
  `).run();
  legacy.close();
}

const service = spawn(process.execPath, [serviceScript, '--port', String(port), '--repo-root', repoRoot], {
  cwd: repoRoot,
  env: { ...process.env, YACHIYO_MEMORY_AUTOSTART_MANAGED_MILVUS: '0' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stderr = '';
service.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

const baseUrl = `http://127.0.0.1:${port}`;
const settings = {
  provider: 'sqlite-milvus',
  databasePath: dbPath,
  milvusEnabled: false,
  milvusManaged: false,
  sessionRollupEnabled: true,
  gcEnabled: true,
  rawRetentionDays: 7,
  embeddingDimension: 32
};

async function waitForService() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`memory service did not start: ${stderr}`);
}

async function post(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `${route} failed: ${JSON.stringify(payload)} ${stderr}`);
  assert.equal(payload.success, true, `${route} returned failure: ${JSON.stringify(payload)}`);
  return payload;
}

function openDb() {
  return new Database(dbPath);
}

try {
  await waitForService();

  // Deliberately shuffle logical turn names and give every turn the same timestamp. Ingestion order,
  // rather than wall-clock order, must define immutable segment membership.
  const turnNumbers = [8, 2, 11, 1, 6, 4, 12, 3, 10, 5, 9, 7];
  const sharedTimestamp = new Date().toISOString();
  const turns = turnNumbers.map((number) => ({
    sessionId: 'stable-session',
    turnId: `turn-${number}`,
    at: sharedTimestamp,
    input: `viewer message ${number}`,
    reply: `reply ${number}`
  }));
  const firstWrite = await post('/api/memory/record-turn', { ...settings, turns });
  assert.equal(firstWrite.recorded, 24);

  // Replaying an already durable batch must neither add rows nor consume sequence numbers.
  const replay = await post('/api/memory/record-turn', { ...settings, turns: turns.slice().reverse() });
  assert.equal(replay.recorded, 0);

  let db = openDb();
  const columns = new Set(db.prepare('PRAGMA table_info(raw_messages)').all().map((row) => row.name));
  assert.equal(columns.has('ingest_sequence'), true, 'raw rows need a durable ingestion sequence');
  assert.equal(columns.has('segment_index'), true, 'raw rows need durable segment membership');
  const migratedLegacy = db.prepare(`
    SELECT turn_id, ingest_sequence, segment_index FROM raw_messages
    WHERE session_id = 'legacy-session' ORDER BY ingest_sequence
  `).all();
  assert.deepEqual(migratedLegacy.map((row) => row.turn_id), ['legacy-a', 'legacy-b', 'legacy-c']);
  assert.deepEqual(migratedLegacy.map((row) => row.ingest_sequence), [0, 1, 2]);
  assert.equal(migratedLegacy.every((row) => row.segment_index === 0), true);
  assert.equal(db.prepare(`
    SELECT next_sequence FROM memory_ingest_cursors
    WHERE session_id = 'legacy-session' AND viewer_id = ''
  `).get().next_sequence, 3);
  const retainedAfterV2 = db.prepare(`
    SELECT ingest_sequence, segment_index FROM raw_messages
    WHERE session_id = 'retained-raw-session' AND turn_id = 'retained-turn-12'
  `).get();
  assert.deepEqual(retainedAfterV2, { ingest_sequence: 12, segment_index: 1 },
    'v2 migration must recover retained raw membership from archived transcript turn IDs');
  const corruptAfterV2 = db.prepare(`
    SELECT ingest_sequence, segment_index FROM raw_messages
    WHERE session_id = 'corrupt-archive-session' AND turn_id = 'corrupt-retained-turn'
  `).get();
  assert.deepEqual(corruptAfterV2, { ingest_sequence: 12, segment_index: 1 },
    'a corrupt archive must allocate retained raw after its conservative segment bound');
  db.close();

  const retainedCompletion = await post('/api/memory/record-turn', {
    ...settings,
    sessionId: 'retained-raw-session',
    turnId: 'retained-turn-12',
    input: 'retained open message',
    reply: 'assistant completion after migration'
  });
  assert.equal(retainedCompletion.recorded, 1);
  const retainedReplay = await post('/api/memory/record-turn', {
    ...settings,
    sessionId: 'retained-raw-session',
    turnId: 'retained-turn-12',
    input: 'retained open message',
    reply: 'assistant completion after migration'
  });
  assert.equal(retainedReplay.recorded, 0);
  db = openDb();
  const completedRetainedRows = db.prepare(`
    SELECT ingest_sequence, segment_index FROM raw_messages
    WHERE session_id = 'retained-raw-session' AND turn_id = 'retained-turn-12'
    ORDER BY role
  `).all();
  assert.equal(completedRetainedRows.length, 2);
  assert.equal(completedRetainedRows.every((row) => row.ingest_sequence === 12 && row.segment_index === 1), true);
  assert.equal(db.prepare("SELECT content_hash FROM memory_segments WHERE id = 'retained-segment-0'").get().content_hash,
    'retained-segment-zero-hash', 'completing or replaying a retained turn must not modify segment zero');
  db.close();

  await post('/api/memory/record-turn', {
    ...settings,
    sessionId: 'archived-only-session',
    turnId: 'first-turn-after-legacy-gc',
    input: 'first new message after upgrading a fully compacted database',
    reply: 'the sealed segment must remain immutable'
  });
  db = openDb();
  const postMigrationRows = db.prepare(`
    SELECT ingest_sequence, segment_index FROM raw_messages
    WHERE session_id = 'archived-only-session' AND turn_id = 'first-turn-after-legacy-gc'
  `).all();
  assert.equal(postMigrationRows.length, 2);
  assert.equal(postMigrationRows.every((row) => row.ingest_sequence === 12 && row.segment_index === 1), true,
    'a sealed legacy segment must advance the migrated cursor even when all raw rows were GCed');
  assert.equal(db.prepare("SELECT content_hash FROM memory_segments WHERE id = 'archived-only-segment-0'").get().content_hash,
    'preserved-sealed-hash');

  const firstTurns = db.prepare(`
    SELECT turn_id, MIN(ingest_sequence) AS ingest_sequence,
      MIN(segment_index) AS min_segment, MAX(segment_index) AS max_segment,
      COUNT(*) AS message_count
    FROM raw_messages WHERE session_id = 'stable-session'
    GROUP BY turn_id ORDER BY ingest_sequence
  `).all();
  assert.deepEqual(firstTurns.map((row) => Number(row.ingest_sequence)), [...Array(12).keys()]);
  assert.equal(firstTurns.every((row) => row.min_segment === 0 && row.max_segment === 0), true);
  assert.equal(firstTurns.every((row) => row.message_count === 2), true);
  const sealedBeforeGc = db.prepare(`
    SELECT id, content_hash, sealed, rollup_hash, rollup_error
    FROM memory_segments
    WHERE session_id = 'stable-session' AND viewer_id = '' AND segment_index = 0
  `).get();
  assert.equal(sealedBeforeGc.sealed, 1);
  assert.equal(sealedBeforeGc.rollup_hash, sealedBeforeGc.content_hash);

  // Model a one-off rollup failure after the compressed segment was safely sealed. Consolidation
  // must repair it even though sealed segments are immutable and no raw write follows.
  db.prepare("DELETE FROM mem_cells WHERE source_memory_id LIKE 'rollup-%'").run();
  db.prepare("DELETE FROM memories WHERE id LIKE 'rollup-%'").run();
  db.prepare("UPDATE memory_segments SET rollup_hash = '', rollup_error = 'simulated first-attempt failure' WHERE id = ?")
    .run(sealedBeforeGc.id);
  db.close();

  const consolidation = await post('/api/memory/consolidate', settings);
  assert.equal(consolidation.rollupsRefreshed >= 1, true, 'consolidation should repair a failed sealed rollup');
  db = openDb();
  const repaired = db.prepare('SELECT content_hash, rollup_hash, rollup_error FROM memory_segments WHERE id = ?')
    .get(sealedBeforeGc.id);
  assert.equal(repaired.rollup_hash, repaired.content_hash);
  assert.equal(repaired.rollup_error, '');

  // Long-running streams must not depend on an operator pressing the consolidate button. A later
  // unrelated turn should repair an aged sealed-segment failure with a bounded background retry.
  db.prepare(`
    UPDATE memory_segments
    SET rollup_hash = '', rollup_error = 'simulated aged retry', updated = '2000-01-01T00:00:00.000Z'
    WHERE id = ?
  `).run(sealedBeforeGc.id);
  db.close();
  const automaticRepair = await post('/api/memory/record-turn', {
    ...settings,
    sessionId: 'repair-trigger-session',
    turnId: 'repair-trigger-turn',
    input: 'keep the livestream active',
    reply: 'repair durable memory in the background'
  });
  assert.equal(automaticRepair.rollups.length >= 1, true, 'a later turn should repair an aged sealed rollup failure');
  db = openDb();
  const automaticallyRepaired = db.prepare('SELECT content_hash, rollup_hash, rollup_error FROM memory_segments WHERE id = ?')
    .get(sealedBeforeGc.id);
  assert.equal(automaticallyRepaired.rollup_hash, automaticallyRepaired.content_hash);
  assert.equal(automaticallyRepaired.rollup_error, '');

  // GC is allowed to remove compacted raw rows. Segment allocation must still continue from the
  // persistent cursor, never rebuild index zero from the remaining raw-row count.
  db.prepare("UPDATE raw_messages SET created = '2000-01-01T00:00:00.000Z', compacted_at = '2020-01-01T00:00:00.000Z' WHERE session_id = 'stable-session'").run();
  db.close();
  const gc = await post('/api/memory/gc', settings);
  assert.equal(gc.gc.rawDeleted, 24);

  const late = await post('/api/memory/record-turn', {
    ...settings,
    sessionId: 'stable-session',
    turnId: 'turn-after-gc',
    // An old/out-of-order wall clock must not move the turn into an old segment.
    at: '1999-01-01T00:00:00.000Z',
    input: 'new message after raw GC',
    reply: 'new reply after raw GC'
  });
  assert.equal(late.recorded, 2);

  db = openDb();
  const lateRows = db.prepare(`
    SELECT ingest_sequence, segment_index FROM raw_messages
    WHERE session_id = 'stable-session' AND turn_id = 'turn-after-gc'
  `).all();
  assert.equal(lateRows.length, 2);
  assert.equal(lateRows.every((row) => row.ingest_sequence === 12 && row.segment_index === 1), true);
  const sealedAfterGc = db.prepare('SELECT content_hash FROM memory_segments WHERE id = ?').get(sealedBeforeGc.id);
  assert.equal(sealedAfterGc.content_hash, sealedBeforeGc.content_hash, 'new turns must not overwrite an old segment');
  const cursor = db.prepare(`
    SELECT next_sequence FROM memory_ingest_cursors
    WHERE session_id = 'stable-session' AND viewer_id = ''
  `).get();
  assert.equal(cursor.next_sequence, 13);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  db.close();
} finally {
  try {
    await fetch(`${baseUrl}/api/memory/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopMilvus: false })
    });
  } catch (_) {
    if (!service.killed) service.kill();
  }
  await Promise.race([
    new Promise((resolve) => service.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]);
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  } catch (_) {
    // Windows can briefly retain SQLite WAL handles after child-process shutdown.
  }
}

console.log('memory segment stability checks passed');
