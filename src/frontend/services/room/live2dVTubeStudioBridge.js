import { readRoomVTubeStudioSettings } from './roomSettings';

const ROOM_ACT_EVENT = 'tsukuyomi:room-act';
const FACE_CAPTURE_EVENT = 'tsukuyomi:live2d-face';
const MOUTH_EVENT = 'tsukuyomi:live2d-mouth';
const SETTINGS_EVENT = 'tsukuyomi:studio-settings-saved';
const STATUS_EVENT = 'tsukuyomi:vts-status';
const TOKEN_KEY = 'roomVTubeStudioAuthToken';
const API_NAME = 'VTubeStudioPublicAPI';
const API_VERSION = '1.0';

const VTS_RANGES = {
  FacePositionX: [-15, 15],
  FacePositionY: [-15, 15],
  FacePositionZ: [-10, 10],
  FaceAngleX: [-30, 30],
  FaceAngleY: [-30, 30],
  FaceAngleZ: [-90, 90],
  MouthSmile: [0, 1],
  MouthOpen: [0, 1],
  VoiceVolumePlusMouthOpen: [0, 1],
  VoiceVolume: [0, 1],
  Brows: [0, 1],
  BrowLeftY: [0, 1],
  BrowRightY: [0, 1],
  EyeOpenLeft: [0, 1],
  EyeOpenRight: [0, 1],
  EyeLeftX: [-1, 1],
  EyeLeftY: [-1, 1],
  EyeRightX: [-1, 1],
  EyeRightY: [-1, 1],
  MocopiConnected: [0, 1],
  MocopiAngleX: [-30, 30],
  MocopiAngleY: [-30, 30],
  MocopiAngleZ: [-30, 30],
  MocopiBodyAngleX: [-10, 10],
  MocopiBodyAngleY: [-10, 10],
  MocopiBodyAngleZ: [-10, 10],
  MocopiBodyPositionX: [-1, 1],
  MocopiBodyPositionY: [-1, 1],
  MocopiBodyPositionZ: [-1, 1]
};

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || '').trim() || 'ws://127.0.0.1:8001');
    if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
    return url.toString();
  } catch (_) {
    return 'ws://127.0.0.1:8001/';
  }
}

function tokenStorageKey(settings) {
  return `${TOKEN_KEY}:${normalizeUrl(settings.apiUrl)}`;
}

function toUnit(value) {
  return clamp(0.5 + Number(value || 0) * 0.5, 0, 1);
}

function addWeighted(target, id, value, weight = 1) {
  const range = VTS_RANGES[id] || [-30, 30];
  const nextWeight = clamp(weight, 0.01, 1);
  const nextValue = clamp(value, range[0], range[1]);
  const current = target.get(id);
  if (!current) {
    target.set(id, { id, value: nextValue * nextWeight, weight: nextWeight });
    return;
  }
  current.value += nextValue * nextWeight;
  current.weight += nextWeight;
}

function finalizeWeighted(target) {
  return [...target.values()].map((item) => ({
    id: item.id,
    value: clamp(item.value / Math.max(item.weight, 0.01), ...(VTS_RANGES[item.id] || [-30, 30])),
    weight: clamp(item.weight, 0.01, 1)
  }));
}

function normalizeLive2DParam(item) {
  const id = String(item?.id || item?.parameterId || item?.param || '').trim();
  const value = Number(item?.value);
  const weight = Number(item?.weight ?? 0.75);
  return id && Number.isFinite(value)
    ? { id, key: id.toLowerCase(), value, weight: Number.isFinite(weight) ? weight : 0.75 }
    : null;
}

function mapLive2DParametersToVTS(parameters, options) {
  const merged = new Map();
  for (const raw of Array.isArray(parameters) ? parameters : []) {
    const item = normalizeLive2DParam(raw);
    if (!item) continue;
    const { key, value, weight } = item;

    if (options.face) {
      if (['paramanglex', 'paramangle_headx', 'paramanglemodify_headx'].includes(key)) {
        addWeighted(merged, 'FaceAngleX', value, weight);
      } else if (['paramangley', 'paramangle_heady', 'paramanglemodify_heady'].includes(key)) {
        addWeighted(merged, 'FaceAngleY', value, weight);
      } else if (['paramanglez', 'paramangle_headz', 'paramangle_headz2'].includes(key)) {
        addWeighted(merged, 'FaceAngleZ', value, weight);
      } else if (key === 'parameyeballx') {
        addWeighted(merged, 'EyeLeftX', value, weight);
        addWeighted(merged, 'EyeRightX', value, weight);
      } else if (key === 'parameyebally') {
        addWeighted(merged, 'EyeLeftY', value, weight);
        addWeighted(merged, 'EyeRightY', value, weight);
      } else if (key === 'parameyelopen') {
        addWeighted(merged, 'EyeOpenLeft', value, weight);
      } else if (key === 'parameyeropen') {
        addWeighted(merged, 'EyeOpenRight', value, weight);
      } else if (key === 'parambrowly') {
        addWeighted(merged, 'BrowLeftY', toUnit(value), weight);
      } else if (key === 'parambrowry') {
        addWeighted(merged, 'BrowRightY', toUnit(value), weight);
      } else if (key === 'parammouthform') {
        addWeighted(merged, 'MouthSmile', toUnit(value), weight);
      } else if (key === 'parammouthopeny') {
        addWeighted(merged, 'MouthOpen', value, weight);
      }
    }

    if (options.body) {
      if ([
        'parambodyanglex',
        'paramangle_bodyx',
        'paramangle_bodyx2',
        'paramangle_bodyx3',
        'parambodyinput_bodyx',
        'paramoutput_bodyx',
        'paramphysicsram_bodyx'
      ].includes(key)) {
        addWeighted(merged, 'MocopiConnected', 1, 1);
        addWeighted(merged, 'MocopiBodyAngleX', value * 0.33, weight);
        addWeighted(merged, 'MocopiAngleX', value, weight * 0.55);
      } else if ([
        'parambodyangley',
        'paramangle_bodyy',
        'paramangle_bodyy2',
        'parambodyinput_bodyy',
        'paramoutput_bodyy',
        'paramphysicsram_bodyy',
        'positionz',
        'paramposition_z'
      ].includes(key)) {
        addWeighted(merged, 'MocopiConnected', 1, 1);
        addWeighted(merged, 'MocopiBodyAngleY', value * 0.32, weight);
        addWeighted(merged, 'MocopiAngleY', value, weight * 0.55);
        if (key === 'positionz' || key === 'paramposition_z') {
          addWeighted(merged, 'FacePositionZ', value * 0.18, weight * 0.5);
          addWeighted(merged, 'MocopiBodyPositionZ', value * 0.035, weight * 0.5);
        }
      } else if ([
        'parambodyanglez',
        'paramangle_bodyz',
        'paramangle_bodyz2',
        'parambodyinput_bodyz',
        'paramoutput_bodyz',
        'paramphysicsram_bodyz',
        'paramangle_chestz',
        'paramangle_hipz',
        'paramangle_shoulderl',
        'paramangle_shoulderr',
        'parambodyinput_chestz',
        'parambodyinput_hipz',
        'paramoutput_chestz',
        'paramoutput_hipz',
        'paramphysicsram_chestz',
        'paramphysicsram_hipz'
      ].includes(key)) {
        addWeighted(merged, 'MocopiConnected', 1, 1);
        addWeighted(merged, 'MocopiBodyAngleZ', value * 0.34, weight);
        addWeighted(merged, 'MocopiAngleZ', value, weight * 0.55);
      }
    }
  }
  return finalizeWeighted(merged);
}

