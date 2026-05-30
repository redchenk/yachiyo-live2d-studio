import {
  activeBehaviorSamples as sampleActiveBehaviorActions,
  createLive2DBehaviorPlan,
  pickDominantMotion,
  shouldInterruptLive2DBehaviorPlan
} from './live2dBehaviorOrchestrator';
import { createLive2DCharacterStateMachine } from './live2dCharacterStateMachine';
import { normalizeBehaviorBodyPose } from '../../constants/room/behaviorActionRegistry';
import {
  normalizeSemanticExpressionId,
  semanticExpressionFromEmotion
} from '../../constants/room/yachiyoExpressionPresetRegistry';

let sharedPerformanceBrain = null;

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function clamp(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function resolveExpression(detail = {}) {
  return normalizeSemanticExpressionId(
    detail.expression ||
    detail.expressionMix?.[0]?.expression ||
    detail.emotion ||
    detail.mood
  ) || semanticExpressionFromEmotion(detail.emotion || detail.mood);
}

function resolveBehaviorActions(detail = {}) {
  const explicit = Array.isArray(detail.behaviorActions) ? detail.behaviorActions : [];
  if (explicit.length) return explicit;
  const pose = normalizeBehaviorBodyPose(detail.bodyPose || detail.pose || detail.posture || detail.motion || detail.action);
  if (!pose) return [];
  return [{
    type: pose,
    intensity: clamp(detail.intensity, 0.4, 1, 0.82),
    durationMs: clamp(detail.durationMs || detail.duration, 650, 8000, 2200),
    delayMs: 0
  }];
}

export function createLive2DPerformanceBrain() {
  const characterState = createLive2DCharacterStateMachine();
  let behaviorPlan = null;
  let outgoingPlan = null;
  let cachedFrameKey = -1;
  let cachedFrame = null;
  let lastRoomActDetail = null;
  let lastRoomActAt = -Infinity;
  let lastRoomActResult = null;

  function invalidateFrameCache() {
    cachedFrameKey = -1;
    cachedFrame = null;
  }

  function releaseBehaviorPlan(plan, at, fadeOutMs = 0) {
    if (!plan) return;
    const elapsedAtRelease = Math.max(0, at - (Number(plan.startedAt) || at));
    outgoingPlan = {
      plan,
      releasedAt: at,
      elapsedAtRelease,
      fadeOutMs: clamp(fadeOutMs || plan.interruptPolicy?.blendOutMs, 180, 900, 260)
    };
  }

  function sampleOutgoingBehaviorActions(at, intensityScale) {
    if (!outgoingPlan) return [];
    const elapsedAfterRelease = Math.max(0, at - outgoingPlan.releasedAt);
    const fade = 1 - clamp(elapsedAfterRelease / Math.max(outgoingPlan.fadeOutMs, 1), 0, 1, 1);
    if (fade <= 0.001) {
      outgoingPlan = null;
      return [];
    }
    const samples = sampleActiveBehaviorActions(
      outgoingPlan.plan.actions,
      outgoingPlan.elapsedAtRelease + elapsedAfterRelease,
      { intensityScale }
    ).map((sample) => ({
      ...sample,
      envelope: sample.envelope * fade,
      intensity: sample.intensity * fade,
      energy: sample.energy * fade,
      outgoing: true
    }));
    if (!samples.length) outgoingPlan = null;
    return samples;
  }

  function startBehaviorPlan(actions, durationMs, options = {}) {
    if (!Array.isArray(actions) || !actions.length) return null;
    const now = Number(options.now) || nowMs();
    const expression = options.expression || '';
    const nextPlan = createLive2DBehaviorPlan(actions, durationMs, {
      now,
      expression,
      emotion: options.emotion,
      intensity: options.intensity,
      priority: options.priority,
      source: options.source || 'room-act',
      interruptPolicy: options.interruptPolicy || options.interrupt,
      suppressEyeOpen: Boolean(options.suppressEyeOpen),
      speechStyle: options.speechStyle
    });
    if (!shouldInterruptLive2DBehaviorPlan(behaviorPlan, nextPlan, now)) return behaviorPlan;
    if (behaviorPlan) {
      releaseBehaviorPlan(behaviorPlan, now, nextPlan.interruptPolicy?.blendInMs || behaviorPlan.interruptPolicy?.blendOutMs);
    }
    behaviorPlan = nextPlan;
    invalidateFrameCache();
    characterState.setMode('acting', {
      now,
      holdMs: nextPlan.durationMs + 420,
      attention: 0.86,
      arousal: 0.72
    });
    return behaviorPlan;
  }

  function onRoomAct(detail = {}, at = nowMs()) {
    if (
      detail &&
      typeof detail === 'object' &&
      detail === lastRoomActDetail &&
      Math.abs(at - lastRoomActAt) < 48
    ) {
      return lastRoomActResult;
    }
    invalidateFrameCache();
    characterState.onRoomAct(detail, at);
    const behaviorActions = resolveBehaviorActions(detail);
    const expression = resolveExpression(detail);
    let nextPlan = null;
    if (behaviorActions.length) {
      nextPlan = startBehaviorPlan(behaviorActions, detail.durationMs || detail.duration, {
        now: at,
        expression,
        emotion: detail.emotion || detail.mood,
        intensity: detail.intensity,
        priority: detail.priority,
        source: detail.source || 'room-act',
        interruptPolicy: detail.interruptPolicy || detail.interrupt,
        speechStyle: detail.speechStyle || detail.speech_style
      });
    }
    const result = {
      behaviorActions,
      behaviorPlan: nextPlan,
      expression,
      bodyPose: detail.bodyPose || detail.pose || detail.posture || detail.motion || detail.action || '',
      intensity: detail.intensity,
      priority: detail.priority,
      durationMs: detail.durationMs || detail.duration || 0
    };
    if (detail && typeof detail === 'object') {
      lastRoomActDetail = detail;
      lastRoomActAt = at;
      lastRoomActResult = result;
    }
    return result;
  }

  function onMouth(value, at = nowMs()) {
    invalidateFrameCache();
    characterState.onMouth(value, at);
  }

  function onExternalState(detail = {}, at = nowMs()) {
    invalidateFrameCache();
    characterState.onExternalState(detail, at);
  }

  function sample(now = nowMs(), options = {}) {
    const frameKey = Math.floor(Number(now) / 16);
    if (cachedFrame && cachedFrameKey === frameKey) return cachedFrame;
    const character = characterState.sample(now);
    const currentPlan = behaviorPlan;
    const elapsedMs = currentPlan ? now - currentPlan.startedAt : 0;
    if (currentPlan && elapsedMs >= currentPlan.durationMs) {
      releaseBehaviorPlan(currentPlan, now, currentPlan.interruptPolicy?.blendOutMs);
      behaviorPlan = null;
      characterState.setMode('listening', { now, holdMs: 1400, attention: 0.52 });
    }
    const activePlan = behaviorPlan;
    const intensityScale = Number(options.intensityScale) || 1.62;
    const outgoingExpression = outgoingPlan?.plan?.expression;
    const trailingSamples = sampleOutgoingBehaviorActions(now, intensityScale);
    const activeSamples = activePlan ? sampleActiveBehaviorActions(activePlan.actions, elapsedMs, {
      intensityScale
    }) : [];
    const samples = [...trailingSamples, ...activeSamples];
    const dominant = activePlan
      ? pickDominantMotion(activeSamples.length ? activeSamples : samples)
      : pickDominantMotion(samples);
    cachedFrame = {
      character,
      behaviorPlan: activePlan,
      elapsedMs,
      samples,
      dominant,
      expression: activePlan?.expression || outgoingExpression || character.emotion,
      active: Boolean(activePlan || trailingSamples.length),
      completed: Boolean(currentPlan && !activePlan)
    };
    cachedFrameKey = frameKey;
    return cachedFrame;
  }

  function getBehaviorPlan() {
    return behaviorPlan;
  }

  function getCharacterState() {
    return characterState;
  }

  function hasBehaviorPlan() {
    return Boolean(behaviorPlan || outgoingPlan);
  }

  return {
    characterState,
    startBehaviorPlan,
    onRoomAct,
    onMouth,
    onExternalState,
    sample,
    getBehaviorPlan,
    getCharacterState,
    hasBehaviorPlan
  };
}

export function getRoomLive2DPerformanceBrain() {
  if (!sharedPerformanceBrain) sharedPerformanceBrain = createLive2DPerformanceBrain();
  return sharedPerformanceBrain;
}
