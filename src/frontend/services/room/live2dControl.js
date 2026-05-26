import { roomLive2DManifest } from '../../constants/room/live2dManifest';

const DEBUG_STATE_KEY = 'roomLive2DDebugState';
export const ROOM_LIVE2D_PENDING_INTENT_KEY = 'roomLive2DPendingIntent';
const DEBUG_HISTORY_LIMIT = 12;

let activeQueueTimers = [];

const expressionAliases = {
  neutral: 'neutral',
  none: 'neutral',
  normal: 'neutral',
  calm: 'neutral',
  default: 'neutral',
  happy: 'smile',
  joy: 'smile',
  cheerful: 'smile',
  smile: 'smile',
  gentle: 'smile',
  warm: 'smile',
  开心: 'smile',
  高兴: 'smile',
  愉快: 'smile',
  微笑: 'smile',
  笑: 'smile',
  嬉しい: 'smile',
  優しい: 'smile',
  shy: 'bsmile',
  blush: 'bsmile',
  embarrassed: 'bsmile',
  playful: 'bsmile',
  bsmile: 'bsmile',
  annoyed: 'bsmile',
  angry: 'bsmile',
  害羞: 'bsmile',
  脸红: 'bsmile',
  調皮: 'bsmile',
  生气: 'bsmile',
  愤怒: 'bsmile',
  照れ: 'bsmile',
  sad: 'namida',
  sorrow: 'namida',
  namida: 'namida',
  难过: 'namida',
  悲伤: 'namida',
  伤心: 'namida',
  眼泪: 'namida',
  涙: 'namida',
  悲しい: 'namida',
  tears: 'tears',
  crying: 'tears',
  cry: 'tears',
  哭: 'tears',
  哭泣: 'tears',
  流泪: 'tears',
  大哭: 'tears',
  泣く: 'tears'
};

const motionAliases = {
  tap_body: 'tap_body',
  body_tap: 'tap_body',
  tapbody: 'tap_body',
  nod: 'tap_body',
  lean: 'tap_body',
  emphasis: 'tap_body',
  点头: 'tap_body',
  靠近: 'tap_body',
  轻动: 'tap_body'
};

const bodyPoseAliases = {
  none: '',
  null: '',
  tap_body: 'emphasis',
  body_tap: 'emphasis',
  tapbody: 'emphasis',
  nod: 'nod',
  agree: 'nod',
  yes: 'nod',
  shake: 'shake_head',
  shake_head: 'shake_head',
  no: 'shake_head',
  lean: 'lean_in',
  lean_in: 'lean_in',
  forward: 'lean_in',
  close: 'lean_in',
  lean_left: 'lean_left',
  left: 'lean_left',
  lean_right: 'lean_right',
  right: 'lean_right',
  sway: 'sway',
  bounce: 'bounce',
  excited: 'bounce',
  emphasis: 'emphasis',
  accent: 'emphasis',
  鐐瑰ご: 'nod',
  闈犺繎: 'lean_in',
  杞诲姩: 'sway'
};

const emotionAliases = {
  happy: 'smile',
  joy: 'smile',
  cheerful: 'smile',
  smile: 'smile',
  warm: 'smile',
  开心: 'smile',
  高兴: 'smile',
  愉快: 'smile',
  微笑: 'smile',
  shy: 'bsmile',
  blush: 'bsmile',
  embarrassed: 'bsmile',
  playful: 'bsmile',
  angry: 'bsmile',
  annoyed: 'bsmile',
  害羞: 'bsmile',
  脸红: 'bsmile',
  调皮: 'bsmile',
  生气: 'bsmile',
  愤怒: 'bsmile',
  sad: 'namida',
  sorrow: 'namida',
  难过: 'namida',
  悲伤: 'namida',
  伤心: 'namida',
  眼泪: 'namida',
  crying: 'tears',
  cry: 'tears',
  tears: 'tears',
  哭泣: 'tears',
  流泪: 'tears',
  大哭: 'tears',
  neutral: 'neutral',
  calm: 'neutral',
  default: 'neutral'
};

function manifestIds(items) {
  return new Set(items.map((item) => item.id));
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function clamp01(value, fallback = 0.65) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, 0), 1);
}

function normalizeDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 5000;
  return Math.min(Math.max(Math.round(numeric), 800), 12000);
}

function normalizeDelay(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(Math.max(Math.round(numeric), 0), 12000);
}

function normalizeParameterDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 900;
  return Math.min(Math.max(Math.round(numeric), 250), 12000);
}

function readDebugState() {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(DEBUG_STATE_KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function writeDebugState(patch) {
  if (typeof localStorage === 'undefined') return;
  const current = readDebugState();
  const next = {
    ...current,
    ...patch,
    updatedAt: Date.now()
  };
  localStorage.setItem(DEBUG_STATE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('tsukuyomi:room-live2d-debug', { detail: next }));
}

function appendDebugHistory(entry) {
  const current = readDebugState();
  const history = Array.isArray(current.history) ? current.history : [];
  writeDebugState({
    history: [
      {
        ...entry,
        id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: Date.now()
      },
      ...history
    ].slice(0, DEBUG_HISTORY_LIMIT)
  });
}

export function normalizeLive2DExpression(value, manifest = roomLive2DManifest) {
  const ids = manifestIds(manifest.expressions);
  const key = normalizeToken(value);
  const aliased = expressionAliases[key] || key;
  return ids.has(aliased) ? aliased : '';
}

export function normalizeLive2DMotion(value, manifest = roomLive2DManifest) {
  const ids = manifestIds(manifest.motions);
  const key = normalizeToken(value);
  if (!key || key === 'none' || key === 'null') return '';
  const aliased = motionAliases[key] || key;
  return ids.has(aliased) ? aliased : '';
}

export function normalizeLive2DBodyPose(value, manifest = roomLive2DManifest) {
  const ids = manifestIds(manifest.motions);
  const key = normalizeToken(value);
  if (!key || key === 'none' || key === 'null') return '';
  const aliased = bodyPoseAliases[key] ?? key;
  return ids.has(aliased) ? aliased : '';
}

function manifestParameterMap(manifest = roomLive2DManifest) {
  return new Map((manifest.parameterControls || []).map((item) => [String(item.id || '').trim().toLowerCase(), item]));
}

function normalizeLive2DParameterTargets(value, manifest = roomLive2DManifest) {
  const controlMap = manifestParameterMap(manifest);
  const rawTargets = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).map(([id, target]) => (target && typeof target === 'object' ? { id, ...target } : { id, value: target }))
      : [];

  const merged = [];
  for (const target of rawTargets) {
    const key = String(target?.id || target?.parameterId || target?.param || target?.key || target?.name || '').trim().toLowerCase();
    const control = key ? controlMap.get(key) : null;
    if (!control) continue;
    const numericValue = Number(target?.value ?? target?.target ?? target?.amount ?? target?.to);
    if (!Number.isFinite(numericValue)) continue;
    const min = Number.isFinite(Number(control.min)) ? Number(control.min) : -1;
    const max = Number.isFinite(Number(control.max)) ? Number(control.max) : 1;
    merged.push({
      id: control.id,
      value: Math.min(Math.max(numericValue, min), max),
      weight: clamp01(target?.weight, 0.85),
      durationMs: normalizeParameterDuration(target?.durationMs || target?.duration || target?.timeMs || target?.time),
      delayMs: normalizeDelay(target?.delayMs || target?.delay || target?.offsetMs)
    });
  }

  return merged.slice(0, 12);
}

export function normalizeLive2DEmotion(value, manifest = roomLive2DManifest) {
  const key = normalizeToken(value);
  const aliased = emotionAliases[key] || key;
  return normalizeLive2DExpression(aliased, manifest);
}

function normalizeExpressionMix(value, fallbackExpression, manifest) {
  const rawLayers = Array.isArray(value) ? value : [];
  const merged = new Map();
  for (const layer of rawLayers) {
    const expression = normalizeLive2DExpression(
      layer?.expression || layer?.key || layer?.id,
      manifest
    );
    if (!expression) continue;
    const weight = clamp01(layer?.weight, expression === fallbackExpression ? 1 : 0.5);
    if (weight <= 0.02) continue;
    merged.set(expression, Math.min(1, (merged.get(expression) || 0) + weight));
  }
  const layers = [...merged.entries()]
    .map(([expression, weight]) => ({ expression, weight }))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 3);
  if (layers.length) return layers;
  return fallbackExpression ? [{ expression: fallbackExpression, weight: 1 }] : [];
}

