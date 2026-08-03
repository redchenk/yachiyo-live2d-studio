import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../live2d-launcher/Live2DStudioLauncher.cs', import.meta.url),
  'utf8'
);

assert.match(
  source,
  /ThreadPool\.QueueUserWorkItem\(_\s*=>\s*HandleClientSafely\(client\)\)/,
  'every local HTTP connection must cross an exception-isolating request boundary'
);
const safeHandlerStart = source.indexOf('private void HandleClientSafely(TcpClient client)');
const coreHandlerStart = source.indexOf('private void HandleClient(TcpClient client)');
assert.ok(safeHandlerStart >= 0 && coreHandlerStart > safeHandlerStart, 'safe request wrapper must guard HandleClient');
const safeHandlerSource = source.slice(safeHandlerStart, coreHandlerStart);
assert.match(safeHandlerSource, /catch\s*\(IOException\)/, 'broken browser sockets must be treated as per-client failures');
assert.match(safeHandlerSource, /catch\s*\(SocketException\)/, 'socket resets must be treated as per-client failures');
assert.match(safeHandlerSource, /catch\s*\(Exception\s+ex\)/, 'unexpected request faults must not terminate the EXE');

assert.match(
  source,
  /private const int ChatRequestTimeoutMs\s*=\s*45000/,
  'a stalled upstream LLM request must not occupy a launcher worker for two minutes'
);
assert.match(
  source,
  /private const int ChatStreamReadWriteTimeoutMs\s*=\s*20000/,
  'an upstream LLM stream that stops producing bytes must release its launcher worker promptly'
);
assert.match(
  source,
  /request\.Timeout\s*=\s*ChatRequestTimeoutMs;[\s\S]*?request\.ReadWriteTimeout\s*=\s*ChatStreamReadWriteTimeoutMs;/,
  'the bounded chat timeouts must be applied to the streaming provider request'
);

console.log('launcher client disconnect safety checks passed');
