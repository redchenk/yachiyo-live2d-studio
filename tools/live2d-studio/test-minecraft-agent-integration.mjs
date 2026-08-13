import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (relativePath) => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const settings = read('src/frontend/services/room/roomSettings.js');
const llm = read('src/frontend/services/room/live2dLlmControl.js');
const page = read('src/frontend/pages/Live2DPage.vue');
const app = read('live2d-studio/src/App.vue');
const settingsPanel = read('live2d-studio/src/components/StudioSettingsPanel.vue');
const launcher = read('tools/live2d-launcher/Live2DStudioLauncher.cs');
const service = read('tools/minecraft/minecraft-agent-service.mjs');
const policy = read('tools/minecraft/minecraft-action-policy.mjs');
const autonomy = read('src/frontend/services/room/live2dMinecraftAutonomy.js');
const planner = read('src/frontend/services/room/live2dMinecraftPlanner.js');
const minecraftPage = read('live2d-studio/src/components/MinecraftPage.vue');

for (const dependency of ['mineflayer', 'mineflayer-pathfinder', 'mineflayer-collectblock', 'mineflayer-tool', 'minecraft-data', 'vec3']) {
  assert.ok(packageJson.dependencies?.[dependency], `Minecraft integration requires ${dependency}`);
}

assert.match(policy, /MINECRAFT_ACTION_TYPES/);
for (const action of ['observe', 'move', 'follow', 'collect', 'craft', 'place', 'place_near', 'construct_shelter', 'mine_down', 'go_surface', 'attack', 'explore', 'eat', 'equip', 'sleep', 'smelt', 'skill', 'chat', 'stop']) {
  assert.match(policy, new RegExp(`['\"]${action}['\"]`), `Minecraft action whitelist must include ${action}`);
}
assert.match(policy, /cannot start with/i, 'Minecraft chat policy must reject slash commands');
assert.doesNotMatch(service, /\beval\s*\(|new\s+Function\s*\(/, 'Minecraft service must never execute LLM-generated code');
assert.match(service, /127\.0\.0\.1/);
assert.match(service, /yachiyo-minecraft-agent/);
assert.match(service, /maxRetries|autoReconnect/);
assert.match(service, /lowHealth|healthThreshold/);
assert.match(service, /taskQueue|actionQueue/);
assert.match(service, /drowning-recovery-started/);
assert.match(service, /action-complete/);
assert.match(service, /executeSkill/);
assert.match(service, /verifyMinecraftSkillStep/);
assert.match(service, /minecraft-skill-memory\.json/);
assert.match(service, /activeSkill/);

assert.match(autonomy, /outcomeHistory/);
assert.match(autonomy, /repeatedFailures/);
assert.match(autonomy, /yielding-to-live/);
assert.match(planner, /private Minecraft Java gameplay planner/);
assert.match(planner, /fallbackLive2DMinecraftPlan/);

assert.match(settings, /ROOM_MINECRAFT_SETTINGS_KEY/);
assert.match(settings, /DEFAULT_ROOM_MINECRAFT_SETTINGS/);
assert.match(settings, /trustedServerAcknowledged/);
assert.match(settings, /readRoomMinecraftSettings/);
assert.match(settings, /writeRoomMinecraftSettings/);

assert.match(llm, /minecraft\s*:/);
assert.match(llm, /normalizeLive2DMinecraftCommand/);
assert.match(llm, /buildLive2DMinecraftPrompt/);
assert.match(page, /executeLive2DMinecraftCommand/);
assert.match(page, /executeMinecraftFromLLMResult/);
assert.match(page, /createLive2DMinecraftAutonomyController/);
assert.match(page, /source === 'live'/);
assert.match(minecraftPage, /autonomousGoal/);
assert.match(minecraftPage, /保存目标/);

assert.match(app, /MinecraftPage/);
assert.match(app, /id:\s*['\"]minecraft['\"]/);
assert.match(settingsPanel, /id:\s*['\"]minecraft['\"]/);
assert.match(settingsPanel, /Minecraft Java/);

assert.match(launcher, /MinecraftAgentServicePort/);
assert.match(launcher, /ShutdownMinecraftAgentService/);
assert.match(launcher, /\/api\/minecraft\/status/);
assert.match(launcher, /\/api\/minecraft\/configure/);
assert.match(launcher, /\/api\/minecraft\/action/);

console.log('Minecraft agent integration checks passed');