function bodyPoseScale(intensity) {
  return 0.7 + clamp01(intensity, 0.72) * 1.05;
}

function poseParameter(id, value, weight, durationMs, delayMs = 0) {
  return {
    id,
    value,
    weight,
    durationMs,
    delayMs
  };
}

function bodyPoseParameterTargets(bodyPose, intensity, durationMs, manifest) {
  const scale = bodyPoseScale(intensity);
  const baseDuration = Math.min(Math.max(Math.round(durationMs * 0.78), 750), 3200);
  const longDuration = Math.min(Math.max(Math.round(durationMs * 1.02), 1100), 5200);
  const subtleBreath = Math.min(1, 0.42 + scale * 0.22);
  const rawTargets = {
    nod: [
      poseParameter('ParamAngleY', 8 * scale, 0.84, baseDuration),
      poseParameter('ParamBodyAngleY', 3.8 * scale, 0.8, longDuration),
      poseParameter('ParamBodyInput_BodyY', 8.5 * scale, 0.88, longDuration),
      poseParameter('ParamOutput_BodyY', 6.8 * scale, 0.82, longDuration),
      poseParameter('ParamAngle_BodyY', 5.8 * scale, 0.82, longDuration),
      poseParameter('ParamAngle_BodyY2', 4.2 * scale, 0.68, longDuration),
      poseParameter('ParamAngle_HipUp', 3.6 * scale, 0.58, baseDuration),
      poseParameter('ParamBreath', subtleBreath, 0.44, longDuration)
    ],
    shake_head: [
      poseParameter('ParamAngleX', -9.5 * scale, 0.82, baseDuration),
      poseParameter('ParamAngleZ', 2.8 * scale, 0.5, baseDuration),
      poseParameter('ParamBodyAngleX', -3.2 * scale, 0.72, longDuration),
      poseParameter('ParamBodyInput_BodyX', -8.5 * scale, 0.88, longDuration),
      poseParameter('ParamOutput_BodyX', -6.8 * scale, 0.82, longDuration),
      poseParameter('ParamAngle_BodyX', -6.2 * scale, 0.82, longDuration),
      poseParameter('ParamAngle_BodyX2', -4.6 * scale, 0.68, longDuration),
      poseParameter('ParamAngle_BodyX3', -3.4 * scale, 0.56, longDuration),
      poseParameter('ParamEyeBallX', -0.26 * scale, 0.48, baseDuration)
    ],
    lean_in: [
      poseParameter('ParamAngleY', -4.2 * scale, 0.62, baseDuration),
      poseParameter('ParamBodyAngleY', -5.2 * scale, 0.84, longDuration),
      poseParameter('PositionZ', -7.5 * scale, 0.86, longDuration),
      poseParameter('ParamPosition_Z', -5.6 * scale, 0.78, longDuration),
      poseParameter('ParamBodyInput_BodyY', -9.2 * scale, 0.9, longDuration),
      poseParameter('ParamOutput_BodyY', -7.2 * scale, 0.84, longDuration),
      poseParameter('ParamAngle_BodyY', -6.2 * scale, 0.82, longDuration),
      poseParameter('ParamAngle_BodyY2', -4.6 * scale, 0.68, longDuration),
      poseParameter('ParamEyeBallY', -0.2 * scale, 0.54, baseDuration),
      poseParameter('ParamBrowLY', 0.12 * scale, 0.36, baseDuration),
      poseParameter('ParamBrowRY', 0.12 * scale, 0.36, baseDuration)
    ],
    lean_left: [
      poseParameter('ParamAngleZ', -5.4 * scale, 0.62, baseDuration),
      poseParameter('ParamBodyInput_BodyX', -9.5 * scale, 0.9, longDuration),
      poseParameter('ParamOutput_BodyX', -7.5 * scale, 0.84, longDuration),
      poseParameter('ParamAngle_BodyX', -6.8 * scale, 0.86, longDuration),
      poseParameter('ParamAngle_BodyX2', -5.2 * scale, 0.72, longDuration),
      poseParameter('ParamBodyInput_BodyZ', -6.8 * scale, 0.84, longDuration),
      poseParameter('ParamOutput_BodyZ', -5.3 * scale, 0.76, longDuration),
      poseParameter('ParamBodyInput_ChestZ', -6.2 * scale, 0.82, longDuration),
      poseParameter('ParamBodyInput_HipZ', 5.4 * scale, 0.76, longDuration),
      poseParameter('ParamAngle_ChestZ', -5.6 * scale, 0.76, longDuration),
      poseParameter('ParamAngle_HipZ', 4.8 * scale, 0.7, longDuration),
      poseParameter('ParamAngle_ShoulderL', -3.4 * scale, 0.48, baseDuration)
    ],
    lean_right: [
      poseParameter('ParamAngleZ', 5.4 * scale, 0.62, baseDuration),
      poseParameter('ParamBodyInput_BodyX', 9.5 * scale, 0.9, longDuration),
      poseParameter('ParamOutput_BodyX', 7.5 * scale, 0.84, longDuration),
      poseParameter('ParamAngle_BodyX', 6.8 * scale, 0.86, longDuration),
      poseParameter('ParamAngle_BodyX2', 5.2 * scale, 0.72, longDuration),
      poseParameter('ParamBodyInput_BodyZ', 6.8 * scale, 0.84, longDuration),
      poseParameter('ParamOutput_BodyZ', 5.3 * scale, 0.76, longDuration),
      poseParameter('ParamBodyInput_ChestZ', 6.2 * scale, 0.82, longDuration),
      poseParameter('ParamBodyInput_HipZ', -5.4 * scale, 0.76, longDuration),
      poseParameter('ParamAngle_ChestZ', 5.6 * scale, 0.76, longDuration),
      poseParameter('ParamAngle_HipZ', -4.8 * scale, 0.7, longDuration),
      poseParameter('ParamAngle_ShoulderR', -3.4 * scale, 0.48, baseDuration)
    ],
    sway: [
      poseParameter('ParamBodyInput_BodyX', 5.8 * scale, 0.68, longDuration),
      poseParameter('ParamOutput_BodyX', 4.8 * scale, 0.64, longDuration),
      poseParameter('ParamAngle_BodyX', 4.4 * scale, 0.62, longDuration),
      poseParameter('ParamAngle_BodyX2', 3.4 * scale, 0.5, longDuration),
      poseParameter('ParamBodyInput_BodyZ', 4.5 * scale, 0.66, longDuration),
      poseParameter('ParamOutput_BodyZ', 3.8 * scale, 0.58, longDuration),
      poseParameter('ParamAngle_BodyZ', 3.5 * scale, 0.56, longDuration),
      poseParameter('ParamAngle_ChestZ', 3.2 * scale, 0.5, longDuration),
      poseParameter('ParamAngle_HipZ', -2.8 * scale, 0.46, longDuration),
      poseParameter('ParamAngle_ShoulderL', 2 * scale, 0.36, baseDuration),
      poseParameter('ParamAngle_ShoulderR', -1.8 * scale, 0.36, baseDuration),
      poseParameter('ParamBreath', subtleBreath, 0.44, longDuration)
    ],
    bounce: [
      poseParameter('ParamAngleY', 3.8 * scale, 0.56, baseDuration),
      poseParameter('ParamBodyAngleY', 5.4 * scale, 0.82, baseDuration),
      poseParameter('PositionZ', 5.5 * scale, 0.74, baseDuration),
      poseParameter('ParamPosition_Z', 4.6 * scale, 0.66, baseDuration),
      poseParameter('ParamBodyInput_BodyY', 9.5 * scale, 0.86, baseDuration),
      poseParameter('ParamOutput_BodyY', 7.6 * scale, 0.8, baseDuration),
      poseParameter('ParamAngle_BodyY', 6.8 * scale, 0.78, baseDuration),
      poseParameter('ParamAngle_BodyY2', 5 * scale, 0.64, baseDuration),
      poseParameter('ParamAngle_HipUp', 5.5 * scale, 0.62, baseDuration),
      poseParameter('ParamAngle_HipDown', -3.8 * scale, 0.48, baseDuration),
      poseParameter('ParamMouthForm', 0.22 * scale, 0.38, baseDuration),
      poseParameter('ParamBreath', Math.min(1, 0.5 + scale * 0.22), 0.44, longDuration)
    ],
    emphasis: [
      poseParameter('ParamAngleZ', -6 * scale, 0.68, baseDuration),
      poseParameter('ParamBodyAngleY', -4 * scale, 0.72, baseDuration),
      poseParameter('ParamBodyInput_BodyY', -6 * scale, 0.78, baseDuration),
      poseParameter('ParamOutput_BodyY', -5 * scale, 0.7, baseDuration),
      poseParameter('ParamBodyInput_BodyZ', -8 * scale, 0.84, baseDuration),
      poseParameter('ParamOutput_BodyZ', -6.5 * scale, 0.78, baseDuration),
      poseParameter('ParamAngle_BodyZ', -6 * scale, 0.78, baseDuration),
      poseParameter('ParamAngle_BodyZ2', -4.8 * scale, 0.62, baseDuration),
      poseParameter('ParamAngle_ChestZ', -6.4 * scale, 0.76, baseDuration),
      poseParameter('ParamAngle_HipZ', 5.4 * scale, 0.7, baseDuration),
      poseParameter('ParamAngle_ShoulderL', -3.4 * scale, 0.48, baseDuration),
      poseParameter('ParamAngle_ShoulderR', 3.1 * scale, 0.48, baseDuration)
    ]
  }[bodyPose] || [];

  return normalizeLive2DParameterTargets(rawTargets, manifest);
}

