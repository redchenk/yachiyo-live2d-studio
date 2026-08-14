import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import {
  normalizeMinecraftAction,
  normalizeMinecraftConfig
} from '../minecraft/minecraft-action-policy.mjs';

assert.deepEqual(normalizeMinecraftAction({ action: 'move', x: Infinity, y: 900, z: -40, range: 99 }), {
  action: 'move', x: 0, y: 512, z: -40, range: 8
});
assert.throws(() => normalizeMinecraftAction({ action: 'chat', message: '/op Yachiyo' }), /cannot start/i);
assert.throws(() => normalizeMinecraftAction({ action: 'javascript', code: 'process.exit()' }), /unsupported/i);
assert.deepEqual(normalizeMinecraftAction({ action: 'explore', radius: 999 }), { action: 'explore', radius: 64 });
assert.deepEqual(normalizeMinecraftAction({ action: 'equip', item: 'iron helmet', destination: 'invalid' }), {
  action: 'equip', item: 'iron_helmet', destination: 'auto'
});
assert.deepEqual(normalizeMinecraftAction({ action: 'smelt', item: 'raw_iron', fuel: 'charcoal', count: 99 }), {
  action: 'smelt', item: 'raw_iron', fuel: 'charcoal', count: 16
});
assert.deepEqual(normalizeMinecraftAction({ action: 'skill', skill: 'gather_resource', target: 'coal', count: 99 }), {
  action: 'skill', skill: 'gather_resource', target: 'coal', count: 64
});
assert.deepEqual(normalizeMinecraftAction({ action: 'place_near', block: 'crafting table', radius: 99 }), {
  action: 'place_near', block: 'crafting_table', radius: 12
});
assert.deepEqual(normalizeMinecraftAction({ action: 'mine_down', depth: 999 }), { action: 'mine_down', depth: 24 });
assert.deepEqual(normalizeMinecraftAction({ action: 'pillar_up', block: 'cobblestone', height: 99 }), {
  action: 'pillar_up', block: 'cobblestone', height: 12
});
assert.deepEqual(normalizeMinecraftAction({ action: 'find_cave', radius: 99 }), { action: 'find_cave', radius: 48 });
assert.deepEqual(normalizeMinecraftAction({ action: 'explore_mine', targetY: -999 }), { action: 'explore_mine', targetY: -60 });
assert.deepEqual(normalizeMinecraftAction({ action: 'construct_shelter', block: 'oak planks' }), { action: 'construct_shelter', block: 'oak_planks' });
assert.throws(() => normalizeMinecraftAction({ action: 'skill', skill: 'write_code' }), /unsupported minecraft skill/i);
assert.equal(normalizeMinecraftConfig({ auth: 'anything', port: 99999 }).auth, 'offline');
assert.equal(normalizeMinecraftConfig({ auth: 'microsoft', port: 99999 }).port, 65535);

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Minecraft test service did not become ready.');
}

async function post(port, route, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { response, data: await response.json() };
}

const port = await freePort();
const child = spawn(process.execPath, ['tools/minecraft/minecraft-agent-service.mjs', '--port', String(port)], {
  cwd: new URL('../..', import.meta.url),
  stdio: ['ignore', 'pipe', 'pipe']
});
let errors = '';
child.stderr.on('data', (chunk) => { errors += chunk.toString(); });

try {
  const health = await waitForHealth(port);
  assert.equal(health.service, 'yachiyo-minecraft-agent');
  assert.equal(health.state.phase, 'disabled');
  assert.equal(health.config.enabled, false);

  const configured = await post(port, '/api/minecraft/configure', {
    enabled: false,
    trustedServerAcknowledged: false,
    host: '127.0.0.1'
  });
  assert.equal(configured.response.status, 200);
  assert.equal(configured.data.state.phase, 'disabled');

  const observed = await post(port, '/api/minecraft/action', { action: 'observe' });
  assert.equal(observed.response.status, 202);
  assert.equal(observed.data.status, 'queued');

  const unsafe = await post(port, '/api/minecraft/action', { action: 'chat', message: '/kill @e' });
  assert.equal(unsafe.response.status, 400);
  assert.match(unsafe.data.message, /cannot start/i);

  const unreachablePort = await freePort();
  const connecting = await post(port, '/api/minecraft/configure', {
    enabled: true,
    trustedServerAcknowledged: true,
    host: '127.0.0.1',
    port: unreachablePort,
    username: 'YachiyoTest',
    auth: 'offline',
    autoReconnect: false,
    maxRetries: 0
  });
  assert.equal(connecting.response.status, 200, connecting.data.message);
  assert.ok(['connecting', 'disconnected'].includes(connecting.data.state.phase));
  await new Promise((resolve) => setTimeout(resolve, 350));
  const disconnected = await post(port, '/api/minecraft/disconnect');
  assert.equal(disconnected.response.status, 200);
  assert.equal(disconnected.data.state.phase, 'disabled');

  const shutdown = await post(port, '/api/minecraft/shutdown');
  assert.equal(shutdown.response.status, 200);
  await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(child.exitCode, 0, errors);
} finally {
  if (child.exitCode === null) child.kill();
}

console.log('Minecraft agent runtime checks passed');
