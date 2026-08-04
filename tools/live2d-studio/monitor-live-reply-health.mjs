import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  liveReplyMonitorRecordType,
  liveReplyMonitorShouldPrint,
  resolveLiveReplyMonitorStatus
} from './live-reply-monitor-policy.mjs';

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_RUNTIME_CHECK_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 60_000;
const DEFAULT_IDLE_END_MINUTES = 30;
const DEFAULT_STARTUP_GRACE_MS = 90_000;
let requiredPorts = [3288, 3299, 9091, 19530];

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    if (['once', 'stdout-only', 'no-idle-exit', 'quiet'].includes(name)) {
      result[name] = true;
      continue;
    }
    result[name] = argv[index + 1];
    index += 1;
  }
  return result;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function isoTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function defaultDatabasePath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(
    process.env.USERPROFILE || 'C:\\Users\\Public',
    'AppData',
    'Local'
  );
  return path.join(
    localAppData,
    'YachiyoLive2DStudio',
    'MemoryData',
    'yachiyo-memory.sqlite'
  );
}

function defaultTelemetryDirectory() {
  const localAppData = process.env.LOCALAPPDATA || path.join(
    process.env.USERPROFILE || 'C:\\Users\\Public',
    'AppData',
    'Local'
  );
  return path.join(localAppData, 'YachiyoLive2DStudio', 'diagnostics');
}

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve('output', `live-reply-monitor-${stamp}.jsonl`);
}

function readWindowsRuntime() {
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$app=Get-Process -Name 'Start-Live2D-Studio' | Sort-Object StartTime -Descending | Select-Object -First 1",
    `$required=@(${requiredPorts.join(',')})`,
    "$listeners=Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $required }",
    '[pscustomobject]@{',
    '  appAlive=[bool]$app;',
    '  pid=if($app){$app.Id}else{0};',
    "  startedUtc=if($app){$app.StartTime.ToUniversalTime().ToString('o')}else{$null};",
    '  responding=if($app){$app.Responding}else{$false};',
    '  workingSetMB=if($app){[math]::Round($app.WorkingSet64/1MB,1)}else{0};',
    '  ports=@($listeners.LocalPort | Sort-Object -Unique);',
    '  missingPorts=@($required | Where-Object { $_ -notin $listeners.LocalPort })',
    '} | ConvertTo-Json -Compress'
  ].join('\n');
  try {
    const output = execFileSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000
    });
    return JSON.parse(output.trim());
  } catch (error) {
    return {
      appAlive: false,
      pid: 0,
      startedUtc: null,
      responding: false,
      workingSetMB: 0,
      ports: [],
      missingPorts: [...requiredPorts],
      probeError: String(error?.message || error).slice(0, 240)
    };
  }
}

async function fetchJson(url, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readServiceHealth(runtime) {
  try {
    const health = await fetchJson('http://127.0.0.1:3299/healthz');
    return {
      appAlive: Boolean(runtime?.appAlive),
      appResponding: Boolean(runtime?.responding),
      pid: Number(runtime?.pid) || 0,
      startedUtc: isoTimestamp(runtime?.startedUtc),
      workingSetMB: Number(runtime?.workingSetMB) || 0,
      ports: Array.isArray(runtime?.ports) ? runtime.ports.map(Number) : [],
      missingPorts: Array.isArray(runtime?.missingPorts) ? runtime.missingPorts.map(Number) : [],
      sqliteReady: Boolean(health.sqliteReady),
      sqliteIntegrity: String(health.sqliteIntegrity || ''),
      milvusReady: Boolean(health.managedMilvus?.ready),
      milvusPhase: String(health.managedMilvus?.phase || ''),
      milvusRestartCount: Number(health.managedMilvus?.container?.restartCount) || 0,
      error: String(health.sqliteError || health.managedMilvus?.error || '').slice(0, 240)
    };
  } catch (error) {
    return {
      appAlive: Boolean(runtime?.appAlive),
      appResponding: Boolean(runtime?.responding),
      pid: Number(runtime?.pid) || 0,
      startedUtc: isoTimestamp(runtime?.startedUtc),
      workingSetMB: Number(runtime?.workingSetMB) || 0,
      ports: Array.isArray(runtime?.ports) ? runtime.ports.map(Number) : [],
      missingPorts: Array.isArray(runtime?.missingPorts) ? runtime.missingPorts.map(Number) : [],
      sqliteReady: false,
      sqliteIntegrity: '',
      milvusReady: false,
      milvusPhase: '',
      milvusRestartCount: 0,
      error: String(error?.message || error).slice(0, 240)
    };
  }
}

function openDatabase(databasePath) {
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true
  });
  database.pragma('busy_timeout = 3000');
  return database;
}

