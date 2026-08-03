import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('tools/live2d-launcher/Live2DStudioLauncher.cs', 'utf8');

assert.match(source, /\/api\/live-reply\/telemetry/);
assert.match(source, /DesktopApiProxy\.LiveReplyTelemetry\(request\.Body\)/);
assert.match(source, /public static StudioApiResponse LiveReplyTelemetry\(byte\[\] body\)/);
assert.match(source, /LiveReplyTelemetryAllowedStages/);
assert.match(source, /YachiyoLive2DStudio\\\\diagnostics/);

const methodStart = source.indexOf('public static StudioApiResponse LiveReplyTelemetry(byte[] body)');
const methodEnd = source.indexOf('\n    public static ', methodStart + 20);
assert.ok(methodStart >= 0 && methodEnd > methodStart);
const method = source.slice(methodStart, methodEnd);
for (const forbidden of ['userName', 'text', 'cookie', 'token', 'apiKey']) {
  assert.equal(
    method.toLowerCase().includes(`"${forbidden.toLowerCase()}"`),
    false,
    `telemetry persistence must not accept ${forbidden}`
  );
}
for (const allowed of ['stage', 'turnId', 'audienceCount', 'paidCount', 'queueDepth', 'durationMs']) {
  assert.match(method, new RegExp(`"${allowed}"`));
}

console.log('Launcher live reply telemetry checks passed');
