import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MANAGED_MILVUS_IMAGE,
  decideManagedMilvusStartupAction,
  managedMilvusVolumeBaseName,
  isSafeManagedMilvusVolumeName
} from '../memory/managed-milvus-policy.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const launcherSource = fs.readFileSync(
  path.resolve(scriptDir, '..', 'live2d-launcher', 'Live2DStudioLauncher.cs'),
  'utf8'
);

assert.equal(/:latest$/i.test(DEFAULT_MANAGED_MILVUS_IMAGE), false, 'managed Milvus must use a pinned image tag');
assert.equal(managedMilvusVolumeBaseName(DEFAULT_MANAGED_MILVUS_IMAGE), 'managed-milvus-v2.6.13');
assert.equal(isSafeManagedMilvusVolumeName('managed-milvus-v2.6.13-recovery-20260801t120000'), true);
assert.equal(isSafeManagedMilvusVolumeName('../managed-milvus'), false);
assert.doesNotMatch(launcherSource, /milvusdb\/milvus:latest/i, 'the EXE launcher must not override the pinned image with latest');
assert.match(
  launcherSource,
  /"stopMilvus",\s*false/,
  'normal EXE shutdown must leave Milvus running so the next launch does not force embedded-etcd cold recovery'
);
assert.match(
  launcherSource,
  /FindMemoryNodeExecutable\(repoRoot\)/,
  'the memory sidecar must select a Node runtime that can load the installed native SQLite module'
);
assert.match(
  launcherSource,
  /GetBoolean\(health,\s*"sqliteReady",\s*false\)/,
  'the EXE health probe must reject a sidecar whose HTTP server is alive but SQLite ABI is unusable'
);
const asrProbeSource = launcherSource.slice(
  launcherSource.indexOf('private static bool ProbeAsrService()'),
  launcherSource.indexOf('private static bool UsesMemoryDataProvider')
);
const memoryProbeSource = launcherSource.slice(
  launcherSource.indexOf('private static bool ProbeMemoryDataService()'),
  launcherSource.indexOf('public static StudioApiResponse MemorySearch')
);
assert.doesNotMatch(
  asrProbeSource,
  /sqliteReady/,
  'SQLite readiness belongs to the memory sidecar probe and must not break Vosk ASR health checks'
);
assert.match(
  memoryProbeSource,
  /sqliteReady/,
  'the memory sidecar probe must validate the SQLite native runtime, not only HTTP 200'
);
assert.match(
  memoryProbeSource,
  /yachiyo-memory-data/,
  'the launcher must reject an unrelated service occupying the memory sidecar port'
);
assert.match(
  memoryProbeSource,
  /repoRoot/,
  'the launcher must not reuse a healthy memory sidecar from another checkout'
);
const listenerGuardSource = launcherSource.slice(
  launcherSource.indexOf('var listenerKind = ProbeMemoryDataServiceListener()'),
  launcherSource.indexOf('var nodeExe = Live2DStudioLauncher.FindMemoryNodeExecutable(repoRoot)')
);
assert.match(
  listenerGuardSource,
  /listenerKind == MemoryDataServiceListenerKind\.ForeignProject[\s\S]*?throw new InvalidOperationException/,
  'a foreign checkout on the fixed memory port must fail explicitly'
);
assert.match(
  listenerGuardSource,
  /listenerKind == MemoryDataServiceListenerKind\.OwnedByCurrentProject[\s\S]*?TryRequestMemoryDataServiceShutdown\(\)/,
  'only a stale sidecar owned by the current checkout may receive the shutdown request'
);
assert.doesNotMatch(
  listenerGuardSource.slice(
    0,
    listenerGuardSource.indexOf('listenerKind == MemoryDataServiceListenerKind.OwnedByCurrentProject')
  ),
  /TryRequestMemoryDataServiceShutdown\(\)/,
  'foreign or unrelated listeners must never be shut down'
);

assert.deepEqual(
  decideManagedMilvusStartupAction({ ready: true }),
  { action: 'ready', reason: 'milvus-api-ready' }
);

assert.deepEqual(
  decideManagedMilvusStartupAction({
    ready: false,
    container: { exists: true, running: true, status: 'running' }
  }),
  { action: 'wait', reason: 'container-running' }
);

assert.deepEqual(
  decideManagedMilvusStartupAction({
    ready: false,
    recoveryAttempts: 0,
    container: { exists: true, running: false, status: 'exited', exitCode: 134, oomKilled: false },
    logs: 'panic: etcdserver: leader changed'
  }),
  { action: 'quarantine-index', reason: 'embedded-etcd-leader-change' }
);

assert.deepEqual(
  decideManagedMilvusStartupAction({
    ready: false,
    recoveryAttempts: 1,
    restartAttempts: 2,
    container: { exists: true, running: false, status: 'exited', exitCode: 134, oomKilled: false },
    logs: 'panic: etcdserver: leader changed'
  }),
  { action: 'degrade', reason: 'recovery-budget-exhausted' }
);

assert.deepEqual(
  decideManagedMilvusStartupAction({
    ready: false,
    restartAttempts: 0,
    container: { exists: true, running: false, status: 'exited', exitCode: 1, oomKilled: false },
    logs: 'temporary startup failure'
  }),
  { action: 'restart', reason: 'container-exited' }
);

assert.deepEqual(
  decideManagedMilvusStartupAction({
    ready: false,
    restartAttempts: 0,
    container: { exists: true, running: false, status: 'exited', exitCode: 137, oomKilled: true }
  }),
  { action: 'degrade', reason: 'container-oom-killed' }
);

console.log('managed Milvus startup policy checks passed');
