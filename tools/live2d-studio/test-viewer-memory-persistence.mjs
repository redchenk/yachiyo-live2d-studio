import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const serviceScript = path.join(repoRoot, 'tools', 'memory', 'memory-data-service.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-viewer-memory-'));
const dbPath = path.join(tempRoot, 'memory.sqlite');
const personaPath = path.join(tempRoot, 'persona.txt');
const port = 38200 + Math.floor(Math.random() * 700);
const baseUrl = `http://127.0.0.1:${port}`;

fs.writeFileSync(personaPath, 'Yachiyo keeps durable viewer memories separated by trusted platform identity.', 'utf8');

const settings = {
  provider: 'sqlite',
  databasePath: dbPath,
  personaCorpusPath: personaPath,
  milvusEnabled: false,
  milvusManaged: false,
  retrievalMode: 'hybrid',
  writeMode: 'auto-approved',
  maxNotesPerTurn: 6,
  sessionRollupEnabled: true,
  gcEnabled: true,
  rawRetentionDays: 7,
  embeddingDimension: 64
};

const alice = { platform: 'bilibili', userId: '1001', userName: '小月' };
const bob = { platform: 'bilibili', userId: '1002', userName: '阿星' };
let service = null;
let stderr = '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startService() {
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
  service.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch (_) {
      await sleep(80);
    }
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
  await post('/api/memory/shutdown', { stopMilvus: false });
  await Promise.race([
    new Promise((resolve) => service.once('exit', resolve)),
    sleep(3000)
  ]);
  if (service.exitCode === null) service.kill();
}

