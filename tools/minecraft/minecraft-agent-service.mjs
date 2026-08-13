import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mineflayer from 'mineflayer';
import minecraftData from 'minecraft-data';
import pathfinderModule from 'mineflayer-pathfinder';
import collectBlockModule from 'mineflayer-collectblock';
import toolPlugin from 'mineflayer-tool';
import { Vec3 } from 'vec3';
import {
  normalizeMinecraftAction,
  normalizeMinecraftConfig
} from './minecraft-action-policy.mjs';

const { pathfinder, Movements, goals } = pathfinderModule;
const collectBlockPlugin = collectBlockModule.plugin || collectBlockModule;

const SERVICE_NAME = 'yachiyo-minecraft-agent';
const SERVICE_HOST = '127.0.0.1';
const DEFAULT_PORT = 3303;
const MAX_BODY_BYTES = 64 * 1024;
const ACTION_TIMEOUT_MS = 45_000;
const RECENT_EVENTS_LIMIT = 24;
const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

const servicePort = Math.max(1, Math.min(65535, Number(arg('--port', DEFAULT_PORT)) || DEFAULT_PORT));
const parentPid = Math.max(0, Number(arg('--parent-pid', 0)) || 0);
const authProfilesFolder = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'YachiyoLive2DStudio',
  'minecraft-auth'
);

let config = normalizeMinecraftConfig();
let bot = null;
let mcData = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let intentionalDisconnect = false;
let taskSequence = 0;
let queueGeneration = 0;
let activeTask = null;
let actionQueue = Promise.resolve();
const taskQueue = [];
const recentEvents = [];
const state = {
  phase: 'disabled',
  connected: false,
  spawned: false,
  lastError: '',
  lastDisconnectReason: '',
  lastConnectedAt: 0,
  lastActionAt: 0,
  lastAction: null,
  microsoftLogin: null
};

function event(type, detail = {}) {
  recentEvents.push({ type, at: Date.now(), ...detail });
  if (recentEvents.length > RECENT_EVENTS_LIMIT) recentEvents.splice(0, recentEvents.length - RECENT_EVENTS_LIMIT);
}

function errorMessage(error) {
  return String(error?.message || error || 'Unknown Minecraft error').slice(0, 500);
}

function json(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.sqrt(((a.x - b.x) ** 2) + ((a.y - b.y) ** 2) + ((a.z - b.z) ** 2));
}

function inventorySnapshot() {
  if (!bot?.inventory) return [];
  const counts = new Map();
  for (const item of bot.inventory.items()) counts.set(item.name, (counts.get(item.name) || 0) + item.count);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 36);
}

function nearbySnapshot() {
  if (!bot?.entity?.position) return { players: [], entities: [] };
  const origin = bot.entity.position;
  const players = Object.entries(bot.players || {})
    .filter(([name, player]) => name !== bot.username && player?.entity?.position)
    .map(([name, player]) => ({ name, distance: Math.round(distance(origin, player.entity.position) * 10) / 10 }))
    .filter((entry) => entry.distance <= 64)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 12);
  const entities = Object.values(bot.entities || {})
    .filter((entity) => entity?.position && entity !== bot.entity && entity.name !== 'player')
    .map((entity) => ({
      name: entity.name || entity.displayName || entity.type || 'entity',
      kind: entity.kind || entity.type || '',
      distance: Math.round(distance(origin, entity.position) * 10) / 10
    }))
    .filter((entry) => entry.distance <= 24)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 16);
  return { players, entities };
}

function statusSnapshot() {
  const position = bot?.entity?.position;
  return {
    success: true,
    service: SERVICE_NAME,
    repoRoot,
    servicePort,
    config: {
      enabled: config.enabled,
      trustedServerAcknowledged: config.trustedServerAcknowledged,
      host: config.host,
      port: config.port,
      username: config.username,
      auth: config.auth,
      version: config.version,
      autonomousPlay: config.autonomousPlay,
      decisionIntervalMs: config.decisionIntervalMs,
      autoReconnect: config.autoReconnect,
      maxRetries: config.maxRetries,
      healthThreshold: config.healthThreshold
    },
    state: {
      ...state,
      reconnectAttempts,
      taskQueueDepth: taskQueue.length,
      activeTask,
      position: position ? { x: Math.round(position.x * 10) / 10, y: Math.round(position.y * 10) / 10, z: Math.round(position.z * 10) / 10 } : null,
      health: Number(bot?.health ?? 0),
      food: Number(bot?.food ?? 0),
      gameMode: bot?.game?.gameMode || '',
      dimension: bot?.game?.dimension || '',
      timeOfDay: Number(bot?.time?.timeOfDay ?? 0),
      inventory: inventorySnapshot(),
      nearby: nearbySnapshot(),
      recentEvents: recentEvents.slice(-12)
    }
  };
}

