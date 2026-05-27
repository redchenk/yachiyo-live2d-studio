const ACTION_ALIASES = {
  look: 'look_at_chat',
  look_at_user: 'look_at_chat',
  look_at_viewer: 'look_at_chat',
  glance: 'look_at_chat',
  eye_contact: 'look_at_chat',
  看弹幕: 'look_at_chat',
  看觀眾: 'look_at_chat',
  看观众: 'look_at_chat',
  看向观众: 'look_at_chat',
  smirk: 'smirk',
  smug: 'smirk',
  grin: 'smirk',
  坏笑: 'smirk',
  壞笑: 'smirk',
  得意笑: 'smirk',
  smile: 'smile',
  微笑: 'smile',
  笑: 'smile',
  blink: 'blink',
  眨眼: 'blink',
  wink: 'wink',
  抛媚眼: 'wink',
  眨单眼: 'wink',
  nod: 'nod',
  agree: 'nod',
  点头: 'nod',
  點頭: 'nod',
  颔首: 'nod',
  頷首: 'nod',
  うなずく: 'nod',
  頷く: 'nod',
  shake: 'shake_head',
  shake_head: 'shake_head',
  no: 'shake_head',
  摇头: 'shake_head',
  搖頭: 'shake_head',
  摆头: 'shake_head',
  擺頭: 'shake_head',
  首を振る: 'shake_head',
  head_tilt: 'head_tilt',
  tilt: 'head_tilt',
  歪头: 'head_tilt',
  歪頭: 'head_tilt',
  侧头: 'head_tilt',
  側頭: 'head_tilt',
  lean: 'lean_in',
  lean_in: 'lean_in',
  靠近: 'lean_in',
  凑近: 'lean_in',
  湊近: 'lean_in',
  前倾: 'lean_in',
  前傾: 'lean_in',
  近づく: 'lean_in',
  lean_left: 'lean_left',
  左倾: 'lean_left',
  左傾: 'lean_left',
  向左: 'lean_left',
  lean_right: 'lean_right',
  右倾: 'lean_right',
  右傾: 'lean_right',
  向右: 'lean_right',
  sway: 'sway',
  摇摆: 'sway',
  搖擺: 'sway',
  晃动: 'sway',
  晃動: 'sway',
  揺れる: 'sway',
  bounce: 'bounce',
  弹跳: 'bounce',
  彈跳: 'bounce',
  蹦: 'bounce',
  跳: 'bounce',
  shiver: 'shiver',
  tremble: 'shiver',
  发抖: 'shiver',
  發抖: 'shiver',
  颤抖: 'shiver',
  顫抖: 'shiver',
  emphasis: 'emphasis',
  hit: 'emphasis',
  强调: 'emphasis',
  強調: 'emphasis',
  重音: 'emphasis',
  surprised: 'surprised',
  surprise: 'surprised',
  惊讶: 'surprised',
  驚訝: 'surprised',
  breathe: 'breathe',
  idle: 'breathe',
  呼吸: 'breathe',
  reset: 'reset',
  重置: 'reset'
};

const EMOTION_EXPRESSIONS = {
  happy: 'smile',
  joy: 'smile',
  cheerful: 'smile',
  smile: 'smile',
  开心: 'smile',
  開心: 'smile',
  高兴: 'smile',
  高興: 'smile',
  微笑: 'smile',
  smug: 'bsmile',
  shy: 'bsmile',
  blush: 'bsmile',
  embarrassed: 'bsmile',
  playful: 'bsmile',
  害羞: 'bsmile',
  脸红: 'bsmile',
  臉紅: 'bsmile',
  调皮: 'bsmile',
  調皮: 'bsmile',
  angry: 'bsmile',
  annoyed: 'bsmile',
  surprised: 'bsmile',
  surprise: 'bsmile',
  惊讶: 'bsmile',
  驚訝: 'bsmile',
  sad: 'namida',
  sorrow: 'namida',
  难过: 'namida',
  難過: 'namida',
  悲伤: 'namida',
  悲傷: 'namida',
  crying: 'tears',
  tears: 'tears',
  哭: 'tears',
  哭泣: 'tears',
  neutral: 'neutral',
  calm: 'neutral'
};

