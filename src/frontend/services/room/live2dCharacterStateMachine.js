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
  speaking: { head: 1.36, body: 1.32, gaze: 1.15, smile: 0.025, brow: 0.02, arousal: 0.18 },
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

function smoothStep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function springStep(value) {
  const t = clamp(value, 0, 1);
  return clamp(smoothStep(t) + Math.sin(Math.PI * t) * 0.08, 0, 1);
}

function speakingMotionValue(state, at, lagMs = 0) {
  const duration = Math.max(Number(state.motionDurationMs) || 4200, 1);
  const progress = clamp(((Number(at) || 0) - lagMs - state.motionStartedAt) / duration, 0, 1);
  return lerp(state.motionFrom, state.motionTo, springStep(progress));
}

function startSpeakingMotionSegment(state, at, target = null, durationMs = 0) {
  const current = speakingMotionValue(state, at);
  const targetValue = target === null
    ? (Math.abs(current) > 0.18 && Math.random() < 0.32 ? 0 : (Math.random() - 0.5) * 2.6)
    : target;
  state.motionFrom = current;
  state.motionTo = targetValue;
  state.motionStartedAt = at;
  state.motionDurationMs = durationMs || (720 + Math.random() * 760);
  state.motionHoldMs = Math.abs(targetValue) < 0.04
    ? 240 + Math.random() * 520
    : 160 + Math.random() * 460;
}

function startSpeakingGesture(state, at) {
  const nod = Math.random() < 0.58;
  state.gestureType = nod ? 'nod' : 'tilt';
  state.gestureStartedAt = at;
  state.gestureDurationMs = nod
    ? 620 + Math.random() * 520
    : 780 + Math.random() * 620;
  state.gestureAmount = nod
    ? 1.2 + Math.random() * 0.9
    : 0.95 + Math.random() * 0.82;
  state.gestureSide = Math.random() > 0.5 ? 1 : -1;
  state.nextGestureAt = at + state.gestureDurationMs + 420 + Math.random() * 980;
}

function startIdleGesture(state, at) {
  const nod = Math.random() < 0.44;
  state.gestureType = nod ? 'nod' : 'tilt';
  state.gestureStartedAt = at;
  state.gestureDurationMs = nod
    ? 1500 + Math.random() * 900
    : 1900 + Math.random() * 1100;
  state.gestureAmount = nod
    ? 1.0 + Math.random() * 0.7
    : 0.9 + Math.random() * 0.65;
  state.gestureSide = Math.random() > 0.5 ? 1 : -1;
  state.nextGestureAt = at + state.gestureDurationMs + 260 + Math.random() * 820;
}

function speakingGestureValue(state, at) {
  if (!state.gestureStartedAt || state.gestureType === 'none') return { nod: 0, tilt: 0 };
  const progress = clamp((at - state.gestureStartedAt) / Math.max(state.gestureDurationMs, 1), 0, 1);
  const envelope = Math.sin(Math.PI * progress);
  if (progress >= 1) return { nod: 0, tilt: 0 };
  if (state.gestureType === 'nod') return { nod: state.gestureAmount * envelope, tilt: 0 };
  return { nod: 0, tilt: state.gestureSide * state.gestureAmount * envelope };
}

