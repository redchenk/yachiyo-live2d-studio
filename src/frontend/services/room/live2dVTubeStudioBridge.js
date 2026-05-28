import { readRoomVTubeStudioSettings } from './roomSettings';
import {
  behaviorActionBlocksAutoBlink,
  behaviorActionPriority,
  normalizeBehaviorBodyPose
} from '../../constants/room/behaviorActionRegistry';
import {
  normalizeSemanticExpressionId,
  semanticExpressionFileCandidates,
  semanticExpressionFromEmotion,
  semanticExpressionVTSOverlay
} from '../../constants/room/yachiyoExpressionPresetRegistry';
import {
  YACHIYO_MODEL_PARAMETER_RANGES,
  yachiyoVTubeStudioParameterSettings
} from '../../constants/room/yachiyoModelParameterRegistry';
import { createLive2DCharacterStateMachine } from './live2dCharacterStateMachine';

const ROOM_ACT_EVENT = 'tsukuyomi:room-act';
const FACE_CAPTURE_EVENT = 'tsukuyomi:live2d-face';
const MOUTH_EVENT = 'tsukuyomi:live2d-mouth';
const CHARACTER_STATE_EVENT = 'tsukuyomi:live2d-character-state';
const SETTINGS_EVENT = 'tsukuyomi:studio-settings-saved';
const STATUS_EVENT = 'tsukuyomi:vts-status';
const TOKEN_KEY = 'roomVTubeStudioAuthToken';
const API_NAME = 'VTubeStudioPublicAPI';
const API_VERSION = '1.0';

const VTS_EXPRESSION_ALIASES = {
  happy: ['happy', 'smile'],
  joy: ['happy', 'smile'],
  smile: ['smile', 'happy'],
  bsmile: ['bsmile', 'blush', 'shy', 'smug'],
  blush: ['shy', 'blush', 'bsmile'],
  shy: ['shy', 'blush', 'bsmile'],
  smug: ['smug', 'bsmile'],
  playful: ['smug', 'playful', 'bsmile'],
  surprised: ['surprised', 'surprise'],
  surprise: ['surprised', 'surprise'],
  angry: ['angry', 'annoyed'],
  annoyed: ['angry', 'annoyed'],
  puff: ['puff', 'pout'],
  pout: ['puff', 'pout'],
  tongue: ['tongue', 'tongue_out', 'blep'],
  dizzy: ['dizzy', 'confused'],
  confused: ['dizzy', 'confused'],
  fire: ['fire', 'rage'],
  namida: ['namida', 'sad', 'tear'],
  sad: ['namida', 'sad', 'tear'],
  tears: ['tears', 'cry', 'crying'],
  crying: ['crying', 'tears', 'cry'],
  neutral: ['neutral', 'normal', 'default']
};

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
  MouthX: [-1, 1],
  TongueOut: [0, 1],
  JawOpen: [0, 1],
  MouthPucker: [-1, 1],
  CheekPuff: [0, 1],
  MouthFunnel: [0, 1],
  MouthPressLipOpen: [-1.3, 1.3],
  MouthShrug: [0, 1],
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
  MocopiBodyPositionZ: [-1, 1],
  ...YACHIYO_MODEL_PARAMETER_RANGES
};

const MOTION_INJECTION_IDS = new Set([
  'FaceAngleX',
  'FaceAngleY',
  'FaceAngleZ',
  'FacePositionX',
  'FacePositionY',
  'MocopiConnected',
  'MocopiAngleX',
  'MocopiAngleY',
  'MocopiAngleZ',
  'MocopiBodyAngleX',
  'MocopiBodyAngleY',
  'MocopiBodyAngleZ',
  'MocopiBodyPositionX',
  'MocopiBodyPositionY',
  'MocopiBodyPositionZ'
]);

const EYE_INJECTION_IDS = new Set([
  'EyeOpenLeft',
  'EyeOpenRight',
  'EyeLeftX',
  'EyeLeftY',
  'EyeRightX',
  'EyeRightY'
]);

const EYE_OPEN_INJECTION_IDS = new Set(['EyeOpenLeft', 'EyeOpenRight']);
const EYE_OWNING_EXPRESSION_TOKENS = new Set([
  'angry',
  'annoyed',
  'bsmile',
  'blush',
  'crying',
  'dizzy',
  'fire',
  'happy',
  'namida',
  'sad',
  'shy',
  'smile',
  'smug',
  'surprised',
  'surprise',
  'tears',
  'tongue',
  'tongue_out',
  '眯眯眼',
  '笑咪咪',
  '泪珠',
  '眼泪'
]);

const MOMENTARY_EXPRESSION_TOKENS = new Set(['blep', 'tongue', 'tongue_out']);
const MOMENTARY_EXPRESSION_PARAMETER_IDS = new Set(['TongueOut']);
const MOMENTARY_EXPRESSION_PULSE_MS = 640;

const MOUTH_INJECTION_IDS = new Set([
  'MouthOpen',
  'VoiceVolumePlusMouthOpen',
  'VoiceVolume',
  'MouthX',
  'TongueOut',
  'JawOpen',
  'MouthPucker',
  'CheekPuff',
  'MouthFunnel',
  'MouthPressLipOpen',
  'MouthShrug'
]);

let yachiyoDirectInputsReady = false;

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(numeric, min), max);
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function clampFallback(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return clamp(numeric, min, max);
}

function injectionProfile(id) {
  if (id.startsWith('ParamEarShape')) return { alpha: 0.42, step: 0.16 };
  if (MOUTH_INJECTION_IDS.has(id)) return { alpha: 0.66, step: 0.26 };
  if (id === 'EyeOpenLeft' || id === 'EyeOpenRight') return { alpha: 0.88, step: 0.72 };
  if (id.startsWith('Eye')) return { alpha: 0.34, step: 0.11 };
  if (id.startsWith('FaceAngle')) return { alpha: 0.46, step: 4.2 };
  if (id.startsWith('FacePosition')) return { alpha: 0.42, step: 2.6 };
  if (id.startsWith('MocopiBodyAngle') || id.startsWith('MocopiAngle')) return { alpha: 0.4, step: 2.2 };
  if (id.startsWith('MocopiBodyPosition')) return { alpha: 0.38, step: 0.16 };
  if (id === 'MocopiConnected') return { alpha: 1, step: 1 };
  return { alpha: 0.34, step: 0.12 };
}

