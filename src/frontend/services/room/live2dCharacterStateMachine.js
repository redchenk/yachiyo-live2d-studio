const EMOTION_PROFILES = {
  neutral: { smile: 0.56, brow: 0.54, eye: 0.92, arousal: 0.34 },
  smile: { smile: 0.68, brow: 0.58, eye: 0.9, arousal: 0.5 },
  happy: { smile: 0.7, brow: 0.6, eye: 0.9, arousal: 0.54 },
  bsmile: { smile: 0.72, brow: 0.62, eye: 0.86, arousal: 0.52 },
  shy: { smile: 0.68, brow: 0.64, eye: 0.84, arousal: 0.5 },
  sad: { smile: 0.34, brow: 0.34, eye: 0.82, arousal: 0.3 },
  namida: { smile: 0.32, brow: 0.32, eye: 0.8, arousal: 0.32 },
  tears: { smile: 0.28, brow: 0.28, eye: 0.76, arousal: 0.44 },
  crying: { smile: 0.28, brow: 0.28, eye: 0.76, arousal: 0.44 }
};

const MODE_PROFILES = {
  idle: { head: 1, body: 1, gaze: 1, smile: 0, brow: 0, arousal: 0 },
  listening: { head: 1.08, body: 1.04, gaze: 1.25, smile: 0.02, brow: 0.03, arousal: 0.08 },
  thinking: { head: 0.9, body: 0.86, gaze: 0.72, smile: -0.04, brow: 0.08, arousal: 0.12 },
  speaking: { head: 1.32, body: 1.36, gaze: 1.08, smile: 0.025, brow: 0.02, arousal: 0.12 },
  acting: { head: 1.28, body: 1.24, gaze: 1.16, smile: 0.02, brow: 0.04, arousal: 0.22 }
};