function pickNextGazeTarget(state, now) {
  const seconds = now / 1000 + state.seed;
  const active = state.mode === 'speaking' || state.mode === 'acting';
  const sideGlance = active && Math.random() < 0.36;
  const span = state.mode === 'thinking' ? 0.18 : (active ? 0.52 : 0.34);
  state.gazeX = sideGlance
    ? (Math.random() > 0.5 ? 1 : -1) * (0.34 + Math.random() * 0.2)
    : clamp(smoothNoise(seconds, 0.43, 0.91, 1.37) * span, -0.62, 0.62);
  state.gazeY = clamp(-0.04 + smoothNoise(seconds, 0.32, 0.68, 1.11) * span * 0.68, -0.38, 0.34);
  state.nextGazeAt = now + (active ? 850 + Math.random() * 1700 : 1600 + Math.random() * 2600);
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
    motionStartedAt: 0,
    motionDurationMs: 4200,
    motionHoldMs: 1200,
    motionFrom: 0,
    motionTo: 0,
    nextGestureAt: 0,
    gestureType: 'none',
    gestureStartedAt: 0,
    gestureDurationMs: 0,
    gestureAmount: 0,
    gestureSide: 1,
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
    const mouthBlend = mouth > state.mouthEnergy ? 0.34 : 0.12;
    state.mouthEnergy = clamp(lerp(state.mouthEnergy, mouth, mouthBlend), 0, 1);
    state.speechMotionEnergy = clamp(lerp(state.speechMotionEnergy, mouth, 0.12), 0, 1);
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
    if (state.gestureStartedAt && at >= state.gestureStartedAt + state.gestureDurationMs) {
      state.gestureType = 'none';
      state.gestureStartedAt = 0;
    }
    if (state.mode === 'speaking') {
      if (!state.motionStartedAt || at >= state.motionStartedAt + state.motionDurationMs + state.motionHoldMs) {
        startSpeakingMotionSegment(state, at);
      }
      if (!state.nextGestureAt) state.nextGestureAt = at + 260 + Math.random() * 760;
      if (at >= state.nextGestureAt && !state.gestureStartedAt) startSpeakingGesture(state, at);
    } else {
      if (Math.abs(state.motionTo) > 0.01 && at >= state.motionStartedAt + state.motionDurationMs) {
        startSpeakingMotionSegment(state, at, 0, 1800);
      }
      if (['idle', 'listening'].includes(state.mode)) {
        if (!state.nextGestureAt) state.nextGestureAt = at + 280 + Math.random() * 720;
        if (at >= state.nextGestureAt && !state.gestureStartedAt) startIdleGesture(state, at);
      } else {
        state.nextGestureAt = 0;
        state.gestureType = 'none';
        state.gestureStartedAt = 0;
      }
    }

    state.mouthEnergy *= 0.9;
    state.speechMotionEnergy *= state.mode === 'speaking' ? 0.985 : 0.9;
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
    const isSpeaking = state.mode === 'speaking';
    const breath = Math.sin(seconds * (isSpeaking ? 1.28 + state.arousal * 0.18 : 0.68 + state.arousal * 0.08));
    const slowFloat = Math.sin(seconds * (isSpeaking ? 1.35 : 0.34) + state.seed * 0.13);
    const bodyFloat = Math.sin(seconds * (isSpeaking ? 1.08 : 0.28) + 1.4 + state.seed * 0.09);
    const livelyFloat = isSpeaking ? Math.sin(seconds * 1.9 + 0.7 + state.seed * 0.07) : 0;
    const breathMotion = isSpeaking ? breath * 1.05 : breath;
    const speakingDriftScale = isSpeaking ? 0.08 : 1;
    const headDrift = smoothNoise(seconds, 0.42, 0.77, 1.26) * speakingDriftScale;
    const bodyDrift = smoothNoise(seconds + 2.4, 0.31, 0.58, 0.96) * speakingDriftScale;
    const speechMotionEnergy = isSpeaking ? state.speechMotionEnergy : state.speechMotionEnergy * 0.35;
    const motionEnergy = isSpeaking
      ? clamp(0.78 + speechMotionEnergy * 0.7, 0, 1.34)
      : clamp(speechMotionEnergy * 0.7, 0, 0.5);
    const forwardLean = isSpeaking ? 1 : 0;
    const headMotion = speakingMotionValue(state, at, 0);
    const bodyMotion = speakingMotionValue(state, at, 420);
    const gesture = speakingGestureValue(state, at);
    const gestureStrength = isSpeaking ? motionEnergy : (state.gestureStartedAt ? 1 : 0);
    const speechNod = gesture.nod * gestureStrength;
    const speechTilt = gesture.tilt * gestureStrength;
    const speechSway = motionEnergy * headMotion;
    const speechCounterSway = motionEnergy * bodyMotion;
    const speechHeadRoll = motionEnergy * (headMotion * 0.24 + bodyMotion * 0.12) + speechTilt;
    const thinkingNod = state.mode === 'thinking' ? Math.sin(seconds * 1.9) * 0.7 : 0;
    const actingLift = state.mode === 'acting' ? Math.sin(seconds * 2.4) * 0.7 : 0;
    const headScale = modeProfile.head * (0.78 + state.attention * 0.34 + state.arousal * 0.2);
    const bodyScale = modeProfile.body * (0.82 + state.arousal * 0.28);
    const gazeScale = modeProfile.gaze * (0.7 + state.attention * 0.44);
    const speechEnergy = isSpeaking
      ? clamp(state.speechMotionEnergy * 0.72 + state.mouthEnergy * 0.28, 0, 1)
      : state.mouthEnergy * 0.45;
    const speechEyeSmile = speechEnergy * 0.06 + Math.max(speechNod, 0) * 0.015;
    const mouthBase = emotionProfile.smile + modeProfile.smile;
    const mouthTarget = isTearfulEmotion(state.emotion) ? 0.42 : 0.64;
    const mouthSmile = clamp(
      lerp(mouthBase, Math.max(mouthBase, mouthTarget), speechEnergy * 0.38),
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
      eyeY: clamp(state.gazeY * gazeScale - 0.02 - thinkingNod * 0.04 - speechNod * 0.018, -0.48, 0.42),
      faceX: (headDrift * 2.8 + speechSway * 13.2) * headScale,
      faceY: (
        isSpeaking
          ? -0.8 - forwardLean * 5.2 + breathMotion * 1.35 + slowFloat * 1.25 + livelyFloat * 0.82 - speechNod * 12 + thinkingNod + actingLift
          : -0.8 + breathMotion * 0.68 + slowFloat * 0.62 + speechNod * 6 + thinkingNod + actingLift
      ) * headScale,
      faceZ: (
        smoothNoise(seconds + 0.9, 0.36, 0.66, 1.05) * 1.1 * speakingDriftScale +
        speechHeadRoll * 14.2
      ) * headScale,
      facePosX: (bodyDrift * 0.52 + speechSway * 4.4) * bodyScale,
      facePosY: (
        isSpeaking
          ? -0.3 * breathMotion + slowFloat * 0.42 + livelyFloat * 0.24 - speechNod * 0.86
          : -0.15 * breathMotion + slowFloat * 0.2 - speechNod * 0.43
      ) * modeProfile.body,
      mouthSmile: clamp(mouthSmile + Math.max(speechNod, 0) * 0.018, 0.18, 0.84),
      brows: softBrow,
      browLeftY: clamp(softBrow + smoothNoise(seconds, 0.83, 1.41, 2.2) * 0.024, 0.18, 0.84),
      browRightY: clamp(softBrow + smoothNoise(seconds + 0.6, 0.79, 1.33, 2.08) * 0.024, 0.18, 0.84),
      bodyX: (bodyDrift * 0.72 + speechCounterSway * 7.2) * bodyScale,
      bodyY: (
        isSpeaking
          ? -forwardLean * 7.2 + breathMotion * 3.0 + bodyFloat * 3.2 + livelyFloat * 1.45 - speechNod * 7.4 + thinkingNod * 0.24
          : breathMotion * 1.5 + bodyFloat * 1.6 + speechNod * 4.2 + thinkingNod * 0.24
      ) * bodyScale,
      bodyZ: (
        smoothNoise(seconds + 1.8, 0.28, 0.51, 0.88) * 0.95 * speakingDriftScale +
        speechCounterSway * 8.2 +
        speechTilt * 9.4
      ) * bodyScale,
      bodyPosX: (bodyDrift * 0.022 + speechCounterSway * 0.06) * bodyScale,
      bodyPosY: (
        isSpeaking
          ? breathMotion * 0.025 + bodyFloat * 0.045 + livelyFloat * 0.025 + speechNod * 0.07
          : breathMotion * 0.012 + bodyFloat * 0.022 + speechNod * 0.035
      ) * bodyScale,
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