function stopCurrentAction() {
  queueGeneration += 1;
  haltBotControls();
  taskQueue.splice(0);
}

function haltBotControls() {
  try { bot?.pathfinder?.setGoal(null); } catch {}
  try { bot?.collectBlock?.cancelTask?.(); } catch {}
  try { bot?.clearControlStates?.(); } catch {}
}

function scheduleReconnect() {
  if (!config.enabled || !config.autoReconnect || intentionalDisconnect || reconnectTimer) return;
  if (reconnectAttempts >= config.maxRetries) {
    state.phase = 'error';
    state.lastError = 'Minecraft reconnect limit reached.';
    return;
  }
  reconnectAttempts += 1;
  const delay = Math.min(30_000, 1500 * (2 ** Math.max(0, reconnectAttempts - 1)));
  state.phase = 'reconnecting';
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBot().catch((error) => {
      state.lastError = errorMessage(error);
      scheduleReconnect();
    });
  }, delay);
  reconnectTimer.unref?.();
}

async function disconnectBot(reason = 'reconfigure') {
  intentionalDisconnect = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  stopCurrentAction();
  const current = bot;
  bot = null;
  mcData = null;
  if (current) {
    try { current.quit(reason); } catch { try { current.end(reason); } catch {} }
  }
  state.connected = false;
  state.spawned = false;
  state.phase = config.enabled ? 'disconnected' : 'disabled';
}

async function connectBot() {
  if (!config.enabled) return statusSnapshot();
  if (!config.trustedServerAcknowledged) throw new Error('Confirm that this is a trusted Minecraft server before connecting.');
  if (bot) return statusSnapshot();
  intentionalDisconnect = false;
  state.phase = 'connecting';
  state.lastError = '';
  await mkdir(authProfilesFolder, { recursive: true });

  const options = {
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth,
    profilesFolder: authProfilesFolder,
    hideErrors: true,
    onMsaCode: (data) => {
      state.microsoftLogin = {
        verificationUri: String(data?.verification_uri || data?.verificationUri || 'https://www.microsoft.com/link'),
        userCode: String(data?.user_code || data?.userCode || ''),
        expiresAt: Date.now() + (Number(data?.expires_in || data?.expiresIn || 900) * 1000)
      };
      event('microsoft-login-required', { verificationUri: state.microsoftLogin.verificationUri });
    }
  };
  if (config.version) options.version = config.version;
  const nextBot = mineflayer.createBot(options);
  nextBot.loadPlugin(pathfinder);
  nextBot.loadPlugin(toolPlugin.plugin || toolPlugin);
  nextBot.loadPlugin(collectBlockPlugin);
  bot = nextBot;

  nextBot.once('login', () => {
    state.connected = true;
    state.phase = 'joining';
    event('login');
  });
  nextBot.once('spawn', () => {
    if (bot !== nextBot) return;
    mcData = minecraftData(nextBot.version);
    nextBot.pathfinder.setMovements(new Movements(nextBot));
    state.connected = true;
    state.spawned = true;
    state.phase = 'ready';
    state.lastConnectedAt = Date.now();
    state.microsoftLogin = null;
    reconnectAttempts = 0;
    event('spawn', { version: nextBot.version });
  });
  nextBot.on('health', () => {
    if (nextBot.health <= config.healthThreshold) handleLowHealth(nextBot).catch(() => {});
  });
  nextBot.on('kicked', (reason) => {
    state.lastDisconnectReason = String(reason || 'kicked').slice(0, 500);
    event('kicked');
  });
  nextBot.on('error', (error) => {
    state.lastError = errorMessage(error);
    event('error', { message: state.lastError });
  });
  nextBot.once('end', (reason) => {
    if (bot === nextBot) bot = null;
    mcData = null;
    state.connected = false;
    state.spawned = false;
    state.phase = intentionalDisconnect || !config.enabled ? (config.enabled ? 'disconnected' : 'disabled') : 'disconnected';
    state.lastDisconnectReason = String(reason || 'connection ended').slice(0, 500);
    event('end', { reason: state.lastDisconnectReason });
    scheduleReconnect();
  });
  return statusSnapshot();
}

