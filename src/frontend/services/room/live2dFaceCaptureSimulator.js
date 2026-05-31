import { naturalAutoBlinkOpen } from './live2dBlinkTiming';

const FACE_CAPTURE_EVENT = 'tsukuyomi:live2d-face';
const ROOM_ACT_EVENT = 'tsukuyomi:room-act';
const MOUTH_EVENT = 'tsukuyomi:live2d-mouth';
const DEFAULT_FACE_CAPTURE_SCALE = 1;

const EXPRESSION_ALIASES = {
  happy: 'smile',
  joy: 'smile',
  cheerful: 'smile',
  smile: 'smile',
  gentle: 'smile',
  shy: 'bsmile',
  blush: 'bsmile',
  embarrassed: 'bsmile',
  playful: 'bsmile',
  bsmile: 'bsmile',
  angry: 'bsmile',
  annoyed: 'bsmile',
  sad: 'namida',
  sorrow: 'namida',
  namida: 'namida',
  crying: 'tears',
  cry: 'tears',
  tears: 'tears',
  neutral: 'neutral',
  calm: 'neutral',
  default: 'neutral'
};

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(numeric, min), max);
}

function parameter(id, value, weight = 0.64) {
  return {
    id,
    value,
    weight
  };
}

function normalizeExpression(value) {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  return EXPRESSION_ALIASES[key] || (key || 'neutral');
}

function pickExpressionFromAct(detail = {}) {
  const mix = Array.isArray(detail.expressionMix) ? detail.expressionMix : [];
  const mixed = mix
    .map((item) => ({
      expression: normalizeExpression(item?.expression || item?.key || item?.id),
      weight: Number(item?.weight)
    }))
    .filter((item) => item.expression && Number.isFinite(item.weight))
    .sort((left, right) => right.weight - left.weight)[0]?.expression;
  return normalizeExpression(mixed || detail.expression || detail.emotion || detail.mood || '');
}

function expressionProfile(expression) {
  switch (normalizeExpression(expression)) {
    case 'smile':
      return { mouth: 0.32, brow: 0.12, cheek: 0.1, eye: 0.92 };
    case 'bsmile':
      return { mouth: 0.24, brow: 0.22, cheek: 0.22, eye: 0.86 };
    case 'namida':
      return { mouth: -0.26, brow: -0.18, cheek: 0.04, eye: 0.78 };
    case 'tears':
      return { mouth: -0.36, brow: -0.28, cheek: 0.02, eye: 0.72 };
    default:
      return { mouth: 0.04, brow: 0.02, cheek: 0.02, eye: 0.94 };
  }
}

function readFaceCaptureScale() {
  if (typeof window === 'undefined') return DEFAULT_FACE_CAPTURE_SCALE;
  const globalValue = Number(window.TSUKUYOMI_LIVE2D_FACE_CAPTURE_SCALE);
  if (Number.isFinite(globalValue)) return clamp(globalValue, 0.2, 1.8);
  try {
    const stored = Number(window.localStorage?.getItem('roomLive2DFaceCaptureScale'));
    if (Number.isFinite(stored)) return clamp(stored, 0.2, 1.8);
  } catch (_) {
    // ignore storage failures in WebView privacy modes
  }
  return DEFAULT_FACE_CAPTURE_SCALE;
}

function blinkOpenAt(timeSeconds, expressionEye = 0.94) {
  return naturalAutoBlinkOpen(Number(timeSeconds) * 1000, expressionEye);
}

