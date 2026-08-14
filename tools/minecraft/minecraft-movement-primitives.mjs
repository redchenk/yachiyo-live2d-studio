import { Vec3 } from 'vec3';

function waitForBotCondition(bot, predicate, timeoutMs, message, isCancelled = () => false) {
  if (isCancelled()) return Promise.reject(new Error('Minecraft action was cancelled.'));
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      bot.removeListener('physicsTick', check);
      bot.removeListener('move', check);
    };
    const check = () => {
      if (settled) return;
      if (isCancelled()) {
        settled = true;
        cleanup();
        reject(new Error('Minecraft action was cancelled.'));
        return;
      }
      if (!predicate()) return;
      settled = true;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    }, timeoutMs);
    bot.on('physicsTick', check);
    bot.on('move', check);
  });
}

function solid(block) {
  return Boolean(block && block.boundingBox === 'block' && !['water', 'lava'].includes(block.name));
}

function empty(block) {
  return Boolean(block && block.boundingBox === 'empty' && !['water', 'lava'].includes(block.name));
}

export async function pillarUp(bot, blockName, requestedHeight = 1, options = {}) {
  const height = Math.max(1, Math.min(12, Math.round(Number(requestedHeight) || 1)));
  const jumpTimeoutMs = Math.max(100, Number(options.jumpTimeoutMs) || 1800);
  const landingTimeoutMs = Math.max(100, Number(options.landingTimeoutMs) || 2200);
  const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false;
  const available = bot.inventory.items().filter((item) => item.name === blockName).reduce((sum, item) => sum + item.count, 0);
  if (available < height) throw new Error(`Pillar needs ${height} ${blockName}, but inventory has ${available}.`);

  const startedY = bot.entity.position.y;
  let completed = 0;
  try {
    while (completed < height) {
      if (isCancelled()) throw new Error('Minecraft action was cancelled.');
      const feet = bot.entity.position.floored();
      const reference = bot.blockAt(feet.offset(0, -1, 0));
      const destination = feet.clone();
      if (!solid(reference)) throw new Error('Pillar requires a full solid block directly below the player.');
      if (!empty(bot.blockAt(destination))) throw new Error('The pillar destination is not empty.');
      if (!empty(bot.blockAt(destination.offset(0, 2, 0)))) throw new Error('There is not enough headroom to jump-pillar safely.');

      const item = bot.inventory.items().find((entry) => entry.name === blockName);
      if (!item) throw new Error(`No ${blockName} remains for the pillar.`);
      bot.clearControlStates();
      await bot.equip(item, 'hand');
      await bot.lookAt(reference.position.offset(0.5, 1, 0.5), true);

      const placementY = destination.y + 1.01;
      bot.setControlState('jump', true);
      try {
        await waitForBotCondition(bot, () => bot.entity.position.y > placementY, jumpTimeoutMs, 'The player did not reach the pillar placement height.', isCancelled);
        if (typeof bot._placeBlockWithOptions === 'function') {
          await bot._placeBlockWithOptions(reference, new Vec3(0, 1, 0), { forceLook: 'ignore', swingArm: 'right' });
        } else {
          await bot.placeBlock(reference, new Vec3(0, 1, 0));
        }
      } finally {
        bot.setControlState('jump', false);
      }

      await waitForBotCondition(bot, () => solid(bot.blockAt(destination)) && bot.entity.onGround && bot.entity.position.y >= destination.y + 0.9,
        landingTimeoutMs, 'The placed pillar block was not confirmed under the player.', isCancelled);
      if (!solid(bot.blockAt(destination))) throw new Error('The server did not confirm the pillar block.');
      completed += 1;
    }
  } finally {
    bot.setControlState('jump', false);
    bot.clearControlStates();
  }
  return { success: true, status: 'pillared-up', block: blockName, height: completed, yChange: Math.round((bot.entity.position.y - startedY) * 10) / 10 };
}
