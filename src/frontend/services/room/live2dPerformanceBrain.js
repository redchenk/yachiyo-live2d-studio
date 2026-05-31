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
import {
  appendRoomLive2DDebugEvent,
  publishRoomLive2DPerformanceDebug,
  summarizeDebugBehaviorPlan
} from './live2dDebug';

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

function isStreamingSpeechSource(source) {
  return String(source || '').trim().toLowerCase() === 'streaming-speech';
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
      fadeOutMs: clamp(fadeOutMs || plan.interruptPolicy?.blendOutMs, 260, 1200, 520)
    };
    appendRoomLive2DDebugEvent('behavior-plan-release', {
      source: plan.source || 'performance',
      expression: plan.expression,
      behaviorPlan: summarizeDebugBehaviorPlan(plan, elapsedAtRelease),
      fadeOutMs: outgoingPlan.fadeOutMs
    });
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
    if (!shouldInterruptLive2DBehaviorPlan(behaviorPlan, nextPlan, now)) {
      appendRoomLive2DDebugEvent('behavior-plan-protected', {
        source: options.source || 'room-act',
        expression,
        behaviorPlan: summarizeDebugBehaviorPlan(behaviorPlan, now - (behaviorPlan?.startedAt || now)),
        nextPlan: summarizeDebugBehaviorPlan(nextPlan, 0)
      });
      return behaviorPlan;
    }
    if (behaviorPlan) {
      releaseBehaviorPlan(behaviorPlan, now, nextPlan.interruptPolicy?.blendInMs || behaviorPlan.interruptPolicy?.blendOutMs);
    }
    behaviorPlan = nextPlan;
    invalidateFrameCache();
    const speechSynchronized = isStreamingSpeechSource(nextPlan.source || options.source);
    characterState.setMode(speechSynchronized ? 'speaking' : 'acting', {
      now,
      holdMs: nextPlan.durationMs + (speechSynchronized ? 760 : 420),
      emotion: speechSynchronized ? (options.emotion || expression) : null,
      emotionHoldMs: speechSynchronized ? nextPlan.durationMs + 960 : null,
      attention: speechSynchronized ? 0.88 : 0.86,
      arousal: speechSynchronized ? 0.68 : 0.72
    });
    appendRoomLive2DDebugEvent('behavior-plan-start', {
      source: nextPlan.source || options.source || 'room-act',
      expression,
      emotion: options.emotion,
      behaviorPlan: summarizeDebugBehaviorPlan(nextPlan, 0),
      action: nextPlan.actions?.[0]?.type || ''
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
    const behaviorActions = resolveBehaviorActions(detail);
    const expression = resolveExpression(detail);
    const source = detail.source || 'room-act';
    const speechSynchronized = isStreamingSpeechSource(source);
    if (speechSynchronized) {
      const durationMs = clamp(detail.durationMs || detail.duration, 800, 12000, 2600);
      characterState.onExternalState({
        mode: 'speaking',
        holdMs: durationMs + 760,
        emotionHoldMs: durationMs + 960,
        emotion: detail.emotion || detail.mood || expression,
        attention: 0.88,
        arousal: detail.emotion === 'sad' || detail.emotion === 'crying' ? 0.5 : 0.68
      }, at);
    } else {
      characterState.onRoomAct(detail, at);
    }
    let nextPlan = null;
    if (behaviorActions.length) {
      nextPlan = startBehaviorPlan(behaviorActions, detail.durationMs || detail.duration, {
        now: at,
        expression,
        emotion: detail.emotion || detail.mood,
        intensity: detail.intensity,
        priority: detail.priority,
        source,
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
    const intensityScale = Number(options.intensityScale) || 1.62;
    const frameKey = `${Math.floor(Number(now) / 16)}:${intensityScale.toFixed(3)}`;
    if (cachedFrame && cachedFrameKey === frameKey) return cachedFrame;
    const character = characterState.sample(now);
    const currentPlan = behaviorPlan;
    const elapsedMs = currentPlan ? now - currentPlan.startedAt : 0;
    if (currentPlan && elapsedMs >= currentPlan.durationMs) {
      releaseBehaviorPlan(currentPlan, now, currentPlan.interruptPolicy?.blendOutMs);
      behaviorPlan = null;
      characterState.setMode('listening', { now, holdMs: 1400, attention: 0.52 });
      appendRoomLive2DDebugEvent('behavior-plan-complete', {
        source: currentPlan.source || 'performance',
        expression: currentPlan.expression,
        behaviorPlan: summarizeDebugBehaviorPlan(currentPlan, currentPlan.durationMs)
      });
    }
    const activePlan = behaviorPlan;
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
    publishRoomLive2DPerformanceDebug(cachedFrame);
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