export function sampleLive2DFaceCapture(nowMs, state = {}) {
  const seconds = Number(nowMs) / 1000;
  const scale = clamp(state.scale ?? DEFAULT_FACE_CAPTURE_SCALE, 0.2, 1.8);
  const mouthEnergy = clamp(state.mouthEnergy || 0, 0, 1);
  const profile = expressionProfile(state.expression || 'neutral');
  const speakingPulse = mouthEnergy * Math.sin(seconds * 10.5);
  const attention = clamp(state.attention || 0, 0, 1);

  const headX = (5.2 * Math.sin(seconds * 0.73) + 2.1 * Math.sin(seconds * 1.37 + 0.8)) * scale;
  const headY = (-1.2 + 3.4 * Math.sin(seconds * 0.61 + 1.1) + 1.4 * speakingPulse) * scale;
  const headZ = (2.7 * Math.sin(seconds * 0.47 + 2.2) + 1.2 * Math.sin(seconds * 1.13)) * scale;
  const bodyX = (headX * 0.22 + 1.1 * Math.sin(seconds * 0.37 + 0.4)) * scale;
  const bodyY = (headY * 0.18 + 0.8 * Math.sin(seconds * 0.9)) * scale;
  const bodyZ = (headZ * 0.28 + 0.9 * Math.sin(seconds * 0.33 + 1.8)) * scale;
  const eyeX = clamp(-headX / 28 + 0.22 * Math.sin(seconds * 0.56 + 2.4), -0.6, 0.6);
  const eyeY = clamp(-headY / 32 + 0.12 * Math.sin(seconds * 0.44 + 0.6), -0.45, 0.45);
  const blink = blinkOpenAt(seconds, profile.eye);
  const winkOffset = 0.035 * Math.sin(seconds * 0.81 + 1.5);
  const browMicro = 0.06 * Math.sin(seconds * 0.92 + 0.2) + mouthEnergy * 0.08 + attention * 0.05;
  const breath = 0.48 + 0.18 * Math.sin(seconds * 1.2);
  const mouthForm = clamp(profile.mouth + 0.1 * mouthEnergy + 0.03 * Math.sin(seconds * 0.7), -1, 1);

  return [
    parameter('ParamAngleX', headX, 0.68),
    parameter('ParamAngleY', headY, 0.66),
    parameter('ParamAngleZ', headZ, 0.62),
    parameter('ParamAngle_HeadX', headX, 0.86),
    parameter('ParamAngle_HeadY', headY, 0.84),
    parameter('ParamAngle_HeadZ', headZ, 0.82),
    parameter('ParamAngle_HeadZ2', headZ * 0.58, 0.62),
    parameter('ParamAngleModify_HeadX', headX * 0.18, 0.34),
    parameter('ParamAngleModify_HeadY', headY * 0.18, 0.34),
    parameter('ParamEyeBallX', eyeX, 0.76),
    parameter('ParamEyeBallY', eyeY, 0.74),
    parameter('ParamEyeLOpen', clamp(blink + winkOffset, 0, 1), 0.82),
    parameter('ParamEyeROpen', clamp(blink - winkOffset, 0, 1), 0.82),
    parameter('ParamBrowLY', clamp(profile.brow + browMicro, -1, 1), 0.52),
    parameter('ParamBrowRY', clamp(profile.brow + browMicro * 0.86, -1, 1), 0.52),
    parameter('ParamMouthForm', mouthForm, 0.54),
    parameter('ParamCheek', clamp(profile.cheek + mouthEnergy * 0.04, 0, 1), 0.38),
    parameter('ParamSwitchCtrl_BodyX', 1, 0.28),
    parameter('ParamSwitchCtrl_BodyY', 1, 0.28),
    parameter('ParamSwitchCtrl_BodyZ', 1, 0.28),
    parameter('ParamSwitchCtrl_ChestZ', 1, 0.24),
    parameter('ParamSwitchCtrl_HipZ', 1, 0.24),
    parameter('ParamBodyAngleX', bodyX * 0.42, 0.44),
    parameter('ParamBodyAngleY', bodyY * 0.38, 0.42),
    parameter('ParamBodyAngleZ', bodyZ * 0.42, 0.42),
    parameter('ParamBodyInput_BodyX', bodyX * 1.3, 0.34),
    parameter('ParamBodyInput_BodyY', bodyY * 1.25, 0.32),
    parameter('ParamBodyInput_BodyZ', bodyZ * 1.35, 0.34),
    parameter('ParamBodyInput_ChestZ', bodyZ * 0.95, 0.26),
    parameter('ParamBodyInput_HipZ', -bodyZ * 0.78, 0.24),
    parameter('ParamOutput_BodyX', bodyX * 1.05, 0.28),
    parameter('ParamOutput_BodyY', bodyY * 1.0, 0.26),
    parameter('ParamOutput_BodyZ', bodyZ * 1.05, 0.28),
    parameter('ParamOutput_ChestZ', bodyZ * 0.72, 0.22),
    parameter('ParamOutput_HipZ', -bodyZ * 0.62, 0.22),
    parameter('ParamAngle_BodyX', bodyX, 0.36),
    parameter('ParamAngle_BodyX2', bodyX * 0.72, 0.28),
    parameter('ParamAngle_BodyX3', bodyX * 0.46, 0.22),
    parameter('ParamAngle_BodyY', bodyY, 0.34),
    parameter('ParamAngle_BodyY2', bodyY * 0.72, 0.28),
    parameter('ParamAngle_BodyZ', bodyZ, 0.34),
    parameter('ParamAngle_BodyZ2', bodyZ * 0.68, 0.26),
    parameter('ParamAngle_ChestZ', bodyZ * 0.54, 0.22),
    parameter('ParamAngle_HipZ', -bodyZ * 0.46, 0.2),
    parameter('ParamAngle_ShoulderL', -bodyZ * 0.22, 0.18),
    parameter('ParamAngle_ShoulderR', bodyZ * 0.2, 0.18),
    parameter('ParamBreath', clamp(breath, 0, 1), 0.36),
    parameter('ParamBreath2', clamp(breath + 0.08 * Math.sin(seconds * 0.8), 0, 1), 0.32),
    parameter('ParamBreath3', clamp(breath - 0.06 * Math.sin(seconds * 0.72), 0, 1), 0.3),
    parameter('ParamHairFront', -headY * 0.34, 0.24),
    parameter('ParamHairSide', -headX * 0.34, 0.24),
    parameter('ParamHairBack', headZ * 0.28, 0.22)
  ];
}

export function mountLive2DFaceCaptureSimulator() {
  if (typeof window === 'undefined') return () => {};
  let frameId = 0;
  let lastDispatchAt = 0;
  let expression = 'neutral';
  let mouthEnergy = 0;
  let attention = 0;

  function onRoomAct(event) {
    const detail = event.detail || {};
    expression = pickExpressionFromAct(detail) || expression;
    attention = Math.max(attention, Number(detail.intensity) || 0.45);
  }

  function onMouth(event) {
    const value = Number(event.detail?.value);
    if (Number.isFinite(value)) mouthEnergy = clamp(value, 0, 1);
  }

  function tick(now = performance.now()) {
    if (now - lastDispatchAt >= 50) {
      const parameters = sampleLive2DFaceCapture(now, {
        expression,
        mouthEnergy,
        attention,
        scale: readFaceCaptureScale()
      });
      window.dispatchEvent(new CustomEvent(FACE_CAPTURE_EVENT, {
        detail: { parameters }
      }));
      lastDispatchAt = now;
      mouthEnergy *= 0.86;
      attention *= 0.94;
    }
    frameId = window.requestAnimationFrame(tick);
  }

  window.addEventListener(ROOM_ACT_EVENT, onRoomAct);
  window.addEventListener(MOUTH_EVENT, onMouth);
  frameId = window.requestAnimationFrame(tick);

  return () => {
    window.removeEventListener(ROOM_ACT_EVENT, onRoomAct);
    window.removeEventListener(MOUTH_EVENT, onMouth);
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
  };
}
