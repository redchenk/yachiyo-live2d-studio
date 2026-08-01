import assert from 'node:assert/strict';
import { createServer } from 'vite';

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key)
};

localStorage.setItem('roomMemorySettings', JSON.stringify({
  enabled: true,
  provider: 'sqlite',
  databasePath: 'session-restart-test.sqlite',
  retrievalMode: 'hybrid',
  writeMode: 'auto-approved',
  allowSessionMemory: true,
  sessionRollupEnabled: true,
  embeddingDimension: 64
}));

globalThis.fetch = async (url) => {
  if (url === '/api/memory/write') {
    return { ok: true, async json() { return { success: true }; } };
  }
  throw new Error(`unexpected fetch in session restart test: ${url}`);
};

async function loadRuntime() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom'
  });
  return {
    server,
    memory: await server.ssrLoadModule('/src/frontend/services/room/live2dMemory.js')
  };
}

function record(memory, number) {
  memory.recordLive2DSessionMemoryTurn({
    turnId: `restart-boundary-${number}`,
    source: 'live2d',
    input: `viewer turn ${number}`,
    reply: `reply ${number}`
  });
}

async function waitForSummary(sequence) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (Number(JSON.parse(localStorage.getItem('live2dMemoryLastSummaryAt') || '0')) >= sequence) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`session summary did not reach sequence ${sequence}`);
}

let first;
let second;
let third;
try {
  first = await loadRuntime();
  for (let number = 1; number <= 5; number += 1) record(first.memory, number);
  const pendingSessionId = JSON.parse(localStorage.getItem('live2dMemorySessionId'));
  await first.server.close();
  first = null;

  second = await loadRuntime();
  record(second.memory, 6);
  let buffer = JSON.parse(localStorage.getItem('live2dMemorySessionBuffer') || '[]');
  assert.equal(buffer.at(-1).sessionId, pendingSessionId, 'an unsummarized tail must resume its original session after restart');
  assert.equal(buffer.at(-1).sequence, 6);
  for (let number = 7; number <= 10; number += 1) record(second.memory, number);
  await waitForSummary(10);
  await second.server.close();
  second = null;

  third = await loadRuntime();
  record(third.memory, 11);
  const freshSessionId = JSON.parse(localStorage.getItem('live2dMemorySessionId'));
  buffer = JSON.parse(localStorage.getItem('live2dMemorySessionBuffer') || '[]');
  assert.notEqual(freshSessionId, pendingSessionId, 'a fully summarized previous runtime must start a fresh session');
  assert.equal(buffer.length, 1);
  assert.equal(buffer[0].sequence, 1);
  assert.equal(buffer[0].sessionId, freshSessionId);
} finally {
  await first?.server.close();
  await second?.server.close();
  await third?.server.close();
  delete globalThis.fetch;
  delete globalThis.localStorage;
}

console.log('memory session restart boundary checks passed');
