import { yachiyoCorePersonalityPrompt } from '../../constants/room/yachiyoPersonalityPrompt';
import { normalizeLive2DMinecraftCommand } from './live2dMinecraft';
import { normalizeLLMApiUrl, readRoomLLMSettings } from './roomSettings';
import { normalizeMinecraftPlannerDecision } from './live2dMinecraftAutonomy';

const PLANNER_TIMEOUT_MS = 45_000;

function parseJsonObject(text) {
  const value = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = value.indexOf('{');
  if (start < 0) throw new Error('Minecraft planner returned no JSON object.');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(value.slice(start, index + 1));
    }
  }
  throw new Error('Minecraft planner JSON was incomplete.');
}

function pickReply(payload = {}) {
  if (typeof payload?.data?.reply === 'string') return payload.data.reply;
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const chatContent = payload?.choices?.[0]?.message?.content;
  if (typeof chatContent === 'string') return chatContent;
  const responseText = payload?.output
    ?.flatMap((item) => item?.content || [])
    ?.map((item) => item?.text || item?.value || '')
    ?.filter(Boolean)
    ?.join('');
  return responseText || '';
}

function inventoryText(items = []) {
  return items.slice(0, 36).map((item) => `${item.name}x${item.count}`).join(', ') || 'empty';
}

function nearbyText(items = [], limit = 16) {
  return items.slice(0, limit).map((item) => {
    const position = Number.isFinite(item.x) ? `@${item.x},${item.y},${item.z}` : `@${item.distance}m`;
    return `${item.name}${position}`;
  }).join(', ') || 'none';
}

function itemCount(state, name) {
  return Number((state.inventory || []).find((item) => item.name === name)?.count || 0);
}

function firstInventory(state, pattern) {
  return (state.inventory || []).find((item) => pattern.test(item.name));
}

function firstBlock(state, pattern) {
  return (state.nearbyBlocks || []).find((block) => pattern.test(block.name));
}

export function fallbackLive2DMinecraftPlan(context = {}) {
  const state = context.status?.state || {};
  if (state.isSleeping) return normalizeMinecraftPlannerDecision({ thought: 'wait until morning', action: null, nextDelayMs: 6000 });
  const position = state.position || { x: 0, y: 64, z: 0 };
  if (Number(state.food) < 15 && firstInventory(state, /(?:apple|bread|beef|porkchop|chicken|mutton|rabbit|potato|carrot|berries|melon|cod|salmon|stew)$/)) {
    return normalizeMinecraftPlannerDecision({ thought: 'low food fallback', action: { action: 'eat' }, nextDelayMs: 1800 });
  }
  const log = firstInventory(state, /_(?:log|stem)$/);
  const visibleLog = firstBlock(state, /_(?:log|stem)$/);
  if (!log) {
    return normalizeMinecraftPlannerDecision({
      thought: visibleLog ? 'collect visible wood' : 'search for wood',
      action: visibleLog
        ? { action: 'collect', block: visibleLog.name, count: 4, radius: 32 }
        : { action: 'explore', radius: 24 },
      nextDelayMs: 2200
    });
  }
  const plankName = log.name.replace(/_(?:log|stem)$/, (suffix) => suffix === '_stem' ? '_planks' : '_planks');
  const planks = firstInventory(state, /_planks$/);
  if (!planks) return normalizeMinecraftPlannerDecision({ thought: 'make planks', action: { action: 'craft', item: plankName, count: 4 }, nextDelayMs: 1500 });
  if (!itemCount(state, 'crafting_table') && !firstBlock(state, /^crafting_table$/)) {
    return normalizeMinecraftPlannerDecision({ thought: 'make crafting table', action: { action: 'craft', item: 'crafting_table', count: 1 }, nextDelayMs: 1500 });
  }
  if (itemCount(state, 'crafting_table') && !firstBlock(state, /^crafting_table$/)) {
    return normalizeMinecraftPlannerDecision({
      thought: 'place crafting table',
      action: { action: 'place', block: 'crafting_table', x: Math.floor(position.x) + 1, y: Math.floor(position.y), z: Math.floor(position.z) },
      nextDelayMs: 1500
    });
  }
  if (!itemCount(state, 'stick')) return normalizeMinecraftPlannerDecision({ thought: 'make sticks', action: { action: 'craft', item: 'stick', count: 4 }, nextDelayMs: 1500 });
  if (!firstInventory(state, /_(?:pickaxe)$/)) return normalizeMinecraftPlannerDecision({ thought: 'make first pickaxe', action: { action: 'craft', item: 'wooden_pickaxe', count: 1 }, nextDelayMs: 1800 });
  const visibleStone = firstBlock(state, /^(?:stone|cobblestone|cobbled_deepslate)$/);
  if (visibleStone && !itemCount(state, 'cobblestone')) return normalizeMinecraftPlannerDecision({ thought: 'collect stone', action: { action: 'collect', block: visibleStone.name, count: 8, radius: 32 }, nextDelayMs: 2200 });
  if (itemCount(state, 'cobblestone') >= 3 && !firstInventory(state, /^stone_pickaxe$/)) return normalizeMinecraftPlannerDecision({ thought: 'upgrade pickaxe', action: { action: 'craft', item: 'stone_pickaxe', count: 1 }, nextDelayMs: 1800 });
  return normalizeMinecraftPlannerDecision({ thought: 'continue scouting', action: { action: 'explore', radius: 28 }, nextDelayMs: 2400 });
}

