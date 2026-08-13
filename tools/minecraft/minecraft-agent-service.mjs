import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
import {
  evaluateMinecraftCurriculum,
  nextMinecraftSkillStep,
  verifyMinecraftSkillStep
} from '../../src/shared/minecraftSurvivalSkills.mjs';

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
const skillMemoryPath = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'YachiyoLive2DStudio',
  'minecraft-skill-memory.json'
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
let lowHealthInFlight = false;
let drowningRecovery = false;
let skillMemory = {};
let skillMemoryLoadPromise = null;
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
  microsoftLogin: null,
  shelterPosition: null,
  miningEntrance: null,
  workstationPositions: {},
  activeSkill: null
};

function event(type, detail = {}) {
  recentEvents.push({ type, at: Date.now(), ...detail });
  if (recentEvents.length > RECENT_EVENTS_LIMIT) recentEvents.splice(0, recentEvents.length - RECENT_EVENTS_LIMIT);
}

function errorMessage(error) {
  return String(error?.message || error || 'Unknown Minecraft error').slice(0, 500);
}

async function loadSkillMemory() {
  if (!skillMemoryLoadPromise) skillMemoryLoadPromise = (async () => {
    try {
      const parsed = JSON.parse(await readFile(skillMemoryPath, 'utf8'));
      if (parsed && typeof parsed === 'object') skillMemory = parsed;
    } catch {}
  })();
  await skillMemoryLoadPromise;
}

function worldMemoryKey() {
  return `${String(config.host || '').toLowerCase()}:${config.port}:${config.username}`;
}

function restoreWorldMemory() {
  const world = skillMemory.__worlds?.[worldMemoryKey()] || {};
  state.shelterPosition = world.shelterPosition || null;
  state.miningEntrance = world.miningEntrance || null;
  state.workstationPositions = world.workstationPositions || {};
}

async function persistWorldMemory(patch = {}) {
  const worlds = skillMemory.__worlds || {};
  worlds[worldMemoryKey()] = { ...(worlds[worldMemoryKey()] || {}), ...patch, updatedAt: Date.now() };
  skillMemory.__worlds = worlds;
  await mkdir(path.dirname(skillMemoryPath), { recursive: true });
  await writeFile(skillMemoryPath, `${JSON.stringify(skillMemory, null, 2)}\n`, 'utf8');
}

