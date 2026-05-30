import { mountCubismBehaviorBridge } from './live2dCubismBehaviorBridge';

const FACE_CAPTURE_EVENT = 'tsukuyomi:live2d-face';
const LOCAL_BRIDGE_STATE_KEY = '__TSUKUYOMI_LOCAL_CUBISM_BRIDGE_STATE__';
const BODY_TARGET_WRITE_INTERVAL_MS = 115;
const BODY_TARGET_DURATION_MS = 360;

const LOCAL_CUBISM_BODY_TARGET_IDS = new Set([
  'ParamSwitchCtrl_BodyX',
  'ParamSwitchCtrl_BodyY',
  'ParamSwitchCtrl_BodyZ',
  'ParamSwitchCtrl_ChestZ',
  'ParamSwitchCtrl_HipZ',
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

let lastBodyTargetWriteAt = 0;
let lastSmoothedFrame = new Map();

function isLocalCubismBodyTargetId(id) {
  const value = String(id || '');
  return (
    LOCAL_CUBISM_BODY_TARGET_IDS.has(value) ||
    value.startsWith('ParamHair') ||
    value.startsWith('ParamEar') ||
    value.startsWith('ParamWing') ||
    value.startsWith('ParamHat') ||
    value.startsWith('ParamCheongsam')
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

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function normalizeParameterId(item) {
  return String(item?.id || item?.parameterId || item?.param || item?.key || item?.name || '').trim();
}

function localCubismBodyTargets(parameters) {
  if (!Array.isArray(parameters)) return [];
  const targets = [];
  for (const item of parameters) {
    const id = normalizeParameterId(item);
    const value = Number(item?.value);
    if (!isLocalCubismBodyTargetId(id) || !Number.isFinite(value)) continue;
    const weight = Number(item?.weight);
    targets.push({
      id,
      value,
      weight: Number.isFinite(weight) ? Math.min(Math.max(weight, 0.52), 1) : 0.86,
      durationMs: BODY_TARGET_DURATION_MS
    });
  }
  return targets;
}

function localFrameSmoothingAlpha(id) {
  if (id.includes('MouthOpen') || id.includes('JawOpen') || id.includes('VoiceVolume')) return 0.7;
  if (id.includes('EyeOpen')) return 0.5;
  if (id.includes('EyeBall') || id.includes('Brow') || id.includes('Mouth') || id.includes('Cheek')) return 0.34;
  if (id.includes('Angle') || id.includes('Position')) return 0.24;
  return 0.3;
}

function smoothLocalCubismFrame(parameters) {
  if (!Array.isArray(parameters)) return [];

  const nextFrameIds = new Set();
  const smoothed = [];
  for (const item of parameters) {
    const id = normalizeParameterId(item);
    const value = Number(item?.value);
    if (!id || !Number.isFinite(value) || isLocalCubismBodyTargetId(id)) continue;

    const previous = lastSmoothedFrame.get(id);
    const alpha = localFrameSmoothingAlpha(id);
    const nextValue = previous === undefined ? value : previous + (value - previous) * alpha;
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

function writeBodyTargets(bridge, parameters) {
  if (!bridge || typeof bridge.setParameterTargets !== 'function') return 0;
  const now = nowMs();
  if (now - lastBodyTargetWriteAt < BODY_TARGET_WRITE_INTERVAL_MS) return 0;
  const targets = localCubismBodyTargets(parameters);
  if (!targets.length) return 0;
  bridge.setParameterTargets(targets);
  lastBodyTargetWriteAt = now;
  return targets.length;
}

function writeLocalCubismFrame(parameters) {
  const bridge = runtimeLocalBridge();
  if (bridge && typeof bridge.setFrame === 'function') {
    try {
      const frameParameters = smoothLocalCubismFrame(parameters);
      bridge.setFrame(frameParameters);
      const bodyTargetCount = writeBodyTargets(bridge, parameters);
      setLocalBridgeState({
        mounted: true,
        output: 'runtime-direct',
        parameterCount: frameParameters.length,
        bodyTargetCount
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
    lastBodyTargetWriteAt = 0;
    lastSmoothedFrame = new Map();
  };
}
