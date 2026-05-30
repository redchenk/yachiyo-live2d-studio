import { normalizeBehaviorBodyPose } from '../../constants/room/behaviorActionRegistry';
import { readRoomModelSettings } from './roomSettings';

const ROOM_ACT_EVENT = 'tsukuyomi:room-act';
const STAGE_ACTUATOR_STATE_KEY = '__TSUKUYOMI_LIVE2D_STAGE_BODY_ACTUATOR_STATE__';
const DEFAULT_STAGE_MOTION_SCALE = 0.86;
const DEFAULT_STAGE_IDLE_SCALE = 1;
const RUNTIME_STAGE_POSE_SCALE = 0.35;
const BODY_PARAMETER_HINTS = [
  'ParamBodyInput_BodyX',
  'ParamBodyInput_BodyY',
  'ParamBodyInput_BodyZ',
  'ParamOutput_BodyX',
  'ParamOutput_BodyY',
  'ParamOutput_BodyZ',
  'ParamPhysicsRAM_BodyX',
  'ParamPhysicsRAM_BodyY',
  'ParamPhysicsRAM_BodyZ',
  'ParamPhysicsRAM_ChestZ',
  'ParamPhysicsRAM_HipZ',
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
  'ParamBodyAngleX',
  'ParamBodyAngleY',
  'ParamBodyAngleZ',
  'PositionZ',
  'ParamPosition_Z'
];

const BODY_POSES = new Set([
  'nod',
  'shake_head',
  'lean_in',
  'lean_left',
  'lean_right',
  'sway',
  'bounce',
  'emphasis'
]);

const PARAMETER_WEIGHTS = {
  x: new Set([
    'parambodyinput_bodyx',
    'paramoutput_bodyx',
    'paramphysicsram_bodyx',
    'paramangle_bodyx',
    'paramangle_bodyx2',
    'paramangle_bodyx3',
    'parambodyanglex'
  ]),
  y: new Set([
    'parambodyinput_bodyy',
    'paramoutput_bodyy',
    'paramphysicsram_bodyy',
    'paramangle_bodyy',
    'paramangle_bodyy2',
    'paramangle_hipup',
    'paramangle_hipdown',
    'parambodyangley',
    'positionz',
    'paramposition_z'
  ]),
  z: new Set([
    'parambodyinput_bodyz',
    'paramoutput_bodyz',
    'paramphysicsram_bodyz',
    'paramphysicsram_chestz',
    'paramphysicsram_hipz',
    'paramangle_bodyz',
    'paramangle_bodyz2',
    'paramangle_chestz',
    'paramangle_hipz',
    'paramangle_shoulderl',
    'paramangle_shoulderr',
    'parambodyanglez',
    'paramanglez'
  ])
};

function clamp(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizePose(value) {
  return normalizeBehaviorBodyPose(value);
}

function normalizeDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 2200;
  return Math.min(Math.max(Math.round(numeric), 650), 8000);
}

function readModelStageSettings() {
  try {
    return readRoomModelSettings();
  } catch (_) {
    return {
      stageFloatEnabled: true,
      stageIdleScale: DEFAULT_STAGE_IDLE_SCALE,
      stageMotionScale: DEFAULT_STAGE_MOTION_SCALE,
      stageVerticalOffset: 0
    };
  }
}

function readStageMotionScale() {
  if (typeof window === 'undefined') return DEFAULT_STAGE_MOTION_SCALE;
  const settings = readModelStageSettings();
  if (Number.isFinite(Number(settings.stageMotionScale))) {
    return clamp(settings.stageMotionScale, 0, 3);
  }
  const globalValue = Number(window.TSUKUYOMI_LIVE2D_STAGE_MOTION_SCALE);
  if (Number.isFinite(globalValue)) return clamp(globalValue, 0, 3);
  try {
    const stored = Number(window.localStorage?.getItem('roomLive2DStageMotionScale'));
    if (Number.isFinite(stored)) return clamp(stored, 0, 3);
  } catch (_) {
    // ignore storage failures in WebView privacy modes
  }
  return DEFAULT_STAGE_MOTION_SCALE;
}