function mergeParameterTargets(explicitTargets, fallbackTargets) {
  const merged = [...explicitTargets];
  const seen = new Set(merged.map((item) => String(item.id || '').toLowerCase()));
  for (const target of fallbackTargets) {
    const key = String(target.id || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    merged.push(target);
    seen.add(key);
  }
  return merged.slice(0, 12);
}

function normalizeLive2DStep(input, manifest = roomLive2DManifest) {
  if (!input || typeof input !== 'object') return null;
  const rawExpression = input.expression || input.expressionId || input.face || input.mood || input.emotion || '';
  const expression = normalizeLive2DExpression(rawExpression, manifest) || normalizeLive2DEmotion(input.emotion || input.mood, manifest);
  const motion = normalizeLive2DMotion(input.motion || input.action, manifest);
  const bodyPose = normalizeLive2DBodyPose(input.bodyPose || input.pose || input.posture || input.motion || input.action, manifest);
  const expressionMix = normalizeExpressionMix(input.expressionMix, expression, manifest);
  const intensity = clamp01(input.intensity, 0.65);
  const durationMs = normalizeDuration(input.durationMs || input.duration);
  const explicitParameters = normalizeLive2DParameterTargets(input.parameters || input.parameterTargets || input.params, manifest);
  const parameters = mergeParameterTargets(
    explicitParameters,
    bodyPose ? bodyPoseParameterTargets(bodyPose, intensity, durationMs, manifest) : []
  );
  const primaryExpression = expressionMix[0]?.expression || expression;
  const hasControl = primaryExpression || motion || bodyPose || parameters.length;
  if (!hasControl) return null;
  return {
    emotion: String(input.emotion || input.mood || '').trim() || null,
    expression: primaryExpression || null,
    expressionMix,
    motion: motion || null,
    bodyPose: bodyPose || null,
    parameters,
    intensity,
    durationMs,
    delayMs: normalizeDelay(input.delayMs || input.delay)
  };
}

function normalizeSequence(input, manifest = roomLive2DManifest) {
  const rawSequence = Array.isArray(input?.sequence) ? input.sequence : [];
  return rawSequence
    .map((step) => normalizeLive2DStep(step, manifest))
    .filter(Boolean)
    .slice(0, 8);
}

export function normalizeLive2DIntent(input, manifest = roomLive2DManifest) {
  if (!input || typeof input !== 'object') return null;
  const sequence = normalizeSequence(input, manifest);
  const baseStep = normalizeLive2DStep(input, manifest);
  const steps = sequence.length ? sequence : (baseStep ? [baseStep] : []);
  if (!steps.length) return null;
  const primary = baseStep || steps[0];
  return {
    ...primary,
    sequence: steps
  };
}

export function inferLive2DIntentFromText(text, manifest = roomLive2DManifest) {
  const value = String(text || '').toLowerCase();
  const matchers = [
    { expression: 'tears', pattern: /(大哭|哭泣|流泪|崩溃|crying|tears|泣く)/u, emotion: 'crying' },
    { expression: 'namida', pattern: /(难过|悲伤|伤心|寂寞|眼泪|sad|sorrow|悲しい)/u, emotion: 'sad' },
    { expression: 'bsmile', pattern: /(害羞|脸红|调皮|生气|愤怒|shy|blush|angry|annoyed|照れ)/u, emotion: 'shy' },
    { expression: 'smile', pattern: /(开心|高兴|愉快|微笑|笑|happy|smile|joy|嬉しい|優しい)/u, emotion: 'happy' }
  ];
  const matched = matchers.find((item) => item.pattern.test(value));
  return matched
    ? normalizeLive2DIntent({ ...matched, intensity: 0.5, durationMs: 5000 }, manifest)
    : null;
}

export function dispatchRoomLive2D(intent) {
  const normalized = normalizeLive2DIntent(intent);
  if (!normalized) return null;
  const sequence = Array.isArray(normalized.sequence) && normalized.sequence.length
    ? normalized.sequence
    : [normalized];
  activeQueueTimers.forEach((timer) => window.clearTimeout(timer));
  activeQueueTimers = [];
  writeDebugState({
    status: 'queued',
    raw: intent,
    normalized,
    activeIndex: 0,
    total: sequence.length
  });
  appendDebugHistory({ source: 'dispatch', normalized });
  let elapsed = 0;
  sequence.forEach((step, index) => {
    elapsed += normalizeDelay(step.delayMs);
    const timer = window.setTimeout(() => {
      writeDebugState({
        status: 'playing',
        current: step,
        activeIndex: index + 1,
        total: sequence.length
      });
      window.dispatchEvent(new CustomEvent('tsukuyomi:room-act', { detail: step }));
      if (index === sequence.length - 1) {
        window.setTimeout(() => {
          writeDebugState({ status: 'idle', activeIndex: sequence.length, total: sequence.length });
        }, normalizeDuration(step.durationMs));
      }
    }, elapsed);
    activeQueueTimers.push(timer);
    elapsed += normalizeDuration(step.durationMs);
  });
  return normalized;
}

export function queueRoomLive2DForNextRoom(intent) {
  const normalized = normalizeLive2DIntent(intent);
  if (!normalized || typeof localStorage === 'undefined') return null;
  localStorage.setItem(ROOM_LIVE2D_PENDING_INTENT_KEY, JSON.stringify({
    intent: normalized,
    createdAt: Date.now()
  }));
  writeDebugState({
    status: 'pending',
    raw: intent,
    normalized,
    activeIndex: 0,
    total: normalized.sequence?.length || 1
  });
  appendDebugHistory({ source: 'pending', normalized });
  return normalized;
}

export function consumePendingRoomLive2DIntent(maxAgeMs = 120000) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const payload = JSON.parse(localStorage.getItem(ROOM_LIVE2D_PENDING_INTENT_KEY) || 'null');
    localStorage.removeItem(ROOM_LIVE2D_PENDING_INTENT_KEY);
    if (!payload?.intent || Date.now() - Number(payload.createdAt || 0) > maxAgeMs) return null;
    return dispatchRoomLive2D(payload.intent);
  } catch (_) {
    localStorage.removeItem(ROOM_LIVE2D_PENDING_INTENT_KEY);
    return null;
  }
}

export function readRoomLive2DDebugState() {
  return readDebugState();
}

export function clearRoomLive2DQueue() {
  activeQueueTimers.forEach((timer) => window.clearTimeout(timer));
  activeQueueTimers = [];
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(ROOM_LIVE2D_PENDING_INTENT_KEY);
  }
  writeDebugState({ status: 'idle', current: null, activeIndex: 0, total: 0 });
}