let lowHealthInFlight = false;
async function handleLowHealth(currentBot) {
  if (lowHealthInFlight || currentBot !== bot || currentBot.health > config.healthThreshold) return;
  lowHealthInFlight = true;
  stopCurrentAction();
  event('lowHealth', { health: currentBot.health });
  try {
    const food = currentBot.inventory.items()
      .filter((item) => mcData?.foodsByName?.[item.name])
      .sort((left, right) => (mcData.foodsByName[right.name]?.foodPoints || 0) - (mcData.foodsByName[left.name]?.foodPoints || 0))[0];
    if (food && currentBot.food < 20) {
      await currentBot.equip(food, 'hand');
      await currentBot.consume();
      event('auto-eat', { item: food.name });
    }
  } catch (error) {
    event('auto-eat-failed', { message: errorMessage(error) });
  } finally {
    lowHealthInFlight = false;
  }
}

function readyBot() {
  if (!config.enabled) throw new Error('Minecraft integration is disabled.');
  if (!bot || !state.spawned || state.phase !== 'ready') throw new Error('Minecraft bot is not ready.');
  return bot;
}

async function waitForReadyBot(generation, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (generation !== queueGeneration) throw new Error('Minecraft action was cancelled.');
    if (bot && state.spawned && state.phase === 'ready') return bot;
    if (!config.enabled) throw new Error('Minecraft integration is disabled.');
    if (state.phase === 'error') throw new Error(state.lastError || 'Minecraft connection failed.');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Minecraft bot did not become ready before the action deadline.');
}

