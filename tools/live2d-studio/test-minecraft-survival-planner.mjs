import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

const {
  buildLive2DMinecraftPlannerPrompt,
  fallbackLive2DMinecraftPlan,
  live2DMinecraftPlannerSystemPrompt
} = await server.ssrLoadModule('/src/frontend/services/room/live2dMinecraftPlanner.js');

const context = (state) => ({ goal: 'survive', status: { state } });
const base = { phase: 'ready', position: { x: 0, y: 64, z: 0 }, health: 20, food: 20, inventory: [], nearbyBlocks: [] };

for (const startingState of [base, { ...base, nearbyBlocks: [{ name: 'oak_log', x: 4, y: 64, z: 3 }] }, { ...base, inventory: [{ name: 'oak_log', count: 4 }] }]) {
  assert.deepEqual(fallbackLive2DMinecraftPlan(context(startingState)).action, { action: 'skill', skill: 'bootstrap_survival' });
}
assert.deepEqual(fallbackLive2DMinecraftPlan(context({ ...base, food: 10, inventory: [{ name: 'bread', count: 1 }] })).action, { action: 'eat' });

const prompt = live2DMinecraftPlannerSystemPrompt();
for (const action of ['explore', 'pillar_up', 'find_cave', 'explore_mine', 'eat', 'equip', 'sleep', 'smelt', 'skill']) assert.ok(prompt.includes(`"action":"${action}"`));
assert.match(prompt, /persistent goal/i);
assert.match(prompt, /reuse mine_routes/i);
assert.match(buildLive2DMinecraftPlannerPrompt(context(base)), /CURRENT_GOAL/);
await server.close();
console.log('Minecraft survival planner checks passed');
