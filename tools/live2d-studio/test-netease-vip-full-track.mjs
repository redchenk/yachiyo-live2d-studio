import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const launcherPath = path.join(repoRoot, 'tools', 'live2d-launcher', 'Live2DStudioLauncher.cs');
const exePath = path.join(repoRoot, 'Start-Live2D-Studio.exe');
const launcherSource = fs.readFileSync(launcherPath, 'utf8');

assert.match(
  launcherSource,
  /NormalizeNeteaseCookie\(cookie\)/,
  'stored and manual NetEase login state must be normalized before use'
);
assert.match(
  launcherSource,
  /IsNeteaseMusicTrialDetail\(detail\)/,
  'preview-only NetEase URL results must be detected before playback'
);
assert.match(
  launcherSource,
  /IsNeteaseMusicTruncatedDetail\(detail, expectedDurationMs\)/,
  'a stream much shorter than the catalog duration must be rejected as truncated'
);

const reflected = spawnSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', path.join(scriptDir, 'test-netease-vip-full-track.ps1'),
  '-LauncherPath', exePath
], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true
});

assert.equal(reflected.status, 0, String(reflected.error || reflected.stderr || reflected.stdout));
const result = JSON.parse(reflected.stdout.trim());
assert.equal(result.normalized, 'MUSIC_R_T=fresh; MUSIC_U=vip-token; __csrf=csrf-token');
assert.equal(result.previewRejected, true, 'a 20-second VIP preview must never be treated as a full track');
assert.equal(result.fullRejected, false, 'a paid full-track response must remain playable');
assert.equal(result.shortStreamRejected, true, 'a preview-sized stream must be rejected even without trial metadata');
assert.equal(result.fullStreamRejected, false, 'a stream matching the catalog duration must remain playable');

console.log('NetEase VIP full-track checks passed');