async function withTimeout(promise, timeoutMs = ACTION_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Minecraft action timed out.')), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function executeAction(action, generation = queueGeneration) {
  if (action.action === 'observe') return statusSnapshot();
  const currentBot = bot && state.spawned && state.phase === 'ready'
    ? readyBot()
    : await waitForReadyBot(generation);
  if (action.action === 'stop') {
    stopCurrentAction();
    return { success: true, status: 'stopped' };
  }
  if (action.action === 'move') {
    await withTimeout(currentBot.pathfinder.goto(new goals.GoalNear(action.x, action.y, action.z, action.range)));
    return { success: true, status: 'arrived', position: statusSnapshot().state.position };
  }
  if (action.action === 'follow') {
    const player = currentBot.players[action.player]?.entity;
    if (!player) throw new Error(`Player ${action.player} is not visible.`);
    currentBot.pathfinder.setGoal(new goals.GoalFollow(player, action.distance), true);
    return { success: true, status: 'following', player: action.player };
  }
  if (action.action === 'collect') {
    const blockData = mcData.blocksByName[action.block];
    if (!blockData) throw new Error(`Unknown block: ${action.block}.`);
    const blocks = currentBot.findBlocks({ matching: blockData.id, maxDistance: action.radius, count: action.count })
      .map((position) => currentBot.blockAt(position))
      .filter(Boolean);
    if (!blocks.length) throw new Error(`No ${action.block} found within ${action.radius} blocks.`);
    await withTimeout(currentBot.collectBlock.collect(blocks), Math.max(ACTION_TIMEOUT_MS, action.count * 15_000));
    return { success: true, status: 'collected', block: action.block, count: blocks.length };
  }
  if (action.action === 'craft') {
    const item = mcData.itemsByName[action.item];
    if (!item) throw new Error(`Unknown item: ${action.item}.`);
    const recipe = currentBot.recipesFor(item.id, null, action.count, null)[0];
    if (!recipe) throw new Error(`No available recipe for ${action.item}.`);
    await withTimeout(currentBot.craft(recipe, action.count, null));
    return { success: true, status: 'crafted', item: action.item, count: action.count };
  }
  if (action.action === 'place') {
    const item = currentBot.inventory.items().find((entry) => entry.name === action.block);
    if (!item) throw new Error(`No ${action.block} in inventory.`);
    const target = new Vec3(Math.floor(action.x), Math.floor(action.y), Math.floor(action.z));
    const references = [
      { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
      { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
      { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
      { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
      { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) }
    ];
    const reference = references.map(({ offset, face }) => ({ block: currentBot.blockAt(target.plus(offset)), face }))
      .find((entry) => entry.block && entry.block.boundingBox === 'block');
    if (!reference) throw new Error('No solid adjacent block is available for placement.');
    await currentBot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 4));
    await currentBot.equip(item, 'hand');
    await currentBot.placeBlock(reference.block, reference.face);
    return { success: true, status: 'placed', block: action.block, position: { x: target.x, y: target.y, z: target.z } };
  }
  if (action.action === 'attack') {
    const target = Object.values(currentBot.entities || {})
      .filter((entity) => entity && entity !== currentBot.entity && entity.position)
      .filter((entity) => entity.type !== 'player' && entity.name !== 'player' && !entity.username)
      .filter((entity) => [entity.name, entity.displayName, entity.kind, entity.type].some((value) => String(value || '').toLowerCase() === action.target))
      .map((entity) => ({ entity, distance: distance(currentBot.entity.position, entity.position) }))
      .filter((entry) => entry.distance <= action.radius)
      .sort((left, right) => left.distance - right.distance)[0]?.entity;
    if (!target) throw new Error(`No ${action.target} found within ${action.radius} blocks.`);
    await currentBot.lookAt(target.position.offset(0, target.height || 1, 0), true);
    currentBot.attack(target);
    return { success: true, status: 'attacked', target: action.target };
  }
  currentBot.chat(action.message);
  return { success: true, status: 'sent', message: action.message };
}

function enqueueAction(rawAction) {
  const action = normalizeMinecraftAction(rawAction);
  if (action.action === 'stop') {
    stopCurrentAction();
    return { success: true, status: 'stopped', action };
  }
  const task = {
    id: `mc-${++taskSequence}`,
    action,
    queuedAt: Date.now(),
    generation: queueGeneration
  };
  taskQueue.push(task);
  const run = async () => {
    if (task.generation !== queueGeneration) {
      const cancelledIndex = taskQueue.findIndex((entry) => entry.id === task.id);
      if (cancelledIndex >= 0) taskQueue.splice(cancelledIndex, 1);
      event('action-cancelled', { taskId: task.id, action: action.action });
      return { success: false, status: 'cancelled', action, taskId: task.id };
    }
    const index = taskQueue.findIndex((entry) => entry.id === task.id);
    if (index >= 0) taskQueue.splice(index, 1);
    activeTask = { ...task, startedAt: Date.now() };
    try {
      const result = await executeAction(action, task.generation);
      state.lastActionAt = Date.now();
      state.lastAction = { ...action, success: true };
      event('action-complete', { taskId: task.id, action: action.action });
      return { ...result, action, taskId: task.id };
    } catch (error) {
      haltBotControls();
      state.lastActionAt = Date.now();
      state.lastAction = { ...action, success: false, error: errorMessage(error) };
      event('action-failed', { taskId: task.id, action: action.action, message: errorMessage(error) });
      throw error;
    } finally {
      activeTask = null;
    }
  };
  const promise = actionQueue.then(run, run);
  actionQueue = promise.catch(() => {});
  promise.catch(() => {});
  return {
    success: true,
    status: 'queued',
    taskId: task.id,
    queueDepth: taskQueue.length,
    action
  };
}

async function configure(next) {
  const normalized = normalizeMinecraftConfig(next);
  const changed = JSON.stringify(normalized) !== JSON.stringify(config);
  config = normalized;
  if (changed || !config.enabled) await disconnectBot('reconfigure');
  if (config.enabled) await connectBot();
  return statusSnapshot();
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${SERVICE_HOST}:${servicePort}`);
    if (request.method === 'GET' && requestUrl.pathname === '/healthz') return json(response, 200, statusSnapshot());
    if (request.method === 'POST' && requestUrl.pathname === '/api/minecraft/status') return json(response, 200, statusSnapshot());
    if (request.method === 'POST' && requestUrl.pathname === '/api/minecraft/configure') return json(response, 200, await configure(await bodyJson(request)));
    if (request.method === 'POST' && requestUrl.pathname === '/api/minecraft/action') return json(response, 202, enqueueAction(await bodyJson(request)));
    if (request.method === 'POST' && requestUrl.pathname === '/api/minecraft/disconnect') {
      config = normalizeMinecraftConfig({ ...config, enabled: false });
      await disconnectBot('manual');
      return json(response, 200, statusSnapshot());
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/minecraft/shutdown') {
      await disconnectBot('shutdown');
      json(response, 200, { success: true });
      setImmediate(() => server.close(() => process.exit(0)));
      return;
    }
    return json(response, 404, { success: false, message: 'Unknown Minecraft route.' });
  } catch (error) {
    return json(response, 400, { success: false, message: errorMessage(error), status: statusSnapshot() });
  }
});

async function shutdown() {
  await disconnectBot('shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
function fatal(error) {
  state.lastError = errorMessage(error);
  event('fatal-error', { message: state.lastError });
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
}

process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);
server.on('error', fatal);

server.listen(servicePort, SERVICE_HOST, () => {
  event('service-started', { port: servicePort });
});

if (parentPid > 0) {
  const parentWatchdog = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      shutdown().catch(() => process.exit(0));
    }
  }, 2000);
  parentWatchdog.unref();
}
