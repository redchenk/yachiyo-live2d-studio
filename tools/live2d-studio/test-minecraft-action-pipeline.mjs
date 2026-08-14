import assert from 'node:assert/strict';
import { createLive2DMinecraftAutonomyController } from '../../src/frontend/services/room/live2dMinecraftAutonomy.js';

let clock = 10_000;
let timerSequence = 0;
const timers = new Map();
const planContexts = [];
const executions = [];
let taskStatus = { taskId: 'task-1', status: 'running', settled: false };

const controller = createLive2DMinecraftAutonomyController({
  now: () => clock,
  setTimeoutImpl: (callback, delay) => {
    const id = ++timerSequence;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeoutImpl: (id) => timers.delete(id),
  readSettings: () => ({ enabled: true, trustedServerAcknowledged: true, autonomousPlay: true }),
  readStatus: async () => ({ state: { phase: 'ready', taskQueueDepth: 0, activeTask: null, recentEvents: [] } }),
  readTaskStatus: async () => taskStatus,
  plan: async (context) => {
    planContexts.push(context);
    return context.speculative
      ? { thought: 'prepare next step', action: { action: 'craft', item: 'oak_planks', count: 4 }, nextDelayMs: 1000 }
      : { thought: 'start collection', action: { action: 'collect', block: 'oak_log', count: 1 }, nextDelayMs: 1000 };
  },
  execute: async (action) => {
    executions.push(action);
    return { status: 'queued', taskId: `task-${executions.length}` };
  }
});

async function fireNextTimer() {
  const next = timers.entries().next().value;
  assert.ok(next, 'a controller timer must be scheduled');
  const [id, timer] = next;
  timers.delete(id);
  clock += timer.delay;
  await timer.callback();
  await new Promise((resolve) => setImmediate(resolve));
  return timer.delay;
}

controller.start('survive quickly');
await fireNextTimer();
assert.equal(executions.length, 1);
assert.equal(planContexts.filter((context) => !context.speculative).length, 1);
assert.equal(planContexts.filter((context) => context.speculative).length, 1, 'the next LLM decision must start while the current task is running');
assert.ok([...timers.values()][0].delay <= 300, 'running tasks must use lightweight sub-300ms completion polling');

await fireNextTimer();
assert.equal(executions.length, 1, 'a running task must not dispatch its prefetched successor early');

taskStatus = {
  taskId: 'task-1',
  status: 'complete',
  settled: true,
  outcome: { type: 'action-complete', success: true, taskId: 'task-1', result: { status: 'collected' }, at: clock }
};
await fireNextTimer();
assert.equal(executions.length, 2, 'the prefetched successor must dispatch immediately after success confirmation');
assert.equal(executions[1].action, 'craft');
assert.equal(planContexts.filter((context) => !context.speculative).length, 1, 'success must consume the prefetched plan instead of making another blocking LLM call');

taskStatus = {
  taskId: 'task-2',
  status: 'failed',
  settled: true,
  outcome: { type: 'action-failed', success: false, taskId: 'task-2', message: 'crafting table unavailable', at: clock }
};
await fireNextTimer();
assert.equal(executions[2].action, 'collect', 'a failed task must discard its speculative successor and use a fresh plan');
assert.equal(planContexts.filter((context) => !context.speculative).length, 2, 'failure must trigger one non-speculative replan with the real outcome');

controller.stop();
console.log('Minecraft action pipeline checks passed');
