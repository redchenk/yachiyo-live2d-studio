import assert from 'node:assert/strict';
import fs from 'node:fs';

const launcherSource = fs.readFileSync(
  new URL('../live2d-launcher/Live2DStudioLauncher.cs', import.meta.url),
  'utf8'
);

assert.match(
  launcherSource,
  /--webview2-probe/,
  'the launcher must support an isolated WebView2 health probe before opening the real profile'
);
assert.match(
  launcherSource,
  /ResolveWorkingWebView2BrowserFolder/,
  'the launcher must select a runtime that actually passes the health probe'
);
assert.match(
  launcherSource,
  /BrowserExecutableFolder\s*=\s*browserExecutableFolder/,
  'the selected working runtime must be applied before WebView2 initialization'
);
assert.match(
  launcherSource,
  /WaitForExit\s*\(\s*\d+/,
  'runtime health probes must have a bounded timeout'
);
assert.doesNotMatch(
  launcherSource,
  /Directory\.Delete\([^;]*YachiyoLive2DStudio[^;]*WebView2/,
  'runtime recovery must never delete the real WebView2 profile or its durable browser storage'
);

console.log('launcher WebView2 runtime fallback checks passed');