const BODY_POSE_BY_ACTION = {
  nod: 'nod',
  shake_head: 'shake_head',
  lean_in: 'lean_in',
  lean_left: 'lean_left',
  lean_right: 'lean_right',
  sway: 'sway',
  bounce: 'bounce',
  shiver: 'sway',
  emphasis: 'emphasis'
};

function clamp(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeSide(value, fallback = '') {
  const side = normalizeToken(value);
  if (['left', 'l', '左', '左边', '左側'].includes(side)) return 'left';
  if (['right', 'r', '右', '右边', '右側'].includes(side)) return 'right';
  if (['up', 'u', '上'].includes(side)) return 'up';
  if (['down', 'd', '下'].includes(side)) return 'down';
  return fallback;
}

function normalizeActionType(value) {
  const key = normalizeToken(value);
  return ACTION_ALIASES[key] || key;
}

function normalizeActionInput(action) {
  if (typeof action === 'string') return { type: action };
  if (!action || typeof action !== 'object') return null;
  return {
    ...action,
    type: action.type || action.action || action.name || action.motion
  };
}

export function normalizeBehaviorActions(actions = [], options = {}) {
  const source = Array.isArray(actions) ? actions : [];
  const baseIntensity = clamp(options.intensity, 0, 1, 0.72);
  const normalized = [];
  let runningOffsetMs = 0;

  for (const rawAction of source) {
    const action = normalizeActionInput(rawAction);
    const type = normalizeActionType(action?.type);
    if (!type || !ACTION_ALIASES[type] && !Object.values(ACTION_ALIASES).includes(type)) continue;

    const durationSeconds = Number(action.duration ?? action.seconds);
    const durationMs = clamp(
      action.durationMs ?? (Number.isFinite(durationSeconds) ? durationSeconds * 1000 : undefined),
      260,
      5200,
      type === 'blink' ? 360 : 1200
    );
    const delaySeconds = Number(action.delay ?? action.offset);
    const delayMs = clamp(
      action.delayMs ?? action.offsetMs ?? (Number.isFinite(delaySeconds) ? delaySeconds * 1000 : undefined),
      0,
      12000,
      runningOffsetMs
    );

    normalized.push({
      type,
      side: normalizeSide(action.side || action.direction, type === 'head_tilt' ? 'right' : ''),
      target: String(action.target || action.to || '').trim(),
      intensity: clamp(action.intensity ?? action.strength ?? baseIntensity, 0.05, 1, baseIntensity),
      durationMs,
      delayMs,
      style: normalizeToken(action.style || options.style || ''),
      source: action
    });

    if (action.delayMs === undefined && action.offsetMs === undefined && action.delay === undefined && action.offset === undefined) {
      runningOffsetMs += Math.round(durationMs * 0.72);
    }
  }

  return normalized.slice(0, 8);
}

export function behaviorExpressionFromEmotion(emotion) {
  const key = normalizeToken(emotion);
  return EMOTION_EXPRESSIONS[key] || (key ? EMOTION_EXPRESSIONS.neutral : '');
}

function parameter(id, value, weight = 0.7, durationMs = 900, delayMs = 0) {
  return { id, value, weight, durationMs, delayMs };
}

function sideSign(side, fallback = 1) {
  if (side === 'left') return -1;
  if (side === 'right') return 1;
  return fallback;
}

function parametersForAction(action) {
  const sign = sideSign(action.side);
  const amount = action.intensity;
  switch (action.type) {
    case 'look_at_chat':
      return [
        parameter('ParamAngle_HeadX', 3.6 * amount, 0.5, action.durationMs, action.delayMs),
        parameter('ParamAngle_HeadY', -1.4 * amount, 0.42, action.durationMs, action.delayMs),
        parameter('ParamEyeBallX', -0.14 * amount, 0.72, action.durationMs, action.delayMs),
        parameter('ParamEyeBallY', -0.1 * amount, 0.62, action.durationMs, action.delayMs)
      ];
    case 'smirk':
    case 'smile':
      return [
        parameter('ParamMouthForm', action.type === 'smirk' ? 0.7 : 0.48, 0.78, action.durationMs, action.delayMs),
        parameter('ParamBrowLY', action.type === 'smirk' ? 0.18 : 0.08, 0.46, action.durationMs, action.delayMs),
        parameter('ParamBrowRY', action.type === 'smirk' ? 0.08 : 0.08, 0.42, action.durationMs, action.delayMs),
        parameter('ParamCheek', action.type === 'smirk' ? 0.16 : 0.1, 0.36, action.durationMs, action.delayMs)
      ];
    case 'head_tilt':
      return [
        parameter('ParamAngle_HeadZ', sign * 9 * amount, 0.82, action.durationMs, action.delayMs),
        parameter('ParamAngle_HeadZ2', sign * 5 * amount, 0.48, action.durationMs, action.delayMs),
        parameter('ParamAngle_BodyZ', sign * 4.5 * amount, 0.44, action.durationMs, action.delayMs)
      ];
    case 'surprised':
      return [
        parameter('ParamEyeLOpen', 1, 0.86, action.durationMs, action.delayMs),
        parameter('ParamEyeROpen', 1, 0.86, action.durationMs, action.delayMs),
        parameter('ParamMouthOpenY', 0.28, 0.38, action.durationMs, action.delayMs),
        parameter('ParamBrowLY', 0.34, 0.64, action.durationMs, action.delayMs),
        parameter('ParamBrowRY', 0.34, 0.64, action.durationMs, action.delayMs)
      ];
    case 'wink':
      return [parameter(action.side === 'left' ? 'ParamEyeLOpen' : 'ParamEyeROpen', 0.05, 0.82, action.durationMs, action.delayMs)];
    case 'blink':
      return [
        parameter('ParamEyeLOpen', 0.04, 0.82, action.durationMs, action.delayMs),
        parameter('ParamEyeROpen', 0.04, 0.82, action.durationMs, action.delayMs)
      ];
    default:
      return [];
  }
}

export function compileBehaviorIntent(payload = {}) {
  const actions = normalizeBehaviorActions(payload.actions || payload.behaviorActions || [], {
    intensity: payload.intensity,
    style: payload.speech_style?.pause || payload.speechStyle?.pause
  });
  const expression = behaviorExpressionFromEmotion(payload.emotion || payload.mood) || undefined;
  const parameters = actions.flatMap(parametersForAction);
  const bodyAction = actions.find((action) => BODY_POSE_BY_ACTION[action.type]);
  const durationMs = Math.max(
    1200,
    ...actions.map((action) => action.delayMs + action.durationMs),
    Number(payload.durationMs) || 0
  );

  if (!actions.length && !expression) return null;

  return {
    emotion: payload.emotion || null,
    expression: expression || null,
    expressionMix: expression ? [{ expression, weight: 1 }] : [],
    bodyPose: bodyAction ? BODY_POSE_BY_ACTION[bodyAction.type] : null,
    intensity: clamp(payload.intensity, 0.05, 1, 0.72),
    durationMs,
    parameters,
    behaviorActions: actions,
    speechStyle: payload.speech_style || payload.speechStyle || null
  };
}

export function semanticActionPromptCatalog() {
  return [
    'Semantic action ids for the actions array:',
    '- look_at_chat: re-establish eye contact with the audience',
    '- smirk: smug or teasing smile',
    '- smile: warm smile',
    '- blink: natural blink',
    '- wink: playful one-eye wink, side left/right',
    '- nod: agreement or acknowledgement',
    '- shake_head: playful refusal or disbelief',
    '- head_tilt: tilt head, side left/right',
    '- lean_in: move closer for focus or teasing',
    '- lean_left / lean_right: side lean',
    '- sway: relaxed idle streamer motion',
    '- bounce: excited vertical accent',
    '- shiver: small embarrassed or excited tremble',
    '- surprised: widened eyes and small mouth opening',
    '- emphasis: punchline/body accent',
    '- breathe: calm idle breath'
  ].join('\n');
}