export function buildLive2DMinecraftPlannerPrompt(context = {}) {
  const state = context.status?.state || {};
  const position = state.position ? `${state.position.x},${state.position.y},${state.position.z}` : 'unknown';
  return [
    '[CURRENT_GOAL]',
    context.goal,
    '[WORLD_STATE]',
    `phase=${state.phase}; position=${position}; health=${state.health}; food=${state.food}; oxygen=${state.oxygen}; dimension=${state.dimension}; time=${state.timeOfDay}; raining=${Boolean(state.isRaining)}`,
    `inventory=${inventoryText(state.inventory)}`,
    `equipment=${JSON.stringify(state.equipment || {})}`,
    `nearby_blocks=${nearbyText(state.nearbyBlocks)}`,
    `nearby_players=${nearbyText(state.nearby?.players, 8)}`,
    `nearby_entities=${nearbyText(state.nearby?.entities, 12)}`,
    `last_decision=${JSON.stringify(context.lastDecision || null)}`,
    `last_outcome=${JSON.stringify(context.lastOutcome || state.lastAction || null)}`,
    `recent_outcomes=${JSON.stringify(context.outcomeHistory || [])}`,
    `consecutive_failures=${Number(context.failures) || 0}`
  ].join('\n');
}

export function live2DMinecraftPlannerSystemPrompt() {
  return [
    'You are the private Minecraft Java gameplay planner for Yachiyo, an autonomous AI VTuber.',
    'Behave like a real survival player: keep a persistent goal, observe results, make incremental progress, recover from failure, and avoid repetitive or impossible actions.',
    'Return exactly one compact JSON object and no Markdown.',
    'Schema: {"thought":"private short reasoning","progress":"what changed","goalCompleted":false,"speak":false,"voice":"short Japanese line","caption":"matching Simplified Chinese subtitle","nextDelayMs":2500,"action":null}',
    'Choose at most one action. Allowed action schemas:',
    '{"action":"observe"}',
    '{"action":"explore","radius":24}',
    '{"action":"move","x":0,"y":64,"z":0,"range":2}',
    '{"action":"collect","block":"oak_log","count":4,"radius":32}',
    '{"action":"craft","item":"oak_planks","count":4}',
    '{"action":"place","block":"crafting_table","x":0,"y":64,"z":0}',
    '{"action":"eat"}',
    '{"action":"equip","item":"stone_pickaxe","destination":"auto"}',
    '{"action":"sleep"}',
    '{"action":"smelt","item":"raw_iron","fuel":"coal","count":3}',
    '{"action":"attack","target":"zombie","radius":8}',
    '{"action":"follow","player":"name","distance":3}',
    '{"action":"chat","message":"safe text without slash commands"}',
    '{"action":"stop"}',
    'Survival priorities: stay alive first; eat when food is low; avoid combat while weak; obtain logs, planks, crafting table, sticks and tools; then food, stone, shelter, bed, furnace, iron and goal-specific progress.',
    'Use exact Minecraft registry names visible in state. Place blocks only at nearby coordinates based on current position. Explore when required resources are not visible.',
    'After a failure, do not repeat the identical action blindly. Inspect the error and choose observe, explore, a prerequisite, another target, or a safer action.',
    'Do not attack players. Do not use slash commands. Do not invent items or claim success before outcome confirms it. Never output code.',
    'Set action to null only when waiting is useful or the goal is complete. nextDelayMs should normally be 1200-4000 after an idle decision.',
    'Set speak=true only for a meaningful milestone, danger, surprising event, or amusing failure, at most occasionally. If speaking, voice must be natural Japanese and caption must be matching Simplified Chinese; otherwise keep both empty.',
    yachiyoCorePersonalityPrompt()
  ].join('\n');
}

async function requestPlannerRaw(systemPrompt, userPrompt, settings) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);
  try {
    if (settings.useProxy) {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userPrompt,
          conversation: [],
          apiKey: settings.apiKey,
          apiUrl: settings.apiUrl,
          model: settings.model,
          systemPrompt
        }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) throw new Error(payload?.message || `Minecraft planner LLM ${response.status}`);
      return pickReply(payload);
    }
    const apiUrl = normalizeLLMApiUrl(settings.apiUrl, settings.model, settings.provider);
    const responsesApi = /(api\.openai\.com|api\.x\.ai)\/v1\/responses\/?$/i.test(apiUrl);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify(responsesApi
        ? {
            model: settings.model,
            instructions: systemPrompt,
            input: [{ role: 'user', content: userPrompt }],
            max_output_tokens: 500
          }
        : {
            model: settings.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.35,
            max_tokens: 500
          }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Minecraft planner LLM ${response.status}`);
    return pickReply(await response.json());
  } finally {
    window.clearTimeout(timer);
  }
}

export async function requestLive2DMinecraftPlan(context = {}) {
  const settings = readRoomLLMSettings();
  try {
    if (!settings.apiKey || !settings.apiUrl) throw new Error('LLM settings are required for autonomous Minecraft play.');
    const raw = await requestPlannerRaw(
      live2DMinecraftPlannerSystemPrompt(),
      buildLive2DMinecraftPlannerPrompt(context),
      settings
    );
    const parsed = parseJsonObject(raw);
    const decision = normalizeMinecraftPlannerDecision(parsed);
    decision.action = normalizeLive2DMinecraftCommand(decision.action);
    if (decision.speak && (!decision.voice || !decision.caption)) decision.speak = false;
    return decision;
  } catch (error) {
    const fallback = fallbackLive2DMinecraftPlan(context);
    fallback.progress = `LLM planner unavailable; safe fallback: ${String(error?.message || error).slice(0, 120)}`;
    fallback.action = normalizeLive2DMinecraftCommand(fallback.action);
    return fallback;
  }
}
