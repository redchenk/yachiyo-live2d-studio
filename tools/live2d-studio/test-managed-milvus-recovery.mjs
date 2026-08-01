import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const serviceScript = path.join(repoRoot, 'tools', 'memory', 'memory-data-service.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-milvus-recovery-'));
const localAppData = path.join(tempRoot, 'local-app-data');
const databasePath = path.join(tempRoot, 'memory.sqlite');
const fakeStatePath = path.join(tempRoot, 'fake-docker-state.json');
const fakeDockerScript = path.join(tempRoot, 'fake-docker.mjs');
let service = null;
let mockMilvus = null;
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

fs.writeFileSync(fakeDockerScript, String.raw`
import fs from 'node:fs';

const statePath = process.env.YACHIYO_TEST_DOCKER_STATE;
const args = process.argv.slice(2);
let state = { exists: false, running: false, runCount: 0, rmCount: 0, stopCount: 0, startCount: 0 };
try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; } catch (_) {}
const save = () => fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
const command = args[0] || '';

if (command === 'info') {
  save();
  process.stdout.write('27.5.1\n');
} else if (command === 'inspect') {
  if (!state.exists) {
    process.stderr.write('Error: No such object: yachiyo-milvus-standalone\n');
    process.exitCode = 1;
  } else {
    const exited = state.runCount === 1;
    process.stdout.write(JSON.stringify([{
      Config: {
        Env: ['ETCD_USE_EMBED=true'],
        Image: state.image
      },
      Mounts: [
        { Destination: '/var/lib/milvus', Source: state.volumePath },
        { Destination: '/milvus/configs/embedEtcd.yaml', Source: state.volumePath + '/embedEtcd.yaml' }
      ],
      State: {
        Running: !exited,
        Restarting: false,
        Status: exited ? 'exited' : 'running',
        ExitCode: exited ? 134 : 0,
        OOMKilled: false,
        Error: '',
        Health: { Status: exited ? 'unhealthy' : 'healthy' }
      },
      NetworkSettings: { Ports: { '19530/tcp': [{ HostPort: String(state.hostPort) }] } },
      RestartCount: exited ? 2 : 0,
      Image: 'sha256:fake-milvus-v2.6.13'
    }]));
  }
} else if (command === 'run') {
  state.runCount += 1;
  state.exists = true;
  state.running = state.runCount >= 2;
  state.image = args.at(-4);
  const portArg = args.find((arg) => /:19530$/.test(arg));
  state.hostPort = Number(String(portArg || '').split(':')[0]);
  const volumeArg = args.find((arg) => /:\/var\/lib\/milvus$/.test(arg));
  state.volumePath = String(volumeArg || '').replace(/:\/var\/lib\/milvus$/, '');
  if (state.runCount === 1) state.originalVolumePath = state.volumePath;
  save();
  process.stdout.write('fake-container-id\n');
} else if (command === 'logs') {
  process.stderr.write('panic: etcdserver: leader changed\n');
} else if (command === 'rm') {
  state.rmCount += 1;
  state.exists = false;
  state.running = false;
  save();
} else if (command === 'stop') {
  state.stopCount += 1;
  state.running = false;
  save();
} else if (command === 'start') {
  state.startCount += 1;
  state.exists = true;
  state.running = true;
  save();
  process.stdout.write('yachiyo-milvus-standalone\n');
} else {
  process.stderr.write('Unexpected fake docker command: ' + args.join(' ') + '\n');
  process.exitCode = 2;
}
`, 'utf8');

const servicePort = await reservePort();
const milvusPort = await reservePort();
const baseUrl = `http://127.0.0.1:${servicePort}`;
const milvusRequests = [];

mockMilvus = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    milvusRequests.push({ url: req.url, body });
    let fakeState = {};
    try { fakeState = JSON.parse(fs.readFileSync(fakeStatePath, 'utf8')); } catch (_) {}
    const ready = Number(fakeState.runCount) >= 2;
    if (!ready) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 1, message: 'not ready' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 0, data: [] }));
  });
});
await new Promise((resolve, reject) => {
  mockMilvus.once('error', reject);
  mockMilvus.listen(milvusPort, '127.0.0.1', resolve);
});

