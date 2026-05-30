import { mountCubismBehaviorBridge } from './live2dCubismBehaviorBridge';
import { YACHIYO_MODEL_PARAMETER_RANGES } from '../../constants/room/yachiyoModelParameterRegistry';

const FACE_CAPTURE_EVENT = 'tsukuyomi:live2d-face';
const LOCAL_BRIDGE_STATE_KEY = '__TSUKUYOMI_LOCAL_CUBISM_BRIDGE_STATE__';
const LOCAL_CUBISM_FRAME_FLUSH_MS = 1000 / 60;

const LOCAL_CUBISM_BODY_DRIVER_IDS = new Set([
  'ParamSwitchCtrl_BodyX',
  'ParamSwitchCtrl_BodyY',
  'ParamSwitchCtrl_BodyZ',
  'ParamSwitchCtrl_ChestZ',
  'ParamSwitchCtrl_HipZ',
  'ParamBodyAngleX',
  'ParamBodyAngleY',
  'ParamBodyAngleZ'
]);

const LOCAL_CUBISM_PHYSICS_MANAGED_IDS = new Set([
  'ParamBodyInput_BodyX',
  'ParamBodyInput_BodyY',
  'ParamBodyInput_BodyZ',
  'ParamBodyInput_ChestZ',
  'ParamBodyInput_HipZ',
  'ParamOutput_BodyX',
  'ParamOutput_BodyY',
  'ParamOutput_BodyZ',
  'ParamOutput_ChestZ',
  'ParamOutput_HipZ',
  'ParamPhysicsRAM_BodyX',
  'ParamPhysicsRAM_BodyY',
  'ParamPhysicsRAM_BodyZ',
  'ParamPhysicsRAM_ChestZ',
  'ParamPhysicsRAM_HipZ',
  'ParamBodyAngleX',
  'ParamBodyAngleY',
  'ParamBodyAngleZ',
  'ParamAngle_BodyX',
  'ParamAngle_BodyX2',
  'ParamAngle_BodyX3',
  'ParamAngle_BodyY',
  'ParamAngle_BodyY2',
  'ParamAngle_BodyZ',
  'ParamAngle_BodyZ2',
  'ParamAngle_ChestZ',
  'ParamAngle_HipZ',
  'ParamAngle_ShoulderL',
  'ParamAngle_ShoulderR',
  'ParamAngle_HipUp',
  'ParamAngle_HipDown',
  'PositionZ',
  'ParamPosition_Z'
]);

const LOCAL_CUBISM_PHYSICS_OUTPUT_PREFIXES = [
  'ParamHairPhysics',
  'ParamEarShape',
  'ParamEarPhysics',
  'ParamWingPhysics',
  'ParamHatPhysics',
  'ParamHatEar',
  'ParamCheongsamPhysics'
];

let lastSmoothedFrame = new Map();
let lastVelocityFrame = new Map();
let lastSmoothedAt = 0;
let pendingFrame = new Map();
let flushTimer = 0;

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function isLocalCubismBodyDriverId(id) {
  return LOCAL_CUBISM_BODY_DRIVER_IDS.has(String(id || ''));
}

