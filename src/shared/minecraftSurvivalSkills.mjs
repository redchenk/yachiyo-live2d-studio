export const MINECRAFT_SKILL_IDS = Object.freeze([
  'bootstrap_survival',
  'secure_food',
  'build_shelter',
  'gather_resource'
]);

export const MINECRAFT_SKILL_DOCS = Object.freeze({
  bootstrap_survival: 'Progresses through wood, a crafting table, sticks, wooden and stone tools, a furnace, coal, raw iron and an iron pickaxe. It verifies every milestone from world state and inventory.',
  secure_food: 'Obtains food from nearby passive animals, explores when none are visible, and eats when hunger is low. It never attacks players.',
  build_shelter: 'Collects and crafts enough building material, then constructs a compact shelter with a doorway and roof at a safe nearby position.',
  gather_resource: 'Collects a requested visible block/item until the requested inventory total is reached, exploring between failed searches. Use after the required tool tier exists.'
});

const FOOD_PATTERN = /(?:apple|bread|beef|porkchop|chicken|mutton|rabbit|potato|carrot|berries|melon|cod|salmon|stew)$/;
const PASSIVE_FOOD_MOBS = new Set(['cow', 'pig', 'chicken', 'sheep', 'rabbit', 'cod', 'salmon']);

export function minecraftInventoryCounts(state = {}) {
  return Object.fromEntries((state.inventory || []).map((item) => [String(item.name || ''), Number(item.count || 0)]));
}

function totalMatching(counts, pattern) {
  return Object.entries(counts).reduce((sum, [name, count]) => sum + (pattern.test(name) ? count : 0), 0);
}

function firstInventory(state, pattern) {
  return (state.inventory || []).find((item) => pattern.test(String(item.name || '')));
}

function firstBlock(state, pattern) {
  return (state.nearbyBlocks || []).find((block) => pattern.test(String(block.name || '')));
}

function nearbyEntity(state, allowed) {
  return (state.nearby?.entities || []).find((entity) => allowed.has(String(entity.name || '').toLowerCase()));
}

function hasPlaced(state, name) {
  return Boolean(firstBlock(state, new RegExp(`^${name}$`)));
}

function hasTool(counts, tier, tool) {
  const ranks = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
  const minimum = ranks.indexOf(tier);
  return ranks.slice(Math.max(0, minimum)).some((rank) => Number(counts[`${rank}_${tool}`] || 0) > 0);
}

function milestone(id, complete, label) {
  return { id, complete: Boolean(complete), label };
}

export function evaluateMinecraftCurriculum(state = {}) {
  const counts = minecraftInventoryCounts(state);
  const logs = totalMatching(counts, /_(?:log|stem)$/);
  const planks = totalMatching(counts, /_planks$/);
  const edible = totalMatching(counts, FOOD_PATTERN);
  const craftingReady = Number(counts.crafting_table || 0) > 0 || hasPlaced(state, 'crafting_table');
  const furnaceReady = Number(counts.furnace || 0) > 0 || hasPlaced(state, 'furnace') || hasPlaced(state, 'blast_furnace');
  const fuelReserve = Number(counts.coal || 0) + Number(counts.charcoal || 0) + totalMatching(counts, /_(?:log|stem|planks)$/);
  const woodenPickReady = hasTool(counts, 'wooden', 'pickaxe');
  const stonePickReady = hasTool(counts, 'stone', 'pickaxe');
  const ironPickReady = hasTool(counts, 'iron', 'pickaxe');
  const milestones = [
    milestone('wood', logs >= 4 || planks >= 12 || craftingReady || woodenPickReady, 'obtain wood'),
    milestone('crafting_table', craftingReady || woodenPickReady, 'prepare a crafting table'),
    milestone('wooden_pickaxe', woodenPickReady, 'craft a first pickaxe'),
    milestone('stone_supply', Number(counts.cobblestone || 0) + Number(counts.cobbled_deepslate || 0) >= 8 || stonePickReady, 'mine stone'),
    milestone('stone_pickaxe', stonePickReady, 'upgrade to a stone pickaxe'),
    milestone('furnace', furnaceReady || ironPickReady, 'prepare a furnace'),
    milestone('fuel', fuelReserve >= 1 || ironPickReady, 'obtain smelting fuel'),
    milestone('raw_iron', Number(counts.raw_iron || 0) + Number(counts.iron_ingot || 0) >= 3 || ironPickReady, 'mine raw iron'),
    milestone('iron_pickaxe', ironPickReady, 'craft an iron pickaxe')
  ];
  const current = milestones.find((entry) => !entry.complete) || { id: 'free_play', label: 'continue the persistent goal', complete: false };
  return {
    stage: current.id,
    stageLabel: current.label,
    stageIndex: milestones.findIndex((entry) => entry.id === current.id),
    completedCount: milestones.filter((entry) => entry.complete).length,
    totalCount: milestones.length,
    bootstrapComplete: milestones.every((entry) => entry.complete),
    foodReserve: edible,
    milestones,
    recommendedSkill: !milestones.every((entry) => entry.complete)
      ? 'bootstrap_survival'
      : Number(state.food ?? 20) < 16 || edible < 3
        ? 'secure_food'
        : 'gather_resource'
  };
}