function normalizePose(value) {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!key || key === 'none' || key === 'null') return '';
  if (key === 'tap_body' || key === 'body_tap' || key === 'tapbody') return 'emphasis';
  return new Set(['nod', 'shake_head', 'lean_in', 'lean_left', 'lean_right', 'sway', 'bounce', 'emphasis']).has(key)
    ? key
    : '';
}

function ease(value) {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function envelope(progress) {
  const t = clamp(progress, 0, 1);
  if (t < 0.18) return ease(t / 0.18);
  if (t > 0.86) return ease((1 - t) / 0.14);
  return 1;
}

function sampleVTSBodyPose(pose, progress, intensity) {
  const t = clamp(progress, 0, 1);
  const e = envelope(t) * clamp(intensity, 0.45, 1);
  const fast = Math.sin(t * Math.PI * 4);
  const slow = Math.sin(t * Math.PI * 2);
  const beat = Math.abs(Math.sin(t * Math.PI * 2));
  const values = new Map();
  addWeighted(values, 'MocopiConnected', 1, 1);

  switch (pose) {
    case 'nod':
      addWeighted(values, 'FaceAngleY', 8 * beat * e, 0.8);
      addWeighted(values, 'MocopiBodyAngleY', 2.8 * beat * e, 0.6);
      break;
    case 'shake_head':
      addWeighted(values, 'FaceAngleX', 10 * fast * e, 0.82);
      addWeighted(values, 'FaceAngleZ', 5 * fast * e, 0.45);
      addWeighted(values, 'MocopiBodyAngleX', 3.5 * fast * e, 0.58);
      break;
    case 'lean_in':
      addWeighted(values, 'FacePositionZ', 4.2 * e, 0.72);
      addWeighted(values, 'FaceAngleY', -4.5 * e, 0.52);
      addWeighted(values, 'MocopiBodyAngleY', -4.2 * e, 0.68);
      addWeighted(values, 'MocopiBodyPositionZ', 0.32 * e, 0.58);
      break;
    case 'lean_left':
      addWeighted(values, 'FacePositionX', -4.2 * e, 0.64);
      addWeighted(values, 'FaceAngleZ', -8.5 * e, 0.7);
      addWeighted(values, 'MocopiBodyAngleZ', -5.8 * e, 0.78);
      addWeighted(values, 'MocopiBodyPositionX', -0.28 * e, 0.48);
      break;
    case 'lean_right':
      addWeighted(values, 'FacePositionX', 4.2 * e, 0.64);
      addWeighted(values, 'FaceAngleZ', 8.5 * e, 0.7);
      addWeighted(values, 'MocopiBodyAngleZ', 5.8 * e, 0.78);
      addWeighted(values, 'MocopiBodyPositionX', 0.28 * e, 0.48);
      break;
    case 'sway':
      addWeighted(values, 'FacePositionX', 2.8 * slow * e, 0.48);
      addWeighted(values, 'FaceAngleZ', 5.8 * slow * e, 0.58);
      addWeighted(values, 'MocopiBodyAngleZ', 5.2 * slow * e, 0.72);
      addWeighted(values, 'MocopiBodyPositionX', 0.22 * slow * e, 0.42);
      break;
    case 'bounce':
      addWeighted(values, 'FacePositionY', -4.8 * beat * e, 0.56);
      addWeighted(values, 'FacePositionZ', 1.8 * beat * e, 0.38);
      addWeighted(values, 'MocopiBodyAngleY', 4.8 * beat * e, 0.72);
      addWeighted(values, 'MocopiBodyPositionY', 0.28 * beat * e, 0.5);
      break;
    case 'emphasis':
      addWeighted(values, 'FaceAngleZ', -7.2 * fast * e, 0.62);
      addWeighted(values, 'FacePositionY', -3.6 * Math.abs(Math.sin(t * Math.PI)) * e, 0.42);
      addWeighted(values, 'MocopiBodyAngleZ', -6.4 * fast * e, 0.72);
      break;
    default:
      break;
  }
  return finalizeWeighted(values);
}

function actionSideSign(action, fallback = 1) {
  if (action.side === 'left') return -1;
  if (action.side === 'right') return 1;
  return fallback;
}

function actionEnvelope(progress) {
  const t = clamp(progress, 0, 1);
  if (t < 0.28) return ease(t / 0.28);
  if (t > 0.76) return ease((1 - t) / 0.24);
  return 1;
}

function setFrameValue(frame, id, value, weight = 1) {
  const range = VTS_RANGES[id] || [-30, 30];
  frame.set(id, {
    id,
    value: clamp(value, range[0], range[1]),
    weight: clamp(weight, 0.01, 1)
  });
}

function addFrameValue(frame, id, value, weight = 1) {
  const current = frame.get(id);
  setFrameValue(frame, id, (current?.value || 0) + value, Math.max(current?.weight || 0, weight));
}

function setFrameEyes(frame, x = 0, y = 0, weight = 0.8) {
  setFrameValue(frame, 'EyeLeftX', x, weight);
  setFrameValue(frame, 'EyeRightX', x, weight);
  setFrameValue(frame, 'EyeLeftY', y, weight);
  setFrameValue(frame, 'EyeRightY', y, weight);
}

function setFrameBody(frame, pose = {}, weight = 1) {
  const bodyX = Number(pose.x) || 0;
  const bodyY = Number(pose.y) || 0;
  const bodyZ = Number(pose.z) || 0;
  const posX = Number(pose.posX) || 0;
  const posY = Number(pose.posY) || 0;
  const posZ = Number(pose.posZ) || 0;
  const connected = pose.connected === 0 ? 0 : 1;

  setFrameValue(frame, 'MocopiConnected', connected, connected ? 1 : 1);
  setFrameValue(frame, 'MocopiAngleX', bodyX * 2.8, weight * 0.75);
  setFrameValue(frame, 'MocopiAngleY', bodyY * 2.8, weight * 0.75);
  setFrameValue(frame, 'MocopiAngleZ', bodyZ * 2.8, weight * 0.75);
  setFrameValue(frame, 'MocopiBodyAngleX', bodyX, weight);
  setFrameValue(frame, 'MocopiBodyAngleY', bodyY, weight);
  setFrameValue(frame, 'MocopiBodyAngleZ', bodyZ, weight);
  setFrameValue(frame, 'MocopiBodyPositionX', posX, weight * 0.75);
  setFrameValue(frame, 'MocopiBodyPositionY', posY, weight * 0.75);
  setFrameValue(frame, 'MocopiBodyPositionZ', posZ, weight * 0.75);
}

function createDirectTrackingFrame() {
  const frame = new Map();
  setFrameValue(frame, 'FaceAngleX', 0, 1);
  setFrameValue(frame, 'FaceAngleY', 0, 1);
  setFrameValue(frame, 'FaceAngleZ', 0, 1);
  setFrameValue(frame, 'FacePositionX', 0, 0.9);
  setFrameValue(frame, 'FacePositionY', 0, 0.9);
  setFrameValue(frame, 'FacePositionZ', 0, 0.9);
  setFrameValue(frame, 'MouthSmile', 0.58, 0.8);
  setFrameValue(frame, 'Brows', 0.55, 0.55);
  setFrameValue(frame, 'BrowLeftY', 0.55, 0.55);
  setFrameValue(frame, 'BrowRightY', 0.55, 0.55);
  setFrameValue(frame, 'EyeOpenLeft', 0.92, 0.85);
  setFrameValue(frame, 'EyeOpenRight', 0.92, 0.85);
  setFrameEyes(frame, 0, 0, 0.8);
  setFrameBody(frame, {}, 1);
  return frame;
}

function finalizeDirectFrame(frame) {
  return [...frame.values()];
}

function addEyeTracking(values, x = 0, y = 0, weight = 0.8) {
  addWeighted(values, 'EyeLeftX', x, weight);
  addWeighted(values, 'EyeRightX', x, weight);
  addWeighted(values, 'EyeLeftY', y, weight);
  addWeighted(values, 'EyeRightY', y, weight);
}

function addBodyTracking(values, pose = {}, weight = 1) {
  const bodyX = Number(pose.x) || 0;
  const bodyY = Number(pose.y) || 0;
  const bodyZ = Number(pose.z) || 0;
  const posX = Number(pose.posX) || 0;
  const posY = Number(pose.posY) || 0;
  const posZ = Number(pose.posZ) || 0;
  const connected = pose.connected === 0 ? 0 : 1;

  addWeighted(values, 'MocopiConnected', connected, connected ? Math.max(weight, 0.2) : 1);
  addWeighted(values, 'MocopiAngleX', bodyX * 2.8, weight * 0.75);
  addWeighted(values, 'MocopiAngleY', bodyY * 2.8, weight * 0.75);
  addWeighted(values, 'MocopiAngleZ', bodyZ * 2.8, weight * 0.75);
  addWeighted(values, 'MocopiBodyAngleX', bodyX, weight);
  addWeighted(values, 'MocopiBodyAngleY', bodyY, weight);
  addWeighted(values, 'MocopiBodyAngleZ', bodyZ, weight);
  addWeighted(values, 'MocopiBodyPositionX', posX, weight * 0.75);
  addWeighted(values, 'MocopiBodyPositionY', posY, weight * 0.75);
  addWeighted(values, 'MocopiBodyPositionZ', posZ, weight * 0.75);
}

function seedBehaviorTrackingFrame(values) {
  addWeighted(values, 'FaceAngleX', 0, 0.08);
  addWeighted(values, 'FaceAngleY', 0, 0.08);
  addWeighted(values, 'FaceAngleZ', 0, 0.08);
  addWeighted(values, 'FacePositionX', 0, 0.08);
  addWeighted(values, 'FacePositionY', 0, 0.08);
  addWeighted(values, 'FacePositionZ', 0, 0.08);
  addWeighted(values, 'MouthSmile', 0.58, 0.26);
  addWeighted(values, 'Brows', 0.55, 0.2);
  addWeighted(values, 'BrowLeftY', 0.55, 0.2);
  addWeighted(values, 'BrowRightY', 0.55, 0.2);
  addWeighted(values, 'EyeOpenLeft', 0.92, 0.32);
  addWeighted(values, 'EyeOpenRight', 0.92, 0.32);
  addEyeTracking(values, 0, 0, 0.1);
  addBodyTracking(values, {}, 0.08);
}

function behaviorNeutralFrame() {
  return finalizeDirectFrame(createDirectTrackingFrame());
}

function behaviorResetFrame() {
  const frame = createDirectTrackingFrame();
  setFrameValue(frame, 'MouthOpen', 0, 0.72);
  setFrameValue(frame, 'VoiceVolumePlusMouthOpen', 0, 0.58);
  setFrameValue(frame, 'VoiceVolume', 0, 0.38);
  setFrameValue(frame, 'MouthSmile', 0.55, 0.8);
  setFrameValue(frame, 'Brows', 0.52, 0.55);
  setFrameValue(frame, 'BrowLeftY', 0.52, 0.55);
  setFrameValue(frame, 'BrowRightY', 0.52, 0.55);
  setFrameBody(frame, { connected: 0 }, 0.85);
  return finalizeDirectFrame(frame);
}

function addBehaviorActionSample(values, action, progress) {
  const t = clamp(progress, 0, 1);
  const e = actionEnvelope(t) * clamp(action.intensity, 0.05, 1);
  const sign = actionSideSign(action, Math.sin((action.delayMs || 0) * 0.017) >= 0 ? 1 : -1);
  const phase = t * Math.PI * 2;
  const fast = Math.sin(phase * 2);
  const slow = Math.sin(phase);
  const beat = Math.abs(Math.sin(phase * 2));

  switch (action.type) {
    case 'look_at_chat':
      addWeighted(values, 'FaceAngleX', 14 * slow * e, 0.9);
      addWeighted(values, 'FaceAngleY', 3 * Math.sin(phase * 0.7) * e - 1.2 * e, 0.72);
      addWeighted(values, 'FaceAngleZ', 8 * Math.sin(phase * 0.5) * e, 0.62);
      addWeighted(values, 'FacePositionZ', 1.2 * e, 0.34);
      addEyeTracking(values, -0.38 * slow * e, -0.12 * e, 0.88);
      addBodyTracking(values, {
        x: (14 * slow * e) / 8,
        z: (8 * Math.sin(phase * 0.5) * e) / 5
      }, 0.78);
      break;
    case 'smile':
      addWeighted(values, 'MouthSmile', 0.72 + 0.12 * e, 0.72);
      addWeighted(values, 'Brows', 0.56 + 0.08 * e, 0.42);
      addWeighted(values, 'BrowLeftY', 0.56 + 0.08 * e, 0.4);
      addWeighted(values, 'BrowRightY', 0.56 + 0.08 * e, 0.4);
      break;
    case 'smirk':
      addWeighted(values, 'MouthSmile', 0.78 + 0.14 * e, 0.84);
      addWeighted(values, 'FaceAngleZ', 3.8 * sign * e, 0.38);
      addWeighted(values, 'Brows', 0.58 + 0.1 * e, 0.48);
      addWeighted(values, 'BrowLeftY', sign < 0 ? 0.72 : 0.54, 0.5);
      addWeighted(values, 'BrowRightY', sign > 0 ? 0.72 : 0.54, 0.5);
      break;
    case 'blink':
      addWeighted(values, 'EyeOpenLeft', t < 0.45 ? 1 - e : 0.92, 0.94);
      addWeighted(values, 'EyeOpenRight', t < 0.45 ? 1 - e : 0.92, 0.94);
      break;
    case 'wink':
      addWeighted(values, action.side === 'left' ? 'EyeOpenLeft' : 'EyeOpenRight', t < 0.62 ? 1 - e : 0.92, 0.96);
      addWeighted(values, 'MouthSmile', 0.72, 0.44);
      break;
    case 'nod':
      addWeighted(values, 'FaceAngleY', 13 * beat * e - 4 * e, 0.94);
      addWeighted(values, 'FacePositionY', -2.5 * beat * e, 0.62);
      addBodyTracking(values, {
        y: 5.5 * beat * e,
        posY: 0.22 * beat * e
      }, 0.88);
      break;
    case 'shake_head':
      addWeighted(values, 'FaceAngleX', 15 * fast * e, 0.94);
      addWeighted(values, 'FaceAngleZ', 6 * fast * e, 0.58);
      addEyeTracking(values, -0.28 * fast * e, 0, 0.58);
      addBodyTracking(values, {
        x: 4.8 * fast * e,
        z: 1.8 * fast * e
      }, 0.78);
      break;
    case 'head_tilt':
      addWeighted(values, 'FaceAngleX', 4.2 * sign * e, 0.5);
      addWeighted(values, 'FaceAngleZ', 17 * sign * e, 0.95);
      addWeighted(values, 'FacePositionX', 3.6 * sign * e, 0.58);
      addEyeTracking(values, -0.18 * sign * e, 0, 0.56);
      addBodyTracking(values, {
        z: 8 * sign * e,
        posX: 0.28 * sign * e
      }, 0.84);
      break;
    case 'lean_in':
      addWeighted(values, 'FacePositionZ', 5.4 * e, 0.84);
      addWeighted(values, 'FacePositionY', -2.8 * e, 0.52);
      addWeighted(values, 'FaceAngleY', -5.2 * e, 0.66);
      addEyeTracking(values, 0, -0.16 * e, 0.62);
      addBodyTracking(values, {
        y: -6.2 * e,
        posZ: 0.42 * e
      }, 0.9);
      break;
    case 'lean_left':
    case 'lean_right': {
      const leanSign = action.type === 'lean_left' ? -1 : 1;
      addWeighted(values, 'FaceAngleX', 5 * leanSign * e, 0.62);
      addWeighted(values, 'FaceAngleZ', 16 * leanSign * e, 0.92);
      addWeighted(values, 'FacePositionX', 5.5 * leanSign * e, 0.82);
      addEyeTracking(values, -0.35 * leanSign * e, 0, 0.72);
      addBodyTracking(values, {
        z: 8 * leanSign * e,
        posX: 0.38 * leanSign * e
      }, 0.94);
      break;
    }
    case 'sway':
      addWeighted(values, 'FaceAngleX', 5.5 * slow * e, 0.64);
      addWeighted(values, 'FaceAngleZ', 9 * slow * e, 0.76);
      addWeighted(values, 'FacePositionX', 3.2 * slow * e, 0.58);
      addWeighted(values, 'MouthSmile', 0.66, 0.32);
      addEyeTracking(values, -0.18 * slow * e, 0, 0.58);
      addBodyTracking(values, {
        x: 3.2 * slow * e,
        z: 6.8 * slow * e,
        posX: 0.25 * slow * e
      }, 0.86);
      break;
    case 'bounce':
      addWeighted(values, 'FaceAngleY', 4 * beat * e, 0.56);
      addWeighted(values, 'FacePositionY', -6.5 * beat * e, 0.82);
      addWeighted(values, 'FacePositionZ', 3.2 * beat * e, 0.62);
      addWeighted(values, 'MouthSmile', 0.78, 0.46);
      addWeighted(values, 'Brows', 0.62, 0.34);
      addBodyTracking(values, {
        y: 8.2 * beat * e,
        posY: 0.36 * beat * e,
        posZ: 0.26 * beat * e
      }, 0.96);
      break;
    case 'shiver':
      addWeighted(values, 'FaceAngleX', 4.2 * fast * e, 0.72);
      addWeighted(values, 'FaceAngleZ', 3.2 * Math.sin(phase * 3) * e, 0.66);
      addWeighted(values, 'FacePositionX', 1.6 * Math.sin(phase * 4.1) * e, 0.36);
      addBodyTracking(values, {
        x: 1.8 * fast * e,
        z: 3.5 * Math.sin(phase * 3.3) * e
      }, 0.68);
      break;
    case 'surprised':
      addWeighted(values, 'EyeOpenLeft', 1, 0.9);
      addWeighted(values, 'EyeOpenRight', 1, 0.9);
      addWeighted(values, 'MouthSmile', 0.48, 0.32);
      addWeighted(values, 'Brows', 0.76, 0.66);
      addWeighted(values, 'BrowLeftY', 0.78, 0.66);
      addWeighted(values, 'BrowRightY', 0.78, 0.66);
      addWeighted(values, 'FacePositionZ', -1.4 * e, 0.3);
      break;
    case 'emphasis':
      addWeighted(values, 'FaceAngleZ', -10.5 * fast * e, 0.78);
      addWeighted(values, 'FaceAngleY', -3.2 * Math.abs(Math.sin(Math.PI * t)) * e, 0.46);
      addWeighted(values, 'FacePositionY', -4.8 * Math.abs(Math.sin(Math.PI * t)) * e, 0.58);
      addBodyTracking(values, {
        y: -4.6 * Math.abs(Math.sin(Math.PI * t)) * e,
        z: -8.2 * fast * e
      }, 0.9);
      break;
    case 'breathe':
      addBodyTracking(values, {
        y: 1.8 * Math.sin(phase) * e,
        posY: 0.07 * Math.sin(phase) * e
      }, 0.34);
      break;
    case 'reset':
      behaviorResetFrame().forEach((item) => addWeighted(values, item.id, item.value, item.weight));
      break;
    default:
      break;
  }
}

const DIRECT_MOTION_PRIORITY = {
  emphasis: 9,
  bounce: 8.4,
  lean_in: 8,
  lean_left: 7.8,
  lean_right: 7.8,
  head_tilt: 7.6,
  nod: 7,
  shake_head: 7,
  shiver: 5.8,
  sway: 5.4,
  look_at_chat: 4,
  breathe: 1
};

function activeBehaviorSamples(actions, elapsedMs) {
  return (Array.isArray(actions) ? actions : []).map((action) => {
    const started = Number(action.delayMs) || 0;
    const duration = Math.max(Number(action.durationMs) || 1000, 1);
    const progress = (elapsedMs - started) / duration;
    if (progress < 0 || progress > 1) return null;
    const envelopeValue = actionEnvelope(progress);
    const intensity = clamp(Number(action.intensity) || 0.72, 0.05, 1);
    return {
      action,
      progress,
      phase: progress * Math.PI * 2,
      envelope: envelopeValue,
      intensity,
      energy: envelopeValue * intensity,
      sign: actionSideSign(action, Math.sin((action.delayMs || 0) * 0.017) >= 0 ? 1 : -1)
    };
  }).filter(Boolean);
}

function pickDominantMotion(samples) {
  return samples
    .filter((sample) => DIRECT_MOTION_PRIORITY[sample.action.type])
    .sort((left, right) => (
      (DIRECT_MOTION_PRIORITY[right.action.type] * right.energy) -
      (DIRECT_MOTION_PRIORITY[left.action.type] * left.energy)
    ))[0] || null;
}

function applyDirectMotion(frame, sample) {
  if (!sample) return;
  const { action, progress: t, phase, energy: e, sign } = sample;
  const fast = Math.sin(phase * 2);
  const slow = Math.sin(phase);
  const beat = Math.abs(Math.sin(phase * 2));

  switch (action.type) {
    case 'look_at_chat': {
      const x = 14 * slow * e;
      const z = 8 * Math.sin(phase * 0.5) * e;
      setFrameValue(frame, 'FaceAngleX', x, 1);
      setFrameValue(frame, 'FaceAngleY', 3 * Math.sin(phase * 0.7) * e, 1);
      setFrameValue(frame, 'FaceAngleZ', z, 1);
      setFrameEyes(frame, -x / 30, -0.12 * e, 0.8);
      setFrameBody(frame, { x: x / 8, z: z / 5 }, 1);
      break;
    }
    case 'nod':
      setFrameValue(frame, 'FaceAngleY', (13 * beat - 4) * e, 1);
      setFrameValue(frame, 'FacePositionY', -2.5 * beat * e, 0.9);
      setFrameBody(frame, { y: 5.5 * beat * e, posY: 0.22 * beat * e }, 1);
      break;
    case 'shake_head':
      setFrameValue(frame, 'FaceAngleX', 15 * fast * e, 1);
      setFrameValue(frame, 'FaceAngleZ', 6 * fast * e, 0.74);
      setFrameEyes(frame, -0.28 * fast * e, 0, 0.72);
      setFrameBody(frame, { x: 4.8 * fast * e, z: 1.8 * fast * e }, 1);
      break;
    case 'head_tilt':
      setFrameValue(frame, 'FaceAngleX', 5 * sign * e, 0.72);
      setFrameValue(frame, 'FaceAngleZ', 16 * sign * e, 1);
      setFrameValue(frame, 'FacePositionX', 4.2 * sign * e, 0.86);
      setFrameEyes(frame, -0.18 * sign * e, 0, 0.7);
      setFrameBody(frame, { z: 8 * sign * e, posX: 0.32 * sign * e }, 1);
      break;
    case 'lean_in':
      setFrameValue(frame, 'FaceAngleY', -5.2 * e, 0.78);
      setFrameValue(frame, 'FacePositionY', -2.8 * e, 0.72);
      setFrameValue(frame, 'FacePositionZ', 5.4 * e, 0.9);
      setFrameEyes(frame, 0, -0.16 * e, 0.72);
      setFrameBody(frame, { y: -6.2 * e, posZ: 0.42 * e }, 1);
      break;
    case 'lean_left':
    case 'lean_right': {
      const leanSign = action.type === 'lean_left' ? -1 : 1;
      setFrameValue(frame, 'FaceAngleX', 5 * leanSign * e, 0.72);
      setFrameValue(frame, 'FaceAngleZ', 16 * leanSign * e, 1);
      setFrameValue(frame, 'FacePositionX', 5.5 * leanSign * e, 0.9);
      setFrameEyes(frame, -0.35 * leanSign * e, 0, 0.8);
      setFrameBody(frame, { z: 8 * leanSign * e, posX: 0.38 * leanSign * e }, 1);
      break;
    }
    case 'sway': {
      const side = slow * e;
      setFrameValue(frame, 'FaceAngleX', 5.5 * side, 0.82);
      setFrameValue(frame, 'FaceAngleZ', 9 * side, 0.9);
      setFrameValue(frame, 'FacePositionX', 3.2 * side, 0.82);
      setFrameEyes(frame, -0.18 * side, 0, 0.76);
      setFrameBody(frame, { x: 3.2 * side, z: 6.8 * side, posX: 0.25 * side }, 1);
      break;
    }
    case 'bounce':
      setFrameValue(frame, 'FaceAngleY', 4 * beat * e, 0.72);
      setFrameValue(frame, 'FacePositionY', -6.5 * beat * e, 0.95);
      setFrameValue(frame, 'FacePositionZ', 3.2 * beat * e, 0.88);
      setFrameValue(frame, 'MouthSmile', 0.78, 0.8);
      setFrameValue(frame, 'Brows', 0.62, 0.55);
      setFrameValue(frame, 'BrowLeftY', 0.62, 0.55);
      setFrameValue(frame, 'BrowRightY', 0.62, 0.55);
      setFrameBody(frame, { y: 8.2 * beat * e, posY: 0.36 * beat * e, posZ: 0.26 * beat * e }, 1);
      break;
    case 'shiver': {
      const jitter = Math.sin(phase * 6) * e;
      setFrameValue(frame, 'FaceAngleX', 4.2 * jitter, 0.86);
      setFrameValue(frame, 'FaceAngleZ', 3.2 * Math.sin(phase * 7) * e, 0.78);
      setFrameValue(frame, 'FacePositionX', 1.6 * Math.sin(phase * 8.2) * e, 0.58);
      setFrameBody(frame, { x: 1.8 * jitter, z: 3.5 * Math.sin(phase * 6.6) * e }, 0.82);
      break;
    }
    case 'emphasis': {
      const hit = Math.abs(Math.sin(Math.PI * t)) * e;
      setFrameValue(frame, 'FaceAngleY', -3.2 * hit, 0.72);
      setFrameValue(frame, 'FaceAngleZ', -10.5 * fast * e, 0.92);
      setFrameValue(frame, 'FacePositionY', -4.8 * hit, 0.86);
      setFrameBody(frame, { y: -4.6 * hit, z: -8.2 * fast * e }, 1);
      break;
    }
    case 'breathe':
      setFrameBody(frame, { y: 1.8 * Math.sin(phase) * e, posY: 0.07 * Math.sin(phase) * e }, 0.45);
      break;
    default:
      break;
  }
}

function applyDirectOverlay(frame, sample, dominant) {
  const { action, progress: t, phase, energy: e, sign } = sample;
  const isDominant = dominant?.action === action;

  switch (action.type) {
    case 'look_at_chat':
      if (!isDominant) {
        const glance = Math.sin(phase) * e;
        addFrameValue(frame, 'FaceAngleX', 2.4 * glance, 0.72);
        setFrameEyes(frame, -0.22 * glance, -0.1 * e, 0.82);
      }
      break;
    case 'smile':
      setFrameValue(frame, 'MouthSmile', 0.74 + 0.16 * e, 0.84);
      setFrameValue(frame, 'Brows', 0.56 + 0.08 * e, 0.58);
      setFrameValue(frame, 'BrowLeftY', 0.56 + 0.08 * e, 0.58);
      setFrameValue(frame, 'BrowRightY', 0.56 + 0.08 * e, 0.58);
      break;
    case 'smirk':
      setFrameValue(frame, 'MouthSmile', 0.8 + 0.12 * e, 0.9);
      addFrameValue(frame, 'FaceAngleZ', 3.8 * sign * e, 0.78);
      setFrameValue(frame, 'Brows', 0.6 + 0.08 * e, 0.66);
      setFrameValue(frame, 'BrowLeftY', sign < 0 ? 0.72 : 0.54, 0.66);
      setFrameValue(frame, 'BrowRightY', sign > 0 ? 0.72 : 0.54, 0.66);
      break;
    case 'blink': {
      const close = Math.sin(Math.PI * t) * e;
      const open = clamp(0.92 - close, 0.04, 1);
      setFrameValue(frame, 'EyeOpenLeft', open, 0.96);
      setFrameValue(frame, 'EyeOpenRight', open, 0.96);
      break;
    }
    case 'wink': {
      const close = Math.sin(Math.PI * t) * e;
      const open = clamp(0.92 - close, 0.04, 1);
      setFrameValue(frame, action.side === 'left' ? 'EyeOpenLeft' : 'EyeOpenRight', open, 0.98);
      setFrameValue(frame, 'MouthSmile', 0.76, 0.62);
      break;
    }
    case 'surprised':
      setFrameValue(frame, 'EyeOpenLeft', 1, 0.98);
      setFrameValue(frame, 'EyeOpenRight', 1, 0.98);
      setFrameValue(frame, 'MouthSmile', 0.48, 0.54);
      setFrameValue(frame, 'Brows', 0.78, 0.78);
      setFrameValue(frame, 'BrowLeftY', 0.78, 0.78);
      setFrameValue(frame, 'BrowRightY', 0.78, 0.78);
      addFrameValue(frame, 'FacePositionZ', -1.4 * e, 0.48);
      break;
    default:
      break;
  }
}

function sampleVTSBehaviorActions(actions, elapsedMs) {
  const samples = activeBehaviorSamples(actions, elapsedMs);
  if (samples.some((sample) => sample.action.type === 'reset' && sample.energy > 0.5)) return behaviorResetFrame();

  const frame = createDirectTrackingFrame();
  const dominant = pickDominantMotion(samples);
  applyDirectMotion(frame, dominant);
  samples.forEach((sample) => applyDirectOverlay(frame, sample, dominant));
  return finalizeDirectFrame(frame);
}

export function mountVTubeStudioBridge() {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return () => {};

  let settings = readRoomVTubeStudioSettings();
  let socket = null;
  let connectPromise = null;
  let authenticated = false;
  let requestCounter = 0;
  let bodyFrameId = 0;
  let bodyMotion = null;
  let behaviorFrameId = 0;
  let behaviorPlan = null;
  const pendingRequests = new Map();
  const pendingInjection = new Map();
  let flushTimer = 0;

  function setStatus(status, error = '') {
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, {
      detail: { status, error, enabled: Boolean(settings.enabled), apiUrl: normalizeUrl(settings.apiUrl) }
    }));
  }

  function makeRequest(messageType, data) {
    requestCounter += 1;
    return {
      apiName: API_NAME,
      apiVersion: API_VERSION,
      requestID: `yachiyo-${Date.now().toString(36)}-${requestCounter}`,
      messageType,
      ...(data ? { data } : {})
    };
  }

  function sendPayload(messageType, data, waitForResponse = false) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('VTube Studio is not connected.'));
    }
    const payload = makeRequest(messageType, data);
    const responsePromise = waitForResponse
      ? new Promise((resolve, reject) => {
          pendingRequests.set(payload.requestID, { resolve, reject });
          window.setTimeout(() => {
            const pending = pendingRequests.get(payload.requestID);
            if (!pending) return;
            pendingRequests.delete(payload.requestID);
            reject(new Error(`${messageType} timed out.`));
          }, 12000);
        })
      : Promise.resolve(null);
    socket.send(JSON.stringify(payload));
    return responsePromise;
  }

  async function request(messageType, data) {
    return sendPayload(messageType, data, true);
  }

  async function authenticate() {
    const state = await request('APIStateRequest');
    if (state?.data?.currentSessionAuthenticated) {
      authenticated = true;
      return;
    }

    const key = tokenStorageKey(settings);
    let token = window.localStorage.getItem(key) || '';
    if (token) {
      const auth = await request('AuthenticationRequest', {
        pluginName: settings.pluginName,
        pluginDeveloper: settings.pluginDeveloper,
        authenticationToken: token
      }).catch(() => null);
      if (auth?.data?.authenticated) {
        authenticated = true;
        return;
      }
      window.localStorage.removeItem(key);
    }

    const tokenResponse = await request('AuthenticationTokenRequest', {
      pluginName: settings.pluginName,
      pluginDeveloper: settings.pluginDeveloper
    });
    token = String(tokenResponse?.data?.authenticationToken || '');
    if (!token) throw new Error('VTube Studio did not return an authentication token.');
    window.localStorage.setItem(key, token);
    const auth = await request('AuthenticationRequest', {
      pluginName: settings.pluginName,
      pluginDeveloper: settings.pluginDeveloper,
      authenticationToken: token
    });
    if (!auth?.data?.authenticated) throw new Error(auth?.data?.reason || 'VTube Studio authentication failed.');
    authenticated = true;
  }

  function closeSocket() {
    authenticated = false;
    connectPromise = null;
    pendingRequests.forEach((item) => item.reject(new Error('VTube Studio connection closed.')));
    pendingRequests.clear();
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      socket = null;
    }
  }

  async function connect() {
    if (!settings.enabled) throw new Error('VTube Studio output is disabled.');
    if (socket?.readyState === WebSocket.OPEN && authenticated) return socket;
    if (connectPromise) return connectPromise;

    connectPromise = new Promise((resolve, reject) => {
      closeSocket();
      const nextSocket = new WebSocket(normalizeUrl(settings.apiUrl));
      socket = nextSocket;
      nextSocket.onopen = async () => {
        try {
          await authenticate();
          setStatus('connected');
          resolve(nextSocket);
        } catch (error) {
          setStatus('error', error.message || 'VTube Studio authentication failed.');
          closeSocket();
          reject(error);
        } finally {
          connectPromise = null;
        }
      };
      nextSocket.onerror = () => {
        setStatus('error', 'Unable to connect to VTube Studio.');
        closeSocket();
        reject(new Error('Unable to connect to VTube Studio.'));
      };
      nextSocket.onclose = () => {
        authenticated = false;
        if (socket === nextSocket) setStatus(settings.enabled ? 'disconnected' : 'disabled');
      };
      nextSocket.onmessage = (event) => {
        const response = JSON.parse(event.data || '{}');
        const pending = pendingRequests.get(response.requestID);
        if (!pending) return;
        pendingRequests.delete(response.requestID);
        if (response.messageType === 'APIError') {
          pending.reject(new Error(response.data?.message || 'VTube Studio API error.'));
        } else {
          pending.resolve(response);
        }
      };
    });

    return connectPromise;
  }

  function queueInjection(values) {
    if (!settings.enabled || !Array.isArray(values) || !values.length) return;
    values.forEach((item) => {
      if (!item?.id || !Number.isFinite(Number(item.value))) return;
      addWeighted(pendingInjection, item.id, Number(item.value), Number(item.weight ?? 1));
    });
    if (flushTimer) return;
    flushTimer = window.setTimeout(flushInjection, 32);
  }

  function flushInjection() {
    flushTimer = 0;
    const values = finalizeWeighted(pendingInjection);
    pendingInjection.clear();
    if (!values.length) return;
    connect()
      .then(() => sendPayload('InjectParameterDataRequest', {
        mode: 'set',
        faceFound: true,
        parameterValues: values
      }))
      .catch((error) => setStatus('error', error.message || 'VTube Studio injection failed.'));
  }

  function stopBodyFrame() {
    if (bodyFrameId) window.cancelAnimationFrame(bodyFrameId);
    bodyFrameId = 0;
  }

  function stopBehaviorFrame() {
    if (behaviorFrameId) window.cancelAnimationFrame(behaviorFrameId);
    behaviorFrameId = 0;
  }

  function tickBody(now = performance.now()) {
    if (!bodyMotion) {
      stopBodyFrame();
      return;
    }
    const progress = (now - bodyMotion.startedAt) / bodyMotion.durationMs;
    queueInjection(sampleVTSBodyPose(bodyMotion.pose, progress, bodyMotion.intensity));
    if (progress >= 1) {
      bodyMotion = null;
      stopBodyFrame();
      return;
    }
    bodyFrameId = window.requestAnimationFrame(tickBody);
  }

  function tickBehavior(now = performance.now()) {
    if (!behaviorPlan) {
      stopBehaviorFrame();
      return;
    }
    const elapsedMs = now - behaviorPlan.startedAt;
    if (elapsedMs >= behaviorPlan.durationMs) {
      behaviorPlan = null;
      queueInjection(behaviorNeutralFrame());
      stopBehaviorFrame();
      return;
    }
    queueInjection(sampleVTSBehaviorActions(behaviorPlan.actions, elapsedMs));
    behaviorFrameId = window.requestAnimationFrame(tickBehavior);
  }

  function startBehaviorPlan(actions, durationMs) {
    if (!Array.isArray(actions) || !actions.length) return;
    bodyMotion = null;
    stopBodyFrame();
    behaviorPlan = {
      actions,
      durationMs: Math.max(
        Number(durationMs) || 0,
        ...actions.map((action) => (Number(action.delayMs) || 0) + (Number(action.durationMs) || 0)),
        800
      ),
      startedAt: performance.now()
    };
    stopBehaviorFrame();
    behaviorFrameId = window.requestAnimationFrame(tickBehavior);
  }

  function onRoomAct(event) {
    const detail = event.detail || {};
    const behaviorActions = Array.isArray(detail.behaviorActions) ? detail.behaviorActions : [];
    if (behaviorActions.length) {
      startBehaviorPlan(behaviorActions, detail.durationMs || detail.duration);
    }
    if (settings.injectFace) {
      const expression = String(detail.expression || detail.emotion || '').toLowerCase();
      if (expression.includes('smile') || expression.includes('happy')) {
        queueInjection([{ id: 'MouthSmile', value: 0.74, weight: 0.35 }, { id: 'Brows', value: 0.58, weight: 0.2 }]);
      } else if (expression.includes('sad') || expression.includes('tears') || expression.includes('cry')) {
        queueInjection([{ id: 'MouthSmile', value: 0.26, weight: 0.35 }, { id: 'Brows', value: 0.32, weight: 0.28 }]);
      }
    }
    if (settings.injectBody && !behaviorActions.length) {
      const mapped = mapLive2DParametersToVTS(detail.parameters || detail.parameterTargets || detail.params, {
        face: false,
        body: true
      });
      queueInjection(mapped);
      const pose = normalizePose(detail.bodyPose || detail.pose || detail.posture || detail.motion || detail.action);
      if (pose) {
        bodyMotion = {
          pose,
          intensity: clamp(Math.max(Number(detail.intensity) || 0, 0.72), 0.45, 1),
          durationMs: clamp(Math.round(Number(detail.durationMs || detail.duration) || 2400), 650, 8000),
          startedAt: performance.now()
        };
        stopBodyFrame();
        bodyFrameId = window.requestAnimationFrame(tickBody);
      }
    }
  }

  function onFaceCapture(event) {
    if (!settings.injectFace && !settings.injectBody) return;
    if (behaviorPlan) return;
    queueInjection(mapLive2DParametersToVTS(event.detail?.parameters, {
      face: settings.injectFace,
      body: settings.injectBody
    }));
  }

  function onMouth(event) {
    if (!settings.injectMouth) return;
    const value = clamp(Number(event.detail?.value), 0, 1);
    queueInjection([
      { id: 'MouthOpen', value, weight: 0.92 },
      { id: 'VoiceVolumePlusMouthOpen', value, weight: 0.72 },
      { id: 'VoiceVolume', value, weight: 0.38 }
    ]);
  }

  function reloadSettings() {
    const next = readRoomVTubeStudioSettings();
    const urlChanged = normalizeUrl(next.apiUrl) !== normalizeUrl(settings.apiUrl);
    const enabledChanged = next.enabled !== settings.enabled;
    settings = next;
    if (!settings.enabled) {
      closeSocket();
      setStatus('disabled');
      return;
    }
    if (urlChanged || enabledChanged) closeSocket();
    connect().catch((error) => setStatus('error', error.message || 'VTube Studio connection failed.'));
  }

  window.addEventListener(ROOM_ACT_EVENT, onRoomAct);
  window.addEventListener(FACE_CAPTURE_EVENT, onFaceCapture);
  window.addEventListener(MOUTH_EVENT, onMouth);
  window.addEventListener(SETTINGS_EVENT, reloadSettings);

  if (settings.enabled) connect().catch((error) => setStatus('error', error.message || 'VTube Studio connection failed.'));
  else setStatus('disabled');

  return () => {
    window.removeEventListener(ROOM_ACT_EVENT, onRoomAct);
    window.removeEventListener(FACE_CAPTURE_EVENT, onFaceCapture);
    window.removeEventListener(MOUTH_EVENT, onMouth);
    window.removeEventListener(SETTINGS_EVENT, reloadSettings);
    window.clearTimeout(flushTimer);
    stopBodyFrame();
    stopBehaviorFrame();
    closeSocket();
  };
}