async function recordSkillAttempt(skill, success, detail = {}) {
  const current = skillMemory[skill] || { attempts: 0, successes: 0, failures: 0, lastSuccessAt: 0, lastFailureAt: 0, recent: [] };
  current.attempts += 1;
  current.successes += success ? 1 : 0;
  current.failures += success ? 0 : 1;
  if (success) current.lastSuccessAt = Date.now();
  else current.lastFailureAt = Date.now();
  current.successRate = current.attempts ? Math.round((current.successes / current.attempts) * 1000) / 1000 : 0;
  current.recent = [...(current.recent || []), { success, at: Date.now(), ...detail }].slice(-12);
  skillMemory[skill] = current;
  await mkdir(path.dirname(skillMemoryPath), { recursive: true });
  await writeFile(skillMemoryPath, `${JSON.stringify(skillMemory, null, 2)}\n`, 'utf8');
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

function equipmentSnapshot() {
  if (!bot) return {};
  const slots = { hand: 36, 'off-hand': 45, feet: 8, legs: 7, torso: 6, head: 5 };
  return Object.fromEntries(Object.entries(slots).map(([name, slot]) => [name, bot.inventory?.slots?.[slot]?.name || '']));
}

function blockSnapshot() {
  if (!bot?.entity?.position || !mcData) return [];
  const workstationNames = ['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest'];
  const workstationSet = new Set(workstationNames);
  const usefulNames = [...new Set([...workstationNames, 'stone', 'cobblestone', ...Object.keys(mcData.blocksByName).filter((name) => /_(?:bed|log|stem|ore)$/.test(name))])];
  const namesById = new Map(usefulNames
    .map((name) => [mcData.blocksByName[name]?.id, name])
    .filter(([id]) => Number.isFinite(id)));
  const found = bot.findBlocks({ matching: [...namesById.keys()], maxDistance: 48, count: 96 })
    .map((position) => {
      const block = bot.blockAt(position);
      return block ? {
        name: namesById.get(block.type) || block.name,
        x: position.x,
        y: position.y,
        z: position.z,
        distance: Math.round(distance(bot.entity.position, position) * 10) / 10,
        workstation: workstationSet.has(namesById.get(block.type) || block.name)
      } : null;
    })
    .filter(Boolean);
  for (const block of found) {
    if (workstationSet.has(block.name)) state.workstationPositions[block.name] = { x: block.x, y: block.y, z: block.z };
  }
  const remembered = Object.entries(state.workstationPositions || {})
    .filter(([name]) => workstationSet.has(name))
    .map(([name, position]) => ({
      name,
      x: Number(position.x),
      y: Number(position.y),
      z: Number(position.z),
      distance: Math.round(distance(bot.entity.position, position) * 10) / 10,
      workstation: true,
      remembered: true
    }));
  return [...new Map([...found, ...remembered].map((block) => [`${block.name}:${block.x}:${block.y}:${block.z}`, block])).values()]
    .sort((left, right) => Number(Boolean(right.workstation)) - Number(Boolean(left.workstation)) || left.distance - right.distance)
    .slice(0, 32);
}

async function findKnownWorkstation(currentBot, names, maxDistance = 48) {
  const ids = names.map((name) => mcData.blocksByName[name]?.id).filter(Number.isFinite);
  let block = currentBot.findBlock({ matching: ids, maxDistance });
  if (block) {
    state.workstationPositions[block.name] = { x: block.position.x, y: block.position.y, z: block.position.z };
    await persistWorldMemory({ workstationPositions: state.workstationPositions });
    return block;
  }
  for (const name of names) {
    const remembered = state.workstationPositions?.[name];
    if (!remembered) continue;
    await withTimeout(currentBot.pathfinder.goto(new goals.GoalNear(remembered.x, remembered.y, remembered.z, 3)), 120_000);
    block = currentBot.blockAt(new Vec3(remembered.x, remembered.y, remembered.z));
    if (block?.name === name) return block;
    delete state.workstationPositions[name];
    await persistWorldMemory({ workstationPositions: state.workstationPositions });
  }
  return null;
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
  const inventory = inventorySnapshot();
  const equipment = equipmentSnapshot();
  const nearbyBlocks = blockSnapshot();
  const nearby = nearbySnapshot();
  const skillStats = Object.fromEntries(Object.entries(skillMemory)
    .filter(([key]) => !key.startsWith('__'))
    .map(([key, value]) => [key, { ...value, recent: (value.recent || []).slice(-3) }]));
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
      autonomousGoal: config.autonomousGoal,
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
      safetyLock: lowHealthInFlight ? 'low-health' : drowningRecovery ? 'drowning' : '',
      position: position ? { x: Math.round(position.x * 10) / 10, y: Math.round(position.y * 10) / 10, z: Math.round(position.z * 10) / 10 } : null,
      health: Number(bot?.health ?? 0),
      food: Number(bot?.food ?? 0),
      oxygen: Number(bot?.oxygenLevel ?? 20),
      gameMode: bot?.game?.gameMode || '',
      dimension: bot?.game?.dimension || '',
      timeOfDay: Number(bot?.time?.timeOfDay ?? 0),
      isRaining: Boolean(bot?.isRaining),
      isSleeping: Boolean(bot?.isSleeping),
      inventory,
      equipment,
      nearbyBlocks,
      nearby,
      curriculum: evaluateMinecraftCurriculum({
        ...state,
        food: Number(bot?.food ?? 0),
        inventory,
        nearbyBlocks,
        nearby
      }),
      skillMemory: skillStats,
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
  drowningRecovery = false;
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
  let hasSpawned = false;
  nextBot.on('spawn', () => {
    if (bot !== nextBot) return;
    mcData = minecraftData(nextBot.version);
    nextBot.pathfinder.setMovements(new Movements(nextBot));
    state.connected = true;
    state.spawned = true;
    state.phase = 'ready';
    state.lastConnectedAt = Date.now();
    state.microsoftLogin = null;
    reconnectAttempts = 0;
    event(hasSpawned ? 'respawn' : 'spawn', { version: nextBot.version });
    hasSpawned = true;
  });
  nextBot.on('health', () => {
    if (nextBot.health <= config.healthThreshold) handleLowHealth(nextBot).catch(() => {});
  });
  nextBot.on('physicsTick', () => {
    if (bot !== nextBot) return;
    if (Number(nextBot.oxygenLevel) <= 8 && !drowningRecovery) {
      drowningRecovery = true;
      stopCurrentAction();
      nextBot.setControlState('jump', true);
      event('drowning-recovery-started', { oxygen: Number(nextBot.oxygenLevel) });
    } else if (drowningRecovery && Number(nextBot.oxygenLevel) >= 18) {
      nextBot.setControlState('jump', false);
      drowningRecovery = false;
      event('drowning-recovery-complete', { oxygen: Number(nextBot.oxygenLevel) });
    }
  });
  nextBot.on('death', () => {
    stopCurrentAction();
    drowningRecovery = false;
    state.phase = 'dead';
    event('death');
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
    drowningRecovery = false;
    state.phase = intentionalDisconnect || !config.enabled ? (config.enabled ? 'disconnected' : 'disabled') : 'disconnected';
    state.lastDisconnectReason = String(reason || 'connection ended').slice(0, 500);
    event('end', { reason: state.lastDisconnectReason });
    scheduleReconnect();
  });
  return statusSnapshot();
}

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

function findSafePlacement(currentBot, radius = 4) {
  const origin = currentBot.entity.position.floored();
  const candidates = [];
  for (let distance = 1; distance <= radius; distance += 1) {
    for (let dx = -distance; dx <= distance; dx += 1) {
      for (const dz of [-distance, distance]) candidates.push(origin.offset(dx, 0, dz));
    }
    for (let dz = -distance + 1; dz < distance; dz += 1) {
      for (const dx of [-distance, distance]) candidates.push(origin.offset(dx, 0, dz));
    }
  }
  return candidates.find((position) => {
    const target = currentBot.blockAt(position);
    const head = currentBot.blockAt(position.offset(0, 1, 0));
    const floor = currentBot.blockAt(position.offset(0, -1, 0));
    return target?.boundingBox === 'empty' && head?.boundingBox === 'empty' && floor?.boundingBox === 'block';
  }) || null;
}

async function placeAt(currentBot, blockName, target, generation) {
  if (generation !== queueGeneration) throw new Error('Minecraft action was cancelled.');
  if (currentBot.blockAt(target)?.boundingBox === 'block') return false;
  const item = currentBot.inventory.items().find((entry) => entry.name === blockName);
  if (!item) throw new Error(`No ${blockName} remains in inventory.`);
  const references = [
    { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
    { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
    { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
    { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
    { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
    { offset: new Vec3(0, 1, 0), face: new Vec3(0, -1, 0) }
  ];
  const reference = references.map(({ offset, face }) => ({ block: currentBot.blockAt(target.plus(offset)), face }))
    .find((entry) => entry.block && entry.block.boundingBox === 'block');
  if (!reference) throw new Error(`No placement reference exists at ${target.x},${target.y},${target.z}.`);
  await currentBot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 4));
  await currentBot.equip(item, 'hand');
  await currentBot.placeBlock(reference.block, reference.face);
  return true;
}

async function constructShelter(currentBot, blockName, generation) {
  const originPosition = currentBot.entity.position.floored();
  let origin = null;
  for (let radius = 3; radius <= 8 && !origin; radius += 1) {
    const candidates = [
      originPosition.offset(radius, 0, 0), originPosition.offset(-radius, 0, 0),
      originPosition.offset(0, 0, radius), originPosition.offset(0, 0, -radius)
    ];
    origin = candidates.find((candidate) => {
      for (let x = 0; x < 3; x += 1) for (let z = 0; z < 3; z += 1) {
        const floor = currentBot.blockAt(candidate.offset(x, -1, z));
        for (let y = 0; y < 3; y += 1) {
          if (currentBot.blockAt(candidate.offset(x, y, z))?.boundingBox !== 'empty') return false;
        }
        if (floor?.boundingBox !== 'block') return false;
      }
      return true;
    }) || null;
  }
  if (!origin) throw new Error('No safe nearby area is available for a shelter.');
  const baseY = origin.y;
  const shell = [];
  for (let x = 0; x < 3; x += 1) {
    for (let z = 0; z < 3; z += 1) {
      if (x !== 0 && x !== 2 && z !== 0 && z !== 2) continue;
      if (x === 1 && z === 0) continue;
      shell.push(new Vec3(origin.x + x, baseY, origin.z + z));
      shell.push(new Vec3(origin.x + x, baseY + 1, origin.z + z));
      shell.push(new Vec3(origin.x + x, baseY + 2, origin.z + z));
    }
  }
  const roof = [];
  for (let x = 0; x < 3; x += 1) for (let z = 0; z < 3; z += 1) roof.push(new Vec3(origin.x + x, baseY + 2, origin.z + z));
  const positions = [...new Map([...shell, ...roof].map((position) => [position.toString(), position])).values()];
  const required = positions.filter((position) => currentBot.blockAt(position)?.boundingBox !== 'block').length;
  const available = currentBot.inventory.items().filter((item) => item.name === blockName).reduce((sum, item) => sum + item.count, 0);
  if (available < required) throw new Error(`Shelter needs ${required} ${blockName}, but inventory has ${available}.`);
  for (const position of positions) await placeAt(currentBot, blockName, position, generation);
  state.shelterPosition = { x: origin.x + 1, y: baseY, z: origin.z + 1 };
  await persistWorldMemory({ shelterPosition: state.shelterPosition });
  return { success: true, status: 'shelter-built', block: blockName, blocks: required, position: state.shelterPosition };
}

async function mineDown(currentBot, depth, generation) {
  const start = currentBot.entity.position.floored();
  const remembered = state.miningEntrance;
  const rememberedDistance = remembered
    ? Math.hypot(start.x - remembered.x, start.z - remembered.z)
    : Infinity;
  if (!remembered || (start.y >= Number(remembered.y || start.y) - 1 && rememberedDistance > 8)) {
    state.miningEntrance = { x: start.x, y: start.y, z: start.z };
    await persistWorldMemory({ miningEntrance: state.miningEntrance });
  }
  let completed = 0;
  for (let index = 1; index <= depth; index += 1) {
    if (generation !== queueGeneration) throw new Error('Minecraft action was cancelled.');
    const feetPosition = start.offset(index, -index, 0);
    const headPosition = feetPosition.offset(0, 1, 0);
    const support = currentBot.blockAt(feetPosition.offset(0, -1, 0));
    if (!support || ['lava', 'water'].includes(support.name) || support.boundingBox !== 'block') break;
    for (const position of [headPosition, feetPosition]) {
      const block = currentBot.blockAt(position);
      if (!block || ['lava', 'water'].includes(block.name)) throw new Error(`Unsafe fluid encountered while descending: ${block?.name || 'unknown'}.`);
      if (block.boundingBox === 'empty') continue;
      await currentBot.tool.equipForBlock(block);
      if (!block.canHarvest(currentBot.heldItem?.type || null)) throw new Error(`The equipped tool cannot mine ${block.name}.`);
      await currentBot.dig(block, true);
    }
    await withTimeout(currentBot.pathfinder.goto(new goals.GoalNear(feetPosition.x, feetPosition.y, feetPosition.z, 0)), 20_000);
    completed += 1;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  if (completed < 2) throw new Error('No safe downward mining progress was possible.');
  return { success: true, status: 'descended', depth: completed, position: statusSnapshot().state.position };
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
  if (action.action === 'skill') return executeSkill(action, generation);
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
    let recipeTable = null;
    let recipe = currentBot.recipesFor(item.id, null, action.count, null)[0];
    if (!recipe) {
      recipeTable = await findKnownWorkstation(currentBot, ['crafting_table']);
      recipe = recipeTable ? currentBot.recipesFor(item.id, null, action.count, recipeTable)[0] : null;
    }
    if (!recipe) throw new Error(`No available recipe for ${action.item}.`);
    if (recipeTable) await withTimeout(currentBot.pathfinder.goto(new goals.GoalNear(recipeTable.position.x, recipeTable.position.y, recipeTable.position.z, 3)));
    const crafts = Math.max(1, Math.ceil(action.count / Math.max(1, Number(recipe.result?.count) || 1)));
    await withTimeout(currentBot.craft(recipe, crafts, recipeTable));
    return { success: true, status: 'crafted', item: action.item, count: action.count };
  }
  if (action.action === 'explore') {
    const origin = currentBot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.max(8, action.radius * (0.55 + (Math.random() * 0.45)));
    const x = Math.floor(origin.x + Math.cos(angle) * radius);
    const z = Math.floor(origin.z + Math.sin(angle) * radius);
    await withTimeout(currentBot.pathfinder.goto(new goals.GoalXZ(x, z)), 90_000);
    return { success: true, status: 'explored', position: statusSnapshot().state.position };
  }
  if (action.action === 'eat') {
    const food = currentBot.inventory.items()
      .filter((item) => mcData?.foodsByName?.[item.name])
      .sort((left, right) => (mcData.foodsByName[right.name]?.foodPoints || 0) - (mcData.foodsByName[left.name]?.foodPoints || 0))[0];
    if (!food) throw new Error('No edible food is available.');
    await currentBot.equip(food, 'hand');
    await currentBot.consume();
    return { success: true, status: 'ate', item: food.name, food: currentBot.food };
  }
  if (action.action === 'equip') {
    const item = currentBot.inventory.items().find((entry) => entry.name === action.item);
    if (!item) throw new Error(`No ${action.item} in inventory.`);
    const inferred = /_helmet$/.test(item.name) ? 'head'
      : /_chestplate$/.test(item.name) ? 'torso'
        : /_leggings$/.test(item.name) ? 'legs'
          : /_boots$/.test(item.name) ? 'feet'
            : 'hand';
    const destination = action.destination === 'auto' ? inferred : action.destination;
    await currentBot.equip(item, destination);
    return { success: true, status: 'equipped', item: item.name, destination };
  }
  if (action.action === 'sleep') {
    const bedIds = Object.values(mcData.blocksByName)
      .filter((block) => /_bed$/.test(block.name))
      .map((block) => block.id);
    const bed = currentBot.findBlock({ matching: bedIds, maxDistance: 32 });
    if (!bed) throw new Error('No bed is visible nearby.');
    await withTimeout(currentBot.pathfinder.goto(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2)));
    await currentBot.sleep(bed);
    return { success: true, status: 'sleeping', position: statusSnapshot().state.position };
  }
  if (action.action === 'smelt') {
    const input = currentBot.inventory.items().find((entry) => entry.name === action.item);
    const fuel = currentBot.inventory.items().find((entry) => entry.name === action.fuel);
    if (!input) throw new Error(`No ${action.item} in inventory.`);
    if (!fuel) throw new Error(`No ${action.fuel} in inventory.`);
    const furnaceNames = /(?:^raw_|_ore$)/.test(action.item)
      ? ['blast_furnace', 'furnace']
      : mcData?.foodsByName?.[action.item]
        ? ['smoker', 'furnace']
        : ['furnace'];
    const furnaceBlock = await findKnownWorkstation(currentBot, furnaceNames);
    if (!furnaceBlock) throw new Error('No furnace is visible nearby.');
    await withTimeout(currentBot.pathfinder.goto(new goals.GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 3)));
    const furnace = await currentBot.openFurnace(furnaceBlock);
    try {
      const count = Math.min(action.count, input.count);
      const fuelCapacity = ['coal', 'charcoal'].includes(fuel.name) ? 8
        : fuel.name === 'blaze_rod' ? 12
          : fuel.name === 'coal_block' ? 80
            : fuel.name === 'lava_bucket' ? 100
              : /_(?:log|stem|planks)$/.test(fuel.name) ? 1.5 : 1;
      const fuelCount = Math.min(fuel.count, Math.max(1, Math.ceil(count / fuelCapacity)));
      if (fuelCount * fuelCapacity < count) throw new Error(`Not enough ${fuel.name} to smelt ${count} ${action.item}.`);
      await furnace.putFuel(fuel.type, fuel.metadata, fuelCount);
      await furnace.putInput(input.type, input.metadata, count);
      const deadline = Date.now() + Math.min(180_000, 15_000 + (count * 12_000));
      while (Date.now() < deadline) {
        if (generation !== queueGeneration) throw new Error('Minecraft action was cancelled.');
        const output = furnace.outputItem();
        if (output && output.count >= count) {
          const taken = await furnace.takeOutput();
          return { success: true, status: 'smelted', item: action.item, output: taken?.name || '', count: taken?.count || count };
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(`Smelting ${action.item} did not finish before the deadline.`);
    } finally {
      furnace.close();
    }
  }
  if (action.action === 'place_near') {
    const target = findSafePlacement(currentBot, action.radius);
    if (!target) throw new Error(`No safe nearby position is available for ${action.block}.`);
    return executeAction({ action: 'place', block: action.block, x: target.x, y: target.y, z: target.z }, generation);
  }
  if (action.action === 'construct_shelter') return constructShelter(currentBot, action.block, generation);
  if (action.action === 'mine_down') return mineDown(currentBot, action.depth, generation);
  if (action.action === 'go_surface') {
    const entrance = state.miningEntrance;
    if (!entrance) throw new Error('No remembered mining entrance is available for a safe return path.');
    try {
      await withTimeout(currentBot.pathfinder.goto(new goals.GoalNear(entrance.x, entrance.y, entrance.z, 1)), 120_000);
    } catch (error) {
      state.miningEntrance = null;
      await persistWorldMemory({ miningEntrance: null });
      throw new Error(`The remembered mining return path is no longer reachable: ${errorMessage(error)}`);
    }
    state.miningEntrance = null;
    await persistWorldMemory({ miningEntrance: null });
    return { success: true, status: 'surface-reached', position: statusSnapshot().state.position };
  }
  if (action.action === 'place') {
    const target = new Vec3(Math.floor(action.x), Math.floor(action.y), Math.floor(action.z));
    await placeAt(currentBot, action.block, target, generation);
    if (['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest'].includes(action.block)) {
      state.workstationPositions[action.block] = { x: target.x, y: target.y, z: target.z };
      await persistWorldMemory({ workstationPositions: state.workstationPositions });
    }
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
    await withTimeout((async () => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && currentBot.entities[target.id]) {
        if (currentBot.health <= config.healthThreshold) throw new Error('Combat stopped because health is low.');
        const targetDistance = distance(currentBot.entity.position, target.position);
        if (targetDistance > 3.2) {
          await currentBot.pathfinder.goto(new goals.GoalFollow(target, 2));
        }
        await currentBot.lookAt(target.position.offset(0, target.height || 1, 0), true);
        currentBot.attack(target);
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
    })(), 18_000);
    const pickupDeadline = Date.now() + 6000;
    while (Date.now() < pickupDeadline) {
      const dropped = Object.values(currentBot.entities || {})
        .filter((entity) => entity?.name === 'item' && entity.position)
        .map((entity) => ({ entity, distance: distance(currentBot.entity.position, entity.position) }))
        .filter((entry) => entry.distance <= 10)
        .sort((left, right) => left.distance - right.distance)[0]?.entity;
      if (!dropped) break;
      await withTimeout(currentBot.pathfinder.goto(new goals.GoalFollow(dropped, 1)), 8000).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return { success: true, status: 'combat-complete', target: action.target };
  }
  currentBot.chat(action.message);
  return { success: true, status: 'sent', message: action.message };
}

async function executeSkill(action, generation) {
  const skill = action.skill;
  const parentSkill = state.activeSkill;
  const startedAt = Date.now();
  const maxSteps = skill === 'bootstrap_survival' ? 24 : 12;
  const stageFailures = new Map();
  const trace = [];
  state.activeSkill = { skill, stage: 'starting', step: 0, maxSteps, startedAt };
  event('skill-started', { skill });
  try {
    for (let index = 0; index < maxSteps; index += 1) {
      if (generation !== queueGeneration) throw new Error('Minecraft skill was cancelled.');
      const before = statusSnapshot().state;
      const next = nextMinecraftSkillStep(action, before);
      state.activeSkill = { skill, stage: next.stage, description: next.description, step: index + 1, maxSteps, startedAt };
      trace.push({ stage: next.stage, description: next.description, action: next.action });
      if (next.done) {
        const result = { success: true, status: 'skill-complete', skill, stage: next.stage, steps: index, trace: trace.slice(-8), durationMs: Date.now() - startedAt };
        await recordSkillAttempt(skill, true, { stage: next.stage, steps: index });
        event('skill-complete', { skill, stage: next.stage, steps: index });
        return result;
      }
      event('skill-step', { skill, stage: next.stage, step: index + 1, action: next.action?.action });
      try {
        await executeAction(normalizeMinecraftAction(next.action), generation);
      } catch (error) {
        const count = (stageFailures.get(next.stage) || 0) + 1;
        stageFailures.set(next.stage, count);
        trace.at(-1).error = errorMessage(error);
        event('skill-step-failed', { skill, stage: next.stage, attempt: count, message: errorMessage(error) });
        const exploreCanRecover = ['collect', 'attack', 'mine_down', 'place_near', 'construct_shelter'].includes(next.action?.action);
        if (count >= 3 || !exploreCanRecover) throw new Error(`Skill ${skill} is blocked at ${next.stage}: ${errorMessage(error)}`);
        if (generation !== queueGeneration) throw error;
        await executeAction({ action: 'explore', radius: 12 + (count * 8) }, generation);
        continue;
      }
      const after = statusSnapshot().state;
      const verification = verifyMinecraftSkillStep(next, before, after);
      trace.at(-1).verification = verification;
      if (!verification.success) {
        const count = (stageFailures.get(next.stage) || 0) + 1;
        stageFailures.set(next.stage, count);
        event('skill-verification-failed', { skill, stage: next.stage, attempt: count, message: verification.evidence });
        if (count >= 3) throw new Error(`Skill ${skill} made no verified progress at ${next.stage}: ${verification.evidence}`);
      } else {
        stageFailures.delete(next.stage);
        event('skill-step-complete', { skill, stage: next.stage, message: verification.evidence });
      }
    }
    throw new Error(`Skill ${skill} reached its ${maxSteps}-step safety limit and will be replanned.`);
  } catch (error) {
    await recordSkillAttempt(skill, false, { stage: trace.at(-1)?.stage || '', message: errorMessage(error) });
    event('skill-failed', { skill, stage: trace.at(-1)?.stage || '', message: errorMessage(error) });
    throw error;
  } finally {
    state.activeSkill = parentSkill;
  }
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
      state.lastAction = { taskId: task.id, ...action, success: true, result };
      event('action-complete', { taskId: task.id, action: action.action, result });
      return { ...result, action, taskId: task.id };
    } catch (error) {
      haltBotControls();
      state.lastActionAt = Date.now();
      state.lastAction = { taskId: task.id, ...action, success: false, error: errorMessage(error) };
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
  await loadSkillMemory();
  const normalized = normalizeMinecraftConfig(next);
  const changed = JSON.stringify(normalized) !== JSON.stringify(config);
  config = normalized;
  restoreWorldMemory();
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
