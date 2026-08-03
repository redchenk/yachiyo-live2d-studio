import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-monitor-lifecycle-'));
const databasePath = path.join(tempDirectory, 'monitor.sqlite');
const stopFile = path.join(tempDirectory, 'monitor.stop');

try {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE raw_messages (source TEXT, role TEXT, created TEXT);
    CREATE TABLE retrieval_traces (created TEXT);
  `);
  database.close();
  fs.writeFileSync(stopFile, 'stop', 'utf8');

  const run = spawnSync(process.execPath, [
    'tools/live2d-studio/monitor-live-reply-health.mjs',
    '--once',
    '--stdout-only',
    '--database', databasePath,
    '--stop-file', stopFile,
    '--session-start', new Date().toISOString()
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const records = run.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const summary = records.find((record) => record.type === 'summary');
  assert.ok(summary, 'a launcher stop signal must produce a final monitor summary');
  assert.equal(summary.reason, 'parent-exit');

  const missingParentRun = spawnSync(process.execPath, [
    'tools/live2d-studio/monitor-live-reply-health.mjs',
    '--once',
    '--stdout-only',
    '--database', databasePath,
    '--parent-pid', '2147483646',
    '--session-start', new Date().toISOString()
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true
  });
  assert.equal(missingParentRun.status, 0, missingParentRun.stderr || missingParentRun.stdout);
  const missingParentSummary = missingParentRun.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((record) => record.type === 'summary');
  assert.equal(
    missingParentSummary?.reason,
    'parent-exit',
    'a monitor orphaned by an app crash must summarize and exit by itself'
  );

  const launcherSource = fs.readFileSync(
    'tools/live2d-launcher/Live2DStudioLauncher.cs',
    'utf8'
  );
  assert.match(
    launcherSource,
    /using \(var monitor = LiveReplyHealthMonitor\.Start\(repoRoot, port\)\)/,
    'the EXE lifecycle must own the live reply monitor'
  );
  assert.match(launcherSource, /--stop-file/);
  assert.match(launcherSource, /--parent-pid/);
  assert.match(launcherSource, /--quiet/);
  assert.match(launcherSource, /CreateNoWindow = true/);
  assert.match(launcherSource, /WindowStyle = ProcessWindowStyle\.Hidden/);
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}

console.log('Automatic monitor lifecycle checks passed');
