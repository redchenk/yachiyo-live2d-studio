import assert from 'node:assert/strict';
import { createLive2DMinecraftAutonomyController } from '../../src/frontend/services/room/live2dMinecraftAutonomy.js';

let clock = 1000;
let timerId = 0;
const timers = new Map();
const decisions = [];
const executions = [];
let serviceState = {
  phase: 'ready', taskQueueDepth: 0, activeTask: null, recentEvents: []
};

const controller = createLive2DMinecraftAutonomyController({
  now: () => clock,
  setTimeoutImpl: (callback, delay) => {
    timerId += 1;
    timers.set(timerId, { callback, delay });
    return timerId;
  },
  clearTimeoutImpl: (id) => timers.delete(id),
  readSettings: () => ({ enabled: true, trustedServerAcknowledged: true, autonomousPlay: true, decisionIntervalMs: 6000 }),
  readStatus: async () => ({ state: serviceState }),
  plan: async (context) => {
    decisions.push(context);
    return { thought: 'collect wood', action: { action: 'collect', block: 'oak_log', count: 2 }, nextDelayMs: 3000 };
  },
  execute: async (action) => {
    executions.push(action);
    return { status: 'queued', taskId: `task-${executions.length}` };
  }
});

async function fireTimer() {
  const [id, timer] = timers.entries().next().value;
  timers.delete(id);
  clock += timer.delay;
  await timer.callback();
  await Promise.resolve();
}

controller.start('survive');
assert.equal(timers.size, 1);
await fireTimer();
assert.equal(decisions.length, 1);
assert.equal(executions.length, 1);
assert.equal(controller.state().lastTaskId, 'task-1');

serviceState = { phase: 'ready', taskQueueDepth: 0, activeTask: { id: 'task-1' }, recentEvents: [] };
await fireTimer();
assert.equal(decisions.length, 1, 'must not plan over a running action');

serviceState = {
  phase: 'ready', taskQueueDepth: 0, activeTask: null,
  recentEvents: [{ type: 'action-complete', taskId: 'task-1', at: clock }]
};
await fireTimer();
assert.equal(decisions.length, 2, 'must plan again as soon as the previous action is confirmed');
assert.equal(decisions[1].lastOutcome.success, true);

serviceState = {
  phase: 'ready', taskQueueDepth: 0, activeTask: null,
  recentEvents: [{ type: 'action-failed', taskId: 'task-2', message: 'blocked', at: clock }]
};
await fireTimer();
assert.equal(decisions[2].failures, 1, 'failed actions must be fed back to the planner');
assert.equal(executions[2].action, 'collect');

serviceState = {
  phase: 'ready', taskQueueDepth: 0, activeTask: null,
  recentEvents: [{ type: 'action-failed', taskId: 'task-3', message: 'still blocked', at: clock }]
};
await fireTimer();
assert.equal(decisions[3].failures, 2);
assert.equal(executions[3].action, 'observe', 'two identical failures must force a fresh observation instead of looping forever');

const activeTaskBeforeSameGoal = controller.state().lastTaskId;
controller.setGoal('survive');
assert.equal(controller.state().lastTaskId, activeTaskBeforeSameGoal, 'saving an unchanged goal must not discard the in-flight outcome');

controller.setGoal('build shelter');
assert.equal(controller.state().goal, 'build shelter');
assert.equal(controller.state().lastTaskId, '');
controller.stop();
assert.equal(timers.size, 0);
console.log('Minecraft autonomy controller checks passed');
