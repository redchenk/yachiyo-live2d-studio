export const DEFAULT_MINECRAFT_GOAL = '在保证安全的前提下推进生存流程：观察环境、收集木材、制作基础工具、获取食物、建立庇护所并逐步升级装备。';
let latestMinecraftAutonomyState = null;

export function readLatestLive2DMinecraftAutonomyState() {
  return latestMinecraftAutonomyState;
}

export function normalizeMinecraftPlannerDecision(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const action = source.action && typeof source.action === 'object' ? source.action : null;
  return {
    thought: String(source.thought || source.reason || '').trim().slice(0, 240),
    action,
    progress: String(source.progress || '').trim().slice(0, 240),
    goalCompleted: Boolean(source.goalCompleted),
    speak: Boolean(source.speak),
    voice: String(source.voice || '').trim().slice(0, 180),
    caption: String(source.caption || '').trim().slice(0, 180),
    nextDelayMs: Math.round(Math.min(30_000, Math.max(1000, Number(source.nextDelayMs) || 3500)))
  };
}

export function createLive2DMinecraftAutonomyController(options = {}) {
  const now = options.now || (() => Date.now());
  const setTimeoutImpl = options.setTimeoutImpl || ((callback, delay) => window.setTimeout(callback, delay));
  const clearTimeoutImpl = options.clearTimeoutImpl || ((timer) => window.clearTimeout(timer));
  const readSettings = options.readSettings;
  const readStatus = options.readStatus;
  const plan = options.plan;
  const execute = options.execute;
  const shouldYield = options.shouldYield || (() => false);
  const onState = options.onState || (() => {});
  const onSpeech = options.onSpeech || (() => {});
  let timer = 0;
  let running = false;
  let planning = false;
  let generation = 0;
  let failures = 0;
  let goal = String(options.initialGoal || DEFAULT_MINECRAFT_GOAL).trim();
  let lastDecision = null;
  let lastOutcome = null;
  let lastTaskId = '';
  let outcomeHistory = [];

  function snapshot(extra = {}) {
    return {
      running,
      planning,
      goal,
      failures,
      lastDecision,
      lastOutcome,
      outcomeHistory,
      lastTaskId,
      updatedAt: now(),
      ...extra
    };
  }

  function publish(extra = {}) {
    const state = snapshot(extra);
    latestMinecraftAutonomyState = state;
    onState(state);
    return state;
  }

  function cancelTimer() {
    if (timer) clearTimeoutImpl(timer);
    timer = 0;
  }

  function schedule(delayMs) {
    cancelTimer();
    if (!running) return;
    const currentGeneration = generation;
    timer = setTimeoutImpl(() => {
      timer = 0;
      if (currentGeneration !== generation) return;
      tick().catch(() => {});
    }, Math.max(250, Number(delayMs) || 1000));
  }

  function taskSettled(status) {
    const state = status?.state || {};
    if (!lastTaskId) return true;
    if (state.activeTask?.id === lastTaskId) return false;
    if ((state.taskQueueDepth || 0) > 0) return false;
    const matching = (state.recentEvents || []).find((event) => event.taskId === lastTaskId) ||
      (state.lastAction?.taskId === lastTaskId
        ? {
            type: state.lastAction.success ? 'action-complete' : 'action-failed',
            taskId: lastTaskId,
            message: state.lastAction.error || '',
            result: state.lastAction.result || null,
            at: state.lastActionAt
          }
        : null);
    if (!matching) return false;
    lastOutcome = {
      taskId: lastTaskId,
      type: matching.type,
      success: matching.type === 'action-complete',
      action: lastDecision?.action || null,
      message: matching.message || '',
      result: matching.result || null,
      at: matching.at || now()
    };
    outcomeHistory = [...outcomeHistory, lastOutcome].slice(-6);
    failures = lastOutcome.success ? 0 : failures + 1;
    lastTaskId = '';
    return true;
  }

  async function tick() {
    if (!running || planning) return snapshot();
    const tickGeneration = generation;
    const settings = readSettings?.() || {};
    if (!settings.enabled || !settings.trustedServerAcknowledged || !settings.autonomousPlay) {
      stop('disabled');
      return snapshot({ reason: 'disabled' });
    }
    if (shouldYield()) {
      schedule(900);
      return publish({ phase: 'yielding-to-live' });
    }
    planning = true;
    publish({ phase: 'observing' });
    try {
      const status = await readStatus({ fresh: true });
      if (!running || tickGeneration !== generation) return snapshot({ phase: 'cancelled' });
      const state = status?.state || {};
      if (state.phase !== 'ready') {
        schedule(Math.max(1500, settings.decisionIntervalMs || 6500));
        return publish({ phase: state.phase || 'waiting' });
      }
      if (state.safetyLock) {
        schedule(900);
        return publish({ phase: `safety-${state.safetyLock}` });
      }
      if (state.activeTask || (state.taskQueueDepth || 0) > 0) {
        schedule(900);
        return publish({ phase: 'executing-external-action' });
      }
      if (!taskSettled(status)) {
        schedule(900);
        return publish({ phase: 'executing' });
      }
      const decision = normalizeMinecraftPlannerDecision(await plan({
        goal,
        status,
        lastDecision,
        lastOutcome,
        outcomeHistory,
        failures
      }));
      if (!running || tickGeneration !== generation) return snapshot({ phase: 'cancelled' });
      if (shouldYield()) {
        schedule(900);
        return publish({ phase: 'yielding-to-live' });
      }
      const actionKey = JSON.stringify(decision.action || null);
      const repeatedFailures = decision.action
        ? outcomeHistory.filter((outcome) => !outcome.success && JSON.stringify(outcome.action || null) === actionKey).length
        : 0;
      if (repeatedFailures >= 2) {
        decision.action = { action: 'observe' };
        decision.progress = `Avoiding a repeatedly failed action (${actionKey.slice(0, 120)}); refreshing state before replanning.`;
        decision.speak = false;
      }
      lastDecision = decision;
      if (!decision.action) {
        failures = decision.goalCompleted ? 0 : failures + 1;
        schedule(decision.nextDelayMs);
        return publish({ phase: decision.goalCompleted ? 'goal-complete' : 'thinking' });
      }
      const result = await execute(decision.action, { settings });
      if (!running || tickGeneration !== generation) return snapshot({ phase: 'cancelled' });
      lastTaskId = result?.taskId || '';
      if (decision.speak && decision.voice && decision.caption) onSpeech(decision);
      schedule(lastTaskId ? 900 : decision.nextDelayMs);
      return publish({ phase: 'executing', queuedAction: decision.action });
    } catch (error) {
      failures += 1;
      lastOutcome = { success: false, message: error?.message || String(error), at: now() };
      const backoff = Math.min(30_000, Math.max(2000, 1500 * (2 ** Math.min(failures, 4))));
      schedule(backoff);
      return publish({ phase: 'backoff', error: lastOutcome.message, retryInMs: backoff });
    } finally {
      planning = false;
    }
  }

  function start(nextGoal = '') {
    if (String(nextGoal || '').trim()) goal = String(nextGoal).trim().slice(0, 500);
    if (running) return publish();
    running = true;
    generation += 1;
    failures = 0;
    publish({ phase: 'starting' });
    schedule(50);
    return snapshot();
  }

  function stop(reason = 'manual') {
    running = false;
    generation += 1;
    planning = false;
    cancelTimer();
    return publish({ phase: 'stopped', reason });
  }

  function setGoal(nextGoal) {
    const value = String(nextGoal || '').trim();
    if (!value || value.slice(0, 500) === goal) return publish({ phase: running ? 'goal-unchanged' : 'stopped' });
    if (value) goal = value.slice(0, 500);
    lastDecision = null;
    lastOutcome = null;
    outcomeHistory = [];
    lastTaskId = '';
    failures = 0;
    publish({ phase: running ? 'goal-updated' : 'stopped' });
    if (running) schedule(50);
    return snapshot();
  }

  return { start, stop, tick, setGoal, state: snapshot };
}