function lockInjectionWeight(id, weight) {
  if (MOTION_INJECTION_IDS.has(id) || EYE_INJECTION_IDS.has(id)) return 1;
  return clamp(weight, 0.01, 1);
}

function smoothInjectionValues(values, previous, deltaMs) {
  const frameScale = clamp((Number(deltaMs) || 32) / 32, 0.5, 3);
  return values.map((item) => {
    const range = VTS_RANGES[item.id] || [-30, 30];
    const target = clamp(item.value, range[0], range[1]);
    const last = previous.get(item.id);
    const profile = injectionProfile(item.id);
    const maxStep = profile.step * frameScale;
    const value = Number.isFinite(last)
      ? clamp(lerp(last, target, profile.alpha), last - maxStep, last + maxStep)
      : target;
    previous.set(item.id, value);
    return {
      ...item,
      value: clamp(value, range[0], range[1]),
      weight: lockInjectionWeight(item.id, item.weight)
    };
  });
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

function normalizeExpressionToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.exp3\.json$/i, '')
    .replace(/[\s-]+/g, '_');
}

function expressionCandidates(value) {
  const raw = String(value || '').trim();
  const key = normalizeExpressionToken(raw);
  if (!key) return [];
  const semanticCandidates = semanticExpressionFileCandidates(raw);
  const aliases = VTS_EXPRESSION_ALIASES[key] || [key];
  return [...new Set([raw, key, ...semanticCandidates, ...aliases].map(normalizeExpressionToken).filter(Boolean))];
}

function expressionOwnsEyeOpen(value) {
  return expressionCandidates(value).some((candidate) => EYE_OWNING_EXPRESSION_TOKENS.has(candidate));
}

function expressionIsMomentary(value) {
  return expressionCandidates(value).some((candidate) => MOMENTARY_EXPRESSION_TOKENS.has(candidate));
}

