import { mountCubismBehaviorBridge } from './live2dCubismBehaviorBridge';

const FACE_CAPTURE_EVENT = 'tsukuyomi:live2d-face';
const LOCAL_BRIDGE_STATE_KEY = '__TSUKUYOMI_LOCAL_CUBISM_BRIDGE_STATE__';

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
let lastSmoothedAt = 0;

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

function isLocalCubismSuppressedId(id) {
  const value = String(id || '');
  return LOCAL_CUBISM_PHYSICS_MANAGED_IDS.has(value) || isLocalCubismPhysicsOutputId(value);
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
  if (id.includes('MouthOpen') || id.includes('JawOpen') || id.includes('VoiceVolume')) return { alpha: 0.72, step: 0.36 };
  if (id === 'ParamEyeLOpen' || id === 'ParamEyeROpen' || id.includes('EyeOpen')) return { alpha: 0.58, step: 0.72 };
  if (id.includes('EyeBall')) return { alpha: 0.24, step: 0.1 };
  if (id.includes('Brow') || id.includes('Cheek')) return { alpha: 0.2, step: 0.09 };
  if (id.includes('Mouth')) return { alpha: 0.34, step: 0.18 };
  if (isLocalCubismBodyDriverId(id)) return { alpha: 0.16, step: 0.72 };
  if (id === 'ParamAngleX' || id === 'ParamAngleY' || id === 'ParamAngleZ') return { alpha: 0.16, step: 1.05 };
  if (id === 'PositionX' || id === 'PositionY' || id === 'PositionZ' || id === 'ParamPosition_Z') return { alpha: 0.14, step: 0.56 };
  if (id.includes('Angle') || id.includes('Position')) return { alpha: 0.18, step: 0.72 };
  return { alpha: 0.28, step: 0.12 };
}

function smoothLocalCubismFrame(parameters, now = nowMs()) {
  if (!Array.isArray(parameters)) return [];

  const nextFrameIds = new Set();
  const smoothed = [];
  const deltaMs = lastSmoothedAt ? Math.min(Math.max(now - lastSmoothedAt, 8), 80) : 16.67;
  const frameScale = Math.min(Math.max(deltaMs / 16.67, 0.5), 3);
  lastSmoothedAt = now;
  for (const item of parameters) {
    const id = normalizeParameterId(item);
    const value = Number(item?.value);
    if (!id || !Number.isFinite(value) || isLocalCubismSuppressedId(id)) continue;

    const previous = lastSmoothedFrame.get(id);
    const { alpha, step } = localFrameSmoothingProfile(id);
    const blendedValue = previous === undefined ? value : previous + (value - previous) * alpha;
    const maxStep = step * frameScale;
    const nextValue = previous === undefined
      ? value
      : Math.min(Math.max(blendedValue, previous - maxStep), previous + maxStep);
    const weight = Number(item?.weight);
    lastSmoothedFrame.set(id, nextValue);
    nextFrameIds.add(id);
    smoothed.push({
      ...item,
      id,
      value: Math.abs(nextValue) < 0.0005 ? 0 : nextValue,
      weight: Number.isFinite(weight) ? Math.min(Math.max(weight, 0.01), 0.92) : item?.weight
    });
  }

  for (const id of lastSmoothedFrame.keys()) {
    if (!nextFrameIds.has(id)) lastSmoothedFrame.delete(id);
  }
  return smoothed;
}

function writeLocalCubismFrame(parameters) {
  const bridge = runtimeLocalBridge();
  if (bridge && typeof bridge.setFrame === 'function') {
    try {
      const frameParameters = smoothLocalCubismFrame(parameters);
      bridge.setFrame(frameParameters);
      setLocalBridgeState({
        mounted: true,
        output: 'runtime-direct',
        parameterCount: frameParameters.length,
        bodyTargetCount: 0
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
    lastSmoothedFrame = new Map();
    lastSmoothedAt = 0;
  };
}