function readStageIdleScale() {
  if (typeof window === 'undefined') return DEFAULT_STAGE_IDLE_SCALE;
  const settings = readModelStageSettings();
  if (Number.isFinite(Number(settings.stageIdleScale))) {
    return clamp(settings.stageIdleScale, 0, 3);
  }
  const globalValue = Number(window.TSUKUYOMI_LIVE2D_STAGE_IDLE_SCALE);
  if (Number.isFinite(globalValue)) return clamp(globalValue, 0, 3);
  try {
    const stored = Number(window.localStorage?.getItem('roomLive2DStageIdleScale'));
    if (Number.isFinite(stored)) return clamp(stored, 0, 3);
  } catch (_) {
    // ignore storage failures in WebView privacy modes
  }
  return DEFAULT_STAGE_IDLE_SCALE;
}

function readStageVerticalOffset() {
  const settings = readModelStageSettings();
  return clamp(settings.stageVerticalOffset, -180, 180, 0);
}

function readStageFloatEnabled() {
  return readModelStageSettings().stageFloatEnabled !== false;
}

function easeInOut(value) {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function envelope(progress) {
  const t = clamp(progress, 0, 1);
  if (t < 0.18) return easeInOut(t / 0.18);
  if (t > 0.84) return easeInOut((1 - t) / 0.16);
  return 1;
}

function pulse(progress, cycles = 1) {
  return Math.sin(clamp(progress, 0, 1) * Math.PI * cycles);
}

function absPulse(progress, cycles = 1) {
  return Math.abs(pulse(progress, cycles));
}

function parameterAxes(parameters) {
  const axes = { x: 0, y: 0, z: 0, max: 0, count: 0 };
  for (const item of Array.isArray(parameters) ? parameters : []) {
    const id = String(item?.id || item?.parameterId || item?.param || '').trim();
    const key = id.toLowerCase();
    const value = Number(item?.value);
    if (!id || !Number.isFinite(value)) continue;
    if (!BODY_PARAMETER_HINTS.some((hint) => hint.toLowerCase() === key)) continue;
    const weighted = value * clamp(item?.weight ?? 0.85, 0.15, 1);
    if (PARAMETER_WEIGHTS.x.has(key)) axes.x += weighted;
    if (PARAMETER_WEIGHTS.y.has(key)) axes.y += weighted;
    if (PARAMETER_WEIGHTS.z.has(key)) axes.z += weighted;
    axes.max = Math.max(axes.max, Math.abs(weighted));
    axes.count += 1;
  }
  return axes;
}

function inferPoseFromParameters(parameters) {
  const axes = parameterAxes(parameters);
  if (axes.count < 2 || axes.max < 3.5) return null;
  const x = axes.x / Math.max(axes.count, 1);
  const y = axes.y / Math.max(axes.count, 1);
  const z = axes.z / Math.max(axes.count, 1);
  const intensity = clamp(axes.max / 22, 0.58, 1);
  if (Math.abs(z) >= Math.abs(x) && Math.abs(z) >= Math.abs(y) && Math.abs(z) > 1.2) {
    return {
      pose: z < 0 ? 'lean_left' : 'lean_right',
      intensity,
      source: 'parameters'
    };
  }
  if (Math.abs(x) >= Math.abs(y) && Math.abs(x) > 1.2) {
    return {
      pose: Math.abs(x) > 4 ? 'sway' : (x < 0 ? 'lean_left' : 'lean_right'),
      intensity,
      source: 'parameters'
    };
  }
  if (Math.abs(y) > 1.2) {
    return {
      pose: y > 0 ? 'bounce' : 'lean_in',
      intensity,
      source: 'parameters'
    };
  }
  return null;
}

export function resolveLive2DStageMotion(detail = {}) {
  const explicitPose = normalizePose(detail.bodyPose || detail.pose || detail.posture || detail.motion || detail.action);
  const inferred = explicitPose ? null : inferPoseFromParameters(detail.parameters || detail.parameterTargets || detail.params);
  const pose = explicitPose || inferred?.pose || '';
  if (!pose) return null;
  const intensity = clamp(Math.max(Number(detail.intensity) || 0, inferred?.intensity || 0.62), 0.5, 1);
  return {
    pose,
    intensity,
    durationMs: normalizeDuration(detail.durationMs || detail.duration),
    source: explicitPose ? 'pose' : inferred.source
  };
}

export function sampleLive2DStagePose(motion, progress, scale = DEFAULT_STAGE_MOTION_SCALE) {
  if (!motion) return { x: 0, y: 0, rotate: 0, scale: 1 };
  const t = clamp(progress, 0, 1);
  const e = envelope(t) * clamp(motion.intensity, 0.5, 1) * clamp(scale, 0, 2.4);
  const fast = Math.sin(t * Math.PI * 4);
  const slow = Math.sin(t * Math.PI * 2);
  const beat = absPulse(t, 2);

  switch (motion.pose) {
    case 'nod':
      return {
        x: 0,
        y: 18 * beat * e,
        rotate: -0.9 * fast * e,
        scale: 1 + 0.01 * beat * e
      };
    case 'shake_head':
      return {
        x: 22 * fast * e,
        y: 2 * beat * e,
        rotate: 3.6 * fast * e,
        scale: 1
      };
    case 'lean_in':
      return {
        x: 0,
        y: -24 * e,
        rotate: 0.8 * slow * e,
        scale: 1 + 0.045 * e
      };
    case 'lean_left':
      return {
        x: -38 * e,
        y: 7 * e,
        rotate: -4.8 * e,
        scale: 1 + 0.012 * e
      };
    case 'lean_right':
      return {
        x: 38 * e,
        y: 7 * e,
        rotate: 4.8 * e,
        scale: 1 + 0.012 * e
      };
    case 'sway':
      return {
        x: 34 * slow * e,
        y: 5 * absPulse(t, 2) * e,
        rotate: 4.2 * slow * e,
        scale: 1 + 0.006 * Math.abs(slow) * e
      };
    case 'bounce':
      return {
        x: 3 * slow * e,
        y: -34 * beat * e,
        rotate: 1.2 * slow * e,
        scale: 1 + 0.026 * beat * e
      };
    case 'emphasis':
      return {
        x: 18 * fast * e,
        y: -18 * absPulse(t, 1) * e,
        rotate: -4.2 * fast * e,
        scale: 1 + 0.032 * absPulse(t, 1) * e
      };
    default:
      return { x: 0, y: 0, rotate: 0, scale: 1 };
  }
}

export function sampleLive2DIdleStagePose(nowMs = performance.now(), scale = DEFAULT_STAGE_IDLE_SCALE) {
  const amount = clamp(scale, 0, 2.4);
  if (amount <= 0) return { x: 0, y: 0, rotate: 0, scale: 1 };
  const seconds = nowMs / 1000;
  const slow = Math.sin(seconds * 1.04);
  const drift = Math.sin(seconds * 0.47 + 1.35);
  const side = Math.sin(seconds * 0.36 + 0.8);
  return {
    x: 5.5 * side * amount,
    y: (22 * slow + 8 * drift) * amount,
    rotate: 0.42 * Math.sin(seconds * 0.43 + 2.1) * amount,
    scale: 1 + 0.006 * Math.sin(seconds * 0.72 + 0.4) * amount
  };
}

function combineCanvasPoses(base, overlay) {
  return {
    x: (base?.x || 0) + (overlay?.x || 0),
    y: (base?.y || 0) + (overlay?.y || 0),
    rotate: (base?.rotate || 0) + (overlay?.rotate || 0),
    scale: (base?.scale || 1) * (overlay?.scale || 1)
  };
}

function setStageActuatorState(patch) {
  if (typeof window === 'undefined') return;
  window[STAGE_ACTUATOR_STATE_KEY] = {
    ...(window[STAGE_ACTUATOR_STATE_KEY] || {}),
    ...patch,
    updatedAt: Date.now()
  };
}

function findLive2DContainer(containerSelector) {
  const container = typeof containerSelector === 'string'
    ? document.querySelector(containerSelector)
    : containerSelector;
  return container || null;
}

function findLive2DCanvas(containerSelector) {
  const container = findLive2DContainer(containerSelector);
  return container?.querySelector?.('canvas') || null;
}

function applyRuntimeStagePose(pose, strength = RUNTIME_STAGE_POSE_SCALE) {
  if (typeof window === 'undefined' || typeof window.setLive2DModelSettings !== 'function') return false;
  const amount = clamp(strength, 0, 1, RUNTIME_STAGE_POSE_SCALE);
  window.setLive2DModelSettings(
    clamp(1 + ((pose.scale || 1) - 1) * amount, 0.92, 1.08, 1),
    clamp((pose.x || 0) * amount, -90, 90, 0),
    clamp((pose.y || 0) * amount, -90, 90, 0)
  );
  return true;
}

function applyModelContainerPose(container, pose) {
  if (!container) return false;
  container.style.transformOrigin = '50% 84%';
  container.style.willChange = 'transform';
  container.style.transform = [
    `translate(calc(-50% + ${pose.x.toFixed(2)}px), ${pose.y.toFixed(2)}px)`,
    `rotate(${pose.rotate.toFixed(3)}deg)`,
    `scale(${pose.scale.toFixed(4)})`
  ].join(' ');
  setStageActuatorState({
    mounted: true,
    output: 'model-container-transform',
    pose: {
      x: Number(pose.x.toFixed(2)),
      y: Number(pose.y.toFixed(2)),
      rotate: Number(pose.rotate.toFixed(3)),
      scale: Number(pose.scale.toFixed(4))
    }
  });
  return true;
}

function applyCanvasPose(canvas, pose) {
  if (!canvas) return;
  canvas.style.transformOrigin = '50% 72%';
  canvas.style.willChange = 'transform';
  canvas.style.transform = `translate3d(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px, 0) rotate(${pose.rotate.toFixed(3)}deg) scale(${pose.scale.toFixed(4)})`;
  setStageActuatorState({
    mounted: true,
    output: 'canvas-transform-fallback',
    pose: {
      x: Number(pose.x.toFixed(2)),
      y: Number(pose.y.toFixed(2)),
      rotate: Number(pose.rotate.toFixed(3)),
      scale: Number(pose.scale.toFixed(4))
    }
  });
}

function clearCanvasPose(canvas) {
  if (!canvas) return;
  canvas.style.transform = '';
  canvas.style.willChange = '';
}

function clearContainerPose(container) {
  if (!container) return;
  container.style.transform = '';
  container.style.willChange = '';
}

function clearRuntimeStagePose() {
  if (typeof window !== 'undefined' && typeof window.setLive2DModelSettings === 'function') {
    window.setLive2DModelSettings(1, 0, 0);
  }
}

function applyStagePose(container, canvas, pose) {
  const runtimeApplied = applyRuntimeStagePose(pose);
  if (applyModelContainerPose(container, pose)) {
    clearCanvasPose(canvas);
    setStageActuatorState({
      output: runtimeApplied ? 'model-container-transform+runtime-view-matrix' : 'model-container-transform'
    });
    return;
  }
  applyCanvasPose(canvas, pose);
}

export function mountLive2DStageBodyActuator(containerSelector = '#live2d-container') {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let activeMotion = null;
  let startMs = 0;
  let frameId = 0;
  let lastCanvas = null;
  let lastContainer = null;

  function stopFrame() {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
  }

  function render(now = performance.now()) {
    const container = findLive2DContainer(containerSelector);
    const canvas = findLive2DCanvas(containerSelector);
    lastContainer = container || lastContainer;
    lastCanvas = canvas || lastCanvas;
    const floatEnabled = readStageFloatEnabled();
    let pose = floatEnabled
      ? sampleLive2DIdleStagePose(now, readStageIdleScale())
      : { x: 0, y: 0, rotate: 0, scale: 1 };
    if (floatEnabled && activeMotion) {
      const progress = (now - startMs) / activeMotion.durationMs;
      pose = combineCanvasPoses(pose, sampleLive2DStagePose(activeMotion, progress, readStageMotionScale()));
      if (progress >= 1) activeMotion = null;
    }
    pose = {
      ...pose,
      y: pose.y + readStageVerticalOffset()
    };
    applyStagePose(container, canvas, pose);
    frameId = window.requestAnimationFrame(render);
  }

  function startMotion(motion) {
    activeMotion = motion;
    startMs = performance.now();
    stopFrame();
    frameId = window.requestAnimationFrame(render);
  }

  function onRoomAct(event) {
    const motion = resolveLive2DStageMotion(event.detail || {});
    if (motion) startMotion(motion);
  }

  window.addEventListener(ROOM_ACT_EVENT, onRoomAct);
  frameId = window.requestAnimationFrame(render);

  return () => {
    window.removeEventListener(ROOM_ACT_EVENT, onRoomAct);
    activeMotion = null;
    stopFrame();
    clearRuntimeStagePose();
    clearContainerPose(lastContainer || findLive2DContainer(containerSelector));
    clearCanvasPose(lastCanvas || findLive2DCanvas(containerSelector));
    lastContainer = null;
    lastCanvas = null;
    setStageActuatorState({ mounted: false, output: 'destroyed' });
  };
}
