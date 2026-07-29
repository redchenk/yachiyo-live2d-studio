import assert from 'node:assert/strict';
import { createServer } from 'vite';

const originalRandom = Math.random;
Math.random = () => 0.5;

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    activeBehaviorSamples,
    createLive2DBehaviorPlan
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dBehaviorOrchestrator.js');
  const {
    createLive2DPerformanceBrain
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dPerformanceBrain.js');

  const plan = createLive2DBehaviorPlan([
    { type: 'nod', intensity: 0.72, delayMs: 0, durationMs: 1000 },
    { type: 'sway', intensity: 0.72, delayMs: 1000, durationMs: 1000 }
  ], 2200, {
    now: 1000,
    source: 'room-act'
  });
  const [firstAction, secondAction] = plan.actions;
  const firstEnd = firstAction.delayMs + firstAction.durationMs;
  const overlapStart = secondAction.delayMs;
  assert.ok(overlapStart < firstEnd, 'sequential actions should overlap for a smooth handoff');

  let minimumHandoffEnergy = Number.POSITIVE_INFINITY;
  for (let elapsed = overlapStart; elapsed <= firstEnd; elapsed += 8) {
    const totalEnergy = activeBehaviorSamples(plan.actions, elapsed, {
      intensityScale: 1
    }).reduce((sum, sample) => sum + sample.energy, 0);
    minimumHandoffEnergy = Math.min(minimumHandoffEnergy, totalEnergy);
  }
  assert.ok(
    minimumHandoffEnergy >= 0.68,
    `action crossfade should preserve motion energy; minimum was ${minimumHandoffEnergy.toFixed(3)}`
  );

  const brain = createLive2DPerformanceBrain();
  brain.onExternalState({
    mode: 'speaking',
    holdMs: 3000,
    attention: 0.88,
    arousal: 0.68
  }, 1000);
  brain.onRoomAct({
    source: 'streaming-speech',
    emotion: 'happy',
    expression: 'smile',
    intensity: 0.72,
    durationMs: 1000,
    behaviorActions: [
      { type: 'nod', intensity: 0.72, delayMs: 0, durationMs: 900 }
    ]
  }, 1000);
  brain.sample(2020);
  brain.onRoomAct({
    source: 'streaming-speech',
    emotion: 'happy',
    expression: 'smile',
    intensity: 0.72,
    durationMs: 1200,
    behaviorActions: [
      { type: 'sway', intensity: 0.72, delayMs: 0, durationMs: 1000 }
    ]
  }, 2120);

  const extendedPlan = brain.getBehaviorPlan();
  const queuedSway = [...extendedPlan.actions].reverse().find((action) => action.type === 'sway');
  const arrivalElapsed = 2120 - extendedPlan.startedAt;
  assert.ok(
    queuedSway.delayMs - arrivalElapsed <= 64,
    `next streaming action should begin within one short visual beat; delay was ${queuedSway.delayMs - arrivalElapsed}ms`
  );

  const rampSampleAt = extendedPlan.startedAt + queuedSway.delayMs + 140;
  const rampEnergy = brain.sample(rampSampleAt).samples
    .find((sample) => sample.action === queuedSway)?.energy || 0;
  assert.ok(
    rampEnergy >= 0.16,
    `streaming handoff should not double-dampen the next action; energy was ${rampEnergy.toFixed(3)}`
  );
} finally {
  Math.random = originalRandom;
  await server.close();
}

console.log('action transition continuity checks passed');
