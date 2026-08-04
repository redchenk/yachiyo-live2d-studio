import assert from 'node:assert/strict';
import {
  liveReplyMonitorRecordType,
  liveReplyMonitorShouldPrint,
  resolveLiveReplyMonitorStatus
} from './live-reply-monitor-policy.mjs';

const nowMs = Date.parse('2026-08-04T12:00:00.000Z');
const healthyServices = {
  appAlive: true,
  appResponding: true,
  sqliteReady: true,
  sqliteIntegrity: 'ok',
  milvusReady: true,
  missingPorts: []
};
const snapshot = {
  incoming: { latest: '2026-08-04T11:58:00.000Z' },
  traces: { latest: '2026-08-04T11:58:00.000Z' },
  replies: { latest: '2026-08-04T11:58:00.000Z' }
};

assert.equal(resolveLiveReplyMonitorStatus({
  snapshot,
  nowMs,
  serviceHealth: healthyServices,
  telemetry: {
    stages: { 'audience-arrived': 1, 'director-start': 1, 'director-stop': 1 },
    latest: {
      'audience-arrived': '2026-08-04T11:58:00.000Z',
      'director-start': '2026-08-04T11:57:00.000Z',
      'director-stop': '2026-08-04T11:59:00.000Z'
    }
  }
}), 'healthy', 'an intentionally stopped director must not create a scheduler stall');

assert.equal(resolveLiveReplyMonitorStatus({
  snapshot,
  nowMs,
  serviceHealth: healthyServices,
  telemetry: {
    stages: { 'audience-arrived': 1, 'director-start': 1 },
    latest: {
      'audience-arrived': '2026-08-04T11:58:00.000Z',
      'director-start': '2026-08-04T11:57:00.000Z'
    }
  }
}), 'scheduler_stall');

assert.equal(liveReplyMonitorRecordType('scheduler_stall', 'healthy'), 'alert');
assert.equal(liveReplyMonitorRecordType('scheduler_stall', 'scheduler_stall'), 'sample');
assert.equal(liveReplyMonitorRecordType('healthy', 'scheduler_stall'), 'sample');
assert.equal(liveReplyMonitorShouldPrint({
  status: 'scheduler_stall',
  previousStatus: 'scheduler_stall',
  nowMs,
  lastHeartbeatAt: nowMs - 5_000,
  heartbeatMs: 60_000
}), false, 'the same active incident must not print on every sample');
assert.equal(liveReplyMonitorShouldPrint({
  status: 'healthy',
  previousStatus: 'scheduler_stall',
  nowMs,
  lastHeartbeatAt: nowMs - 5_000,
  heartbeatMs: 60_000
}), true, 'state transitions must be printed immediately');

console.log('Live reply monitor policy checks passed');