function readStageSnapshot(databasePath, sessionStart) {
  const database = openDatabase(databasePath);
  try {
    const incoming = database.prepare(`
      SELECT COUNT(*) AS count, MAX(created) AS latest
      FROM raw_messages
      WHERE source = 'bilibili' AND role = 'user' AND created >= ?
    `).get(sessionStart);
    const traces = database.prepare(`
      SELECT COUNT(*) AS count, MAX(created) AS latest
      FROM retrieval_traces
      WHERE created >= ?
    `).get(sessionStart);
    const replies = database.prepare(`
      SELECT COUNT(*) AS count, MAX(created) AS latest
      FROM raw_messages
      WHERE source = 'llm-control' AND role = 'assistant' AND created >= ?
    `).get(sessionStart);
    return {
      incoming: { count: Number(incoming.count) || 0, latest: isoTimestamp(incoming.latest) },
      traces: { count: Number(traces.count) || 0, latest: isoTimestamp(traces.latest) },
      replies: { count: Number(replies.count) || 0, latest: isoTimestamp(replies.latest) }
    };
  } finally {
    database.close();
  }
}

function readLiveReplyTelemetry(telemetryDirectory, sessionStart) {
  if (!fs.existsSync(telemetryDirectory)) return [];
  const startMs = Date.parse(sessionStart) || 0;
  const events = [];
  for (const name of fs.readdirSync(telemetryDirectory)) {
    if (!/^live-reply-telemetry-\d{8}\.jsonl$/i.test(name)) continue;
    const filePath = path.join(telemetryDirectory, name);
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const timestampMs = Date.parse(event.timestamp || event.receivedAt || '');
        if (!Number.isFinite(timestampMs) || timestampMs < startMs) continue;
        events.push({
          timestampMs,
          stage: String(event.stage || ''),
          turnId: String(event.turnId || ''),
          audienceCount: Number(event.audienceCount) || 0,
          paidCount: Number(event.paidCount) || 0,
          queueDepth: Number(event.queueDepth) || 0,
          durationMs: Number(event.durationMs) || 0,
          attempt: Number(event.attempt) || 0,
          outcome: String(event.outcome || ''),
          failureKind: String(event.failureKind || '')
        });
      } catch {
        // Ignore partially written or legacy diagnostic lines.
      }
    }
  }
  return events.sort((left, right) => left.timestampMs - right.timestampMs);
}

