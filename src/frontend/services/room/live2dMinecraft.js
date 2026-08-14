import { readRoomMinecraftSettings } from './roomSettings';
import { readLatestLive2DMinecraftAutonomyState } from './live2dMinecraftAutonomy';

export const LIVE2D_MINECRAFT_ACTIONS = Object.freeze([
  'observe', 'move', 'follow', 'collect', 'craft', 'place', 'place_near', 'construct_shelter', 'pillar_up', 'find_cave', 'explore_mine', 'mine_down', 'go_surface', 'attack',
  'explore', 'eat', 'equip', 'sleep', 'smelt', 'skill', 'chat', 'stop'
]);

const ACTION_SET = new Set(LIVE2D_MINECRAFT_ACTIONS);
let configuredFingerprint = '';
let cachedStatus = null;
let cachedStatusAt = 0;

function clipped(value, maxLength = 80) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

function name(value, field) {
  const result = clipped(value).toLowerCase().replace(/\s+/g, '_');
  if (!result || !/^[a-z0-9_:\-. ]+$/i.test(result)) throw new Error(`${field} 无效`);
  return result;
}

export function normalizeLive2DMinecraftCommand(input = {}) {
  const source = typeof input === 'string' ? { action: input } : (input || {});
  const action = clipped(source.action || source.type || source.command, 24).toLowerCase();
  if (!ACTION_SET.has(action)) return null;
  if (action === 'observe' || action === 'stop') return { action };
  if (action === 'move') return {
    action,
    x: number(source.x, 0, -30_000_000, 30_000_000),
    y: number(source.y, 64, -64, 512),
    z: number(source.z, 0, -30_000_000, 30_000_000),
    range: Math.round(number(source.range, 2, 1, 8))
  };
  if (action === 'follow') return { action, player: name(source.player || source.username || source.target, '玩家名'), distance: Math.round(number(source.distance, 3, 2, 12)) };
  if (action === 'collect') return { action, block: name(source.block || source.blockType || source.target, '方块名'), count: Math.round(number(source.count, 1, 1, 16)), radius: Math.round(number(source.radius, 24, 4, 48)) };
  if (action === 'craft') return { action, item: name(source.item || source.itemType || source.target, '物品名'), count: Math.round(number(source.count, 1, 1, 16)) };
  if (action === 'explore') return { action, radius: Math.round(number(source.radius, 24, 8, 64)) };
  if (action === 'eat' || action === 'sleep') return { action };
  if (action === 'equip') {
    const destination = clipped(source.destination || source.slot || 'auto', 16).toLowerCase();
    return {
      action,
      item: name(source.item || source.itemType || source.target, '物品名'),
      destination: ['auto', 'hand', 'head', 'torso', 'legs', 'feet', 'off-hand'].includes(destination) ? destination : 'auto'
    };
  }
  if (action === 'smelt') return {
    action,
    item: name(source.item || source.itemType || source.input, '物品名'),
    fuel: name(source.fuel || 'coal', '燃料名'),
    count: Math.round(number(source.count, 1, 1, 16))
  };
  if (action === 'skill') {
    const skill = clipped(source.skill || source.name, 48).toLowerCase();
    if (!['bootstrap_survival', 'secure_food', 'build_shelter', 'gather_resource'].includes(skill)) throw new Error(`不支持的 Minecraft 技能：${skill || '空'}`);
    const normalized = { action, skill };
    if (skill === 'gather_resource') {
      normalized.target = name(source.target || source.item || source.block, '技能目标');
      normalized.count = Math.round(number(source.count, 8, 1, 64));
    }
    return normalized;
  }
  if (action === 'place') return { action, block: name(source.block || source.blockType || source.item, '方块名'), x: number(source.x, 0, -30_000_000, 30_000_000), y: number(source.y, 64, -64, 512), z: number(source.z, 0, -30_000_000, 30_000_000) };
  if (action === 'place_near') return { action, block: name(source.block || source.blockType || source.item, '方块名'), radius: Math.round(number(source.radius, 4, 2, 12)) };
  if (action === 'construct_shelter') return { action, block: name(source.block || source.item, '建筑方块') };
  if (action === 'pillar_up') return { action, block: name(source.block || source.item, '垫高方块'), height: Math.round(number(source.height || source.count, 1, 1, 12)) };
  if (action === 'find_cave') return { action, radius: Math.round(number(source.radius, 32, 12, 48)) };
  if (action === 'explore_mine') return { action, targetY: Math.round(number(source.targetY ?? source.y, 16, -60, 320)) };
  if (action === 'mine_down') return { action, depth: Math.round(number(source.depth || source.distance, 8, 1, 24)) };
  if (action === 'go_surface') return { action };
  if (action === 'attack') return { action, target: name(source.target || source.entity || source.mob, '目标'), radius: Math.round(number(source.radius, 8, 2, 16)) };
  const message = clipped(source.message || source.text, 180);
  if (!message || message.startsWith('/')) return null;
  return { action, message };
}

