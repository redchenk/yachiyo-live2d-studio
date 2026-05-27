const ROOM_ACT_EVENT = 'tsukuyomi:room-act';
const DEFAULT_STAGE_MOTION_SCALE = 0;
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

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(numeric, min), max);
}

function normalizePose(value) {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!key || key === 'none' || key === 'null') return '';
  if (key === 'tap_body' || key === 'body_tap' || key === 'tapbody') return 'emphasis';
  return BODY_POSES.has(key) ? key : '';
}

function normalizeDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 2200;
  return Math.min(Math.max(Math.round(numeric), 650), 8000);
}

function readStageMotionScale() {
  if (typeof window === 'undefined') return DEFAULT_STAGE_MOTION_SCALE;
  const globalValue = Number(window.TSUKUYOMI_LIVE2D_STAGE_MOTION_SCALE);
  if (Number.isFinite(globalValue)) return clamp(globalValue, 0, 2.4);
  try {
    const stored = Number(window.localStorage?.getItem('roomLive2DStageMotionScale'));
    if (Number.isFinite(stored)) return clamp(stored, 0, 2.4);
  } catch (_) {
    // ignore storage failures in WebView privacy modes
  }
  return DEFAULT_STAGE_MOTION_SCALE;
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

function findLive2DCanvas(containerSelector) {
  const container = typeof containerSelector === 'string'
    ? document.querySelector(containerSelector)
    : containerSelector;
  return container?.querySelector?.('canvas') || null;
}

function applyCanvasPose(canvas, pose) {
  if (!canvas) return;
  canvas.style.transformOrigin = '50% 72%';
  canvas.style.willChange = 'transform';
  canvas.style.transform = `translate3d(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px, 0) rotate(${pose.rotate.toFixed(3)}deg) scale(${pose.scale.toFixed(4)})`;
}

function clearCanvasPose(canvas) {
  if (!canvas) return;
  canvas.style.transform = '';
  canvas.style.willChange = '';
}

export function mountLive2DStageBodyActuator(containerSelector = '#live2d-container') {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let activeMotion = null;
  let startMs = 0;
  let frameId = 0;
  let lastCanvas = null;

  function stopFrame() {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
  }

  function render(now = performance.now()) {
    if (!activeMotion) {
      stopFrame();
      clearCanvasPose(lastCanvas);
      return;
    }
    const progress = (now - startMs) / activeMotion.durationMs;
    const canvas = findLive2DCanvas(containerSelector);
    lastCanvas = canvas || lastCanvas;
    if (canvas) {
      applyCanvasPose(canvas, sampleLive2DStagePose(activeMotion, progress, readStageMotionScale()));
    }
    if (progress >= 1) {
      activeMotion = null;
      clearCanvasPose(canvas || lastCanvas);
      stopFrame();
      return;
    }
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

  return () => {
    window.removeEventListener(ROOM_ACT_EVENT, onRoomAct);
    activeMotion = null;
    stopFrame();
    clearCanvasPose(lastCanvas || findLive2DCanvas(containerSelector));
    lastCanvas = null;
  };
}
