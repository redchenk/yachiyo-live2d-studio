export const MINECRAFT_ACTION_TYPES = Object.freeze([
  'observe',
  'move',
  'follow',
  'collect',
  'craft',
  'place',
  'place_near',
  'construct_shelter',
  'mine_down',
  'go_surface',
  'attack',
  'explore',
  'eat',
  'equip',
  'sleep',
  'smelt',
  'skill',
  'chat',
  'stop'
]);

const ACTION_SET = new Set(MINECRAFT_ACTION_TYPES);
const NAME_PATTERN = /^[a-z0-9_:\-. ]+$/i;

function text(value, maxLength = 80) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function finite(value, fallback, min, max) {
  const numeric = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(numeric) ? numeric : fallback));
}

function integer(value, fallback, min, max) {
  return Math.round(finite(value, fallback, min, max));
}

function safeName(value, field) {
  const normalized = text(value).toLowerCase().replace(/\s+/g, '_');
  if (!normalized || !NAME_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid.`);
  }
  return normalized;
}

export function normalizeMinecraftAction(input = {}) {
  const source = typeof input === 'string' ? { action: input } : (input || {});
  const action = text(source.action || source.type || source.command, 24).toLowerCase();
  if (!ACTION_SET.has(action)) throw new Error(`Unsupported Minecraft action: ${action || 'empty'}.`);

  if (action === 'observe' || action === 'stop') return { action };
  if (action === 'move') {
    return {
      action,
      x: finite(source.x, 0, -30_000_000, 30_000_000),
      y: finite(source.y, 64, -64, 512),
      z: finite(source.z, 0, -30_000_000, 30_000_000),
      range: integer(source.range, 2, 1, 8)
    };
  }
  if (action === 'follow') {
    return {
      action,
      player: safeName(source.player || source.username || source.target, 'player'),
      distance: integer(source.distance, 3, 2, 12)
    };
  }
  if (action === 'collect') {
    return {
      action,
      block: safeName(source.block || source.blockType || source.target, 'block'),
      count: integer(source.count, 1, 1, 16),
      radius: integer(source.radius, 24, 4, 48)
    };
  }
  if (action === 'craft') {
    return {
      action,
      item: safeName(source.item || source.itemType || source.target, 'item'),
      count: integer(source.count, 1, 1, 16)
    };
  }
  if (action === 'explore') return { action, radius: integer(source.radius, 24, 8, 64) };
  if (action === 'eat' || action === 'sleep') return { action };
  if (action === 'equip') {
    const destination = text(source.destination || source.slot || 'auto', 16).toLowerCase();
    return {
      action,
      item: safeName(source.item || source.itemType || source.target, 'item'),
      destination: ['auto', 'hand', 'head', 'torso', 'legs', 'feet', 'off-hand'].includes(destination) ? destination : 'auto'
    };
  }
  if (action === 'smelt') {
    return {
      action,
      item: safeName(source.item || source.itemType || source.input, 'item'),
      fuel: safeName(source.fuel || 'coal', 'fuel'),
      count: integer(source.count, 1, 1, 16)
    };
  }
  if (action === 'skill') {
    const skill = text(source.skill || source.name, 48).toLowerCase();
    if (!['bootstrap_survival', 'secure_food', 'build_shelter', 'gather_resource'].includes(skill)) {
      throw new Error(`Unsupported Minecraft skill: ${skill || 'empty'}.`);
    }
    const normalized = { action, skill };
    if (skill === 'gather_resource') {
      normalized.target = safeName(source.target || source.item || source.block, 'skill target');
      normalized.count = integer(source.count, 8, 1, 64);
    }
    return normalized;
  }
  if (action === 'construct_shelter') return { action, block: safeName(source.block || source.item, 'building block') };
  if (action === 'mine_down') return { action, depth: integer(source.depth || source.distance, 8, 1, 24) };
  if (action === 'go_surface') return { action };
  if (action === 'place') {
    return {
      action,
      block: safeName(source.block || source.blockType || source.item, 'block'),
      x: finite(source.x, 0, -30_000_000, 30_000_000),
      y: finite(source.y, 64, -64, 512),
      z: finite(source.z, 0, -30_000_000, 30_000_000)
    };
  }
  if (action === 'place_near') {
    return {
      action,
      block: safeName(source.block || source.blockType || source.item, 'block'),
      radius: integer(source.radius, 4, 2, 12)
    };
  }
  if (action === 'attack') {
    return {
      action,
      target: safeName(source.target || source.entity || source.mob, 'target'),
      radius: integer(source.radius, 8, 2, 16)
    };
  }

  const message = text(source.message || source.text, 180);
  if (!message) throw new Error('Minecraft chat message is required.');
  if (message.startsWith('/')) throw new Error('Minecraft chat cannot start with a slash command.');
  return { action, message };
}

export function normalizeMinecraftConfig(input = {}) {
  const auth = text(input.auth || 'offline', 16).toLowerCase();
  return {
    enabled: Boolean(input.enabled),
    trustedServerAcknowledged: Boolean(input.trustedServerAcknowledged),
    host: text(input.host || '127.0.0.1', 255) || '127.0.0.1',
    port: integer(input.port, 25565, 1, 65535),
    username: text(input.username || 'Yachiyo', 80) || 'Yachiyo',
    auth: auth === 'microsoft' ? 'microsoft' : 'offline',
    version: text(input.version || '', 32),
    autonomousPlay: input.autonomousPlay !== false,
    autonomousGoal: text(input.autonomousGoal || '', 500),
    decisionIntervalMs: integer(input.decisionIntervalMs, 6500, 3000, 30000),
    autoReconnect: input.autoReconnect !== false,
    maxRetries: integer(input.maxRetries, 5, 0, 20),
    healthThreshold: integer(input.healthThreshold, 8, 2, 18)
  };
}