async function post(path, body = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) throw new Error(payload?.message || `Minecraft 请求失败 (${response.status})`);
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

function rememberStatus(payload) {
  const status = payload?.status?.state ? payload.status : payload;
  if (status?.state) {
    cachedStatus = status;
    cachedStatusAt = Date.now();
  }
  return payload;
}

export async function configureLive2DMinecraft(settings = readRoomMinecraftSettings()) {
  const fingerprint = JSON.stringify(settings);
  const result = rememberStatus(await post('/api/minecraft/configure', settings, settings.auth === 'microsoft' ? 12_000 : 7000));
  configuredFingerprint = fingerprint;
  return result;
}

export async function readLive2DMinecraftStatus({ fresh = true } = {}) {
  if (!fresh && cachedStatus && Date.now() - cachedStatusAt < 1500) return cachedStatus;
  const result = rememberStatus(await post('/api/minecraft/status'));
  const settings = readRoomMinecraftSettings();
  if (settings.enabled && settings.trustedServerAcknowledged && result?.config?.enabled !== true) {
    configuredFingerprint = '';
    return configureLive2DMinecraft(settings);
  }
  return result;
}

export async function readLive2DMinecraftTask(taskId) {
  const normalizedTaskId = clipped(taskId, 80);
  if (!normalizedTaskId) return { success: true, taskId: '', status: 'unknown', settled: false };
  return post('/api/minecraft/task', { taskId: normalizedTaskId }, 2500);
}

export async function disconnectLive2DMinecraft() {
  configuredFingerprint = '';
  return rememberStatus(await post('/api/minecraft/disconnect'));
}

export async function executeLive2DMinecraftCommand(input, { settings = readRoomMinecraftSettings() } = {}) {
  const command = normalizeLive2DMinecraftCommand(input);
  if (!command) throw new Error('Minecraft 动作无效或不安全');
  if (!settings.enabled) throw new Error('Minecraft 控制尚未开启');
  if (!settings.trustedServerAcknowledged) throw new Error('请先确认这是可信服务器');
  const fingerprint = JSON.stringify(settings);
  if (fingerprint !== configuredFingerprint) await configureLive2DMinecraft(settings);
  return rememberStatus(await post('/api/minecraft/action', command));
}

function compactList(values, mapper, limit = 8) {
  return (Array.isArray(values) ? values : []).slice(0, limit).map(mapper).filter(Boolean).join(', ') || 'none';
}

export async function buildLive2DMinecraftPrompt() {
  const settings = readRoomMinecraftSettings();
  if (!settings.enabled || !settings.trustedServerAcknowledged) return '';
  try {
    if (JSON.stringify(settings) !== configuredFingerprint) await configureLive2DMinecraft(settings);
    const status = await readLive2DMinecraftStatus({ fresh: false });
    const state = status?.state || {};
    const autonomy = readLatestLive2DMinecraftAutonomyState() || {};
    const position = state.position ? `${state.position.x},${state.position.y},${state.position.z}` : 'unknown';
    const inventory = compactList(state.inventory, (item) => `${item.name}x${item.count}`, 12);
    const players = compactList(state.nearby?.players, (player) => `${player.name}@${player.distance}m`, 8);
    const entities = compactList(state.nearby?.entities, (entity) => `${entity.name}@${entity.distance}m`, 8);
    return [
      '[MINECRAFT_JAVA_STATE]',
      `persistent_goal=${settings.autonomousGoal}`,
      `planner_phase=${autonomy.phase || 'unknown'}; planner_progress=${autonomy.lastDecision?.progress || 'none'}; planner_last_outcome=${autonomy.lastOutcome?.message || autonomy.lastOutcome?.type || 'none'}`,
      `phase=${state.phase || 'unknown'}; position=${position}; health=${state.health ?? 0}; food=${state.food ?? 0}; dimension=${state.dimension || 'unknown'}`,
      `inventory=${inventory}`,
      `equipment=${JSON.stringify(state.equipment || {})}`,
      `nearby_blocks=${compactList(state.nearbyBlocks, (block) => `${block.name}@${block.x},${block.y},${block.z}`, 12)}`,
      `nearby_players=${players}`,
      `nearby_entities=${entities}`,
      `mine_routes=${(state.mineSites || []).length}; active_mine=${state.activeMineSiteId || 'none'}; cave_search_misses=${state.caveSearchMisses || 0}`,
      `active_task=${state.activeTask?.action?.action || 'none'}; active_skill=${state.activeSkill?.skill || 'none'}:${state.activeSkill?.stage || 'idle'}; skill_step=${state.activeSkill?.step || 0}; queued=${state.taskQueueDepth || 0}`
    ].join('\n');
  } catch (error) {
    return `[MINECRAFT_JAVA_STATE]\nphase=unavailable; error=${clipped(error?.message, 160)}`;
  }
}
