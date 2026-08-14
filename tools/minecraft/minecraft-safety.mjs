import { Vec3 } from 'vec3';

const HAZARD_BLOCK_NAMES = Object.freeze([
  'lava',
  'fire',
  'soul_fire',
  'magma_block',
  'campfire',
  'soul_campfire',
  'cactus',
  'sweet_berry_bush',
  'powder_snow'
]);

function blockName(block) {
  return String(block?.name || '').toLowerCase();
}

function hazardBlock(block) {
  return HAZARD_BLOCK_NAMES.includes(blockName(block));
}

function passable(block) {
  return Boolean(block && block.boundingBox === 'empty' && !hazardBlock(block));
}

function safeFloor(block) {
  return Boolean(block && block.boundingBox === 'block' && !hazardBlock(block));
}

function hazardNear(bot, position, radius = 1) {
  if (!bot?.blockAt || !position) return false;
  const offsets = [
    [0, -1, 0], [0, 0, 0], [0, 1, 0],
    [radius, -1, 0], [radius, 0, 0], [-radius, -1, 0], [-radius, 0, 0],
    [0, -1, radius], [0, 0, radius], [0, -1, -radius], [0, 0, -radius]
  ];
  for (const [dx, dy, dz] of offsets) {
    if (hazardBlock(bot.blockAt(new Vec3(position.x + dx, position.y + dy, position.z + dz)))) return true;
  }
  return false;
}

function lockBoolean(movements, property, value) {
  try {
    Object.defineProperty(movements, property, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: () => {}
    });
  } catch {
    movements[property] = value;
  }
}

export function configureSafeMinecraftMovements(bot, movements, options = {}) {
  if (!movements) throw new Error('Minecraft movements are required.');
  movements.allow1by1towers = false;
  movements.allowParkour = false;
  movements.allowSprinting = false;
  movements.infiniteLiquidDropdownDistance = false;
  movements.maxDropDown = Math.min(2, Number(movements.maxDropDown) || 2);
  movements.liquidCost = Math.max(100, Number(movements.liquidCost) || 0);
  movements.dontCreateFlow = true;
  movements.dontMineUnderFallingBlock = true;

  if (!(movements.blocksToAvoid instanceof Set)) movements.blocksToAvoid = new Set(movements.blocksToAvoid || []);
  for (const name of HAZARD_BLOCK_NAMES) {
    const id = bot?.registry?.blocksByName?.[name]?.id;
    if (Number.isFinite(id)) movements.blocksToAvoid.add(id);
  }

  const exclusion = (candidate) => hazardNear(bot, candidate?.position, 1) ? 100 : 0;
  for (const property of ['exclusionAreasStep', 'exclusionAreasBreak', 'exclusionAreasPlace']) {
    if (!Array.isArray(movements[property])) movements[property] = [];
    if (!movements[property].includes(exclusion)) movements[property].push(exclusion);
  }

  if (options.lockCritical) {
    for (const [property, value] of Object.entries({
      allow1by1towers: false,
      allowParkour: false,
      allowSprinting: false,
      infiniteLiquidDropdownDistance: false,
      dontCreateFlow: true,
      dontMineUnderFallingBlock: true
    })) lockBoolean(movements, property, value);
  }
  return movements;
}

function touchingLava(bot) {
  if (bot?.entity?.isInLava) return true;
  const origin = bot?.entity?.position?.floored?.();
  if (!origin) return false;
  return [origin, origin.offset(0, 1, 0)].some((position) => blockName(bot.blockAt(position)) === 'lava');
}

function countNearbyHazards(bot, position) {
  let count = 0;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (hazardBlock(bot.blockAt(new Vec3(position.x + dx, position.y + dy, position.z + dz)))) count += 1;
      }
    }
  }
  return count;
}

function findEscapeTarget(bot, radius = 8) {
  const origin = bot?.entity?.position?.floored?.();
  if (!origin) return null;
  const candidates = [];
  for (let ring = 1; ring <= radius; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (const dz of [-ring, ring]) candidates.push(origin.offset(dx, 0, dz));
    }
    for (let dz = -ring + 1; dz < ring; dz += 1) {
      for (const dx of [-ring, ring]) candidates.push(origin.offset(dx, 0, dz));
    }
  }
  const valid = [];
  for (const horizontal of candidates) {
    for (const dy of [0, 1, -1, 2]) {
      const feet = horizontal.offset(0, dy, 0);
      if (!passable(bot.blockAt(feet)) || !passable(bot.blockAt(feet.offset(0, 1, 0))) || !safeFloor(bot.blockAt(feet.offset(0, -1, 0)))) continue;
      valid.push({
        position: feet,
        hazards: countNearbyHazards(bot, feet),
        distance: Math.hypot(feet.x - origin.x, feet.z - origin.z),
        climb: Math.max(0, feet.y - origin.y)
      });
    }
  }
  valid.sort((left, right) => left.hazards - right.hazards || left.climb - right.climb || left.distance - right.distance);
  return valid[0]?.position || null;
}

function horizontalDistance(left, right) {
  return Math.hypot(Number(left?.x || 0) - Number(right?.x || 0), Number(left?.z || 0) - Number(right?.z || 0));
}

function stopMotion(bot) {
  try { bot?.pathfinder?.stop?.(); } catch {}
  try { bot?.pathfinder?.setGoal?.(null); } catch {}
  try { bot?.clearControlStates?.(); } catch {}
}