function filterMomentaryExpressionOverlay(overlay, expression, options = {}) {
  if (options.includeMomentary || !expressionIsMomentary(expression)) return overlay;
  return overlay.filter((item) => !MOMENTARY_EXPRESSION_PARAMETER_IDS.has(item.id));
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
      } else if (['parammouthx', 'parammouthx2'].includes(key)) {
        addWeighted(merged, 'MouthX', value, weight);
      } else if (['paramtongueout', 'paramtongueout_bs'].includes(key)) {
        addWeighted(merged, 'TongueOut', value, weight);
      } else if (key === 'paramjawopen') {
        addWeighted(merged, 'JawOpen', value, weight);
      } else if (key === 'parammouthpuckerwiden') {
        addWeighted(merged, 'MouthPucker', value, weight);
      } else if (['paramcheekpuff', 'paramcheekpuff2'].includes(key)) {
        addWeighted(merged, 'CheekPuff', value, weight);
      } else if (key === 'parammouthfunnel') {
        addWeighted(merged, 'MouthFunnel', value, weight);
      } else if (key === 'parammouthpresslipopen') {
        addWeighted(merged, 'MouthPressLipOpen', value, weight);
      } else if (key === 'parammouthshrug') {
        addWeighted(merged, 'MouthShrug', value, weight);
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
  return normalizeBehaviorBodyPose(value);
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
      addWeighted(values, 'FaceAngleY', -4.5 * e, 0.52);
      addWeighted(values, 'MocopiBodyAngleY', -4.2 * e, 0.68);
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

function actionVariant(action) {
  return Math.abs(Math.round(Number(action?.motionVariant) || 0)) % 4;
}

function actionArc(action) {
  return clampFallback(action?.motionArc, -1, 1, 0);
}

function actionSecondarySign(action, fallback = -1) {
  const value = Number(action?.secondarySign);
  if (value < 0) return -1;
  if (value > 0) return 1;
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

function setFrameYachiyoEars(frame, character = {}, strength = 1) {
  if (!yachiyoDirectInputsReady) return;
  const amount = clampFallback(strength, 0, 1, 1);
  const energy = clampFallback(character.energy, 0, 1, 0.34);
  const emotion = String(character.emotion || 'neutral');
  const headX = Number(character.faceX) || 0;
  const headY = Number(character.faceY) || 0;
  const headZ = Number(character.faceZ) || 0;
  const lively = ['happy', 'smile', 'surprised', 'tongue', 'fire'].includes(emotion) ? 1 : 0;
  const droop = ['sad', 'namida', 'tears', 'crying', 'dizzy'].includes(emotion) ? 1 : 0;
  const alert = ['surprised', 'fire'].includes(emotion) ? 1 : 0;
  const base = clamp((0.08 + energy * 0.28 + lively * 0.14 + alert * 0.12 - droop * 0.22) * amount, -0.32, 0.72);
  const lean = clamp((headZ * 0.006 - headX * 0.003) * amount, -0.16, 0.16);
  const lift = clamp((-headY * 0.005 + alert * 0.08 - droop * 0.08) * amount, -0.18, 0.18);

  setFrameValue(frame, 'ParamEarShape_L1', clamp(base + lean, -0.45, 0.82), 0.52);
  setFrameValue(frame, 'ParamEarShape_R1', clamp(base - lean, -0.45, 0.82), 0.52);
  setFrameValue(frame, 'ParamEarShape_L2', clamp(base * 0.68 + lift, -0.45, 0.76), 0.42);
  setFrameValue(frame, 'ParamEarShape_R2', clamp(base * 0.68 + lift, -0.45, 0.76), 0.42);
  setFrameValue(frame, 'ParamEarShape_L3', clamp(base * 0.42 - lift * 0.5 + lean * 0.35, -0.45, 0.72), 0.34);
  setFrameValue(frame, 'ParamEarShape_R3', clamp(base * 0.42 - lift * 0.5 - lean * 0.35, -0.45, 0.72), 0.34);
}

function setFrameBody(frame, pose = {}, weight = 1) {
  const bodyX = Number(pose.x) || 0;
  const bodyY = Number(pose.y) || 0;
  const bodyZ = Number(pose.z) || 0;
  const posX = Number(pose.posX) || 0;
  const posY = Number(pose.posY) || 0;
  const posZ = 0;
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

function createDirectTrackingFrame(options = {}) {
  const frame = new Map();
  setFrameValue(frame, 'FaceAngleX', 0, 1);
  setFrameValue(frame, 'FaceAngleY', 0, 1);
  setFrameValue(frame, 'FaceAngleZ', 0, 1);
  setFrameValue(frame, 'FacePositionX', 0, 0.9);
  setFrameValue(frame, 'FacePositionY', 0, 0.9);
  setFrameValue(frame, 'MouthSmile', 0.58, 0.8);
  setFrameValue(frame, 'Brows', 0.55, 0.55);
  setFrameValue(frame, 'BrowLeftY', 0.55, 0.55);
  setFrameValue(frame, 'BrowRightY', 0.55, 0.55);
  if (!options.suppressEyeOpen) {
    setFrameValue(frame, 'EyeOpenLeft', 0.92, 0.85);
    setFrameValue(frame, 'EyeOpenRight', 0.92, 0.85);
  }
  setFrameEyes(frame, 0, 0, 0.8);
  setFrameYachiyoEars(frame, {}, 1);
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
  const posZ = 0;
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
  setFrameBody(frame, {}, 0.85);
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
      addWeighted(values, 'FacePositionY', -2.8 * e, 0.52);
      addWeighted(values, 'FaceAngleY', -5.2 * e, 0.66);
      addEyeTracking(values, 0, -0.16 * e, 0.62);
      addBodyTracking(values, {
        y: -6.2 * e
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
      addWeighted(values, 'MouthSmile', 0.78, 0.46);
      addWeighted(values, 'Brows', 0.62, 0.34);
      addBodyTracking(values, {
        y: 8.2 * beat * e,
        posY: 0.36 * beat * e
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

function activeBehaviorSamples(actions, elapsedMs) {
  return (Array.isArray(actions) ? actions : []).map((action) => {
    const started = Number(action.delayMs) || 0;
    const duration = Math.max(Number(action.durationMs) || 1000, 1);
    const progress = (elapsedMs - started) / duration;
    if (progress < 0 || progress > 1) return null;
    const envelopeValue = actionEnvelope(progress);
    const amplitude = clampFallback(action.amplitude, 0.72, 1.36, 1);
    const tempo = clampFallback(action.tempo, 0.82, 1.22, 1);
    const phaseOffset = Number(action.phaseOffset) || 0;
    const intensity = clamp((Number(action.intensity) || 0.92) * 1.7 * amplitude, 0.3, 1.9);
    return {
      action,
      progress,
      phase: progress * Math.PI * 2 * tempo + phaseOffset,
      envelope: envelopeValue,
      intensity,
      energy: envelopeValue * intensity,
      sign: actionSideSign(action, Number(action.sideSign) || (Math.sin((action.delayMs || 0) * 0.017) >= 0 ? 1 : -1))
    };
  }).filter(Boolean);
}

function autoBlinkOpen(nowMs, baseOpen = 0.92) {
  const seconds = Number(nowMs || 0) / 1000;
  const cycle = 3.35 + 0.28 * Math.sin(seconds * 0.17);
  const phase = ((seconds + 0.41 * Math.sin(seconds * 0.31)) % cycle + cycle) % cycle;
  const open = clampFallback(baseOpen, 0.62, 1, 0.92);
  if (phase < 0.085) return open * (1 - phase / 0.085);
  if (phase < 0.165) return 0.015;
  if (phase < 0.35) return open * ((phase - 0.165) / 0.185);
  return open;
}

function pickDominantMotion(samples) {
  return samples
    .filter((sample) => behaviorActionPriority(sample.action.type) > 0)
    .sort((left, right) => (
      (behaviorActionPriority(right.action.type) * right.energy) -
      (behaviorActionPriority(left.action.type) * left.energy)
    ))[0] || null;
}

function applyDirectMotion(frame, sample) {
  if (!sample) return;
  const { action, progress: t, phase, energy: e, sign } = sample;
  const variant = actionVariant(action);
  const arc = actionArc(action);
  const secondarySign = actionSecondarySign(action, -sign);
  const fast = Math.sin(phase * 2);
  const slow = Math.sin(phase);
  const beat = Math.abs(Math.sin(phase * 2));

  switch (action.type) {
    case 'look_at_chat': {
      const x = 14 * slow * e;
      const z = (8 * Math.sin(phase * 0.5) + (variant === 1 ? 1.8 * sign * Math.abs(slow) : 0)) * e;
      const y = (3 * Math.sin(phase * 0.7) - (variant === 2 ? 1.4 * Math.abs(slow) : 0)) * e;
      setFrameValue(frame, 'FaceAngleX', x, 1);
      setFrameValue(frame, 'FaceAngleY', y, 1);
      setFrameValue(frame, 'FaceAngleZ', z, 1);
      setFrameEyes(frame, -x / 30, -0.12 * e, 0.8);
      setFrameBody(frame, {
        x: x / 8,
        y: variant === 3 ? -1.4 * Math.abs(slow) * e : 0,
        z: z / 5,
        posX: variant === 1 ? 0.05 * sign * Math.abs(slow) * e : 0
      }, 1);
      break;
    }
    case 'nod': {
      const sideLean = variant ? sign * (1.3 + Math.abs(arc)) * slow * e : 0;
      setFrameValue(frame, 'FaceAngleY', (13 * beat - 4) * e, 1);
      setFrameValue(frame, 'FacePositionY', -2.5 * beat * e, 0.9);
      if (variant === 2) addFrameValue(frame, 'FaceAngleZ', sideLean * 0.9, 0.5);
      setFrameBody(frame, {
        y: 5.5 * beat * e,
        z: sideLean * 0.64,
        posX: sideLean * 0.012,
        posY: 0.22 * beat * e
      }, 1);
      break;
    }
    case 'shake_head':
      setFrameValue(frame, 'FaceAngleX', 15 * fast * e, 1);
      setFrameValue(frame, 'FaceAngleZ', (6 * fast + (variant === 1 ? 1.4 * slow * secondarySign : 0)) * e, 0.74);
      setFrameEyes(frame, -0.28 * fast * e, 0, 0.72);
      setFrameBody(frame, {
        x: 4.8 * fast * e,
        y: variant === 2 ? 0.9 * Math.abs(slow) * e : 0,
        z: (1.8 * fast + (variant === 3 ? 1.2 * slow * secondarySign : 0)) * e
      }, 1);
      break;
    case 'head_tilt':
      setFrameValue(frame, 'FaceAngleX', (5 * sign + (variant === 2 ? 1.4 * secondarySign * Math.sin(phase) : 0)) * e, 0.72);
      setFrameValue(frame, 'FaceAngleZ', 16 * sign * e, 1);
      setFrameValue(frame, 'FacePositionX', 4.2 * sign * e, 0.86);
      if (variant === 1) addFrameValue(frame, 'FaceAngleY', -1.7 * e, 0.46);
      if (variant === 3) addFrameValue(frame, 'FacePositionY', -0.9 * Math.abs(slow) * e, 0.42);
      setFrameEyes(frame, -0.18 * sign * e, 0, 0.7);
      setFrameBody(frame, {
        x: variant === 2 ? 0.9 * secondarySign * slow * e : 0,
        y: variant === 1 ? -1.2 * e : 0,
        z: 8 * sign * e,
        posX: 0.32 * sign * e,
        posY: variant === 3 ? 0.04 * Math.abs(slow) * e : 0
      }, 1);
      break;
    case 'lean_in':
      setFrameValue(frame, 'FaceAngleY', (-5.2 - (variant === 1 ? 0.9 * Math.abs(slow) : 0)) * e, 0.78);
      setFrameValue(frame, 'FacePositionY', -2.8 * e, 0.72);
      if (variant === 2) addFrameValue(frame, 'FaceAngleZ', 2.4 * sign * slow * e, 0.54);
      if (variant === 3) addFrameValue(frame, 'FacePositionX', 1.8 * sign * Math.abs(slow) * e, 0.48);
      setFrameEyes(frame, 0, -0.16 * e, 0.72);
      setFrameBody(frame, {
        y: -6.2 * e,
        z: variant === 2 ? 1.6 * sign * slow * e : 0,
        posX: variant === 3 ? 0.08 * sign * Math.abs(slow) * e : 0
      }, 1);
      break;
    case 'lean_left':
    case 'lean_right': {
      const leanSign = action.type === 'lean_left' ? -1 : 1;
      setFrameValue(frame, 'FaceAngleX', (5 * leanSign + (variant === 2 ? 1.2 * secondarySign * slow : 0)) * e, 0.72);
      setFrameValue(frame, 'FaceAngleZ', 16 * leanSign * e, 1);
      setFrameValue(frame, 'FacePositionX', 5.5 * leanSign * e, 0.9);
      if (variant === 1) addFrameValue(frame, 'FaceAngleY', -1.4 * e, 0.42);
      if (variant === 3) addFrameValue(frame, 'FacePositionY', -0.8 * Math.abs(slow) * e, 0.44);
      setFrameEyes(frame, -0.35 * leanSign * e, 0, 0.8);
      setFrameBody(frame, {
        y: variant === 1 ? -1.1 * e : 0,
        z: 8 * leanSign * e,
        posX: 0.38 * leanSign * e,
        posY: variant === 3 ? 0.04 * Math.abs(slow) * e : 0
      }, 1);
      break;
    }
    case 'sway': {
      const side = slow * e;
      const lift = variant === 1 ? 1.2 * Math.abs(slow) * e : 0;
      setFrameValue(frame, 'FaceAngleX', (5.5 * slow + (variant === 2 ? 1.4 * sign * Math.abs(slow) : 0)) * e, 0.82);
      setFrameValue(frame, 'FaceAngleZ', (9 * slow + (variant === 3 ? 1.6 * sign * Math.abs(slow) : 0)) * e, 0.9);
      setFrameValue(frame, 'FacePositionX', 3.2 * side, 0.82);
      if (lift) addFrameValue(frame, 'FacePositionY', -lift, 0.42);
      setFrameEyes(frame, -0.18 * side, 0, 0.76);
      setFrameBody(frame, {
        x: 3.2 * side,
        y: lift * 0.72,
        z: (6.8 * slow + (variant === 3 ? 1.1 * sign * Math.abs(slow) : 0)) * e,
        posX: 0.25 * side,
        posY: lift ? 0.06 * Math.abs(slow) * e : 0
      }, 1);
      break;
    }
    case 'bounce': {
      const sideLean = variant ? sign * (1 + Math.abs(arc) * 0.7) * slow * e : 0;
      setFrameValue(frame, 'FaceAngleY', 4 * beat * e, 0.72);
      setFrameValue(frame, 'FacePositionY', -6.5 * beat * e, 0.95);
      if (variant === 1) addFrameValue(frame, 'FaceAngleZ', sideLean * 1.4, 0.52);
      setFrameValue(frame, 'MouthSmile', 0.78, 0.8);
      setFrameValue(frame, 'Brows', 0.62, 0.55);
      setFrameValue(frame, 'BrowLeftY', 0.62, 0.55);
      setFrameValue(frame, 'BrowRightY', 0.62, 0.55);
      setFrameBody(frame, {
        y: 8.2 * beat * e,
        z: sideLean * 0.72,
        posX: sideLean * 0.016,
        posY: 0.36 * beat * e
      }, 1);
      break;
    }
    case 'shiver': {
      const jitter = Math.sin(phase * (variant === 2 ? 5 : 6)) * e;
      setFrameValue(frame, 'FaceAngleX', 4.2 * jitter, 0.86);
      setFrameValue(frame, 'FaceAngleZ', (3.2 * Math.sin(phase * 7) + (variant === 1 ? 1.2 * sign * slow : 0)) * e, 0.78);
      setFrameValue(frame, 'FacePositionX', 1.6 * Math.sin(phase * 8.2) * e, 0.58);
      setFrameBody(frame, {
        x: 1.8 * jitter,
        y: variant === 3 ? 0.8 * Math.abs(slow) * e : 0,
        z: 3.5 * Math.sin(phase * 6.6) * e
      }, 0.82);
      break;
    }
    case 'emphasis': {
      const hit = Math.abs(Math.sin(Math.PI * t)) * e;
      setFrameValue(frame, 'FaceAngleY', -3.2 * hit, 0.72);
      setFrameValue(frame, 'FaceAngleZ', sign * 10.5 * fast * e, 0.92);
      setFrameValue(frame, 'FacePositionY', -4.8 * hit, 0.86);
      setFrameBody(frame, {
        y: -4.6 * hit,
        z: sign * 8.2 * fast * e,
        posX: variant === 1 ? 0.04 * secondarySign * hit : 0
      }, 1);
      break;
    }
    case 'breathe':
      setFrameBody(frame, { y: 1.8 * Math.sin(phase) * e, posY: 0.07 * Math.sin(phase) * e }, 0.45);
      break;
    default:
      break;
  }
}

function applyDirectOverlay(frame, sample, dominant, options = {}) {
  const { action, progress: t, phase, energy: e, sign } = sample;
  const isDominant = dominant?.action === action;
  const faceOnly = Boolean(options.faceOnly);
  const suppressEyeOpen = Boolean(options.suppressEyeOpen);

  switch (action.type) {
    case 'look_at_chat':
      if (faceOnly) break;
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
      if (!faceOnly) addFrameValue(frame, 'FaceAngleZ', 3.8 * sign * e, 0.78);
      setFrameValue(frame, 'Brows', 0.6 + 0.08 * e, 0.66);
      setFrameValue(frame, 'BrowLeftY', sign < 0 ? 0.72 : 0.54, 0.66);
      setFrameValue(frame, 'BrowRightY', sign > 0 ? 0.72 : 0.54, 0.66);
      break;
    case 'blink': {
      if (suppressEyeOpen) break;
      const close = Math.sin(Math.PI * t) * e;
      const open = clamp(0.92 - close, 0.04, 1);
      setFrameValue(frame, 'EyeOpenLeft', open, 0.96);
      setFrameValue(frame, 'EyeOpenRight', open, 0.96);
      break;
    }
    case 'wink': {
      if (suppressEyeOpen) break;
      const close = Math.sin(Math.PI * t) * e;
      const open = clamp(0.92 - close, 0.04, 1);
      setFrameValue(frame, action.side === 'left' ? 'EyeOpenLeft' : 'EyeOpenRight', open, 0.98);
      setFrameValue(frame, 'MouthSmile', 0.76, 0.62);
      break;
    }
    case 'surprised':
      if (!suppressEyeOpen) {
        setFrameValue(frame, 'EyeOpenLeft', 1, 0.98);
        setFrameValue(frame, 'EyeOpenRight', 1, 0.98);
      }
      setFrameValue(frame, 'MouthSmile', 0.48, 0.54);
      setFrameValue(frame, 'Brows', 0.78, 0.78);
      setFrameValue(frame, 'BrowLeftY', 0.78, 0.78);
      setFrameValue(frame, 'BrowRightY', 0.78, 0.78);
      break;
    default:
      break;
  }
}

function applySemanticExpressionOverlay(frame, expression, strength = 1, options = {}) {
  const overlay = filterMomentaryExpressionOverlay(
    semanticExpressionVTSOverlay(expression),
    expression,
    options
  );
  if (!overlay.length) return;
  const amount = clampFallback(strength, 0, 1, 1);
  overlay.forEach((item) => {
    const weight = clampFallback(item.weight, 0.01, 1, 0.55) * amount;
    const value = Number(item.value);
    if (!item.id || !Number.isFinite(value)) return;
    if (item.mode === 'add') addFrameValue(frame, item.id, value * amount, weight);
    else setFrameValue(frame, item.id, value, weight);
  });
}

function applyCharacterStateFrame(frame, character, strength = 1) {
  if (!character) return;
  const amount = clampFallback(strength, 0, 1, 1);
  const isSpeaking = character.mode === 'speaking';
  const facePositionWeight = isSpeaking ? 0.72 : 0.54;
  const bodyWeight = isSpeaking ? 0.96 : 0.72;
  setFrameValue(frame, 'FaceAngleX', character.faceX * amount, 0.72);
  setFrameValue(frame, 'FaceAngleY', character.faceY * amount, 0.7);
  setFrameValue(frame, 'FaceAngleZ', character.faceZ * amount, 0.68);
  setFrameValue(frame, 'FacePositionX', character.facePosX * amount, facePositionWeight);
  setFrameValue(frame, 'FacePositionY', character.facePosY * amount, facePositionWeight);
  setFrameValue(frame, 'MouthSmile', character.mouthSmile, 0.72);
  setFrameValue(frame, 'Brows', character.brows, 0.56);
  setFrameValue(frame, 'BrowLeftY', character.browLeftY, 0.54);
  setFrameValue(frame, 'BrowRightY', character.browRightY, 0.54);
  setFrameEyes(frame, character.eyeX * amount, character.eyeY * amount, 0.78);
  setFrameYachiyoEars(frame, character, amount);
  setFrameBody(frame, {
    x: character.bodyX * amount,
    y: character.bodyY * amount,
    z: character.bodyZ * amount,
    posX: character.bodyPosX * amount,
    posY: character.bodyPosY * amount
  }, bodyWeight);
}

function applyAutoBlink(frame, samples, nowMs, baseOpen = 0.92, options = {}) {
  if (options.suppressEyeOpen) return;
  const hasManualEye = samples.some((sample) => behaviorActionBlocksAutoBlink(sample.action.type));
  if (hasManualEye) return;
  const open = autoBlinkOpen(nowMs, baseOpen);
  setFrameValue(frame, 'EyeOpenLeft', open, 0.92);
  setFrameValue(frame, 'EyeOpenRight', open, 0.92);
}

function sampleVTSBehaviorActions(actions, elapsedMs, nowMs = performance.now(), character = null, expression = '', options = {}) {
  const samples = activeBehaviorSamples(actions, elapsedMs);
  if (samples.some((sample) => sample.action.type === 'reset' && sample.energy > 0.5)) return behaviorResetFrame();

  const suppressEyeOpen = Boolean(options.suppressEyeOpen || expressionOwnsEyeOpen(expression));
  const frame = createDirectTrackingFrame({ suppressEyeOpen });
  const speaking = character?.mode === 'speaking';
  const dominant = pickDominantMotion(samples);
  applyCharacterStateFrame(frame, character, speaking && dominant ? 0.42 : (speaking ? 0.82 : 0.68));
  applySemanticExpressionOverlay(frame, expression || character?.emotion, speaking ? 0.68 : 0.82);
  applyDirectMotion(frame, dominant);
  samples.forEach((sample) => applyDirectOverlay(frame, sample, dominant, { faceOnly: false, suppressEyeOpen }));
  applyAutoBlink(frame, samples, nowMs, character?.eyeOpen, { suppressEyeOpen });
  return finalizeDirectFrame(frame);
}

function sampleVTSIdleFrame(nowMs = performance.now(), character = null, options = {}) {
  const suppressEyeOpen = Boolean(options.suppressEyeOpen);
  const frame = createDirectTrackingFrame({ suppressEyeOpen });
  applyCharacterStateFrame(frame, character, 1);
  applySemanticExpressionOverlay(frame, character?.emotion, 0.52);
  applyAutoBlink(frame, [], nowMs, character?.eyeOpen, { suppressEyeOpen });
  return finalizeDirectFrame(frame);
}

function enrichBehaviorActions(actions = []) {
  return actions.map((action, index) => {
    const sideSign = action.side === 'left'
      ? -1
      : action.side === 'right'
        ? 1
        : (Math.random() > 0.5 ? 1 : -1);
    const tempo = 0.9 + Math.random() * 0.22;
    const amplitude = 0.92 + Math.random() * 0.26;
    const durationJitter = 0.94 + Math.random() * 0.16;
    const delayJitter = index > 0 ? Math.round((Math.random() - 0.5) * 90) : 0;
    return {
      ...action,
      sideSign,
      tempo,
      amplitude,
      motionVariant: Math.floor(Math.random() * 4),
      motionArc: (Math.random() - 0.5) * 2,
      secondarySign: Math.random() > 0.5 ? 1 : -1,
      phaseOffset: Math.random() * Math.PI * 2,
      durationMs: Math.round(Math.max(Number(action.durationMs) || 1000, 260) * durationJitter),
      delayMs: Math.max(0, Math.round((Number(action.delayMs) || 0) + delayJitter))
    };
  });
}

export function mountVTubeStudioBridge() {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return () => {};

  let settings = readRoomVTubeStudioSettings();
  let socket = null;
  let connectPromise = null;
  let authenticated = false;
  let yachiyoParameterCreationPromise = null;
  let requestCounter = 0;
  let bodyFrameId = 0;
  let bodyMotion = null;
  let behaviorFrameId = 0;
  let idleFrameId = 0;
  let behaviorPlan = null;
  let expressionFiles = [];
  let expressionsLoadedAt = 0;
  const characterState = createLive2DCharacterStateMachine();
  const pendingRequests = new Map();
  const pendingInjection = new Map();
  const smoothedInjection = new Map();
  const expressionActivationTimers = new Map();
  const expressionTimers = new Map();
  const momentaryExpressionTimers = new Map();
  const activeExpressionFiles = new Set();
  let flushTimer = 0;
  let lastInjectionAt = 0;

  function activeExpressionOwnsEyeOpen() {
    return [...activeExpressionFiles].some((file) => expressionOwnsEyeOpen(file));
  }

  function releaseInjectedEyeOpen() {
    EYE_OPEN_INJECTION_IDS.forEach((id) => {
      pendingInjection.delete(id);
      smoothedInjection.delete(id);
    });
  }

  function releaseInjectedMomentaryParameters() {
    MOMENTARY_EXPRESSION_PARAMETER_IDS.forEach((id) => {
      pendingInjection.delete(id);
      smoothedInjection.delete(id);
    });
  }

  function clearMomentaryExpressionTimer(key) {
    const timer = momentaryExpressionTimers.get(key);
    if (timer) window.clearTimeout(timer);
    momentaryExpressionTimers.delete(key);
  }

  function pulseMomentaryExpressionOverlay(expression, overlay = semanticExpressionVTSOverlay(expression)) {
    if (!expressionIsMomentary(expression)) return false;
    const pulse = overlay.filter((item) => MOMENTARY_EXPRESSION_PARAMETER_IDS.has(item.id));
    if (!pulse.length) return false;
    const key = normalizeExpressionToken(expression) || 'momentary';
    clearMomentaryExpressionTimer(key);
    queueInjection(pulse);
    const timer = window.setTimeout(() => {
      momentaryExpressionTimers.delete(key);
      releaseInjectedMomentaryParameters();
      queueInjection(pulse.map((item) => ({ id: item.id, value: 0, weight: 1 })));
    }, MOMENTARY_EXPRESSION_PULSE_MS);
    momentaryExpressionTimers.set(key, timer);
    return true;
  }

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

  function parameterAlreadyExists(error) {
    return /already exists|exists|duplicate|taken/i.test(String(error?.message || ''));
  }

  async function ensureYachiyoParameters() {
    if (yachiyoDirectInputsReady) return true;
    if (yachiyoParameterCreationPromise) return yachiyoParameterCreationPromise;
    yachiyoParameterCreationPromise = (async () => {
      for (const item of yachiyoVTubeStudioParameterSettings()) {
        await sendPayload('ParameterCreationRequest', {
          parameterName: item.input,
          explanation: `Yachiyo model input for ${item.outputLive2D}`,
          min: item.min,
          max: item.max,
          defaultValue: item.defaultValue
        }, true).catch((error) => {
          if (parameterAlreadyExists(error)) return null;
          throw error;
        });
      }
      yachiyoDirectInputsReady = true;
      return true;
    })()
      .catch(() => false)
      .finally(() => {
        yachiyoParameterCreationPromise = null;
      });
    return yachiyoParameterCreationPromise;
  }

  function closeSocket() {
    stopIdleFrame();
    authenticated = false;
    connectPromise = null;
    yachiyoParameterCreationPromise = null;
    yachiyoDirectInputsReady = false;
    smoothedInjection.clear();
    lastInjectionAt = 0;
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
    if (socket?.readyState === WebSocket.OPEN && authenticated) {
      startIdleFrame();
      return socket;
    }
    if (connectPromise) return connectPromise;

    connectPromise = new Promise((resolve, reject) => {
      closeSocket();
      const nextSocket = new WebSocket(normalizeUrl(settings.apiUrl));
      socket = nextSocket;
      nextSocket.onopen = async () => {
        try {
          await authenticate();
          await ensureYachiyoParameters();
          setStatus('connected');
          startIdleFrame();
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
        stopIdleFrame();
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

  async function loadExpressionFiles(force = false) {
    const fresh = Date.now() - expressionsLoadedAt < 30000;
    if (!force && fresh && expressionFiles.length) return expressionFiles;
    await connect();
    const response = await request('ExpressionStateRequest', { details: false }).catch(() => null);
    expressionFiles = (response?.data?.expressions || [])
      .map((item) => String(item?.file || item?.expressionFile || item?.name || '').trim())
      .filter(Boolean);
    expressionsLoadedAt = Date.now();
    return expressionFiles;
  }

  async function resolveExpressionFile(expression) {
    const candidates = expressionCandidates(expression);
    if (!candidates.length || candidates.includes('neutral')) return '';
    const files = await loadExpressionFiles();
    const normalizedFiles = files.map((file) => ({
      file,
      key: normalizeExpressionToken(file),
      lower: file.toLowerCase()
    }));
    for (const candidate of candidates) {
      const direct = normalizedFiles.find((item) => item.key === candidate);
      if (direct) return direct.file;
    }
    for (const candidate of candidates) {
      const partial = normalizedFiles.find((item) => item.key.includes(candidate) || candidate.includes(item.key));
      if (partial) return partial.file;
    }
    return '';
  }

  function clearExpressionTimer(file) {
    const timer = expressionTimers.get(file);
    if (timer) window.clearTimeout(timer);
    expressionTimers.delete(file);
  }

  function clearExpressionActivationTimer(file) {
    const timer = expressionActivationTimers.get(file);
    if (timer) window.clearTimeout(timer);
    expressionActivationTimers.delete(file);
  }

  function setVTSExpression(file, active, fadeTime = 0.35) {
    if (!file) return;
    connect()
      .then(() => sendPayload('ExpressionActivationRequest', {
        expressionFile: file,
        active,
        fadeTime
      }, true))
      .catch(() => {});
  }

  function deactivateActiveExpressions() {
    [...new Set([...expressionFiles, ...activeExpressionFiles])].forEach((file) => {
      clearExpressionActivationTimer(file);
      clearExpressionTimer(file);
      setVTSExpression(file, false, 0.08);
    });
    activeExpressionFiles.clear();
    releaseInjectedEyeOpen();
    releaseInjectedMomentaryParameters();
  }

  function deactivateOtherExpressions(nextFile) {
    const nextKey = normalizeExpressionToken(nextFile);
    [...new Set([...expressionFiles, ...activeExpressionFiles])].forEach((file) => {
      if (!file || normalizeExpressionToken(file) === nextKey) return;
      clearExpressionActivationTimer(file);
      clearExpressionTimer(file);
      setVTSExpression(file, false, 0.06);
      activeExpressionFiles.delete(file);
    });
    if (!activeExpressionOwnsEyeOpen()) releaseInjectedEyeOpen();
  }

  function activateVTSExpression(expression, durationMs = 2600) {
    const candidates = expressionCandidates(expression);
    if (!candidates.length) return;
    if (candidates.includes('neutral')) {
      deactivateActiveExpressions();
      loadExpressionFiles().then(() => deactivateActiveExpressions()).catch(() => {});
      return;
    }
    resolveExpressionFile(expression)
      .then((file) => {
        if (!file) return;
        const momentaryExpression = expressionIsMomentary(expression) || expressionIsMomentary(file);
        deactivateOtherExpressions(file);
        clearExpressionActivationTimer(file);
        clearExpressionTimer(file);
        const activationTimer = window.setTimeout(() => {
          expressionActivationTimers.delete(file);
          setVTSExpression(file, true, 0.18);
        }, 70);
        expressionActivationTimers.set(file, activationTimer);
        activeExpressionFiles.add(file);
        if (expressionOwnsEyeOpen(file)) releaseInjectedEyeOpen();
        const holdMs = momentaryExpression
          ? clamp(Math.min(Math.round(Number(durationMs) || MOMENTARY_EXPRESSION_PULSE_MS), MOMENTARY_EXPRESSION_PULSE_MS), 420, MOMENTARY_EXPRESSION_PULSE_MS)
          : clamp(Math.round(Number(durationMs) || 2600), 900, 9000);
        const timer = window.setTimeout(() => {
          setVTSExpression(file, false, 0.45);
          activeExpressionFiles.delete(file);
          expressionTimers.delete(file);
          if (!activeExpressionOwnsEyeOpen()) releaseInjectedEyeOpen();
          if (momentaryExpression) releaseInjectedMomentaryParameters();
        }, holdMs);
        expressionTimers.set(file, timer);
      })
      .catch(() => {});
  }

  function queueInjection(values) {
    if (!settings.enabled || !Array.isArray(values) || !values.length) return;
    const suppressEyeOpen = activeExpressionOwnsEyeOpen();
    if (suppressEyeOpen) releaseInjectedEyeOpen();
    values.forEach((item) => {
      if (!item?.id || !Number.isFinite(Number(item.value))) return;
      if (suppressEyeOpen && EYE_OPEN_INJECTION_IDS.has(item.id)) return;
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
    const now = performance.now();
    const smoothedValues = smoothInjectionValues(values, smoothedInjection, lastInjectionAt ? now - lastInjectionAt : 32);
    lastInjectionAt = now;
    connect()
      .then(() => sendPayload('InjectParameterDataRequest', {
        mode: 'set',
        faceFound: true,
        parameterValues: smoothedValues
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

  function stopIdleFrame() {
    if (idleFrameId) window.cancelAnimationFrame(idleFrameId);
    idleFrameId = 0;
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
      characterState.setMode('listening', { now, holdMs: 1400, attention: 0.52 });
      queueInjection(sampleVTSIdleFrame(now, characterState.sample(now), {
        suppressEyeOpen: activeExpressionOwnsEyeOpen()
      }));
      stopBehaviorFrame();
      return;
    }
    queueInjection(sampleVTSBehaviorActions(
      behaviorPlan.actions,
      elapsedMs,
      now,
      characterState.sample(now),
      behaviorPlan.expression,
      { suppressEyeOpen: behaviorPlan.suppressEyeOpen || activeExpressionOwnsEyeOpen() }
    ));
    behaviorFrameId = window.requestAnimationFrame(tickBehavior);
  }

  function tickIdle(now = performance.now()) {
    if (!settings.enabled || !authenticated || socket?.readyState !== WebSocket.OPEN) {
      stopIdleFrame();
      return;
    }
    if (!behaviorPlan) {
      queueInjection(sampleVTSIdleFrame(now, characterState.sample(now), {
        suppressEyeOpen: activeExpressionOwnsEyeOpen()
      }));
    }
    idleFrameId = window.requestAnimationFrame(tickIdle);
  }

  function startIdleFrame() {
    if (idleFrameId || !settings.enabled || !authenticated || socket?.readyState !== WebSocket.OPEN) return;
    idleFrameId = window.requestAnimationFrame(tickIdle);
  }

  function startBehaviorPlan(actions, durationMs, options = {}) {
    if (!Array.isArray(actions) || !actions.length) return;
    const enrichedActions = enrichBehaviorActions(actions);
    const planDurationMs = Math.max(
      Number(durationMs) || 0,
      ...enrichedActions.map((action) => (Number(action.delayMs) || 0) + (Number(action.durationMs) || 0)),
      800
    );
    bodyMotion = null;
    stopBodyFrame();
    behaviorPlan = {
      actions: enrichedActions,
      durationMs: planDurationMs,
      startedAt: performance.now(),
      expression: options.expression || semanticExpressionFromEmotion(options.emotion),
      suppressEyeOpen: expressionOwnsEyeOpen(options.expression || options.emotion)
    };
    characterState.setMode('acting', {
      holdMs: planDurationMs + 420,
      attention: 0.86,
      arousal: 0.72
    });
    stopBehaviorFrame();
    behaviorFrameId = window.requestAnimationFrame(tickBehavior);
  }

  function onRoomAct(event) {
    const detail = event.detail || {};
    characterState.onRoomAct(detail);
    const behaviorActions = Array.isArray(detail.behaviorActions) ? detail.behaviorActions : [];
    const expression = normalizeSemanticExpressionId(
      detail.expression || detail.expressionMix?.[0]?.expression || detail.emotion || detail.mood
    ) || semanticExpressionFromEmotion(detail.emotion || detail.mood);
    if (behaviorActions.length) {
      startBehaviorPlan(behaviorActions, detail.durationMs || detail.duration, {
        expression,
        emotion: detail.emotion || detail.mood
      });
    }
    if (settings.injectFace) {
      if (expression) activateVTSExpression(expression, detail.durationMs || detail.duration);
      const overlay = semanticExpressionVTSOverlay(expression);
      const continuousOverlay = filterMomentaryExpressionOverlay(overlay, expression);
      if (expression) pulseMomentaryExpressionOverlay(expression, overlay);
      if (continuousOverlay.length) queueInjection(continuousOverlay);
    }
    if (settings.injectBody && !behaviorActions.length) {
      const mapped = mapLive2DParametersToVTS(detail.parameters || detail.parameterTargets || detail.params, {
        face: false,
        body: true
      });
      queueInjection(mapped);
      const pose = normalizePose(detail.bodyPose || detail.pose || detail.posture || detail.motion || detail.action);
      if (pose) {
        const durationMs = clamp(Math.round(Number(detail.durationMs || detail.duration) || 2400), 650, 8000);
        const intensity = clamp(Math.max(Number(detail.intensity) || 0, 0.86), 0.65, 1);
        stopBodyFrame();
        startBehaviorPlan([{ type: pose, intensity, durationMs, delayMs: 0 }], durationMs);
      }
    }
  }

  function onFaceCapture(event) {
    if (!settings.injectFace && !settings.injectBody) return;
    if (behaviorPlan) return;
    if (characterState.getState().mode === 'speaking') return;
    queueInjection(mapLive2DParametersToVTS(event.detail?.parameters, {
      face: settings.injectFace,
      body: settings.injectBody
    }));
  }

  function onMouth(event) {
    if (!settings.injectMouth) return;
    const value = clamp(Number(event.detail?.value), 0, 1);
    characterState.onMouth(value);
    queueInjection([
      { id: 'MouthOpen', value, weight: 0.92 },
      { id: 'VoiceVolumePlusMouthOpen', value, weight: 0.72 },
      { id: 'VoiceVolume', value, weight: 0.38 }
    ]);
  }

  function onCharacterState(event) {
    characterState.onExternalState(event.detail || {});
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
  window.addEventListener(CHARACTER_STATE_EVENT, onCharacterState);
  window.addEventListener(SETTINGS_EVENT, reloadSettings);

  if (settings.enabled) connect().catch((error) => setStatus('error', error.message || 'VTube Studio connection failed.'));
  else setStatus('disabled');

  return () => {
    window.removeEventListener(ROOM_ACT_EVENT, onRoomAct);
    window.removeEventListener(FACE_CAPTURE_EVENT, onFaceCapture);
    window.removeEventListener(MOUTH_EVENT, onMouth);
    window.removeEventListener(CHARACTER_STATE_EVENT, onCharacterState);
    window.removeEventListener(SETTINGS_EVENT, reloadSettings);
    window.clearTimeout(flushTimer);
    expressionActivationTimers.forEach((timer) => window.clearTimeout(timer));
    expressionActivationTimers.clear();
    expressionTimers.forEach((timer) => window.clearTimeout(timer));
    expressionTimers.clear();
    momentaryExpressionTimers.forEach((timer) => window.clearTimeout(timer));
    momentaryExpressionTimers.clear();
    activeExpressionFiles.clear();
    stopBodyFrame();
    stopBehaviorFrame();
    stopIdleFrame();
    closeSocket();
  };
}
