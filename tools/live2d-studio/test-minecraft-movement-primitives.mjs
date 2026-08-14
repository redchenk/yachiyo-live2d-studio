import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { pillarUp } from '../minecraft/minecraft-movement-primitives.mjs';

const key = (position) => `${position.x},${position.y},${position.z}`;
const blocks = new Map();
blocks.set('0,63,0', { name: 'stone', boundingBox: 'block', position: new Vec3(0, 63, 0) });
const air = (position) => ({ name: 'air', boundingBox: 'empty', position });
const bot = new EventEmitter();
bot.entity = { position: new Vec3(0.5, 64, 0.5), onGround: true };
bot.inventory = { items: () => [{ name: 'cobblestone', count: 2 }] };
bot.blockAt = (position) => blocks.get(key(position)) || air(position);
bot.equip = async () => {};
bot.lookAt = async () => {};
bot.clearControlStates = () => {};
let jumpCount = 0;
bot.setControlState = (control, enabled) => {
  if (control !== 'jump' || !enabled) return;
  jumpCount += 1;
  setTimeout(() => {
    bot.entity.position.y = 65.08;
    bot.entity.onGround = false;
    bot.emit('physicsTick');
  }, 0);
};
bot.placeBlock = async (reference, face) => {
  const target = reference.position.plus(face);
  blocks.set(key(target), { name: 'cobblestone', boundingBox: 'block', position: target });
  setTimeout(() => {
    bot.entity.position.y = target.y + 1;
    bot.entity.onGround = true;
    bot.emit('physicsTick');
  }, 0);
};
bot._placeBlockWithOptions = bot.placeBlock;

const result = await pillarUp(bot, 'cobblestone', 1, { jumpTimeoutMs: 200, landingTimeoutMs: 200 });
assert.equal(result.height, 1);
assert.equal(jumpCount, 1, 'one requested level should need one jump, not repeated blind attempts');
assert.equal(blocks.get('0,64,0')?.name, 'cobblestone');
assert.equal(bot.entity.position.y, 65);

console.log('Minecraft movement primitive checks passed');