const settings = {
  provider: 'sqlite-milvus',
  databasePath,
  personaCorpusPath: '',
  milvusEnabled: true,
  milvusManaged: true,
  milvusUrl: `http://127.0.0.1:${milvusPort}`,
  milvusImage: 'milvusdb/milvus:v2.6.13',
  milvusCollection: 'yachiyo_memory_recovery_test',
  embeddingDimension: 64,
  retrievalMode: 'hybrid',
  writeMode: 'auto-approved',
  sessionRollupEnabled: true,
  gcEnabled: false
};

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
  service = spawn(process.execPath, [serviceScript, '--port', String(servicePort), '--repo-root', repoRoot], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LOCALAPPDATA: localAppData,
      YACHIYO_MEMORY_AUTOSTART_MANAGED_MILVUS: '0',
      YACHIYO_MEMORY_DOCKER_CLI: process.execPath,
      YACHIYO_MEMORY_DOCKER_CLI_SCRIPT: fakeDockerScript,
      YACHIYO_TEST_DOCKER_STATE: fakeStatePath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  service.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) break;
    } catch (_) {
      await sleep(60);
    }
  }

  await post('/api/memory/write', {
    ...settings,
    milvusEnabled: false,
    milvusManaged: false,
    memory: {
      type: 'viewer',
      scope: 'relationship',
      title: 'Recovery test preference',
      text: 'The durable SQLite memory must survive Milvus index recovery.',
      facts: ['SQLite remains the source of truth.'],
      importance: 0.9,
      confidence: 0.95,
      idempotencyKey: 'milvus-recovery-sqlite-proof'
    }
  });

  const started = await post('/api/memory/managed-milvus/start', settings);
  assert.equal(started.startup.recoveryAttempts, 1, 'exit 134 leader-change must trigger exactly one safe index recovery');
  assert.equal(started.synced, 1, 'the rebuilt Milvus index must be repopulated from SQLite');

  const dockerState = JSON.parse(fs.readFileSync(fakeStatePath, 'utf8'));
  assert.equal(dockerState.runCount, 2, 'one failed index and one recovered index should be created');
  assert.equal(dockerState.rmCount, 1, 'only the failed container should be removed');
  assert.equal(dockerState.stopCount, 0, 'recovery must not stop or delete SQLite data');
  assert.notEqual(dockerState.volumePath, dockerState.originalVolumePath, 'recovery must switch to a fresh versioned index directory');
  assert.equal(fs.existsSync(dockerState.originalVolumePath), true, 'the failed index directory must be preserved for rollback');
  assert.equal(fs.existsSync(dockerState.volumePath), true, 'the recovered index directory must exist');

  const healthResponse = await fetch(`${baseUrl}/healthz`);
  const health = await healthResponse.json();
  assert.equal(health.managedMilvus.phase, 'ready');
  assert.equal(health.managedMilvus.ready, true);
  assert.equal(health.managedMilvus.recoveryAttempts, 1);
  assert.equal(
    milvusRequests.some((request) => request.url === '/v2/vectordb/entities/upsert' && request.body.data?.length === 1),
    true,
    'SQLite memory must be upserted into the recovered Milvus collection'
  );

  const sqlite = new Database(databasePath, { readonly: true });
  try {
    assert.equal(sqlite.pragma('integrity_check')[0].integrity_check, 'ok');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM memories').get().count, 1);
  } finally {
    sqlite.close();
  }

  await post('/api/memory/shutdown', { stopMilvus: false });
  await Promise.race([new Promise((resolve) => service.once('exit', resolve)), sleep(3000)]);
  const finalDockerState = JSON.parse(fs.readFileSync(fakeStatePath, 'utf8'));
  assert.equal(finalDockerState.stopCount, 0, 'normal EXE shutdown must leave a healthy Milvus container running');
  console.log('managed Milvus recovery integration checks passed');
} finally {
  if (service && service.exitCode === null) service.kill();
  if (mockMilvus) await new Promise((resolve) => mockMilvus.close(resolve));
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
