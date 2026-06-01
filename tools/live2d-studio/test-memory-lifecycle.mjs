import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const serviceScript = path.join(repoRoot, 'tools', 'memory', 'memory-data-service.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-memory-lifecycle-'));
const dbPath = path.join(tempRoot, 'memory.sqlite');
const personaPath = path.join(tempRoot, 'persona.txt');
const port = 37200 + Math.floor(Math.random() * 1000);

fs.writeFileSync(personaPath, [
  'Yachiyo persona luminous anchorphrase.',
  '',
  'The phrase luminous anchorphrase belongs to the stable persona corpus.',
  'Yachiyo treats durable memories as stage lights that can be recalled later.'
].join('\n'), 'utf8');

const service = spawn(process.execPath, [
  serviceScript,
  '--port',
  String(port),
  '--repo-root',
  repoRoot
], {
  cwd: repoRoot,
  env: {
    ...process.env,
    YACHIYO_MEMORY_AUTOSTART_MANAGED_MILVUS: '0',
    YACHIYO_PERSONA_CORPUS_PATH: personaPath
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stderr = '';
service.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const baseUrl = `http://127.0.0.1:${port}`;
const settings = {
  provider: 'sqlite-milvus',
  databasePath: dbPath,
  personaCorpusPath: personaPath,
  milvusEnabled: false,
  milvusManaged: false,
  retrievalMode: 'hybrid',
  writeMode: 'auto-approved',
  maxNotesPerTurn: 5,
  sessionRollupEnabled: true,
  gcEnabled: true,
  gcArchiveDays: 1,
  gcForgetDays: 7,
  rawRetentionDays: 7,
  anchorImportanceThreshold: 0.7,
  embeddingDimension: 64
};

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForService() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch (_) {
      await sleep(100);
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

try {
  await waitForService();

  const init = await post('/api/memory/init', settings);
  assert.equal(init.imported.persona > 0, true, 'persona corpus should be imported');
  assert.equal(init.lifecycle.anchors > 0, true, 'persona cells should create anchors');

  const personaSearch = await post('/api/memory/search', {
    ...settings,
    query: {
      text: 'luminous anchorphrase',
      retrievalMode: 'hybrid',
      maxNotes: 5
    }
  });
  assert.equal(
    personaSearch.notes.some((note) => String(note.summary || note.content || '').includes('luminous anchorphrase')),
    true,
    'persona search should recall imported corpus text'
  );

  const turn = await post('/api/memory/record-turn', {
    ...settings,
    sessionId: 'session-lifecycle-test',
    turnId: 'turn-one-minute-decision',
    input: '记住关键事件：自动发言间隔决定固定为一分钟。',
    reply: '我会把自动发言间隔当成一分钟的稳定决定。',
    emotion: 'focused'
  });
  assert.equal(Boolean(turn.rollup?.cell?.id), true, 'record-turn should update a persistent session rollup cell');

  const written = await post('/api/memory/write', {
    ...settings,
    memory: {
      type: 'session',
      scope: 'long_term',
      title: 'One minute autonomous speech interval',
      text: 'Key event: the autonomous speaking interval is now fixed to one minute.',
      facts: ['The autonomous speaking interval is one minute.'],
      tags: ['decision', 'key-event'],
      importance: 0.92,
      confidence: 0.88
    }
  });
  assert.equal(Boolean(written.lifecycle.anchor?.id), true, 'important write should be anchored');

  const anchors = await post('/api/memory/anchors', { ...settings, maxItems: 40 });
  assert.equal(
    anchors.anchors.some((anchor) => anchor.label === 'One minute autonomous speech interval'),
    true,
    'anchor list should expose key event anchors'
  );

  const recall = await post('/api/memory/search', {
    ...settings,
    query: {
      text: 'what is the autonomous speaking interval decision?',
      retrievalMode: 'hybrid',
      maxNotes: 5
    }
  });
  assert.equal(
    recall.recollection.anchors.some((anchor) => anchor.label === 'One minute autonomous speech interval'),
    true,
    'search should recall key event through anchor scoring'
  );

  await post('/api/memory/write', {
    ...settings,
    memory: {
      type: 'session',
      scope: 'session',
      title: 'Disposable expired scratch note',
      text: 'Temporary scratch note that should be collected.',
      importance: 0.2,
      confidence: 0.4,
      validUntil: '2000-01-01T00:00:00.000Z'
    }
  });
  const gc = await post('/api/memory/gc', settings);
  assert.equal(
    (gc.gc.archived || 0) + (gc.gc.forgotten || 0) > 0,
    true,
    'GC should archive or forget expired low-value memory'
  );

  const list = await post('/api/memory/list', { ...settings, includeDisabled: true, maxNotes: 100 });
  assert.equal(list.anchors.length > 0, true, 'list should include anchors');
  assert.equal(
    list.cells.some((cell) => cell.title === 'Disposable expired scratch note'),
    false,
    'expired scratch cell should not remain active after GC'
  );

  await post('/api/memory/shutdown', { stopMilvus: false });
  console.log('Memory lifecycle test passed');
} finally {
  if (!service.killed) service.kill();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
