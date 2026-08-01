import assert from 'node:assert/strict';
import fs from 'node:fs';

const launcherSource = fs.readFileSync(
  new URL('../live2d-launcher/Live2DStudioLauncher.cs', import.meta.url),
  'utf8'
);

assert.match(
  launcherSource,
  /ClientSize\s*=\s*new Size\(1280,\s*720\)/,
  'the EXE must open with a 16:9 WebView client area'
);
assert.match(
  launcherSource,
  /MinimumSize\s*=\s*SizeFromClientSize\(new Size\(960,\s*540\)\)/,
  'the minimum client area should use the same 16:9 ratio'
);
assert.doesNotMatch(
  launcherSource,
  /Width\s*=\s*1360|Height\s*=\s*860/,
  'the previous non-16:9 default size must not return'
);

console.log('launcher 16:9 window checks passed');
