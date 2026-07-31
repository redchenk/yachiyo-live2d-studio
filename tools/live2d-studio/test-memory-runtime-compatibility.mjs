import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const serviceScript = path.join(repoRoot, 'tools', 'memory', 'memory-data-service.mjs');
const runtimeProbeScript = path.join(repoRoot, 'tools', 'memory', 'check-memory-runtime.mjs');
const bundledNodeCandidates = [
  path.join(repoRoot, 'tools', 'node-v22.11.0-win-x64', 'node.exe'),
  path.resolve(repoRoot, '..', 'tools', 'node-v22.11.0-win-x64', 'node.exe'),
  path.resolve(repoRoot, '..', '.codex_tmp', 'node-v22.11.0-win-x64', 'node.exe')
];
const bundledNode = bundledNodeCandidates.find((candidate) => fs.existsSync(candidate));

assert.ok(bundledNode, 'the launcher-priority bundled Node 22 runtime must be available for this compatibility check');

const runtimeCandidates = [
  ...bundledNodeCandidates,
  ...String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory.replace(/^"|"$/g, ''), 'node.exe'))
].filter((candidate, index, all) => fs.existsSync(candidate) && all.indexOf(candidate) === index);

function probeMemoryRuntime(nodeExecutable) {
  return spawnSync(nodeExecutable, [runtimeProbeScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true
  });
}

const compatibleNode = runtimeCandidates.find((candidate) => probeMemoryRuntime(candidate).status === 0);
assert.ok(compatibleNode, 'the launcher must find at least one Node runtime compatible with better-sqlite3');

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, process, stderr) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (process.exitCode !== null) {
      throw new Error(`memory sidecar exited before health check: ${stderr()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return response.json();
    } catch (_) {
      // The random loopback port is not ready yet.
    }
    await sleep(60);
  }
  throw new Error(`memory sidecar did not become healthy: ${stderr()}`);
}

async function stopSidecar(process, baseUrl) {
  if (!process || process.exitCode !== null) return;
  try {
    await fetch(`${baseUrl}/api/memory/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopMilvus: false }),
      signal: AbortSignal.timeout(1_500)
    });
  } catch (_) {
    // Process termination below is the deterministic cleanup fallback.
  }
  await Promise.race([
    new Promise((resolve) => process.once('exit', resolve)),
    sleep(1_500)
  ]);
  if (process.exitCode === null) process.kill();
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-memory-runtime-'));
const databasePath = path.join(tempRoot, 'memory.sqlite');
const personaPath = path.join(tempRoot, 'persona.txt');
const port = await reserveLoopbackPort();
const baseUrl = `http://127.0.0.1:${port}`;
fs.writeFileSync(personaPath, 'Runtime compatibility probe persona.', 'utf8');

let stderr = '';
let sidecar = null;

try {
  sidecar = spawn(compatibleNode, [serviceScript, '--port', String(port), '--repo-root', repoRoot], {
    cwd: repoRoot,
    env: {
      ...process.env,
      YACHIYO_MEMORY_AUTOSTART_MANAGED_MILVUS: '0',
      YACHIYO_PERSONA_CORPUS_PATH: personaPath
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  sidecar.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-12_000);
  });

  const health = await waitForHealth(baseUrl, sidecar, () => stderr);
  const turnResponse = await fetch(`${baseUrl}/api/memory/record-turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'sqlite',
      databasePath,
      personaCorpusPath: personaPath,
      milvusEnabled: false,
      milvusManaged: false,
      retrievalMode: 'hybrid',
      writeMode: 'auto-approved',
      sessionRollupEnabled: true,
      embeddingDimension: 64,
      sessionId: 'runtime-probe-session',
      turnId: 'runtime-probe-turn',
      input: 'Remember this runtime probe.',
      reply: 'Runtime probe acknowledged.'
    })
  });
  const turn = await turnResponse.json().catch(() => ({}));

  assert.deepEqual(
    {
      sqliteReady: health.sqliteReady === true,
      runtimeProbeReady: probeMemoryRuntime(compatibleNode).status === 0,
      recordTurnReady: turnResponse.ok && turn.success === true,
      databaseCreated: fs.existsSync(databasePath)
    },
    {
      sqliteReady: true,
      runtimeProbeReady: true,
      recordTurnReady: true,
      databaseCreated: true
    },
    'the launcher-selected compatible Node must expose an honest SQLite health signal and persist a memory turn'
  );
} finally {
  await stopSidecar(sidecar, baseUrl);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('memory runtime compatibility checks passed');