function isLocalCubismPhysicsOutputId(id) {
  const value = String(id || '');
  return LOCAL_CUBISM_PHYSICS_OUTPUT_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isYachiyoModelParameterId(id) {
  return !!YACHIYO_MODEL_PARAMETER_RANGES[String(id || '')];
}

function isLocalCubismSuppressedId(id) {
  const value = String(id || '');
  if (isYachiyoModelParameterId(value)) return false;
  return LOCAL_CUBISM_PHYSICS_MANAGED_IDS.has(value) || isLocalCubismPhysicsOutputId(value);
}

function isLocalCubismEyeExpressionId(id) {
  const value = String(id || '');
  return (
    value === 'ParamEyeLSmile' ||
    value === 'ParamEyeRSmile' ||
    value.startsWith('ParamEyeSmile_') ||
    value.startsWith('ParamHide_Eyes') ||
    value.startsWith('ParamHighLightHide_Eyes') ||
    value.startsWith('ParamHide_EyeSocket')
  );
}

function setLocalBridgeState(patch) {
  if (typeof window === 'undefined') return;
  window[LOCAL_BRIDGE_STATE_KEY] = {
    ...(window[LOCAL_BRIDGE_STATE_KEY] || {}),
    ...patch,
    updatedAt: Date.now()
  };
}

function runtimeLocalBridge() {
  return typeof window !== 'undefined' && window.TSUKUYOMI_LOCAL_CUBISM_BRIDGE
    ? window.TSUKUYOMI_LOCAL_CUBISM_BRIDGE
    : null;
}

function dispatchFallbackFrame(parameters) {
  window.dispatchEvent(new CustomEvent(FACE_CAPTURE_EVENT, {
    detail: { source: 'cubism-behavior', parameters }
  }));
}

function normalizeParameterId(item) {
  return String(item?.id || item?.parameterId || item?.param || item?.key || item?.name || '').trim();
}

function localFrameSmoothingProfile(id) {
  if (id.startsWith('ParamSwitchCtrl_')) return { alpha: 1, step: 1 };
  if (id.startsWith('ParamBodyInput_')) return { alpha: 0.28, step: 1.8, accel: 0.42 };
  if (id.startsWith('ParamOutput_') || id.startsWith('ParamPhysicsRAM_')) return { alpha: 0.26, step: 1.65, accel: 0.36 };
  if (id.startsWith('ParamAngle_Body') || id.startsWith('ParamAngle_Chest') || id.startsWith('ParamAngle_Hip') || id.startsWith('ParamAngle_Shoulder')) return { alpha: 0.26, step: 1.7, accel: 0.38 };
  if (id === 'ParamPosition_Z') return { alpha: 0.36, step: 1.6, accel: 0.3 };
  if (id.startsWith('ParamHair')) return { alpha: 0.46, step: 2.8 };
  if (id.startsWith('ParamEarShape')) return { alpha: 0.42, step: 0.16 };
  if (id.startsWith('ParamEarPhysics')) return { alpha: 0.5, step: 8.5 };
  if (id.startsWith('ParamHatEar')) return { alpha: 0.5, step: 6.8 };
  if (id.startsWith('ParamHatPhysics')) return { alpha: 0.5, step: 5.2 };
  if (id.startsWith('ParamWingPhysics')) return { alpha: 0.48, step: 8 };
  if (id.startsWith('ParamCheongsamPhysics')) return { alpha: 0.44, step: 4.8 };
  if (id.startsWith('ParamTonguePhysics') || id.startsWith('ParamDollEarPhysics')) return { alpha: 0.46, step: 6.5 };
  if (id.includes('MouthOpen') || id.includes('JawOpen') || id.includes('VoiceVolume')) return { alpha: 0.66, step: 0.26 };
  if (id === 'ParamEyeLOpen' || id === 'ParamEyeROpen' || id.includes('EyeOpen')) return { alpha: 0.88, step: 0.72 };
  if (isLocalCubismEyeExpressionId(id)) return { alpha: 0.82, step: 0.62 };
  if (id.includes('EyeBall')) return { alpha: 0.36, step: 0.18 };
  if (id.includes('Brow') || id.includes('Cheek')) return { alpha: 0.34, step: 0.12 };
  if (id.includes('Mouth')) return { alpha: 0.34, step: 0.18 };
  if (isLocalCubismBodyDriverId(id)) return { alpha: 0.28, step: 1.55, accel: 0.34 };
  if (id === 'ParamAngleX' || id === 'ParamAngleY' || id === 'ParamAngleZ') return { alpha: 0.34, step: 2.65, accel: 0.62 };
  if (id === 'PositionY') return { alpha: 0.24, step: 0.86, accel: 0.16 };
  if (id === 'PositionX' || id === 'PositionZ') return { alpha: 0.32, step: 1.45, accel: 0.28 };
  if (id.includes('Angle') || id.includes('Position')) return { alpha: 0.3, step: 1.45, accel: 0.28 };
  return { alpha: 0.34, step: 0.12 };
}

function smoothLocalCubismFrame(parameters, now = nowMs()) {
  if (!Array.isArray(parameters)) return [];

  const nextFrameIds = new Set();
  const smoothed = [];
  const deltaMs = lastSmoothedAt ? Math.min(Math.max(now - lastSmoothedAt, 8), 96) : LOCAL_CUBISM_FRAME_FLUSH_MS;
  const frameScale = Math.min(Math.max(deltaMs / LOCAL_CUBISM_FRAME_FLUSH_MS, 0.5), 3);
  lastSmoothedAt = now;
  for (const item of parameters) {
    const id = normalizeParameterId(item);
    const value = Number(item?.value);
    if (!id || !Number.isFinite(value) || isLocalCubismSuppressedId(id)) continue;

    const previous = lastSmoothedFrame.get(id);
    const { alpha, step, accel } = localFrameSmoothingProfile(id);
    const blendedValue = previous === undefined ? value : previous + (value - previous) * alpha;
    const maxStep = step * frameScale;
    const previousVelocity = lastVelocityFrame.get(id) || 0;
    const targetStep = previous === undefined
      ? 0
      : Math.min(Math.max(blendedValue - previous, -maxStep), maxStep);
    const maxAccel = Number(accel) > 0 ? Number(accel) * frameScale : 0;
    const nextStep = previous === undefined
      ? 0
      : (maxAccel
        ? Math.min(Math.max(targetStep, previousVelocity - maxAccel), previousVelocity + maxAccel)
        : targetStep);
    const nextValue = previous === undefined ? value : previous + nextStep;
    const weight = Number(item?.weight);
    lastSmoothedFrame.set(id, nextValue);
    lastVelocityFrame.set(id, nextStep);
    nextFrameIds.add(id);
    smoothed.push({
      ...item,
      id,
      value: Math.abs(nextValue) < 0.0005 ? 0 : nextValue,
      weight: Number.isFinite(weight) ? Math.min(Math.max(weight, 0.01), 1) : item?.weight
    });
  }

  for (const id of lastSmoothedFrame.keys()) {
    if (!nextFrameIds.has(id)) {
      lastSmoothedFrame.delete(id);
      lastVelocityFrame.delete(id);
    }
  }
  return smoothed;
}

function queueLocalCubismFrame(parameters) {
  for (const item of Array.isArray(parameters) ? parameters : []) {
    const id = normalizeParameterId(item);
    const value = Number(item?.value);
    if (!id || !Number.isFinite(value) || isLocalCubismSuppressedId(id)) continue;
    const weight = Number.isFinite(Number(item?.weight)) ? Math.min(Math.max(Number(item.weight), 0.01), 1) : 0.75;
    const current = pendingFrame.get(id);
    if (current) {
      current.value += value * weight;
      current.weight += weight;
      current.raw = item;
    } else {
      pendingFrame.set(id, {
        raw: item,
        id,
        value: value * weight,
        weight
      });
    }
  }
}

function takePendingLocalCubismFrame() {
  const frame = [...pendingFrame.values()].map((item) => ({
    ...item.raw,
    id: item.id,
    value: item.value / Math.max(item.weight, 0.01),
    weight: Math.min(Math.max(item.weight, 0.01), 1)
  }));
  pendingFrame.clear();
  return frame;
}

function flushLocalCubismFrame() {
  flushTimer = 0;
  const parameters = takePendingLocalCubismFrame();
  if (!parameters.length) return;

  const bridge = runtimeLocalBridge();
  if (bridge && typeof bridge.setFrame === 'function') {
    try {
      const frameParameters = smoothLocalCubismFrame(parameters);
      bridge.setFrame(frameParameters);
      setLocalBridgeState({
        mounted: true,
        output: 'runtime-direct',
        parameterCount: frameParameters.length,
        bodyTargetCount: frameParameters.filter((item) => /^Param(?:BodyInput|Output|PhysicsRAM|Angle_Body|Angle_Chest|Angle_Hip|Angle_Shoulder)|^PositionZ$|^ParamPosition_Z$/.test(item.id)).length
      });
      return;
    } catch (error) {
      setLocalBridgeState({
        mounted: true,
        output: 'runtime-direct-error',
        error: error?.message || 'Local Cubism bridge write failed'
      });
    }
  }

  dispatchFallbackFrame(parameters);
  setLocalBridgeState({
    mounted: true,
    output: 'runtime-event-fallback',
    parameterCount: Array.isArray(parameters) ? parameters.length : 0
  });
}

function writeLocalCubismFrame(parameters) {
  queueLocalCubismFrame(parameters);
  if (flushTimer) return;
  flushTimer = window.requestAnimationFrame(flushLocalCubismFrame);
}

export function mountLocalCubismBridge() {
  if (typeof window === 'undefined') return () => {};

  window.TSUKUYOMI_LOCAL_CUBISM_BRIDGE_MOUNTED = true;
  setLocalBridgeState({ mounted: true, output: 'starting' });

  const destroyBehaviorBridge = mountCubismBehaviorBridge({
    source: 'local-cubism',
    onFrame: writeLocalCubismFrame
  });

  return () => {
    destroyBehaviorBridge?.();
    if (window.TSUKUYOMI_LOCAL_CUBISM_BRIDGE_MOUNTED) {
      delete window.TSUKUYOMI_LOCAL_CUBISM_BRIDGE_MOUNTED;
    }
    setLocalBridgeState({ mounted: false, output: 'destroyed', parameterCount: 0 });
    if (flushTimer) window.cancelAnimationFrame(flushTimer);
    pendingFrame = new Map();
    flushTimer = 0;
    lastSmoothedFrame = new Map();
    lastVelocityFrame = new Map();
    lastSmoothedAt = 0;
  };
}