function liveReplyTelemetrySnapshot(events) {
  const stages = {};
  const latest = {};
  for (const event of events) {
    stages[event.stage] = (stages[event.stage] || 0) + 1;
    latest[event.stage] = new Date(event.timestampMs).toISOString();
  }
  return { stages, latest };
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function buildLiveReplyTelemetrySummary(events) {
  const snapshot = liveReplyTelemetrySnapshot(events);
  const turns = new Map();
  const recovery = {};
  const failureKinds = {};
  for (const event of events) {
    if (event.stage === 'recovery') {
      recovery[event.outcome || 'unknown'] = (recovery[event.outcome || 'unknown'] || 0) + 1;
    }
    if (event.failureKind) {
      failureKinds[event.failureKind] = (failureKinds[event.failureKind] || 0) + 1;
    }
    if (!event.turnId) continue;
    const turn = turns.get(event.turnId) || {
      audienceCount: 0,
      paidCount: 0,
      firstSentenceMs: 0,
      firstAudioMs: 0,
      completed: false,
      failed: false
    };
    turn.audienceCount = Math.max(turn.audienceCount, event.audienceCount);
    turn.paidCount = Math.max(turn.paidCount, event.paidCount);
    if (event.stage === 'first-sentence' && !turn.firstSentenceMs) turn.firstSentenceMs = event.durationMs;
    if (event.stage === 'tts-start' && !turn.firstAudioMs) turn.firstAudioMs = event.durationMs;
    if (event.stage === 'tts-end') turn.completed = true;
    if (event.stage === 'tts-fail') turn.failed = true;
    turns.set(event.turnId, turn);
  }
  const firstSentence = [...turns.values()]
    .map((turn) => turn.firstSentenceMs)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  const firstAudio = [...turns.values()]
    .map((turn) => turn.firstAudioMs)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  const latency = (values) => ({
    samples: values.length,
    p50Sec: Math.round(percentile(values, 0.5) / 100) / 10,
    p95Sec: Math.round(percentile(values, 0.95) / 100) / 10,
    p99Sec: Math.round(percentile(values, 0.99) / 100) / 10,
    maxSec: Math.round((values.at(-1) || 0) / 100) / 10,
    over30Sec: values.filter((value) => value >= 30_000).length
  });
  return {
    events: events.length,
    turns: turns.size,
    selectedAudience: [...turns.values()].reduce((total, turn) => total + turn.audienceCount, 0),
    selectedPaid: [...turns.values()].reduce((total, turn) => total + turn.paidCount, 0),
    completedTurns: [...turns.values()].filter((turn) => turn.completed).length,
    failedTurns: [...turns.values()].filter((turn) => turn.failed).length,
    stages: snapshot.stages,
    recovery,
    failureKinds,
    firstSentence: latency(firstSentence),
    firstAudio: latency(firstAudio)
  };
}

function buildSessionSummary(databasePath, sessionStart, telemetryEvents = []) {
  const database = openDatabase(databasePath);
  try {
    const incoming = database.prepare(`
      SELECT created FROM raw_messages
      WHERE source = 'bilibili' AND role = 'user' AND created >= ?
      ORDER BY created
    `).all(sessionStart).map((row) => Date.parse(row.created)).filter(Number.isFinite);
    const replies = database.prepare(`
      SELECT created FROM raw_messages
      WHERE source = 'llm-control' AND role = 'assistant' AND created >= ?
      ORDER BY created
    `).all(sessionStart).map((row) => Date.parse(row.created)).filter(Number.isFinite);
    const traces = database.prepare(`
      SELECT created FROM retrieval_traces
      WHERE created >= ?
      ORDER BY created
    `).all(sessionStart).map((row) => Date.parse(row.created)).filter(Number.isFinite);
    const activeWaits = [];
    for (let index = 1; index < replies.length; index += 1) {
      const arrivals = incoming.filter((time) => time > replies[index - 1] && time <= replies[index]);
      if (!arrivals.length) continue;
      activeWaits.push({
        start: arrivals[0],
        end: replies[index],
        waitMs: replies[index] - arrivals[0],
        incoming: arrivals.length,
        traces: traces.filter((time) => time > arrivals[0] && time <= replies[index]).length
      });
    }
    const waitValues = activeWaits.map((item) => item.waitMs).sort((left, right) => left - right);
    const retryClusters = [];
    let cluster = null;
    for (let index = 1; index < traces.length; index += 1) {
      const intervalMs = traces[index] - traces[index - 1];
      const replyBetween = replies.some((time) => time > traces[index - 1] && time <= traces[index]);
      if (intervalMs >= 13_000 && intervalMs <= 19_000 && !replyBetween) {
        if (!cluster) cluster = { start: traces[index - 1], end: traces[index], attempts: 2 };
        else {
          cluster.end = traces[index];
          cluster.attempts += 1;
        }
      } else if (cluster) {
        if (cluster.attempts >= 3) retryClusters.push(cluster);
        cluster = null;
      }
    }
    if (cluster?.attempts >= 3) retryClusters.push(cluster);
    const worst = [...activeWaits]
      .sort((left, right) => right.waitMs - left.waitMs)
      .slice(0, 5)
      .map((item) => ({
        firstIncoming: new Date(item.start).toISOString(),
        reply: new Date(item.end).toISOString(),
        waitSec: Math.round(item.waitMs / 100) / 10,
        incoming: item.incoming,
        traces: item.traces
      }));
    return {
      sessionStart,
      generatedAt: new Date().toISOString(),
      totals: { incoming: incoming.length, traces: traces.length, replies: replies.length },
      activeWait: {
        samples: activeWaits.length,
        p50Sec: Math.round(percentile(waitValues, 0.5) / 100) / 10,
        p95Sec: Math.round(percentile(waitValues, 0.95) / 100) / 10,
        p99Sec: Math.round(percentile(waitValues, 0.99) / 100) / 10,
        over30Sec: activeWaits.filter((item) => item.waitMs >= 30_000).length,
        over45Sec: activeWaits.filter((item) => item.waitMs >= 45_000).length,
        over90Sec: activeWaits.filter((item) => item.waitMs >= 90_000).length,
        worst
      },
      retryClusters: retryClusters.map((item) => ({
        start: new Date(item.start).toISOString(),
        end: new Date(item.end).toISOString(),
        attempts: item.attempts,
        durationSec: Math.round((item.end - item.start) / 100) / 10
      })),
      lifecycle: buildLiveReplyTelemetrySummary(telemetryEvents)
    };
  } finally {
    database.close();
  }
}

const args = parseArgs(process.argv.slice(2));
const appPort = boundedNumber(args['app-port'], 3288, 1, 65_535);
requiredPorts = [...new Set([appPort, 3299, 9091, 19530])];
const intervalMs = boundedNumber(args['interval-ms'], DEFAULT_INTERVAL_MS, 1_000, 60_000);
const runtimeCheckMs = boundedNumber(
  args['runtime-check-ms'],
  DEFAULT_RUNTIME_CHECK_MS,
  intervalMs,
  300_000
);
const heartbeatMs = boundedNumber(args['heartbeat-ms'], DEFAULT_HEARTBEAT_MS, intervalMs, 600_000);
const idleEndMinutes = boundedNumber(
  args['idle-end-minutes'],
  DEFAULT_IDLE_END_MINUTES,
  5,
  24 * 60
);
const startupGraceMs = boundedNumber(
  args['startup-grace-ms'],
  DEFAULT_STARTUP_GRACE_MS,
  0,
  10 * 60_000
);
const databasePath = path.resolve(args.database || defaultDatabasePath());
const telemetryDirectory = path.resolve(args['telemetry-dir'] || defaultTelemetryDirectory());
const outputPath = args['stdout-only'] ? '' : path.resolve(args.output || defaultOutputPath());
const pidFile = path.resolve(args['pid-file'] || path.join('output', 'live-reply-monitor.pid'));
const stopFile = args['stop-file'] ? path.resolve(args['stop-file']) : '';
const parentPid = boundedNumber(args['parent-pid'], 0, 0, 2_147_483_647);

const initialShutdownReason = requestedShutdownReason();
let runtime = initialShutdownReason
  ? {
      appAlive: false,
      pid: 0,
      startedUtc: null,
      responding: false,
      workingSetMB: 0,
      ports: [],
      missingPorts: [...requiredPorts]
    }
  : readWindowsRuntime();
const sessionStart = isoTimestamp(args['session-start'] || runtime.startedUtc) || new Date().toISOString();
const sessionStartedMs = Date.parse(sessionStart) || Date.now();
let serviceHealth = initialShutdownReason
  ? {
      appAlive: false,
      appResponding: false,
      pid: 0,
      startedUtc: null,
      workingSetMB: 0,
      ports: [],
      missingPorts: [...requiredPorts],
      sqliteReady: false,
      sqliteIntegrity: '',
      milvusReady: false,
      milvusPhase: '',
      milvusRestartCount: 0,
      error: 'parent-exit'
    }
  : await readServiceHealth(runtime);
let previousSnapshot = null;
let previousStatus = '';
let lastRuntimeCheckAt = Date.now();
let lastHeartbeatAt = 0;
let appFailureChecks = 0;
let stopping = false;

function emit(record, { consoleOutput = false } = {}) {
  const line = JSON.stringify(record);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.appendFileSync(outputPath, `${line}\n`, 'utf8');
  }
  if (!args.quiet && (consoleOutput || args.once)) process.stdout.write(`${line}\n`);
}

