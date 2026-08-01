import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const serviceScript = path.join(repoRoot, 'tools', 'memory', 'memory-data-service.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-memory-large-scale-'));
const dbPath = path.join(tempRoot, 'memory.sqlite');
const personaPath = path.join(tempRoot, 'persona.txt');

fs.writeFileSync(personaPath, 'Yachiyo keeps long-term viewer memory isolated by stable platform identity.', 'utf8');

const settings = {
  provider: 'sqlite',
  databasePath: dbPath,
  personaCorpusPath: personaPath,
  milvusEnabled: false,
  milvusManaged: false,
  retrievalMode: 'tags',
  writeMode: 'auto-approved',
  maxNotes: 8,
  sessionRollupEnabled: true,
  gcEnabled: false,
  embeddingDimension: 64
};

const targetViewer = { platform: 'bilibili', userId: 'large-scale-target', userName: 'Target Viewer' };
const viewerAlpha = { platform: 'bilibili', userId: 'conflict-alpha', userName: 'Viewer Alpha' };
const viewerBeta = { platform: 'bilibili', userId: 'conflict-beta', userName: 'Viewer Beta' };
const globalMemoryCount = 50_025;
const embeddingSignature = 'hash-v2:64';
const unitVectorJson = JSON.stringify([1, ...new Array(63).fill(0)]);