function step(stage, description, action, verify = null) {
  return { done: false, stage, description, action, verify };
}

function complete(stage, description) {
  return { done: true, stage, description, action: null, verify: { type: 'curriculum', stage } };
}

function bootstrapStep(state) {
  const counts = minecraftInventoryCounts(state);
  const curriculum = evaluateMinecraftCurriculum(state);
  const visibleLog = firstBlock(state, /_(?:log|stem)$/);
  const logItem = firstInventory(state, /_(?:log|stem)$/);
  const plankItem = firstInventory(state, /_planks$/);
  const totalLogs = totalMatching(counts, /_(?:log|stem)$/);
  const totalPlanks = totalMatching(counts, /_planks$/);
  const hasTable = hasPlaced(state, 'crafting_table');
  const hasFurnace = hasPlaced(state, 'furnace') || hasPlaced(state, 'blast_furnace');
  const hasAnyPickaxe = hasTool(counts, 'wooden', 'pickaxe');
  const ironReady = Number(counts.iron_ingot || 0) >= 3 || hasTool(counts, 'iron', 'pickaxe');

  if (Number(state.food ?? 20) < 12 && firstInventory(state, FOOD_PATTERN)) {
    return step('safety_food', 'eat before continuing the technology progression', { action: 'eat' }, { type: 'food-increase' });
  }
  if (curriculum.bootstrapComplete) {
    if (state.miningEntrance && Number(state.position?.y ?? 64) < Number(state.miningEntrance.y ?? 64) - 2) {
      return step('return_surface', 'return along the mined staircase before starting the next survival goal', { action: 'go_surface' }, { type: 'y-increase' });
    }
    return complete('bootstrap_complete', `survival bootstrap complete (${curriculum.completedCount}/${curriculum.totalCount} milestones)`);
  }
  if (!hasAnyPickaxe && totalLogs < 4 && totalPlanks < 12) {
    return visibleLog
      ? step('wood', 'collect enough logs for the initial crafting chain', { action: 'collect', block: visibleLog.name, count: Math.max(1, 4 - totalLogs), radius: 48 }, { type: 'inventory-increase', itemPattern: '_(log|stem)$' })
      : step('wood_search', 'search a new nearby area for trees', { action: 'explore', radius: 24 }, { type: 'position-change' });
  }
  if (totalPlanks < 12 && logItem) {
    const plankName = logItem.name.replace(/_(?:log|stem)$/, '_planks');
    return step('planks', 'convert logs into a useful plank reserve', { action: 'craft', item: plankName, count: 12 - totalPlanks }, { type: 'inventory-increase', item: plankName });
  }
  if (!hasAnyPickaxe && !hasTable && !Number(counts.crafting_table || 0)) {
    return step('crafting_table', 'craft the first workstation', { action: 'craft', item: 'crafting_table', count: 1 }, { type: 'inventory-increase', item: 'crafting_table' });
  }
  if (!hasAnyPickaxe && !hasTable && Number(counts.crafting_table || 0) > 0) {
    return step('place_crafting_table', 'place the workstation at a safe adjacent position', { action: 'place_near', block: 'crafting_table', radius: 4 }, { type: 'nearby-block', block: 'crafting_table' });
  }
  if (!hasAnyPickaxe && Number(counts.stick || 0) < 4) {
    return step('sticks', 'craft handles for tools', { action: 'craft', item: 'stick', count: 4 - Number(counts.stick || 0) }, { type: 'inventory-increase', item: 'stick' });
  }
  if (!hasTool(counts, 'wooden', 'pickaxe')) {
    return step('wooden_pickaxe', 'craft a wooden pickaxe to unlock stone', { action: 'craft', item: 'wooden_pickaxe', count: 1 }, { type: 'inventory-increase', item: 'wooden_pickaxe' });
  }
  if (!hasTable && !Number(counts.crafting_table || 0)) {
    if (totalPlanks >= 4) {
      return step('restore_crafting_table', 'replace the missing crafting table before continuing the tool chain', { action: 'craft', item: 'crafting_table', count: 1 }, { type: 'inventory-increase', item: 'crafting_table' });
    }
    if (state.miningEntrance && Number(state.position?.y ?? 64) < Number(state.miningEntrance.y ?? 64) - 2) {
      return step('restore_table_return', 'return to the surface to replace the missing crafting table', { action: 'go_surface' }, { type: 'y-increase' });
    }
    return visibleLog
      ? step('restore_table_wood', 'collect wood to replace the missing crafting table', { action: 'collect', block: visibleLog.name, count: 1, radius: 48 }, { type: 'inventory-increase', itemPattern: '_(log|stem)$' })
      : step('restore_table_search', 'search for wood to replace the missing crafting table', { action: 'explore', radius: 24 }, { type: 'position-change' });
  }
  if (!hasTable && Number(counts.crafting_table || 0) > 0) {
    return step('restore_place_crafting_table', 'place the replacement crafting table', { action: 'place_near', block: 'crafting_table', radius: 4 }, { type: 'nearby-block', block: 'crafting_table' });
  }
  const stoneMaterial = Number(counts.cobblestone || 0) + Number(counts.cobbled_deepslate || 0);
  const stoneNeeded = (hasTool(counts, 'stone', 'pickaxe') ? 0 : 3) + (ironReady || hasFurnace || Number(counts.furnace || 0) ? 0 : 8);
  if (stoneMaterial < stoneNeeded) {
    const stone = firstBlock(state, /^(?:stone|cobblestone|cobbled_deepslate)$/);
    return stone
      ? step('stone_supply', 'mine enough stone for a stone pickaxe and furnace', { action: 'collect', block: stone.name, count: stoneNeeded - stoneMaterial, radius: 48 }, { type: 'inventory-increase', itemPattern: '^(cobblestone|cobbled_deepslate)$' })
      : step('stone_search', 'look for exposed stone', { action: 'explore', radius: 20 }, { type: 'position-change' });
  }
  if (!hasTool(counts, 'stone', 'pickaxe')) {
    return step('stone_pickaxe', 'upgrade the mining tool', { action: 'craft', item: 'stone_pickaxe', count: 1 }, { type: 'inventory-increase', item: 'stone_pickaxe' });
  }
  if (!ironReady && !hasFurnace && !Number(counts.furnace || 0)) {
    return step('furnace', 'craft a furnace for the iron stage', { action: 'craft', item: 'furnace', count: 1 }, { type: 'inventory-increase', item: 'furnace' });
  }
  if (!ironReady && !hasFurnace && Number(counts.furnace || 0) > 0) {
    return step('place_furnace', 'place the furnace beside the workstation', { action: 'place_near', block: 'furnace', radius: 5 }, { type: 'nearby-block', block: 'furnace' });
  }
  if (!ironReady && !Number(counts.coal || 0) && !Number(counts.charcoal || 0) && !firstInventory(state, /_(?:log|stem|planks)$/)) {
    const coal = firstBlock(state, /^(?:coal_ore|deepslate_coal_ore)$/);
    return coal
      ? step('fuel', 'mine coal for reliable smelting', { action: 'collect', block: coal.name, count: 1, radius: 48 }, { type: 'inventory-increase', item: 'coal' })
      : step('fuel_search', 'search for exposed coal', { action: 'explore', radius: 26 }, { type: 'position-change' });
  }
  if (Number(counts.raw_iron || 0) + Number(counts.iron_ingot || 0) < 3) {
    const iron = firstBlock(state, /^(?:iron_ore|deepslate_iron_ore)$/);
    return iron
      ? step('raw_iron', 'mine enough iron for the first iron tool', { action: 'collect', block: iron.name, count: 3 - Number(counts.raw_iron || 0) - Number(counts.iron_ingot || 0), radius: 48 }, { type: 'inventory-increase', item: 'raw_iron' })
      : Number(state.position?.y ?? 64) > 32
        ? step('iron_depth', 'descend by a safe staircase toward the iron layer', { action: 'mine_down', depth: 12 }, { type: 'y-decrease' })
        : step('iron_search', 'search the mining layer for exposed iron ore', { action: 'explore', radius: 28 }, { type: 'position-change' });
  }
  if (Number(counts.iron_ingot || 0) < 3 && Number(counts.raw_iron || 0) > 0) {
    const fuel = firstInventory(state, /^(?:coal|charcoal)$/) || firstInventory(state, /_(?:planks|log|stem)$/);
    return step('smelt_iron', 'smelt the mined iron', {
      action: 'smelt', item: 'raw_iron', fuel: fuel?.name || 'coal', count: Math.min(3 - Number(counts.iron_ingot || 0), Number(counts.raw_iron || 0))
    }, { type: 'inventory-increase', item: 'iron_ingot' });
  }
  if (!hasTool(counts, 'iron', 'pickaxe') && Number(counts.stick || 0) < 2) {
    if (!plankItem && logItem) {
      const plankName = logItem.name.replace(/_(?:log|stem)$/, '_planks');
      return step('iron_tool_planks', 'prepare planks for the iron tool handle', { action: 'craft', item: plankName, count: 2 }, { type: 'inventory-increase', item: plankName });
    }
    if (!plankItem && state.miningEntrance && Number(state.position?.y ?? 64) < Number(state.miningEntrance.y ?? 64) - 2) {
      return step('iron_tool_return', 'return to the surface to replenish tool-handle material', { action: 'go_surface' }, { type: 'y-increase' });
    }
    if (!plankItem) {
      return visibleLog
        ? step('iron_tool_wood', 'collect wood for the iron tool handle', { action: 'collect', block: visibleLog.name, count: 1, radius: 48 }, { type: 'inventory-increase', itemPattern: '_(log|stem)$' })
        : step('iron_tool_wood_search', 'search for wood for the iron tool handle', { action: 'explore', radius: 24 }, { type: 'position-change' });
    }
    return step('iron_tool_sticks', 'craft a handle for the iron pickaxe', { action: 'craft', item: 'stick', count: 2 - Number(counts.stick || 0) }, { type: 'inventory-increase', item: 'stick' });
  }
  if (!hasTool(counts, 'iron', 'pickaxe')) {
    return step('iron_pickaxe', 'craft the first iron pickaxe', { action: 'craft', item: 'iron_pickaxe', count: 1 }, { type: 'inventory-increase', item: 'iron_pickaxe' });
  }
  return complete('bootstrap_complete', `survival bootstrap complete (${curriculum.completedCount}/${curriculum.totalCount} milestones)`);
}