function clamp(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeEmotion(value) {
  const key = normalizeToken(value);
  const aliases = {
    joy: 'happy',
    cheerful: 'happy',
    playful: 'bsmile',
    smug: 'bsmile',
    blush: 'shy',
    embarrassed: 'shy',
    sorrow: 'sad',
    cry: 'crying'
  };
  return EMOTION_PROFILES[aliases[key] || key] ? (aliases[key] || key) : 'neutral';
}

function normalizeMode(value) {
  const key = normalizeToken(value);
  if (key === 'listen') return 'listening';
  if (key === 'speak') return 'speaking';
  if (MODE_PROFILES[key]) return key;
  return 'idle';
}

function isTearfulEmotion(emotion) {
  return ['sad', 'namida', 'tears', 'crying'].includes(normalizeEmotion(emotion));
}

function lerp(left, right, t) {
  return left + (right - left) * clamp(t, 0, 1);
}

function smoothNoise(seconds, a, b, c) {
  return (
    Math.sin(seconds * a) * 0.55 +
    Math.sin(seconds * b + 1.7) * 0.3 +
    Math.sin(seconds * c + 3.1) * 0.15
  );
}

function pickNextGazeTarget(state, now) {
  const seconds = now / 1000 + state.seed;
  const span = state.mode === 'thinking' ? 0.18 : 0.34;
  state.gazeX = clamp(smoothNoise(seconds, 0.43, 0.91, 1.37) * span, -0.55, 0.55);
  state.gazeY = clamp(-0.05 + smoothNoise(seconds, 0.32, 0.68, 1.11) * span * 0.58, -0.35, 0.28);
  state.nextGazeAt = now + 1600 + Math.random() * 2600;
}

function emotionFromDetail(detail = {}) {
  const mix = Array.isArray(detail.expressionMix) ? detail.expressionMix : [];
  const mixed = mix
    .map((item) => ({
      expression: item?.expression || item?.key || item?.id,
      weight: Number(item?.weight)
    }))
    .filter((item) => item.expression && Number.isFinite(item.weight))
    .sort((left, right) => right.weight - left.weight)[0]?.expression;
  const raw = mixed || detail.expression || detail.emotion || detail.mood || '';
  return raw ? normalizeEmotion(raw) : '';
}

export function createLive2DCharacterStateMachine() {
  const state = {
    mode: 'idle',
    previousMode: 'idle',
    emotion: 'neutral',
    modeSince: nowMs(),
    modeUntil: 0,
    lastActAt: 0,
    lastMouthAt: 0,
    mouthEnergy: 0,
    speechMotionEnergy: 0,
    attention: 0.36,
    arousal: 0.34,
    gazeX: 0,
    gazeY: 0,
    nextGazeAt: 0,
    seed: Math.random() * 1000
  };

  function setMode(mode, options = {}) {
    const at = Number(options.now) || nowMs();
    const nextMode = normalizeMode(mode);
    if (state.mode !== nextMode) {
      state.previousMode = state.mode;
      state.mode = nextMode;
      state.modeSince = at;
    }
    const holdMs = Number(options.holdMs);
    state.modeUntil = Number.isFinite(holdMs) && holdMs > 0 ? at + holdMs : 0;
    if (options.emotion) state.emotion = normalizeEmotion(options.emotion);
    state.attention = Math.max(state.attention, clamp(options.attention, 0, 1, 0));
    state.arousal = Math.max(state.arousal, clamp(options.arousal, 0, 1, 0));
  }

  function onRoomAct(detail = {}, at = nowMs()) {
    const durationMs = clamp(detail.durationMs || detail.duration, 800, 12000, 2600);
    const intensity = clamp(detail.intensity, 0, 1, 0.66);
    state.lastActAt = at;
    setMode('acting', {
      now: at,
      holdMs: durationMs + 450,
      emotion: emotionFromDetail(detail),
      attention: 0.58 + intensity * 0.36,
      arousal: 0.48 + intensity * 0.34
    });
  }

  function onMouth(value, at = nowMs()) {
    const mouth = clamp(value, 0, 1, 0);
    state.mouthEnergy = Math.max(state.mouthEnergy, mouth);
    state.speechMotionEnergy = Math.max(state.speechMotionEnergy * 0.9 + mouth * 0.1, mouth * 0.95);
    if (mouth > 0.025) {
      state.lastMouthAt = at;
      setMode('speaking', {
        now: at,
        holdMs: 850,
        attention: 0.72,
        arousal: 0.58 + mouth * 0.22
      });
    }
  }

  function onExternalState(detail = {}, at = nowMs()) {
    setMode(detail.mode || detail.status || 'idle', {
      now: at,
      holdMs: detail.holdMs,
      emotion: detail.emotion,
      attention: detail.attention,
      arousal: detail.arousal
    });
  }

  function update(at) {
    if (state.modeUntil && at > state.modeUntil && state.mode !== 'idle') {
      if (state.mode !== 'speaking' || at - state.lastMouthAt > 720) {
        state.previousMode = state.mode;
        state.mode = state.attention > 0.48 ? 'listening' : 'idle';
        state.modeSince = at;
        state.modeUntil = 0;
      }
    }
    if (state.mode === 'speaking' && at - state.lastMouthAt > 820) {
      state.previousMode = state.mode;
      state.mode = 'listening';
      state.modeSince = at;
    }
    if (at >= state.nextGazeAt) pickNextGazeTarget(state, at);

    state.mouthEnergy *= 0.86;
    state.speechMotionEnergy *= state.mode === 'speaking' ? 0.965 : 0.9;
    state.attention = lerp(state.attention, state.mode === 'idle' ? 0.34 : 0.56, 0.018);
    state.arousal = lerp(state.arousal, EMOTION_PROFILES[state.emotion]?.arousal ?? 0.34, 0.014);
  }

  function sample(at = nowMs()) {
    update(at);
    const seconds = at / 1000 + state.seed;
    const modeProfile = MODE_PROFILES[state.mode] || MODE_PROFILES.idle;
    const emotionProfile = EMOTION_PROFILES[state.emotion] || EMOTION_PROFILES.neutral;
    const modeAge = Math.max(0, at - state.modeSince);
    const transition = clamp(modeAge / 520, 0, 1);
    const breath = Math.sin(seconds * (1.08 + state.arousal * 0.18));
    const headDrift = smoothNoise(seconds, 0.42, 0.77, 1.26);
    const bodyDrift = smoothNoise(seconds + 2.4, 0.31, 0.58, 0.96);
    const speechMotionEnergy = state.mode === 'speaking' ? state.speechMotionEnergy : state.speechMotionEnergy * 0.35;
    const speechPulse = speechMotionEnergy * Math.sin(seconds * 2.35);
    const speechSway = speechMotionEnergy * Math.sin(seconds * 1.55);
    const speechCounterSway = speechMotionEnergy * Math.sin(seconds * 1.55 + 0.72);
    const thinkingNod = state.mode === 'thinking' ? Math.sin(seconds * 1.9) * 0.7 : 0;
    const actingLift = state.mode === 'acting' ? Math.sin(seconds * 2.4) * 0.7 : 0;
    const headScale = modeProfile.head * (0.78 + state.attention * 0.34 + state.arousal * 0.2);
    const bodyScale = modeProfile.body * (0.82 + state.arousal * 0.28);
    const gazeScale = modeProfile.gaze * (0.7 + state.attention * 0.44);
    const speechEnergy = state.mode === 'speaking' ? state.mouthEnergy : state.mouthEnergy * 0.45;
    const speechEyeSmile = speechEnergy * 0.085 + Math.max(speechPulse, 0) * 0.025;
    const mouthBase = emotionProfile.smile + modeProfile.smile;
    const mouthTarget = isTearfulEmotion(state.emotion) ? 0.42 : 0.64;
    const mouthSmile = clamp(
      lerp(mouthBase, Math.max(mouthBase, mouthTarget), speechEnergy * 0.38) + Math.max(speechPulse, 0) * 0.025,
      0.18,
      0.84
    );
    const browBase = emotionProfile.brow + modeProfile.brow;
    const softBrow = clamp(lerp(browBase, 0.55, speechEnergy * 0.34), 0.18, 0.82);

    return {
      mode: state.mode,
      emotion: state.emotion,
      transition,
      eyeOpen: clamp(emotionProfile.eye - speechEyeSmile, 0.66, 1),
      eyeX: clamp(state.gazeX * gazeScale - headDrift * 0.07, -0.72, 0.72),
      eyeY: clamp(state.gazeY * gazeScale - 0.02 - thinkingNod * 0.04 - speechPulse * 0.035, -0.48, 0.42),
      faceX: (headDrift * 4.2 + speechSway * 13.5) * headScale,
      faceY: (-0.8 + breath * 1.2 + speechPulse * 3.6 + thinkingNod + actingLift) * headScale,
      faceZ: (smoothNoise(seconds + 0.9, 0.36, 0.66, 1.05) * 3.6 + speechCounterSway * 10.5) * headScale,
      facePosX: (bodyDrift * 1.1 + speechSway * 2.6) * bodyScale,
      facePosY: (-0.38 * breath - state.mouthEnergy * 0.42 - speechPulse * 0.38) * modeProfile.body,
      mouthSmile,
      brows: softBrow,
      browLeftY: clamp(softBrow + smoothNoise(seconds, 0.83, 1.41, 2.2) * 0.024, 0.18, 0.84),
      browRightY: clamp(softBrow + smoothNoise(seconds + 0.6, 0.79, 1.33, 2.08) * 0.024, 0.18, 0.84),
      bodyX: (bodyDrift * 1.4 + speechSway * 5.8) * bodyScale,
      bodyY: (breath * 0.96 + speechPulse * 2.2 + thinkingNod * 0.24) * bodyScale,
      bodyZ: (smoothNoise(seconds + 1.8, 0.28, 0.51, 0.88) * 2.4 + speechCounterSway * 6.8) * bodyScale,
      bodyPosX: (bodyDrift * 0.06 + speechSway * 0.22) * bodyScale,
      bodyPosY: (breath * 0.035 + speechPulse * 0.11) * bodyScale,
      energy: clamp(state.arousal + state.mouthEnergy * 0.3, 0, 1)
    };
  }

  return {
    sample,
    setMode,
    onRoomAct,
    onMouth,
    onExternalState,
    getState: () => ({ ...state })
  };
}
