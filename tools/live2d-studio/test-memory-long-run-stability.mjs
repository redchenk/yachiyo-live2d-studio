import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const serviceScript = path.join(repoRoot, 'tools', 'memory', 'memory-data-service.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-memory-long-run-'));
const dbPath = path.join(tempRoot, 'memory.sqlite');
const personaPath = path.join(tempRoot, 'persona.txt');

fs.writeFileSync(
  personaPath,
  'Yachiyo preserves durable viewer memories across long livestreams and keeps every viewer identity isolated.',
  'utf8'
);

const settings = {
  provider: 'sqlite',
  databasePath: dbPath,
  personaCorpusPath: personaPath,
  milvusEnabled: false,
  milvusManaged: false,
  retrievalMode: 'hybrid',
  writeMode: 'auto-approved',
  maxNotesPerTurn: 8,
  sessionRollupEnabled: true,
  gcEnabled: true,
  gcArchiveDays: 30,
  gcForgetDays: 365,
  rawRetentionDays: 365,
  anchorImportanceThreshold: 0.7,
  embeddingDimension: 64
};

const viewers = [
  {
    identity: { platform: 'bilibili', userId: 'long-run-1001', userName: '小月' },
    identityKey: 'bilibili:long-run-1001',
    preferenceTitle: '小月的长期音乐偏好',
    preferenceText: '小月长期喜欢歌曲 Ray，点歌时优先选择 Ray。',
    query: '小月长期喜欢哪一首歌曲 Ray'
  },
  {
    identity: { platform: 'bilibili', userId: 'long-run-1002', userName: '阿星' },
    identityKey: 'bilibili:long-run-1002',
    preferenceTitle: '阿星的长期饮品偏好',
    preferenceText: '阿星长期喜欢茉莉花茶，不喜欢太甜的饮料。',
    query: '阿星长期喜欢什么饮品 茉莉花茶'
  },
  {
    identity: { platform: 'bilibili', userId: 'long-run-1003', userName: '小雨' },
    identityKey: 'bilibili:long-run-1003',
    preferenceTitle: '小雨的长期称呼偏好',
    preferenceText: '小雨希望八千代一直称呼她为雨酱。',
    query: '小雨希望长期被称为什么 雨酱'
  }
];

const sessionCount = 4;
const turnsPerViewerPerSession = 50;
const batchSize = 10;
const expectedTurns = sessionCount * viewers.length * turnsPerViewerPerSession;
const expectedRawMessages = expectedTurns * 2;
const expectedInteractionsPerViewer = sessionCount * turnsPerViewerPerSession;
const expectedSegments = sessionCount * viewers.length * Math.ceil(turnsPerViewerPerSession / 12);
const allTurns = [];
const recordDurations = [];
let service = null;
let stderr = '';
let baseUrl = '';
let cumulativeRollups = 0;
let restartCount = 0;

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