function foodStep(state) {
  const food = firstInventory(state, FOOD_PATTERN);
  const reserve = evaluateMinecraftCurriculum(state).foodReserve;
  if (Number(state.food ?? 20) < 18 && food) return step('eat', 'restore hunger from the existing reserve', { action: 'eat' }, { type: 'food-increase' });
  if (reserve >= 4) return complete('food_secure', `food reserve is ${reserve}`);
  const animal = nearbyEntity(state, PASSIVE_FOOD_MOBS);
  if (animal) return step('hunt_food', `hunt nearby ${animal.name} for food`, { action: 'attack', target: animal.name, radius: 16 }, { type: 'food-reserve-increase' });
  return step('food_search', 'explore for passive animals or village food', { action: 'explore', radius: 28 }, { type: 'position-change' });
}

function resourceBlockPatterns(target) {
  if (target === 'cobblestone') return /^(?:stone|cobblestone|cobbled_deepslate)$/;
  if (target === 'coal') return /^(?:coal_ore|deepslate_coal_ore)$/;
  if (target === 'raw_iron') return /^(?:iron_ore|deepslate_iron_ore)$/;
  if (target === 'diamond') return /^(?:diamond_ore|deepslate_diamond_ore)$/;
  if (target === 'raw_gold') return /^(?:gold_ore|deepslate_gold_ore)$/;
  if (target === 'raw_copper') return /^(?:copper_ore|deepslate_copper_ore)$/;
  if (target === 'emerald') return /^(?:emerald_ore|deepslate_emerald_ore)$/;
  if (target === 'redstone') return /^(?:redstone_ore|deepslate_redstone_ore)$/;
  if (target === 'lapis_lazuli') return /^(?:lapis_ore|deepslate_lapis_ore)$/;
  if (target === 'log') return /_(?:log|stem)$/;
  return new RegExp(`^${String(target || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

function shelterStep(state) {
  if (state.shelterPosition) return complete('shelter_complete', 'a shelter was constructed in this world session');
  const planks = (state.inventory || []).filter((item) => /_planks$/.test(item.name)).sort((a, b) => b.count - a.count);
  const bestPlank = planks[0];
  if (Number(bestPlank?.count || 0) >= 23) {
    return step('construct_shelter', `construct a compact shelter from ${bestPlank.name}`, { action: 'construct_shelter', block: bestPlank.name }, { type: 'shelter-built' });
  }
  const logs = (state.inventory || []).filter((item) => /_(?:log|stem)$/.test(item.name)).sort((a, b) => b.count - a.count);
  const log = logs[0];
  if (log) {
    const plankName = log.name.replace(/_(?:log|stem)$/, '_planks');
    const obtainable = Math.max(4, Math.min(23 - Number(bestPlank?.count || 0), Number(log.count || 0) * 4));
    return step('shelter_materials', `craft ${plankName} for the shelter`, { action: 'craft', item: plankName, count: obtainable }, { type: 'inventory-increase', item: plankName });
  }
  const visibleLog = firstBlock(state, /_(?:log|stem)$/);
  return visibleLog
    ? step('shelter_wood', 'collect building material for the shelter', { action: 'collect', block: visibleLog.name, count: 6, radius: 48 }, { type: 'inventory-increase', itemPattern: '_(log|stem)$' })
    : step('shelter_search', 'search for trees before building', { action: 'explore', radius: 26 }, { type: 'position-change' });
}

function resourceStep(state, target, count) {
  const counts = minecraftInventoryCounts(state);
  const normalizedTarget = String(target || '').trim().toLowerCase();
  const desired = Math.max(1, Math.min(64, Number(count) || 1));
  const requiredTier = ['diamond', 'raw_gold', 'redstone', 'lapis_lazuli', 'emerald'].includes(normalizedTarget)
    ? 'iron'
    : normalizedTarget === 'raw_iron' ? 'stone' : ['coal', 'cobblestone'].includes(normalizedTarget) ? 'wooden' : '';
  if (requiredTier && !hasTool(counts, requiredTier, 'pickaxe')) {
    return step('resource_prerequisite', `prepare the required ${requiredTier} pickaxe tier before gathering ${normalizedTarget}`, { action: 'skill', skill: 'bootstrap_survival' }, { type: 'tool-tier', tier: requiredTier, tool: 'pickaxe' });
  }
  const current = normalizedTarget === 'log'
    ? totalMatching(counts, /_(?:log|stem)$/)
    : normalizedTarget === 'cobblestone'
      ? Number(counts.cobblestone || 0) + Number(counts.cobbled_deepslate || 0)
    : Number(counts[normalizedTarget] || 0);
  if (current >= desired) {
    if (state.miningEntrance && Number(state.position?.y ?? 64) < Number(state.miningEntrance.y ?? 64) - 2) {
      return step('resource_return_surface', `return to the surface with the gathered ${normalizedTarget}`, { action: 'go_surface' }, { type: 'y-increase' });
    }
    return complete('resource_complete', `${normalizedTarget} reserve reached ${current}/${desired}`);
  }
  const block = firstBlock(state, resourceBlockPatterns(normalizedTarget));
  const targetDepth = {
    diamond: -54,
    redstone: -54,
    raw_gold: -16,
    lapis_lazuli: 0,
    raw_iron: 16
  }[normalizedTarget];
  const currentY = Number(state.position?.y ?? 64);
  const verification = normalizedTarget === 'log'
    ? { type: 'inventory-increase', itemPattern: '_(log|stem)$' }
    : normalizedTarget === 'cobblestone'
      ? { type: 'inventory-increase', itemPattern: '^(cobblestone|cobbled_deepslate)$' }
      : { type: 'inventory-increase', item: normalizedTarget };
  return block
    ? step('gather_resource', `collect ${normalizedTarget} (${current}/${desired})`, { action: 'collect', block: block.name, count: Math.min(16, desired - current), radius: 48 }, verification)
    : Number.isFinite(targetDepth) && currentY > targetDepth + 4
      ? step('resource_depth', `descend safely toward Y ${targetDepth} for ${normalizedTarget}`, { action: 'mine_down', depth: Math.min(16, Math.max(4, currentY - targetDepth)) }, { type: 'y-decrease' })
      : step('resource_search', `search for ${normalizedTarget}`, { action: 'explore', radius: 30 }, { type: 'position-change' });
}

export function nextMinecraftSkillStep(skillAction = {}, state = {}) {
  const skill = String(skillAction.skill || '').trim();
  if (skill === 'bootstrap_survival') return bootstrapStep(state);
  if (skill === 'secure_food') return foodStep(state);
  if (skill === 'build_shelter') return shelterStep(state);
  if (skill === 'gather_resource') return resourceStep(state, skillAction.target, skillAction.count);
  throw new Error(`Unsupported Minecraft skill: ${skill || 'empty'}.`);
}

function matchingInventoryTotal(state, item = '', itemPattern = '') {
  const counts = minecraftInventoryCounts(state);
  if (item === 'log') return totalMatching(counts, /_(?:log|stem)$/);
  if (item === 'coal') return Number(counts.coal || 0) + Number(counts.charcoal || 0);
  if (itemPattern) return totalMatching(counts, new RegExp(itemPattern));
  return Number(counts[item] || 0);
}

export function verifyMinecraftSkillStep(step = {}, before = {}, after = {}) {
  const verify = step.verify || {};
  if (step.done) return { success: true, evidence: step.description || 'skill complete' };
  if (!step.action) return { success: false, evidence: 'skill step has no action' };
  if (verify.type === 'inventory-increase') {
    const previous = matchingInventoryTotal(before, verify.item, verify.itemPattern);
    const current = matchingInventoryTotal(after, verify.item, verify.itemPattern);
    return { success: current > previous, evidence: `${verify.item || verify.itemPattern}:${previous}->${current}` };
  }
  if (verify.type === 'nearby-block') {
    const present = (after.nearbyBlocks || []).some((block) => block.name === verify.block);
    return { success: present, evidence: `${verify.block}:${present ? 'visible' : 'missing'}` };
  }
  if (verify.type === 'food-increase') {
    return { success: Number(after.food || 0) > Number(before.food || 0), evidence: `food:${before.food || 0}->${after.food || 0}` };
  }
  if (verify.type === 'food-reserve-increase') {
    const previous = evaluateMinecraftCurriculum(before).foodReserve;
    const current = evaluateMinecraftCurriculum(after).foodReserve;
    return { success: current > previous, evidence: `food-reserve:${previous}->${current}` };
  }
  if (verify.type === 'position-change') {
    const a = before.position || {};
    const b = after.position || {};
    const distance = Math.hypot(Number(b.x || 0) - Number(a.x || 0), Number(b.z || 0) - Number(a.z || 0));
    return { success: distance >= 4, evidence: `travelled:${Math.round(distance * 10) / 10}` };
  }
  if (verify.type === 'y-decrease') {
    const change = Number(before.position?.y || 0) - Number(after.position?.y || 0);
    return { success: change >= 2, evidence: `descended:${Math.round(change * 10) / 10}` };
  }
  if (verify.type === 'y-increase') {
    const change = Number(after.position?.y || 0) - Number(before.position?.y || 0);
    return { success: change >= 2, evidence: `ascended:${Math.round(change * 10) / 10}` };
  }
  if (verify.type === 'tool-tier') {
    const ready = hasTool(minecraftInventoryCounts(after), verify.tier, verify.tool);
    return { success: ready, evidence: `${verify.tier}_${verify.tool}:${ready ? 'ready' : 'missing'}` };
  }
  if (verify.type === 'shelter-built') {
    return { success: Boolean(after.shelterPosition), evidence: after.shelterPosition ? 'shelter-position-recorded' : 'shelter-missing' };
  }
  return { success: true, evidence: 'primitive action completed' };
}

export function minecraftSkillPromptSummary(state = {}, skillMemory = {}) {
  const curriculum = evaluateMinecraftCurriculum(state);
  const docs = MINECRAFT_SKILL_IDS.map((id) => `${id}: ${MINECRAFT_SKILL_DOCS[id]}`).join('\n');
  return [
    `[CURRICULUM] stage=${curriculum.stage}; progress=${curriculum.completedCount}/${curriculum.totalCount}; recommended=${curriculum.recommendedSkill}`,
    `milestones=${curriculum.milestones.map((entry) => `${entry.id}:${entry.complete ? 'done' : 'todo'}`).join(',')}`,
    `[SAFE_SKILL_LIBRARY]\n${docs}`,
    `skill_memory=${JSON.stringify(skillMemory || {})}`
  ].join('\n');
}
