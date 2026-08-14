import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import {
  configureSafeMinecraftMovements,
  installMinecraftSafetySupervisor
} from '../minecraft/minecraft-safety.mjs';

function mockBot() {
  const bot = new EventEmitter();
  const controls = new Map();
  bot.entity = { position: new Vec3(0.5, 64, 0.5), onGround: true, isInLava: false };
  bot.registry = {
    blocksByName: {
      lava: { id: 1 }, fire: { id: 2 }, soul_fire: { id: 3 }, magma_block: { id: 4 }, campfire: { id: 5 }
    }
  };
  bot.blockAt = (position) => {
    if (position.y <= 63) return { name: 'stone', type: 20, boundingBox: 'block', position };
    return { name: 'air', type: 0, boundingBox: 'empty', position };
  };
  bot.setControlState = (name, enabled) => controls.set(name, enabled);
  bot.getControlState = (name) => Boolean(controls.get(name));
  bot.clearControlStates = () => controls.clear();
  bot.lookAt = async () => {};
  bot.pathfinder = {
    isMoving: () => true,
    stop: () => {},
    setGoal: () => {}
  };
  bot.controls = controls;
  return bot;
}

{
  const bot = mockBot();
  const movements = {
    blocksToAvoid: new Set(),
    exclusionAreasStep: [],
    exclusionAreasBreak: [],
    exclusionAreasPlace: []
  };
  configureSafeMinecraftMovements(bot, movements);
  assert.equal(movements.allow1by1towers, false);
  assert.equal(movements.allowParkour, false);
  assert.equal(movements.allowSprinting, false);
  assert.equal(movements.infiniteLiquidDropdownDistance, false);
  assert.ok(movements.liquidCost >= 100);
  assert.ok(movements.blocksToAvoid.has(1), 'lava must always be blocked');
  assert.ok(movements.blocksToAvoid.has(4), 'magma must be treated as hazardous');
  assert.ok(movements.exclusionAreasStep.length > 0, 'paths need a safety buffer around lava');
  const originalBlockAt = bot.blockAt;
  bot.blockAt = (position) => position.x === 1 && position.y === 64
    ? { name: 'lava', type: 1, boundingBox: 'empty', position }
    : originalBlockAt(position);
  assert.equal(movements.exclusionAreasStep[0]({ position: new Vec3(0, 64, 0) }), 100, 'a route next to lava must be rejected');

  configureSafeMinecraftMovements(bot, movements, { lockCritical: true });
  movements.dontCreateFlow = false;
  movements.allow1by1towers = true;
  assert.equal(movements.dontCreateFlow, true, 'collectblock must not disable fluid-flow protection');
  assert.equal(movements.allow1by1towers, false, 'collectblock must not restore implicit towers');
}

{
  const bot = mockBot();
  const cancellations = [];
  bot.entity.isInLava = true;
  const supervisor = installMinecraftSafetySupervisor(bot, {
    cancelCurrentAction: (reason) => cancellations.push(reason),
    isActionActive: () => true
  }, { stuckWindowMs: 20, respawnRetryMs: 20 });
  bot.emit('physicsTick');
  assert.deepEqual(cancellations, ['lava-contact']);
  assert.equal(bot.getControlState('jump'), true, 'lava recovery must swim upward');
  assert.equal(bot.getControlState('forward'), true, 'lava recovery must move toward a safe shore');
  bot.entity.isInLava = false;
  bot.emit('physicsTick');
  assert.equal(bot.getControlState('jump'), false, 'escape controls must be released after leaving lava');
  supervisor.dispose();
}

{
  const bot = mockBot();
  const cancellations = [];
  const supervisor = installMinecraftSafetySupervisor(bot, {
    cancelCurrentAction: (reason) => cancellations.push(reason),
    isActionActive: () => true
  }, { stuckWindowMs: 1000, respawnRetryMs: 20 });
  bot.emit('path_reset', 'stuck');
  bot.emit('path_reset', 'stuck');
  assert.deepEqual(cancellations, ['stuck-hopping'], 'two stationary pathfinder resets must break the jump/replan loop');
  supervisor.dispose();
}

{
  const bot = mockBot();
  const cancellations = [];
  bot.setControlState('jump', true);
  const supervisor = installMinecraftSafetySupervisor(bot, {
    cancelCurrentAction: (reason) => cancellations.push(reason),
    isActionActive: () => true
  }, { stuckWindowMs: 20, respawnRetryMs: 20 });
  bot.emit('physicsTick');
  await new Promise((resolve) => setTimeout(resolve, 30));
  bot.emit('physicsTick');
  assert.ok(cancellations.includes('stuck-hopping'), 'stationary repeated jumping must cancel the active route');
  assert.equal(bot.getControlState('jump'), false);
  supervisor.dispose();
}

{
  const bot = mockBot();
  let stalled = 0;
  let respawns = 0;
  bot.respawn = () => { respawns += 1; };
  const supervisor = installMinecraftSafetySupervisor(bot, {
    onRespawnStalled: () => { stalled += 1; }
  }, { respawnRetryMs: 20, maxRespawnAttempts: 2 });
  bot.emit('death');
  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.equal(respawns, 2);
  assert.equal(stalled, 1, 'a server that never confirms spawn must trigger reconnect recovery');
  supervisor.dispose();
}

{
  const bot = mockBot();
  const cancellations = [];
  let deaths = 0;
  let recoveries = 0;
  let respawns = 0;
  bot.respawn = () => { respawns += 1; };
  const supervisor = installMinecraftSafetySupervisor(bot, {
    cancelCurrentAction: (reason) => cancellations.push(reason),
    onDeath: () => { deaths += 1; },
    onRespawn: () => { recoveries += 1; }
  }, { stuckWindowMs: 20, respawnRetryMs: 20 });
  bot.emit('death');
  assert.deepEqual(cancellations, ['death']);
  assert.equal(deaths, 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(respawns >= 1, 'death recovery must actively retry respawning');
  bot.emit('spawn');
  const respawnsAtRecovery = respawns;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(recoveries, 1);
  assert.equal(respawns, respawnsAtRecovery, 'respawn retries must stop after spawn');
  supervisor.dispose();
}

console.log('Minecraft safety checks passed');
