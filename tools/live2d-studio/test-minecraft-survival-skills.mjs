import assert from 'node:assert/strict';
import {
  evaluateMinecraftCurriculum,
  minecraftSkillPromptSummary,
  nextMinecraftSkillStep,
  verifyMinecraftSkillStep
} from '../../src/shared/minecraftSurvivalSkills.mjs';

const state = (inventory = [], nearbyBlocks = [], extra = {}) => ({
  position: { x: 0, y: 64, z: 0 },
  health: 20,
  food: 20,
  inventory,
  nearbyBlocks,
  nearby: { entities: [] },
  ...extra
});

assert.deepEqual(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, state([], [{ name: 'oak_log' }])).action, {
  action: 'collect', block: 'oak_log', count: 4, radius: 48
});

assert.equal(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, state([
  { name: 'oak_log', count: 4 }
])).action.item, 'oak_planks');

assert.equal(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, state([
  { name: 'oak_planks', count: 12 }
])).action.item, 'crafting_table');

assert.equal(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, state([
  { name: 'oak_planks', count: 12 }, { name: 'crafting_table', count: 1 }
])).action.action, 'place_near');

const stoneStage = state([
  { name: 'oak_planks', count: 12 }, { name: 'stick', count: 4 }, { name: 'wooden_pickaxe', count: 1 }
], [{ name: 'crafting_table' }, { name: 'stone' }]);
assert.deepEqual(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, stoneStage).action, {
  action: 'collect', block: 'stone', count: 11, radius: 48
});

const smeltStage = state([
  { name: 'oak_planks', count: 12 }, { name: 'stick', count: 4 }, { name: 'stone_pickaxe', count: 1 },
  { name: 'cobblestone', count: 11 }, { name: 'coal', count: 2 }, { name: 'raw_iron', count: 3 }
], [{ name: 'crafting_table' }, { name: 'furnace' }]);
assert.equal(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, smeltStage).action.action, 'smelt');

const ironDepthStage = state([
  { name: 'oak_planks', count: 12 }, { name: 'stick', count: 4 }, { name: 'stone_pickaxe', count: 1 },
  { name: 'cobblestone', count: 8 }, { name: 'raw_iron', count: 0 }
], [{ name: 'crafting_table' }, { name: 'furnace' }, { name: 'coal_ore' }], { position: { x: 0, y: 64, z: 0 } });
assert.equal(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, ironDepthStage).action.action, 'mine_down');

const ironComplete = state([
  { name: 'iron_pickaxe', count: 1 }, { name: 'coal', count: 2 }, { name: 'raw_iron', count: 3 },
  { name: 'cobblestone', count: 11 }
], [{ name: 'crafting_table' }, { name: 'furnace' }]);
assert.equal(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, ironComplete).done, true);
assert.equal(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, state([
  { name: 'iron_pickaxe', count: 1 }
], [{ name: 'crafting_table' }, { name: 'furnace' }])).done, true, 'a consumed prerequisite must remain complete when its downstream tool exists');
assert.equal(evaluateMinecraftCurriculum(state([{ name: 'stone_pickaxe', count: 1 }])).milestones
  .find((entry) => entry.id === 'crafting_table').complete, true, 'downstream tools must prove consumed or distant prerequisites');
assert.equal(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, state([
  { name: 'stone_pickaxe', count: 1 }, { name: 'oak_planks', count: 4 }
])).action.item, 'crafting_table', 'a destroyed crafting table must be rebuilt before later workstation recipes');
assert.equal(nextMinecraftSkillStep({ skill: 'bootstrap_survival' }, state([
  { name: 'iron_pickaxe', count: 1 }
], [{ name: 'crafting_table' }, { name: 'furnace' }], {
  position: { x: 12, y: 30, z: 0 }, miningEntrance: { x: 0, y: 64, z: 0 }
})).action.action, 'go_surface');

const hungry = state([{ name: 'bread', count: 2 }], [], { food: 10 });
assert.deepEqual(nextMinecraftSkillStep({ skill: 'secure_food' }, hungry).action, { action: 'eat' });

const animal = state([], [], { nearby: { entities: [{ name: 'cow', distance: 4 }] } });
assert.equal(nextMinecraftSkillStep({ skill: 'secure_food' }, animal).action.target, 'cow');

assert.equal(nextMinecraftSkillStep({ skill: 'build_shelter' }, state([{ name: 'oak_log', count: 6 }])).action.item, 'oak_planks');
assert.deepEqual(nextMinecraftSkillStep({ skill: 'build_shelter' }, state([{ name: 'oak_planks', count: 23 }])).action, {
  action: 'construct_shelter', block: 'oak_planks'
});
assert.equal(nextMinecraftSkillStep({ skill: 'build_shelter' }, state([], [], { shelterPosition: { x: 0, y: 64, z: 0 } })).done, true);

assert.equal(nextMinecraftSkillStep({ skill: 'gather_resource', target: 'coal', count: 8 }, state([
  { name: 'coal', count: 3 }, { name: 'wooden_pickaxe', count: 1 }
], [{ name: 'deepslate_coal_ore' }])).action.count, 5);

assert.deepEqual(nextMinecraftSkillStep({ skill: 'gather_resource', target: 'diamond', count: 2 }, state()).action, {
  action: 'skill', skill: 'bootstrap_survival'
});
assert.equal(nextMinecraftSkillStep({ skill: 'gather_resource', target: 'diamond', count: 2 }, state([
  { name: 'iron_pickaxe', count: 1 }
], [], { position: { x: 0, y: 64, z: 0 } })).action.action, 'mine_down');
assert.equal(nextMinecraftSkillStep({ skill: 'gather_resource', target: 'diamond', count: 2 }, state([
  { name: 'iron_pickaxe', count: 1 }
], [], { position: { x: 0, y: 0, z: 0 } })).action.action, 'mine_down', 'diamond progression must continue below the old Y=20 cutoff');
assert.equal(nextMinecraftSkillStep({ skill: 'gather_resource', target: 'diamond', count: 2 }, state([
  { name: 'iron_pickaxe', count: 1 }, { name: 'diamond', count: 2 }
], [], { position: { x: 12, y: 16, z: 0 }, miningEntrance: { x: 0, y: 64, z: 0 } })).action.action, 'go_surface');

const curriculum = evaluateMinecraftCurriculum(ironComplete);
assert.equal(curriculum.bootstrapComplete, true);
assert.match(minecraftSkillPromptSummary(ironComplete, { bootstrap_survival: { successes: 2 } }), /SAFE_SKILL_LIBRARY/);
assert.deepEqual(verifyMinecraftSkillStep({ verify: { type: 'inventory-increase', item: 'coal' }, action: { action: 'collect' } },
  state([{ name: 'coal', count: 1 }]), state([{ name: 'coal', count: 3 }])).success, true);
assert.equal(verifyMinecraftSkillStep({ verify: { type: 'position-change' }, action: { action: 'explore' } },
  state(), state([], [], { position: { x: 8, y: 64, z: 0 } })).success, true);
assert.equal(verifyMinecraftSkillStep({ verify: { type: 'y-increase' }, action: { action: 'go_surface' } },
  state([], [], { position: { x: 12, y: 16, z: 0 } }), state([], [], { position: { x: 0, y: 64, z: 0 } })).success, true);
assert.throws(() => nextMinecraftSkillStep({ skill: 'javascript' }, state()), /unsupported/i);

console.log('Minecraft survival skill checks passed');