async function startService({ restart = false } = {}) {
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
    if (service.exitCode !== null) {
      throw new Error(`memory service exited during startup (${service.exitCode}): ${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        if (restart) restartCount += 1;
        return;
      }
    } catch (_) {
      // The listener is not ready yet.
    }
    await sleep(80);
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
    // A forceful cleanup below still guarantees no child process survives the test.
  }
  await Promise.race([
    new Promise((resolve) => service.once('exit', resolve)),
    sleep(3000)
  ]);
  if (service.exitCode === null) {
    service.kill();
    await Promise.race([
      new Promise((resolve) => service.once('exit', resolve)),
      sleep(1000)
    ]);
  }
  service = null;
}

async function restartService() {
  await stopService();
  await startService({ restart: true });
  const reopened = await post('/api/memory/init', settings);
  assert.equal(reopened.organization.integrity, 'ok', 'organization must remain sound after service restart');
  assert.equal(reopened.vectorHealth.invalidNotes, 0, 'note vectors must remain valid after service restart');
  assert.equal(reopened.vectorHealth.invalidCells, 0, 'cell vectors must remain valid after service restart');
  assert.equal(reopened.vectorHealth.compatible, true, 'stored vectors must remain compatible after service restart');
}

function makeTurns(sessionIndex, viewerIndex) {
  const viewer = viewers[viewerIndex];
  return Array.from({ length: turnsPerViewerPerSession }, (_, turnIndex) => {
    const ordinal = sessionIndex * turnsPerViewerPerSession + turnIndex + 1;
    return {
      sessionId: `long-stream-${sessionIndex + 1}`,
      turnId: `viewer-${viewerIndex + 1}-session-${sessionIndex + 1}-turn-${turnIndex + 1}`,
      input: `${viewer.identity.userName} 的长期直播互动 ${ordinal}：记住稳定的个人偏好。`,
      reply: `已经记录 ${viewer.identity.userName} 的第 ${ordinal} 次互动。`,
      viewer: viewer.identity,
      eventType: 'danmu',
      source: 'bilibili',
      emotion: 'attentive'
    };
  });
}

async function recordBatch(turns) {
  const startedAt = performance.now();
  const response = await post('/api/memory/record-turn', { ...settings, turns });
  recordDurations.push(performance.now() - startedAt);
  cumulativeRollups += response.rollups.length;
  assert.equal(response.recorded, turns.length * 2, 'each new turn must durably store both user and assistant rows');
  assert.equal(response.viewerProfilesUpdated, turns.length, 'each new viewer turn must update its profile exactly once');
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

const testStartedAt = performance.now();

try {
  await startService();
  const initialized = await post('/api/memory/init', settings);
  assert.equal(initialized.organization.integrity, 'ok');
  assert.equal(initialized.vectorHealth.compatible, true);

  for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
    for (let viewerIndex = 0; viewerIndex < viewers.length; viewerIndex += 1) {
      const turns = makeTurns(sessionIndex, viewerIndex);
      allTurns.push(...turns);
      for (let offset = 0; offset < turns.length; offset += batchSize) {
        await recordBatch(turns.slice(offset, offset + batchSize));
      }
    }
    if (sessionIndex === 0) {
      for (const viewer of viewers) {
        const written = await post('/api/memory/write', {
          ...settings,
          memory: {
            type: 'viewer',
            scope: 'relationship',
            title: viewer.preferenceTitle,
            text: viewer.preferenceText,
            facts: [viewer.preferenceText],
            tags: ['long-run', 'viewer-preference'],
            importance: 0.86,
            confidence: 0.94,
            viewer: viewer.identity,
            idempotencyKey: `long-run-preference-${viewer.identity.userId}`
          }
        });
        assert.equal(Boolean(written.id), true, 'durable viewer preference should be written');
      }
    }
    if (sessionIndex < sessionCount - 1) await restartService();
  }

  assert.equal(restartCount, 3, 'the same SQLite memory must survive at least three complete service restarts');
  assert.equal(allTurns.length, expectedTurns, 'the stress fixture must exercise at least 600 turns');

  for (let offset = 0; offset < allTurns.length; offset += 200) {
    const replay = allTurns.slice(offset, offset + 200);
    const response = await post('/api/memory/record-turn', { ...settings, turns: replay });
    assert.equal(response.recorded, 0, 'replayed platform events must not duplicate raw rows');
    assert.equal(response.viewerProfilesUpdated, 0, 'replayed platform events must not inflate viewer counters');
    assert.equal(response.rollups.length, 0, 'idempotent replay must not regenerate session rollups');
  }

  const organized = await post('/api/memory/consolidate', settings);
  assert.equal(organized.organization.integrity, 'ok', 'long-run organization integrity must remain ok');
  assert.equal(organized.organization.viewers, viewers.length, 'all viewers should remain independently organized');
  assert.equal(organized.organization.segments, expectedSegments, 'every session/viewer transcript should produce exact segments');
  assert.equal(organized.organization.rawMessages, expectedRawMessages, 'raw message count must remain exact after replay');
  assert.equal(organized.vectorHealth.compatible, true, 'consolidated vector metadata must remain compatible');
  assert.equal(organized.vectorHealth.invalidNotes, 0);
  assert.equal(organized.vectorHealth.invalidCells, 0);
  assert.equal(
    organized.rollupsRefreshed <= sessionCount * viewers.length,
    true,
    'consolidation should refresh at most the single open tail segment for each session/viewer pair'
  );

  const rollupUpperBound = expectedSegments * 2 + sessionCount * viewers.length;
  assert.equal(
    cumulativeRollups <= rollupUpperBound,
    true,
    `sealed transcript segments were repeatedly recomputed: ${cumulativeRollups} rollups for ${expectedSegments} segments (limit ${rollupUpperBound})`
  );

  for (const viewer of viewers) {
    const profile = await post('/api/memory/profile', {
      ...settings,
      viewerIds: [viewer.identityKey]
    });
    assert.equal(profile.organization.integrity, 'ok');
    assert.equal(profile.viewers.length, 1, 'viewer lookup must return only the requested identity');
    assert.equal(profile.viewers[0].identityKey, viewer.identityKey);
    assert.equal(profile.viewers[0].interactionCount, expectedInteractionsPerViewer, 'event replay must not inflate interaction count');

    const recall = await post('/api/memory/search', {
      ...settings,
      query: {
        text: viewer.query,
        viewerIds: [viewer.identityKey],
        retrievalMode: 'hybrid',
        maxNotes: 8
      }
    });
    assert.equal(recall.vectorHealth.compatible, true, 'reopened search vectors must remain compatible');
    assert.equal(recall.recollection.viewers.length, 1);
    assert.equal(recall.recollection.viewers[0].identityKey, viewer.identityKey);
    assert.equal(
      recall.notes.some((note) => note.title === viewer.preferenceTitle),
      true,
      `${viewer.preferenceTitle} must remain searchable after repeated restarts and consolidation`
    );
    for (const otherViewer of viewers.filter((candidate) => candidate !== viewer)) {
      assert.equal(
        recall.notes.some((note) => note.title === otherViewer.preferenceTitle),
        false,
        `memory from ${otherViewer.identityKey} leaked into ${viewer.identityKey}`
      );
    }
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const integrityRows = db.pragma('integrity_check');
    assert.equal(
      integrityRows.every((row) => String(row.integrity_check || '').toLowerCase() === 'ok'),
      true,
      `SQLite integrity_check failed: ${JSON.stringify(integrityRows)}`
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM raw_messages').get().count, expectedRawMessages);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memory_segments').get().count, expectedSegments);
    const profileRows = db.prepare('SELECT id, interaction_count FROM viewer_profiles ORDER BY id').all();
    assert.equal(profileRows.length, viewers.length);
    assert.equal(
      profileRows.every((row) => row.interaction_count === expectedInteractionsPerViewer),
      true,
      `viewer interaction counters drifted: ${JSON.stringify(profileRows)}`
    );
  } finally {
    db.close();
  }

  const totalDurationMs = performance.now() - testStartedAt;
  const p95RecordMs = percentile(recordDurations, 0.95);
  console.log(
    `memory long-run stability checks passed: ${expectedTurns} turns, ${restartCount} restarts, `
    + `${expectedSegments} segments, ${cumulativeRollups} rollups, `
    + `record p95=${p95RecordMs.toFixed(1)}ms, total=${(totalDurationMs / 1000).toFixed(1)}s`
  );
} finally {
  await stopService();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