export function installMinecraftSafetySupervisor(bot, callbacks = {}, options = {}) {
  const stuckWindowMs = Math.max(20, Number(options.stuckWindowMs) || 4500);
  const stuckDistance = Math.max(0.2, Number(options.stuckDistance) || 0.65);
  const respawnRetryMs = Math.max(20, Number(options.respawnRetryMs) || 1500);
  const maxRespawnAttempts = Math.max(1, Number(options.maxRespawnAttempts) || 8);
  let dead = false;
  let lavaRecovery = false;
  let lavaTarget = null;
  let lastLavaLookAt = 0;
  let stuckSample = null;
  let stuckPathResets = [];
  let stuckCooldownUntil = 0;
  let respawnTimer = null;
  let respawnAttempts = 0;
  let disposed = false;

  const notify = (type, detail = {}) => callbacks.onEvent?.(type, detail);
  const cancel = (reason) => callbacks.cancelCurrentAction?.(reason);

  const scheduleRespawn = () => {
    if (disposed || !dead || respawnTimer) return;
    respawnTimer = setTimeout(() => {
      respawnTimer = null;
      if (disposed || !dead) return;
      try {
        bot.respawn?.();
        respawnAttempts += 1;
        notify('respawn-requested', { attempt: respawnAttempts });
      } catch (error) {
        notify('respawn-request-failed', { message: String(error?.message || error) });
      }
      if (respawnAttempts >= maxRespawnAttempts) callbacks.onRespawnStalled?.({ attempts: respawnAttempts });
      else scheduleRespawn();
    }, respawnRetryMs);
    respawnTimer.unref?.();
  };

  const onDeath = () => {
    if (dead) return;
    dead = true;
    lavaRecovery = false;
    lavaTarget = null;
    stuckSample = null;
    stuckPathResets = [];
    respawnAttempts = 0;
    stopMotion(bot);
    cancel('death');
    callbacks.onDeath?.();
    scheduleRespawn();
  };

  const onSpawn = () => {
    if (!dead) return;
    dead = false;
    if (respawnTimer) clearTimeout(respawnTimer);
    respawnTimer = null;
    respawnAttempts = 0;
    stopMotion(bot);
    stuckCooldownUntil = Date.now() + 1500;
    callbacks.onRespawn?.();
  };

  const stopStuckRoute = (now, source) => {
    stopMotion(bot);
    cancel('stuck-hopping');
    notify('stuck-hopping-stopped', {
      source,
      position: { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) }
    });
    stuckSample = null;
    stuckPathResets = [];
    stuckCooldownUntil = now + 5000;
  };

  const onPathReset = (reason) => {
    if (disposed || dead || lavaRecovery || reason !== 'stuck' || !bot?.entity?.position) return;
    const now = Date.now();
    const active = callbacks.isActionActive ? callbacks.isActionActive() : true;
    if (!active || now < stuckCooldownUntil) return;
    stuckPathResets = stuckPathResets
      .filter((entry) => now - entry.at <= 12_000 && horizontalDistance(entry.position, bot.entity.position) < 1)
      .concat({ position: bot.entity.position.clone(), at: now });
    if (stuckPathResets.length >= 2) stopStuckRoute(now, 'path-reset');
  };

  const onPhysicsTick = () => {
    if (disposed || dead || !bot?.entity?.position) return;
    const now = Date.now();
    if (touchingLava(bot)) {
      if (!lavaRecovery) {
        lavaRecovery = true;
        lavaTarget = findEscapeTarget(bot);
        stuckSample = null;
        stuckPathResets = [];
        stopMotion(bot);
        cancel('lava-contact');
        notify('lava-recovery-started', { target: lavaTarget ? { x: lavaTarget.x, y: lavaTarget.y, z: lavaTarget.z } : null });
      }
      if (lavaTarget && now - lastLavaLookAt >= 400) {
        lastLavaLookAt = now;
        Promise.resolve(bot.lookAt?.(lavaTarget.offset(0.5, 1, 0.5), true)).catch(() => {});
      }
      bot.setControlState?.('sprint', false);
      bot.setControlState?.('jump', true);
      if (lavaTarget) bot.setControlState?.('forward', true);
      else bot.setControlState?.('back', true);
      return;
    }

    if (lavaRecovery) {
      lavaRecovery = false;
      lavaTarget = null;
      stopMotion(bot);
      stuckCooldownUntil = now + 1500;
      notify('lava-recovery-complete');
      return;
    }

    const jumping = Boolean(bot.getControlState?.('jump'));
    const moving = Boolean(bot.pathfinder?.isMoving?.() || bot.getControlState?.('forward'));
    const actionActive = callbacks.isActionActive ? callbacks.isActionActive() : moving;
    if (!jumping || !moving || !actionActive || now < stuckCooldownUntil) {
      stuckSample = null;
      return;
    }
    if (!stuckSample || horizontalDistance(stuckSample.position, bot.entity.position) >= stuckDistance) {
      stuckSample = { position: bot.entity.position.clone(), at: now };
      return;
    }
    if (now - stuckSample.at < stuckWindowMs) return;
    stopStuckRoute(now, 'control-state');
  };

  bot.on('physicsTick', onPhysicsTick);
  bot.on('path_reset', onPathReset);
  bot.on('death', onDeath);
  bot.on('spawn', onSpawn);

  return {
    status: () => ({ lock: dead ? 'dead' : lavaRecovery ? 'lava-recovery' : '', dead, lavaRecovery }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (respawnTimer) clearTimeout(respawnTimer);
      respawnTimer = null;
      bot.removeListener('physicsTick', onPhysicsTick);
      bot.removeListener('path_reset', onPathReset);
      bot.removeListener('death', onDeath);
      bot.removeListener('spawn', onSpawn);
      stopMotion(bot);
    }
  };
}
