export const DEFAULT_MANAGED_MILVUS_IMAGE = 'milvusdb/milvus:v2.6.13';

const MAX_RESTART_ATTEMPTS = 2;
const MAX_RECOVERY_ATTEMPTS = 1;

export function managedMilvusVolumeBaseName(image = DEFAULT_MANAGED_MILVUS_IMAGE) {
  const version = String(image || '')
    .split('@')[0]
    .split(':')
    .at(-1)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  return `managed-milvus-${version || 'pinned'}`;
}

export function isSafeManagedMilvusVolumeName(value) {
  return /^managed-milvus-[a-z0-9][a-z0-9._-]{0,119}$/i.test(String(value || ''));
}

export function isEmbeddedEtcdLeaderChange(container = {}, logs = '') {
  return Number(container.exitCode) === 134 && /etcdserver:\s*leader changed|panic:\s*etcdserver/iu.test(String(logs || ''));
}

export function decideManagedMilvusStartupAction({
  ready = false,
  container = {},
  logs = '',
  restartAttempts = 0,
  recoveryAttempts = 0
} = {}) {
  if (ready) return { action: 'ready', reason: 'milvus-api-ready' };
  if (!container?.exists) return { action: 'create', reason: 'container-missing' };
  if (container.running) return { action: 'wait', reason: 'container-running' };
  if (container.oomKilled) return { action: 'degrade', reason: 'container-oom-killed' };
  if (isEmbeddedEtcdLeaderChange(container, logs)) {
    if (recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
      return { action: 'quarantine-index', reason: 'embedded-etcd-leader-change' };
    }
    return { action: 'degrade', reason: 'recovery-budget-exhausted' };
  }
  if (restartAttempts < MAX_RESTART_ATTEMPTS) return { action: 'restart', reason: 'container-exited' };
  return { action: 'degrade', reason: 'restart-budget-exhausted' };
}