let service = null;
let baseUrl = '';
let stderr = '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function startService() {
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  stderr = '';
  service = spawn(process.execPath, [serviceScript, '--port', String(port), '--repo-root', repoRoot], {
    cwd: repoRoot,
    env: {
      ...process.env,
      YACHIYO_MEMORY_AUTOSTART_MANAGED_MILVUS: '0',
      YACHIYO_PERSONA_CORPUS_PATH: personaPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  service.stdout.on('data', () => {});
  service.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (service.exitCode !== null) throw new Error(`memory service exited (${service.exitCode}): ${stderr}`);
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch (_) {
      // The listener is still starting.
    }
    await sleep(60);
  }
  throw new Error(`memory service did not start: ${stderr}`);
}

async function post(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `${route} failed: ${JSON.stringify(payload)} ${stderr}`);
  assert.equal(payload.success, true, `${route} payload failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function stopService() {
  if (!service || service.exitCode !== null) return;
  try {
    await post('/api/memory/shutdown', { stopMilvus: false });
  } catch (_) {
    // Forceful cleanup below is sufficient for this isolated test database.
  }
  await Promise.race([
    new Promise((resolve) => service.once('exit', resolve)),
    sleep(2500)
  ]);
  if (service.exitCode === null) service.kill();
  service = null;
}

async function writeViewerMemory(viewer, idempotencyKey, title, text) {
  return post('/api/memory/write', {
    ...settings,
    memory: {
      type: 'viewer',
      scope: 'relationship',
      title,
      text,
      episode: text,
      facts: [text],
      tags: ['viewer', 'preference', 'ray'],
      importance: 0.86,
      confidence: 0.94,
      viewer,
      idempotencyKey
    }
  });
}

function seedGlobalMemories() {
  const db = new Database(dbPath);
  const updated = '2030-01-01T00:00:00.000Z';
  const insertNote = db.prepare(`
    INSERT INTO memories (
      id, title, type, scope, tags_json, summary, content, source, path,
      importance, confidence, disabled, deleted, review_status, updated,
      content_hash, vector_json, last_recalled, recall_count, viewer_id,
      embedding_signature, vector_dimension
    ) VALUES (
      @id, @title, 'memory', 'long_term', '[]', @summary, @content, 'runtime', @path,
      0.2, 0.5, 0, 0, 'approved', @updated,
      @contentHash, @vectorJson, '', 0, '', @embeddingSignature, 64
    )
  `);
  const insertCell = db.prepare(`
    INSERT INTO mem_cells (
      id, title, type, scope, episode, facts_json, foresight_json,
      source_turn_ids_json, source_memory_id, source, scene_id, importance,
      confidence, status, valid_from, valid_until, created, updated,
      content_hash, vector_json, pinned, decay_score, last_recalled,
      recall_count, viewer_id, embedding_signature, vector_dimension
    ) VALUES (
      @cellId, @title, 'memory', 'long_term', @content, '[]', '[]',
      '[]', @id, 'runtime', '', 0.2,
      0.5, 'active', @updated, '', @updated, @updated,
      @contentHash, @vectorJson, 0, 0, '',
      0, '', @embeddingSignature, 64
    )
  `);
  const insertAll = db.transaction(() => {
    for (let index = 0; index < globalMemoryCount; index += 1) {
      const suffix = String(index).padStart(6, '0');
      const row = {
        id: `bulk-global-${suffix}`,
        cellId: `bulk-cell-${suffix}`,
        title: `Bulk global memory ${suffix}`,
        summary: `Unrelated global memory ${suffix}`,
        content: `Unrelated global memory payload ${suffix}`,
        path: `runtime/bulk-global-${suffix}.md`,
        updated,
        contentHash: `bulk-hash-${suffix}`,
        vectorJson: unitVectorJson,
        embeddingSignature
      };
      insertNote.run(row);
      insertCell.run(row);
    }
    db.prepare(`
      INSERT INTO memory_meta (key, value, updated)
      VALUES ('vector-health', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated
    `).run(JSON.stringify({
      signature: embeddingSignature,
      dimension: 64,
      checkedAt: new Date().toISOString(),
      invalidNotes: 0,
      invalidCells: 0,
      compatible: true
    }), new Date().toISOString());
  });

  try {
    insertAll();
    const counts = {
      notes: db.prepare('SELECT COUNT(*) AS count FROM memories').get().count,
      cells: db.prepare('SELECT COUNT(*) AS count FROM mem_cells').get().count
    };
    assert.equal(counts.notes > 50_000, true, `fixture did not cross the 50k note boundary: ${counts.notes}`);
    assert.equal(counts.cells > 50_000, true, `fixture did not cross the 50k cell boundary: ${counts.cells}`);
  } finally {
    db.close();
  }
}

try {
  await startService();
  await post('/api/memory/init', settings);

  const target = await writeViewerMemory(
    targetViewer,
    'large-scale-older-viewer-memory',
    'Target Viewer vintage starlight preference',
    'Target Viewer has a durable vintage starlight preference that must remain searchable.'
  );
  const alpha = await writeViewerMemory(
    viewerAlpha,
    'cross-viewer-conflict-alpha',
    'Ray playback preference',
    'Viewer Alpha likes Ray music and asks to hear Ray.'
  );
  const beta = await writeViewerMemory(
    viewerBeta,
    'cross-viewer-conflict-beta',
    'Ray playback preference',
    'Viewer Beta says do not play Ray music for them.'
  );
  const crossViewerConflict = (beta.lifecycle?.conflicts || []).some((conflict) => (
    conflict.leftCellId === alpha.lifecycle?.cell?.id ||
    conflict.rightCellId === alpha.lifecycle?.cell?.id
  ));

  await stopService();
  seedGlobalMemories();
  await startService();

  const recall = await post('/api/memory/search', {
    ...settings,
    query: {
      text: 'vintage starlight preference',
      tags: ['vintage', 'starlight'],
      viewerIds: ['bilibili:large-scale-target'],
      retrievalMode: 'tags',
      maxNotes: 8
    }
  });
  const targetStillSearchable = recall.notes.some((note) => note.id === target.id);

  assert.deepEqual(
    { targetStillSearchable, crossViewerConflict },
    { targetStillSearchable: true, crossViewerConflict: false },
    'viewer-scoped memory must survive the 50k global boundary and conflicts must remain viewer-isolated'
  );

  console.log(`large-scale viewer isolation checks passed: ${globalMemoryCount} global memories`);
} finally {
  await stopService();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