try {
  await startService();
  const init = await post('/api/memory/init', settings);
  assert.equal(init.vectorHealth.invalidNotes, 0, 'fresh note vectors should be valid');
  assert.equal(init.vectorHealth.invalidCells, 0, 'fresh cell vectors should be valid');

  const viewerBatch = await post('/api/memory/record-turn', {
    ...settings,
    turns: [
      {
        sessionId: 'stream-2026-07-29',
        turnId: 'alice-1',
        input: '我叫小月，我最喜欢 Ray，下次还想听这首歌。',
        viewer: alice,
        eventType: 'danmu',
        source: 'bilibili'
      },
      {
        sessionId: 'stream-2026-07-29',
        turnId: 'bob-1',
        input: '我是阿星，我喜欢同桌的你。',
        viewer: bob,
        eventType: 'danmu',
        source: 'bilibili'
      }
    ]
  });
  assert.equal(viewerBatch.viewerProfilesUpdated, 2, 'each trusted viewer should receive an independent profile');

  await post('/api/memory/record-turn', {
    ...settings,
    turns: Array.from({ length: 12 }, (_, index) => ({
      sessionId: 'stream-2026-07-29',
      turnId: `alice-followup-${index}`,
      input: `小月的连续互动 ${index + 1}，仍然想听 Ray。`,
      viewer: alice,
      eventType: 'danmu',
      source: 'bilibili'
    }))
  });

  const writeBody = {
    ...settings,
    memory: {
      type: 'viewer',
      scope: 'relationship',
      title: '小月的点歌偏好',
      text: '小月明确表示最喜欢 Ray。',
      facts: ['小月最喜欢 Ray。'],
      tags: ['music', 'preference'],
      importance: 0.84,
      confidence: 0.92,
      viewer: alice,
      idempotencyKey: 'bilibili-1001-ray-preference-v1'
    }
  };
  const firstWrite = await post('/api/memory/write', writeBody);
  const retriedWrite = await post('/api/memory/write', writeBody);
  assert.equal(retriedWrite.id, firstWrite.id, 'retried durable writes must be idempotent');
  const writtenList = await post('/api/memory/list', { ...settings, maxNotes: 100 });
  const writtenCell = writtenList.cells.find((cell) => cell.title === '小月的点歌偏好');
  assert.equal(Boolean(writtenCell?.viewerId), true, `viewer cell was not persisted: ${writtenList.cells.map((cell) => cell.title).join(' | ')}`);

  const aliceProfile = await post('/api/memory/profile', {
    ...settings,
    viewerIds: ['bilibili:1001']
  });
  assert.equal(aliceProfile.viewers.length, 1, 'profile lookup should return only the requested viewer');
  assert.equal(aliceProfile.viewers[0].platformUserId, '1001');
  assert.equal(aliceProfile.viewers[0].displayName, '小月');
  assert.equal(aliceProfile.viewers[0].interactionCount, 13);
  assert.equal(aliceProfile.viewers[0].topics.some((topic) => /ray/i.test(topic)), true, 'viewer profile should retain durable topic hints');

  const aliceRecall = await post('/api/memory/search', {
    ...settings,
    query: {
      text: '这个观众喜欢听什么歌？',
      viewerIds: ['bilibili:1001'],
      retrievalMode: 'hybrid',
      maxNotes: 6
    }
  });
  assert.equal(aliceRecall.recollection.viewers.length, 1);
  assert.equal(aliceRecall.recollection.viewers[0].platformUserId, '1001');
  assert.equal(
    aliceRecall.notes.some((note) => note.title === '小月的点歌偏好'),
    true,
    `Alice preference was missing from recall: notes=${aliceRecall.notes.map((note) => note.title).join(' | ')} cells=${aliceRecall.recollection.cells.map((cell) => cell.title).join(' | ')} anchors=${aliceRecall.recollection.anchors.map((anchor) => anchor.label).join(' | ')}`
  );
  assert.equal(aliceRecall.vectorHealth.compatible, true, 'query and stored vectors should have compatible signatures');

  const bobRecall = await post('/api/memory/search', {
    ...settings,
    query: {
      text: '这个观众喜欢听什么歌？',
      viewerIds: ['bilibili:1002'],
      retrievalMode: 'hybrid',
      maxNotes: 6
    }
  });
  assert.equal(bobRecall.notes.some((note) => note.title === '小月的点歌偏好'), false, 'viewer memories must never leak across profiles');

  const organized = await post('/api/memory/consolidate', settings);
  assert.equal(organized.organization.segments >= 1, true, 'long streams should create durable transcript segments');
  assert.equal(organized.organization.integrity, 'ok');

  await stopService();

  const db = new Database(dbPath);
  db.prepare("UPDATE mem_cells SET vector_json = '[]', embedding_signature = '' WHERE viewer_id != ''").run();
  db.close();

  await startService();
  const lazyRepairedRecall = await post('/api/memory/search', {
    ...settings,
    query: {
      text: 'Ray 点歌偏好',
      viewerIds: ['bilibili:1001'],
      retrievalMode: 'hybrid',
      maxNotes: 6
    }
  });
  assert.equal(lazyRepairedRecall.vectorHealth.compatible, true, 'first search after reopen should lazily repair the vector index');
  const repairedDb = new Database(dbPath, { readonly: true });
  const repairedViewerCells = repairedDb.prepare("SELECT vector_json, embedding_signature FROM mem_cells WHERE viewer_id != ''").all();
  repairedDb.close();
  assert.equal(
    repairedViewerCells.every((row) => JSON.parse(row.vector_json || '[]').length === 64 && row.embedding_signature === 'hash-v2:64'),
    true,
    'lazy reopen repair should persist compatible viewer cell vectors'
  );

  const reopened = await post('/api/memory/init', settings);
  assert.equal(reopened.vectorHealth.invalidCells, 0);

  const restoredProfile = await post('/api/memory/profile', {
    ...settings,
    viewerIds: ['bilibili:1001']
  });
  assert.equal(restoredProfile.viewers[0].displayName, '小月', 'viewer profile must survive a full service restart');
  assert.equal(restoredProfile.viewers[0].interactionCount, 13, 'restart must not duplicate or reset viewer counters');

  const restoredRecall = await post('/api/memory/search', {
    ...settings,
    query: {
      text: 'Ray 点歌偏好',
      viewerIds: ['bilibili:1001'],
      retrievalMode: 'hybrid',
      maxNotes: 6
    }
  });
  assert.equal(restoredRecall.notes.some((note) => note.title === '小月的点歌偏好'), true, 'semantic viewer memory must remain searchable after restart');

  await stopService();
  console.log('viewer memory persistence checks passed');
} finally {
  if (service && service.exitCode === null) service.kill();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