function acquirePidFile() {
  if (args.once || args['stdout-only']) return;
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  if (fs.existsSync(pidFile)) {
    const existingPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (existingPid > 0) {
      try {
        process.kill(existingPid, 0);
        throw new Error(`A live reply monitor is already running with PID ${existingPid}.`);
      } catch (error) {
        if (String(error?.message || '').startsWith('A live reply monitor')) throw error;
      }
    }
  }
  fs.writeFileSync(pidFile, String(process.pid), 'utf8');
}

function releasePidFile() {
  if (!args.once && !args['stdout-only'] && fs.existsSync(pidFile)) {
    const owner = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (owner === process.pid) fs.unlinkSync(pidFile);
  }
}

function stopRequested() {
  return Boolean(stopFile && fs.existsSync(stopFile));
}

function parentProcessAlive() {
  if (parentPid <= 0) return true;
  try {
    process.kill(parentPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function requestedShutdownReason() {
  if (stopRequested()) return 'parent-exit';
  if (!parentProcessAlive()) return 'parent-exit';
  return '';
}

function releaseStopFile() {
  if (!stopFile || !fs.existsSync(stopFile)) return;
  try {
    fs.unlinkSync(stopFile);
  } catch {
    // The launcher also removes its own stop signal during final cleanup.
  }
}

async function waitForNextSample() {
  const deadline = Date.now() + intervalMs;
  while (Date.now() < deadline) {
    const reason = requestedShutdownReason();
    if (reason) return reason;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
  }
  return requestedShutdownReason();
}

async function refreshRuntime(nowMs) {
  if (nowMs - lastRuntimeCheckAt < runtimeCheckMs) return;
  runtime = readWindowsRuntime();
  serviceHealth = await readServiceHealth(runtime);
  lastRuntimeCheckAt = nowMs;
}

async function sample() {
  const requestedReason = requestedShutdownReason();
  if (requestedReason) return requestedReason;
  const nowMs = Date.now();
  await refreshRuntime(nowMs);
  const snapshot = readStageSnapshot(databasePath, sessionStart);
  const telemetryEvents = readLiveReplyTelemetry(telemetryDirectory, sessionStart);
  const telemetry = liveReplyTelemetrySnapshot(telemetryEvents);
  const status = resolveLiveReplyMonitorStatus({
    snapshot,
    nowMs,
    serviceHealth,
    telemetry,
    sessionStartedMs,
    startupGraceMs
  });
  const delta = previousSnapshot
    ? {
        incoming: snapshot.incoming.count - previousSnapshot.incoming.count,
        traces: snapshot.traces.count - previousSnapshot.traces.count,
        replies: snapshot.replies.count - previousSnapshot.replies.count
      }
    : { incoming: 0, traces: 0, replies: 0 };
  const latestIncomingMs = Date.parse(snapshot.incoming.latest || '') || 0;
  const record = {
    type: liveReplyMonitorRecordType(status, previousStatus),
    at: new Date(nowMs).toISOString(),
    sessionStart,
    status,
    totals: {
      incoming: snapshot.incoming.count,
      traces: snapshot.traces.count,
      replies: snapshot.replies.count
    },
    delta,
    latest: {
      incoming: snapshot.incoming.latest,
      trace: snapshot.traces.latest,
      reply: snapshot.replies.latest
    },
    lifecycle: telemetry,
    service: serviceHealth
  };
  const shouldPrint = liveReplyMonitorShouldPrint({
    status,
    previousStatus,
    nowMs,
    lastHeartbeatAt,
    heartbeatMs
  });
  emit(record, { consoleOutput: shouldPrint });
  if (shouldPrint) lastHeartbeatAt = nowMs;
  previousSnapshot = snapshot;
  previousStatus = status;
  appFailureChecks = serviceHealth.appAlive ? 0 : appFailureChecks + 1;
  if (appFailureChecks >= 3) return 'app-exited';
  if (
    !args['no-idle-exit'] &&
    latestIncomingMs > 0 &&
    nowMs - latestIncomingMs >= idleEndMinutes * 60_000
  ) return 'bilibili-idle';
  return '';
}

async function finish(reason) {
  if (stopping) return;
  stopping = true;
  let summary = null;
  try {
    summary = buildSessionSummary(
      databasePath,
      sessionStart,
      readLiveReplyTelemetry(telemetryDirectory, sessionStart)
    );
  } catch (error) {
    summary = { error: String(error?.message || error).slice(0, 240) };
  }
  emit({
    type: 'summary',
    at: new Date().toISOString(),
    reason,
    outputPath: outputPath || null,
    summary,
    finalService: serviceHealth
  }, { consoleOutput: true });
  releasePidFile();
  releaseStopFile();
}

acquirePidFile();
emit({
  type: 'monitor-start',
  at: new Date().toISOString(),
  pid: process.pid,
  sessionStart,
  databasePath,
  telemetryDirectory,
  outputPath: outputPath || null,
  intervalMs,
  runtimeCheckMs,
  appPort,
  parentPid: parentPid || null,
  startupGraceMs,
  idleEndMinutes: args['no-idle-exit'] ? null : idleEndMinutes
}, { consoleOutput: true });

process.once('SIGINT', () => {
  finish('sigint').finally(() => process.exit(0));
});
process.once('SIGTERM', () => {
  finish('sigterm').finally(() => process.exit(0));
});

const startupShutdownReason = requestedShutdownReason();
if (startupShutdownReason) {
  await finish(startupShutdownReason);
} else if (args.once) {
  await sample();
  await finish('once');
} else {
  while (!stopping) {
    const stopReason = await sample().catch((error) => {
      emit({
        type: 'monitor-error',
        at: new Date().toISOString(),
        error: String(error?.message || error).slice(0, 240)
      }, { consoleOutput: true });
      return '';
    });
    if (stopReason) {
      await finish(stopReason);
      break;
    }
    const waitStopReason = await waitForNextSample();
    if (waitStopReason) {
      await finish(waitStopReason);
      break;
    }
  }
}
