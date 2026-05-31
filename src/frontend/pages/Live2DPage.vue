<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import TsIcon from '../components/TsIcon.vue';
import { useLive2D } from '../composables/room/useLive2D';
import {
  clearLive2DLLMHistory,
  requestLive2DControl,
  requestLive2DControlStream,
  translateLive2DReplyToChinese
} from '../services/room/live2dLlmControl';
import { dispatchRoomLive2D } from '../services/room/live2dControl';
import {
  alignLive2DIntentToStreamingSpeech,
  createLive2DStreamingSpeechSession,
  streamingSpeechHoldMs
} from '../services/room/live2dStreamingSpeechSession';
import {
  ROOM_LIVE2D_DEBUG_EVENT,
  readRoomLive2DDebugState
} from '../services/room/live2dDebug';
import { createLive2DAsrRecorder } from '../services/room/live2dAsr';
import { executeLive2DMusicCommand } from '../services/room/live2dMusic';
import { createLive2DSpeechPlayer } from '../services/room/live2dSpeech';
import { cleanLive2DReply } from '../services/room/live2dText';
import {
  behaviorActionComboPrompt,
  behaviorBodyActionButtons
} from '../constants/room/behaviorActionRegistry';

const live2d = useLive2D();
const booted = ref(false);
const prompt = ref('Say hello to the audience and choose a bright expression.');
const liveTopic = ref('late-night AI VTuber test stream');
const audienceInput = ref('');
const audienceQueue = ref([]);
const showLog = ref([]);
const messagesExpanded = ref(false);
const activeMotionTab = ref('expression');
const muted = ref(false);
const modelHidden = ref(false);
const modelLocked = ref(false);
const micGain = ref(70);
const modelContainerRef = ref(null);
const modelViewport = reactive({
  x: 0,
  y: 0,
  scale: 1,
  dragging: false
});
const llmState = ref({
  loading: false,
  error: '',
  reply: '',
  raw: null,
  live2d: null
});
const liveDirector = reactive({
  running: false,
  status: 'idle',
  error: '',
  turn: 0,
  autoVoice: true
});
const speechState = ref({
  status: 'idle',
  error: ''
});
const asrState = ref({
  status: 'idle',
  error: '',
  text: ''
});
const debugPanelOpen = ref(
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('roomLive2DDebugPanelOpen') === 'true'
    : false
);
const live2dDebug = ref(readRoomLive2DDebugState());

const MODEL_VIEWPORT_STORAGE_KEY = 'yachiyo:live2d:modelViewport';
const MODEL_VIEWPORT_LIMITS = Object.freeze({
  minScale: 0.55,
  maxScale: 2.4,
  maxX: 900,
  maxY: 680
});

let liveTimer = 0;
let liveTurnInFlight = false;
let speechPlayer = null;
let streamingSpeechSession = null;
let asrRecorder = null;
let modelDragState = null;
const CHARACTER_STATE_EVENT = 'tsukuyomi:live2d-character-state';
const SETTINGS_SAVED_EVENT = 'tsukuyomi:studio-settings-saved';

const debugEmotion = computed(() => (
  live2dDebug.value.emotion ||
  live2dDebug.value.current?.emotion ||
  live2dDebug.value.current?.expression ||
  'neutral'
));

const debugMouthEnergy = computed(() => Number(live2dDebug.value.mouthEnergy || 0).toFixed(3));

const debugActionQueue = computed(() => {
  const planActions = live2dDebug.value.actionQueue || live2dDebug.value.behaviorPlan?.actions || [];
  if (Array.isArray(planActions) && planActions.length) return planActions.slice(0, 8);
  const sequence = live2dDebug.value.normalized?.sequence || [];
  return Array.isArray(sequence)
    ? sequence.map((step) => ({
        type: step.bodyPose || step.motion || step.expression || 'act',
        intensity: step.intensity,
        delayMs: step.delayMs,
        durationMs: step.durationMs
      })).slice(0, 8)
    : [];
});

const debugVTSParameters = computed(() => (live2dDebug.value.vtsParameters || []).slice(0, 18));
const debugCubismParameters = computed(() => (live2dDebug.value.cubismParameters || []).slice(0, 12));
const debugExpressionFiles = computed(() => live2dDebug.value.expressionFiles || {});
const debugEvents = computed(() => (live2dDebug.value.behaviorEvents || live2dDebug.value.history || []).slice(0, 10));
const debugBehaviorPlanText = computed(() => formatDebugObject(live2dDebug.value.behaviorPlan || null));
const debugInterruptPolicyText = computed(() => formatDebugObject(live2dDebug.value.interruptPolicy || null));

const debugUpdatedLabel = computed(() => formatDebugTime(live2dDebug.value.updatedAt));
const displayedChat = computed(() => showLog.value.slice(-4));
const micBars = computed(() => Array.from({ length: 14 }, (_, index) => index < Math.round(Number(micGain.value || 0) / 8)));

function formatDebugObject(value) {
  if (!value) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

function formatDebugTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '--:--:--';
  return new Date(numeric).toLocaleTimeString();
}

function formatDebugNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(Math.abs(numeric) >= 10 ? 1 : 3) : String(value || 0);
}

function debugActionLabel(action) {
  return action?.type || action?.action || action?.bodyPose || action?.expression || 'act';
}

function debugActionMeta(action) {
  const parts = [];
  if (Number.isFinite(Number(action?.intensity))) parts.push(`i ${formatDebugNumber(action.intensity)}`);
  if (Number.isFinite(Number(action?.delayMs)) && Number(action.delayMs) > 0) parts.push(`+${Math.round(action.delayMs)}ms`);
  if (Number.isFinite(Number(action?.durationMs)) && Number(action.durationMs) > 0) parts.push(`${Math.round(action.durationMs)}ms`);
  return parts.join(' / ') || 'ready';
}

function debugEventLabel(event) {
  const bits = [event.type, event.emotion, event.action].filter(Boolean);
  return bits.join(' / ') || 'event';
}

function toggleLive2DDebugPanel() {
  debugPanelOpen.value = !debugPanelOpen.value;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('roomLive2DDebugPanelOpen', debugPanelOpen.value ? 'true' : 'false');
  }
}

function clampModelViewportNumber(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeModelViewport(value = {}) {
  return {
    x: clampModelViewportNumber(value.x, -MODEL_VIEWPORT_LIMITS.maxX, MODEL_VIEWPORT_LIMITS.maxX),
    y: clampModelViewportNumber(value.y, -MODEL_VIEWPORT_LIMITS.maxY, MODEL_VIEWPORT_LIMITS.maxY),
    scale: clampModelViewportNumber(
      value.scale,
      MODEL_VIEWPORT_LIMITS.minScale,
      MODEL_VIEWPORT_LIMITS.maxScale,
      1
    )
  };
}

function saveModelViewport() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(MODEL_VIEWPORT_STORAGE_KEY, JSON.stringify({
    x: Math.round(modelViewport.x),
    y: Math.round(modelViewport.y),
    scale: Number(modelViewport.scale.toFixed(3))
  }));
}

function applyModelViewportTransform({ persist = false } = {}) {
  const container = modelContainerRef.value;
  if (container) {
    container.style.setProperty('--live2d-user-x', `${modelViewport.x.toFixed(2)}px`);
    container.style.setProperty('--live2d-user-y', `${modelViewport.y.toFixed(2)}px`);
    container.style.setProperty('--live2d-user-scale', modelViewport.scale.toFixed(4));
  }
  if (persist) saveModelViewport();
}

function setModelViewport(patch, options = {}) {
  const next = normalizeModelViewport({
    x: patch.x ?? modelViewport.x,
    y: patch.y ?? modelViewport.y,
    scale: patch.scale ?? modelViewport.scale
  });
  modelViewport.x = next.x;
  modelViewport.y = next.y;
  modelViewport.scale = next.scale;
  applyModelViewportTransform(options);
}

function loadModelViewport() {
  if (typeof localStorage !== 'undefined') {
    try {
      setModelViewport(JSON.parse(localStorage.getItem(MODEL_VIEWPORT_STORAGE_KEY) || '{}') || {});
      return;
    } catch (_) {
      localStorage.removeItem(MODEL_VIEWPORT_STORAGE_KEY);
    }
  }
  applyModelViewportTransform();
}

function startModelDrag(event) {
  if (modelLocked.value || (event.pointerType === 'mouse' && event.button !== 0)) return;
  modelDragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: modelViewport.x,
    originY: modelViewport.y
  };
  modelViewport.dragging = true;
  try {
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  } catch (_) {}
  event.preventDefault();
}

function dragModel(event) {
  if (!modelDragState || event.pointerId !== modelDragState.pointerId) return;
  setModelViewport({
    x: modelDragState.originX + event.clientX - modelDragState.startX,
    y: modelDragState.originY + event.clientY - modelDragState.startY
  });
  event.preventDefault();
}

function endModelDrag(event) {
  if (!modelDragState || event.pointerId !== modelDragState.pointerId) return;
  try {
    if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  } catch (_) {}
  modelDragState = null;
  modelViewport.dragging = false;
  saveModelViewport();
}

function zoomModel(event) {
  if (modelLocked.value) return;
  const factor = Math.exp(-Number(event.deltaY || 0) * 0.0012);
  setModelViewport({ scale: modelViewport.scale * factor }, { persist: true });
  event.preventDefault();
}

function resetModelViewport() {
  setModelViewport({ x: 0, y: 0, scale: 1 }, { persist: true });
}

const statusLabel = computed(() => {
  if (live2d.error.value) return 'ERROR';
  if (live2d.ready.value) return 'READY';
  if (live2d.loading.value) return 'LOADING';
  return 'STANDBY';
});

const liveStateLabel = computed(() => {
  if (liveDirector.error) return 'ERROR';
  if (liveDirector.running && liveDirector.status === 'speaking') return 'SPEAKING';
  if (liveDirector.running && liveDirector.status === 'thinking') return 'THINKING';
  if (liveDirector.running) return 'ON AIR';
  return 'OFF AIR';
});

const latestCaption = computed(() => {
  const line = [...showLog.value].reverse().find((item) => item.role === 'yachiyo');
  return visibleYachiyoText(line?.text || llmState.value.reply || '');
});

const testActions = [
  { label: '中性', expression: 'neutral', icon: 'meh' },
  { label: '微笑', expression: 'smile', icon: 'smile' },
  { label: '害羞', expression: 'bsmile', icon: 'smilePlus' },
  { label: '哭泣', expression: 'tears', icon: 'frown' }
];

const bodyActions = behaviorBodyActionButtons();

const parameterActions = [
  {
    label: '左看',
    icon: 'chevronUp',
    parameters: [
      { id: 'ParamEyeBallX', value: -0.35, weight: 0.95, durationMs: 900 },
      { id: 'ParamAngleY', value: 5, weight: 0.45, durationMs: 900 }
    ]
  },
  {
    label: '右看',
    icon: 'chevronDown',
    parameters: [
      { id: 'ParamEyeBallX', value: 0.35, weight: 0.95, durationMs: 900 },
      { id: 'ParamAngleY', value: -5, weight: 0.45, durationMs: 900 }
    ]
  },
  {
    label: '倾斜',
    icon: 'sparkles',
    parameters: [
      { id: 'ParamAngleZ', value: 8, weight: 0.85, durationMs: 1100 }
    ]
  },
  {
    label: '专注',
    icon: 'circleDot',
    parameters: [
      { id: 'ParamAngleX', value: -6, weight: 0.65, durationMs: 1000 },
      { id: 'ParamBrowLY', value: 0.24, weight: 0.7, durationMs: 900 },
      { id: 'ParamBrowRY', value: 0.24, weight: 0.7, durationMs: 900 }
    ]
  },
  {
    label: '温暖',
    icon: 'heart',
    parameters: [
      { id: 'ParamMouthForm', value: 0.42, weight: 0.9, durationMs: 1000 },
      { id: 'ParamCheek', value: 0.2, weight: 0.55, durationMs: 1100 }
    ]
  },
  {
    label: '呼吸',
    icon: 'audioLines',
    parameters: [
      { id: 'ParamBreath', value: 0.8, weight: 0.5, durationMs: 1800 }
    ]
  }
];

function actionIcon(action) {
  const key = String(action?.bodyPose || action?.label || '').toLowerCase();
  if (/nod|点头/.test(key)) return 'smile';
  if (/shake|摇头/.test(key)) return 'frown';
  if (/tilt|倾/.test(key)) return 'sparkles';
  if (/look|看/.test(key)) return 'circleDot';
  if (/bounce|jump|弹/.test(key)) return 'star';
  if (/wave|招呼|hand/.test(key)) return 'handHeart';
  if (/breath|呼吸/.test(key)) return 'audioLines';
  return 'smile';
}

function actionLabel(action) {
  const labels = {
    nod: '点头',
    shake_head: '摇头',
    head_tilt: '倾斜',
    look_left: '左看',
    look_right: '右看',
    look_at_chat: '向左看',
    look_at_camera: '向右看',
    sway: '摆动',
    bounce: '弹跳',
    wave: '打招呼',
    lean_in: '靠近',
    breathe: '呼吸'
  };
  const key = String(action?.bodyPose || '').toLowerCase();
  return labels[key] || action?.label || action?.bodyPose || '动作';
}

function uid(prefix = 'line') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function visibleYachiyoText(text) {
  return cleanLive2DReply(text).replace(/[ \t]{2,}/g, ' ').trim();
}

function pushLog(role, text, meta = {}) {
  const value = role === 'yachiyo'
    ? visibleYachiyoText(text)
    : String(text || '').trim();
  if (!value) return;
  showLog.value = [
    ...showLog.value,
    {
      id: uid(role),
      role,
      text: value,
      meta,
      createdAt: Date.now()
    }
  ].slice(-10);
}

async function executeMusicFromLLMResult(result, source = 'manual') {
  if (!result?.music) return null;
  try {
    const musicResult = await executeLive2DMusicCommand(result.music);
    if (!musicResult || musicResult.status === 'disabled') return musicResult;
    if (musicResult.status === 'playing') {
      pushLog('system', `Apple Music playing: ${musicResult.title || musicResult.songId || 'song'}`, {
        music: musicResult,
        source
      });
    } else {
      pushLog('system', `Apple Music ${musicResult.status}.`, {
        music: musicResult,
        source
      });
    }
    return musicResult;
  } catch (error) {
    const message = error?.message || 'Apple Music failed';
    llmState.value = {
      ...llmState.value,
      error: message
    };
    if (source === 'live') liveDirector.error = message;
    pushLog('system', `Apple Music: ${message}`, { source });
    return null;
  }
}

function shouldJoinWithSpace(left, right) {
  return /[A-Za-z0-9]$/.test(String(left || '').trim()) && /^[A-Za-z0-9]/.test(String(right || '').trim());
}

function joinSpeechText(left, right) {
  const previous = visibleYachiyoText(left);
  const next = visibleYachiyoText(right);
  if (!previous) return next;
  if (!next) return previous;
  return `${previous}${shouldJoinWithSpace(previous, next) ? ' ' : ''}${next}`;
}

function upsertLogLine(id, role, text, meta = {}) {
  const value = role === 'yachiyo'
    ? visibleYachiyoText(text)
    : String(text || '').trim();
  if (!value) return;
  const index = showLog.value.findIndex((item) => item.id === id);
  if (index >= 0) {
    const nextLog = [...showLog.value];
    nextLog[index] = {
      ...nextLog[index],
      text: value,
      meta: { ...(nextLog[index].meta || {}), ...meta }
    };
    showLog.value = nextLog.slice(-10);
    return;
  }
  showLog.value = [
    ...showLog.value,
    {
      id,
      role,
      text: value,
      meta,
      createdAt: Date.now()
    }
  ].slice(-10);
}

function dispatchCharacterState(mode, detail = {}) {
  window.dispatchEvent(new CustomEvent(CHARACTER_STATE_EVENT, {
    detail: { mode, ...detail }
  }));
}

function dispatchStreamingSpeechStart(durationMs = 0, detail = {}) {
  if (streamingSpeechSession) {
    streamingSpeechSession.lineStarted({ durationMs, ...detail });
    return;
  }
  dispatchCharacterState('speaking', {
    holdMs: streamingSpeechHoldMs(durationMs),
    emotion: detail.emotion,
    emotionHoldMs: Math.max(Number(durationMs) || 0, 1800),
    attention: detail.attention ?? 0.88,
    arousal: detail.arousal ?? (detail.emotion === 'sad' || detail.emotion === 'crying' ? 0.5 : 0.72)
  });
}

async function init() {
  if (booted.value) return;
  booted.value = true;
  window.TSUKUYOMI_LIVE2D_DISABLE_POINTER = true;
  streamingSpeechSession = createLive2DStreamingSpeechSession({
    dispatchCharacterState,
    isLiveDirectorRunning: () => liveDirector.running
  });
  speechPlayer = createLive2DSpeechPlayer({
    onState: (patch) => {
      speechState.value = { ...speechState.value, ...patch };
      if (streamingSpeechSession?.handleSpeechStatePatch(patch)) return;
      if (patch.status === 'loading') {
        dispatchCharacterState('thinking', { holdMs: 1800, attention: 0.78, arousal: 0.46 });
      } else if (patch.status === 'playing') {
        dispatchCharacterState('speaking', { holdMs: 1200, attention: 0.86, arousal: 0.68 });
      } else if (patch.status === 'idle' || patch.status === 'disabled') {
        dispatchCharacterState(liveDirector.running ? 'listening' : 'idle', { holdMs: 1200, attention: liveDirector.running ? 0.58 : 0.36 });
      } else if (patch.status === 'error') {
        dispatchCharacterState('idle', { holdMs: 1000, arousal: 0.28 });
      }
    }
  });
  asrRecorder = createLive2DAsrRecorder({
    onState: (patch) => {
      asrState.value = { ...asrState.value, ...patch };
      if (patch.status === 'listening') {
        dispatchCharacterState('listening', { holdMs: 1600, attention: 0.9, arousal: 0.44 });
      } else if (patch.status === 'transcribing') {
        dispatchCharacterState('thinking', { holdMs: 1400, attention: 0.72, arousal: 0.42 });
      }
    },
    onResult: ({ text }) => {
      submitAudienceLine(text, { source: 'asr' });
    }
  });
  await live2d.init();
}

function runExpression(expression) {
  dispatchRoomLive2D({
    expression,
    expressionMix: [{ expression, weight: 1 }],
    durationMs: 4200
  });
}

function runBodyPose(bodyPose) {
  dispatchRoomLive2D({
    bodyPose,
    intensity: 1,
    durationMs: 2600
  });
}

function runParameterTargets(parameters) {
  const durationMs = Math.max(
    1200,
    ...parameters.map((item) => Number(item.durationMs) || 0)
  );
  dispatchRoomLive2D({
    parameters,
    durationMs
  });
}

function alignLive2DToSpeech(intent, speechDurationMs = 0) {
  return alignLive2DIntentToStreamingSpeech(intent, speechDurationMs);
}

function runGreeting() {
  dispatchRoomLive2D({
    sequence: [
      {
        expression: 'smile',
        expressionMix: [{ expression: 'smile', weight: 1 }],
        bodyPose: 'bounce',
        durationMs: 2300
      },
      {
        expression: 'bsmile',
        expressionMix: [{ expression: 'bsmile', weight: 1 }],
        bodyPose: 'lean_in',
        delayMs: 180,
        durationMs: 2600
      },
      {
        expression: 'neutral',
        expressionMix: [{ expression: 'neutral', weight: 1 }],
        bodyPose: 'sway',
        delayMs: 180,
        durationMs: 2200
      }
    ]
  });
}

function speak() {
  if (muted.value) return;
  if (latestCaption.value && speechPlayer) {
    speechPlayer.play(latestCaption.value).catch(() => {});
    return;
  }
  live2d.speak();
}

async function performLLMAct(message, source = 'manual', options = {}) {
  const value = String(message || '').trim();
  if (!value || llmState.value.loading) return null;
  dispatchCharacterState('thinking', { holdMs: 2400, attention: 0.82, arousal: 0.5 });
  llmState.value = {
    ...llmState.value,
    loading: true,
    error: ''
  };
  try {
    const result = await requestLive2DControl(value);
    if (result.live2d && options.dispatchLive2D !== false) dispatchRoomLive2D(result.live2d);
    const visibleReply = visibleYachiyoText(result.reply) || 'OK.';
    llmState.value = {
      loading: false,
      error: '',
      reply: visibleReply,
      raw: result.raw,
      live2d: result.live2d
    };
    if (source === 'live') {
      pushLog('yachiyo', visibleReply, { live2d: result.live2d });
    }
    if (options.dispatchLive2D === false) {
      dispatchCharacterState('listening', { holdMs: 900, attention: 0.62 });
    } else {
      dispatchCharacterState('acting', {
        holdMs: Math.max(Number(result.live2d?.durationMs) || 0, 1400),
        emotion: result.live2d?.emotion || result.live2d?.expression,
        attention: 0.82,
        arousal: 0.62
      });
    }
    await executeMusicFromLLMResult(result, source);
    return { ...result, reply: visibleReply };
  } catch (error) {
    llmState.value = {
      ...llmState.value,
      loading: false,
      error: error.message || 'LLM control failed'
    };
    throw error;
  }
}

async function performStreamingLiveTurn(message) {
  const value = String(message || '').trim();
  if (!value || llmState.value.loading || !speechPlayer) return null;
  const logId = uid('yachiyo-stream');
  const playbackPromises = [];
  let streamedReply = '';
  let finalResult = null;
  let queuedSpeechCount = 0;
  let queuedLive2DCount = 0;
  let dispatchedStreamLive2DCount = 0;

  streamingSpeechSession?.begin();
  dispatchCharacterState('thinking', { holdMs: 2400, attention: 0.82, arousal: 0.5 });
  llmState.value = {
    ...llmState.value,
    loading: true,
    error: ''
  };

  try {
    finalResult = await requestLive2DControlStream(value, {
      onSentence: (sentence) => {
        const speechSentence = visibleYachiyoText(sentence.text);
        if (!speechSentence) return;
        const captionPromise = translateLive2DReplyToChinese(speechSentence)
          .then((caption) => visibleYachiyoText(caption))
          .catch(() => '');
        const showCaption = (durationMs = 0) => {
          captionPromise.then((visibleSentence) => {
            if (!visibleSentence) return;
            streamedReply = joinSpeechText(streamedReply, visibleSentence);
            upsertLogLine(logId, 'yachiyo', streamedReply, {
              live2d: sentence.live2d,
              emotion: sentence.emotion,
              streaming: true
            });
            llmState.value = {
              loading: llmState.value.loading,
              error: '',
              reply: streamedReply,
              raw: finalResult?.raw || null,
              live2d: sentence.live2d
            };
          });
          if (sentence.live2d) {
            dispatchedStreamLive2DCount += 1;
            dispatchRoomLive2D(alignLive2DToSpeech(sentence.live2d, durationMs));
          }
          dispatchStreamingSpeechStart(durationMs, {
            emotion: sentence.emotion,
            attention: 0.88,
            arousal: sentence.emotion === 'sad' || sentence.emotion === 'crying' ? 0.5 : 0.72
          });
        };
        if (sentence.live2d) queuedLive2DCount += 1;
        llmState.value = {
          loading: true,
          error: '',
          reply: streamedReply || llmState.value.reply,
          raw: finalResult?.raw || null,
          live2d: sentence.live2d
        };
        liveDirector.status = 'speaking';
        queuedSpeechCount += 1;
        streamingSpeechSession?.queueLine();
        playbackPromises.push(speechPlayer.enqueue(speechSentence, {
          emotion: sentence.emotion,
          speechStyle: sentence.speechStyle,
          onStart: ({ durationMs }) => showCaption(durationMs)
        }).catch((error) => {
          if (error?.name === 'AbortError') return;
          speechState.value = { status: 'error', error: error.message || 'TTS failed' };
        }).finally(() => {
          streamingSpeechSession?.lineSettled();
        }));
      }
    });

    const visibleReply = queuedSpeechCount < 1
      ? visibleYachiyoText(await translateLive2DReplyToChinese(finalResult.reply).catch(() => '')) || 'OK.'
      : streamedReply;
    if (queuedSpeechCount > 0 && finalResult.live2d && queuedLive2DCount < 1) {
      dispatchRoomLive2D(alignLive2DToSpeech(finalResult.live2d, Number(finalResult.live2d.durationMs) || 0));
    }
    if (queuedSpeechCount < 1 && visibleReply) {
      const finalSpeech = visibleYachiyoText(finalResult.reply) || visibleReply;
      const finalCaptionPromise = translateLive2DReplyToChinese(finalSpeech)
        .then((caption) => visibleYachiyoText(caption))
        .catch(() => visibleReply);
      streamingSpeechSession?.queueLine();
      playbackPromises.push(speechPlayer.enqueue(finalSpeech, {
        emotion: finalResult.live2d?.emotion || finalResult.live2d?.expression || 'neutral',
        speechStyle: finalResult.live2d?.speechStyle || null,
        onStart: ({ durationMs }) => {
          finalCaptionPromise.then((caption) => {
            if (!caption) return;
            streamedReply = caption;
            upsertLogLine(logId, 'yachiyo', caption, {
              live2d: finalResult.live2d,
              streaming: false
            });
            llmState.value = {
              loading: false,
              error: '',
              reply: caption,
              raw: finalResult.raw,
              live2d: finalResult.live2d
            };
          });
          if (finalResult.live2d) dispatchRoomLive2D(alignLive2DToSpeech(finalResult.live2d, durationMs));
          dispatchStreamingSpeechStart(durationMs, {
            emotion: finalResult.live2d?.emotion || finalResult.live2d?.expression || 'neutral'
          });
        }
      }).catch((error) => {
        if (error?.name === 'AbortError') return;
        speechState.value = { status: 'error', error: error.message || 'TTS failed' };
      }).finally(() => {
        streamingSpeechSession?.lineSettled();
      }));
    } else if (visibleReply) {
      upsertLogLine(logId, 'yachiyo', visibleReply, {
        live2d: finalResult.live2d,
        streaming: true
      });
    }

    llmState.value = {
      loading: false,
      error: '',
      reply: streamedReply || visibleReply || llmState.value.reply,
      raw: finalResult.raw,
      live2d: finalResult.live2d
    };
    liveDirector.turn += 1;
    await executeMusicFromLLMResult(finalResult, 'live');
    await Promise.allSettled(playbackPromises);
    if (queuedSpeechCount > 0 && finalResult.live2d && queuedLive2DCount > 0 && dispatchedStreamLive2DCount < 1) {
      dispatchRoomLive2D(alignLive2DToSpeech(finalResult.live2d, Number(finalResult.live2d.durationMs) || 0));
    }
    streamingSpeechSession?.finish({ delayMs: 520 });
    return { ...finalResult, reply: visibleReply };
  } catch (error) {
    streamingSpeechSession?.cancel({ dispatchState: true });
    llmState.value = {
      ...llmState.value,
      loading: false,
      error: error.message || 'LLM control failed'
    };
    throw error;
  }
}

async function runLLMControl() {
  const message = prompt.value.trim();
  if (!message || llmState.value.loading) return;
  const result = await performLLMAct(message, 'manual').catch(() => null);
  if (result?.reply) pushLog('yachiyo', result.reply, { live2d: result.live2d });
}

function resetLLMHistory() {
  clearLive2DLLMHistory();
  showLog.value = [];
  audienceQueue.value = [];
  llmState.value = {
    loading: false,
    error: '',
    reply: '',
    raw: null,
    live2d: null
  };
}

function buildLiveDirectorPrompt(audienceLines, options = {}) {
  const chat = audienceLines.length
    ? audienceLines.map((line, index) => `${index + 1}. ${line}`).join('\n')
    : 'No new audience messages. Continue the show with a short autonomous streamer thought.';
  return [
    'LIVE_DIRECTOR_TICK',
    `Stream topic: ${liveTopic.value || 'free talk'}`,
    'Recent audience messages:',
    chat,
    'Act like an autonomous AI VTuber streamer. Reply with 1-2 short spoken sentences.',
    'Do not wait passively for instructions. React, tease gently, ask a tiny hook, or continue the topic.',
    'Choose 2-5 semantic actions every turn unless the moment is intentionally calm.',
    'Match actions to the meaning of the line and vary the combo from the previous turn; avoid looping the same body action.',
    `Prefer action combos like ${behaviorActionComboPrompt()}.`,
    'Use emotion plus actions instead of raw Live2D parameters. Let the behavior controller map actions to VTube Studio tracking curves.',
    'Never show action cues in the spoken reply or caption: no parentheses, no asterisk actions, no Action/Pose labels, and no body descriptions in reply. Put movement only in the actions array.',
    options.streaming
      ? 'Streaming mode: follow the system format exactly, with VOICE lines first and CONTROL JSON last.'
      : 'Return the required JSON object only.'
  ].join('\n');
}

function scheduleLiveTurn(delayMs = 7800) {
  window.clearTimeout(liveTimer);
  if (!liveDirector.running) return;
  liveTimer = window.setTimeout(() => {
    runLiveTurn();
  }, delayMs);
}

async function runLiveTurn() {
  if (!liveDirector.running || liveTurnInFlight || llmState.value.loading) return;
  liveTurnInFlight = true;
  liveDirector.status = 'thinking';
  liveDirector.error = '';
  const audienceLines = audienceQueue.value.splice(0, 3);
  try {
    const shouldSpeak = Boolean(liveDirector.autoVoice && speechPlayer);
    if (shouldSpeak) {
      liveDirector.status = 'thinking';
      await performStreamingLiveTurn(buildLiveDirectorPrompt(audienceLines, { streaming: true }));
      liveDirector.status = 'idle';
      return;
    }
    await performLLMAct(buildLiveDirectorPrompt(audienceLines), 'live', {
      dispatchLive2D: true
    });
    liveDirector.turn += 1;
    liveDirector.status = 'idle';
  } catch (error) {
    liveDirector.error = error.message || 'Live director failed';
    liveDirector.status = 'idle';
  } finally {
    liveTurnInFlight = false;
    if (liveDirector.running) {
      scheduleLiveTurn(audienceQueue.value.length ? 900 : 7800 + Math.round(Math.random() * 4200));
    }
  }
}

function startLiveDirector() {
  if (liveDirector.running) return;
  speechPlayer?.warmup?.();
  liveDirector.running = true;
  liveDirector.status = 'starting';
  liveDirector.error = '';
  dispatchCharacterState('listening', { holdMs: 2200, attention: 0.68, arousal: 0.42 });
  pushLog('system', 'Live director started.');
  runLiveTurn();
}

function stopLiveDirector() {
  liveDirector.running = false;
  liveDirector.status = 'idle';
  window.clearTimeout(liveTimer);
  liveTimer = 0;
  streamingSpeechSession?.cancel();
  speechPlayer?.stop();
  dispatchCharacterState('idle', { holdMs: 1200, attention: 0.32, arousal: 0.28 });
  pushLog('system', 'Live director stopped.');
}

function submitAudienceLine(text, meta = {}) {
  const value = String(text || '').trim();
  if (!value) return;
  if (!meta.keepInput) audienceInput.value = '';
  audienceQueue.value.push(value);
  pushLog('audience', value, meta);
  dispatchCharacterState('listening', { holdMs: 1800, attention: 0.88, arousal: 0.48 });
  if (liveDirector.running && !liveTurnInFlight) scheduleLiveTurn(450);
}

function sendAudienceLine() {
  submitAudienceLine(audienceInput.value);
}

function toggleFullscreen() {
  const root = document.documentElement;
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  root.requestFullscreen?.();
}

async function toggleAudienceAsr() {
  if (!asrRecorder) return;
  try {
    if (asrRecorder.isRecording()) {
      await asrRecorder.stop();
      return;
    }
    await asrRecorder.start();
  } catch (error) {
    asrState.value = {
      ...asrState.value,
      status: 'error',
      error: error.message || 'ASR failed'
    };
  }
}

function handleStudioSettingsSaved() {
  speechPlayer?.warmup?.();
}

function handleLive2DDebugEvent(event) {
  live2dDebug.value = event.detail || readRoomLive2DDebugState();
}

onMounted(() => {
  window.addEventListener(SETTINGS_SAVED_EVENT, handleStudioSettingsSaved);
  window.addEventListener(ROOM_LIVE2D_DEBUG_EVENT, handleLive2DDebugEvent);
  loadModelViewport();
  live2dDebug.value = readRoomLive2DDebugState();
  init();
});

onUnmounted(() => {
  window.removeEventListener(SETTINGS_SAVED_EVENT, handleStudioSettingsSaved);
  window.removeEventListener(ROOM_LIVE2D_DEBUG_EVENT, handleLive2DDebugEvent);
  modelDragState = null;
  modelViewport.dragging = false;
  stopLiveDirector();
  streamingSpeechSession?.cancel();
  speechPlayer?.destroy();
  asrRecorder?.destroy();
  speechPlayer = null;
  streamingSpeechSession = null;
  asrRecorder = null;
  delete window.TSUKUYOMI_LIVE2D_DISABLE_POINTER;
});
</script>

<template>
  <main
    class="live2d-page"
    :class="{ 'model-hidden': modelHidden, 'model-locked': modelLocked }"
    :data-live-state="liveDirector.running ? 'on' : 'off'"
    aria-label="Yachiyo Live2D Studio"
  >
    <div class="live2d-backdrop" aria-hidden="true"></div>
    <section class="live2d-stage" aria-label="Yachiyo Live2D stage">
      <div
        id="live2d-container"
        ref="modelContainerRef"
        class="live2d-model"
        :class="{ hidden: modelHidden, locked: modelLocked, dragging: modelViewport.dragging }"
        :data-speaking="speechState.status === 'playing' ? 'true' : undefined"
        title="拖动模型，滚轮缩放"
        @pointerdown="startModelDrag"
        @pointermove="dragModel"
        @pointerup="endModelDrag"
        @pointercancel="endModelDrag"
        @lostpointercapture="endModelDrag"
        @wheel.prevent="zoomModel"
        @dblclick="resetModelViewport"
      ></div>
      <div v-if="live2d.error.value" class="live2d-error" role="alert">{{ live2d.error.value }}</div>

      <section class="live2d-broadcast-hud" aria-label="Broadcast captions">
        <div class="live2d-caption">
          <header class="live2d-caption-head">
            <span>当前发言</span>
            <button
              class="live2d-mini-btn"
              type="button"
              :aria-expanded="messagesExpanded ? 'true' : 'false'"
              @click="messagesExpanded = !messagesExpanded"
            >
              <TsIcon :name="messagesExpanded ? 'x' : 'message'" :size="15" />
              <span>{{ messagesExpanded ? '收起' : '全部消息' }}</span>
            </button>
          </header>
          <p>{{ latestCaption || '等待当前消息' }}</p>
        </div>
        <div v-if="messagesExpanded" class="live2d-feed" aria-live="polite">
          <header>
            <strong>全部消息</strong>
            <button class="live2d-mini-btn" type="button" @click="resetLLMHistory">
              <TsIcon name="trash" :size="15" />
              <span>清空</span>
            </button>
          </header>
          <article v-for="line in displayedChat" :key="line.id" class="live2d-feed-line" :class="line.role">
            <strong>{{ line.role === 'yachiyo' ? 'YACHIYO' : line.role === 'audience' ? '聊天' : '系统' }}</strong>
            <time>{{ formatDebugTime(line.createdAt) }}</time>
            <span>{{ line.text }}</span>
          </article>
          <p v-if="!displayedChat.length" class="live2d-feed-empty">等待第一条消息</p>
        </div>
      </section>
    </section>

    <aside class="live2d-control-panel" aria-label="Live controls">
      <header class="live2d-panel-header">
        <div class="live2d-status-orb" :class="{ ready: live2d.ready.value, error: live2d.error.value }"></div>
        <div class="live2d-status-copy">
          <span>直播状态</span>
          <strong>{{ liveStateLabel }}</strong>
          <small>{{ statusLabel }}</small>
        </div>
        <button class="live2d-icon-btn" type="button" title="刷新模型状态" aria-label="刷新模型状态" @click="runGreeting">
          <TsIcon name="refresh" :size="19" />
        </button>
        <button
          class="live2d-icon-btn live2d-debug-toggle"
          type="button"
          title="Motion inspector"
          aria-label="Motion inspector"
          :aria-pressed="debugPanelOpen ? 'true' : 'false'"
          @click="toggleLive2DDebugPanel"
        >
          <TsIcon name="settings" :size="19" />
        </button>
      </header>

      <section class="live2d-live-director" aria-label="Live director">
        <label>
          <span>标题</span>
          <small>{{ liveTopic.length }}/80</small>
          <input v-model="liveTopic" maxlength="80" type="text" spellcheck="false" placeholder="late-night AI VTuber test stream">
        </label>
        <label>
          <span>观众发言</span>
          <small>语音输入</small>
          <div class="live2d-audience-row">
            <input v-model="audienceInput" type="text" spellcheck="false" placeholder="在此输入观众发言..." @keydown.enter="sendAudienceLine">
            <button
              class="live2d-icon-btn live2d-mic-btn"
              :class="{ active: asrState.status === 'listening' }"
              type="button"
              :title="asrState.status === 'listening' ? '停止语音输入' : '开始语音输入'"
              :aria-label="asrState.status === 'listening' ? '停止语音输入' : '开始语音输入'"
              :aria-pressed="asrState.status === 'listening' ? 'true' : 'false'"
              :disabled="asrState.status === 'transcribing'"
              @click="toggleAudienceAsr"
            >
              <TsIcon :name="asrState.status === 'transcribing' ? 'loader' : 'mic'" :size="20" />
            </button>
            <button class="live2d-icon-btn" type="button" title="发送" aria-label="发送" @click="sendAudienceLine">
              <TsIcon name="send" :size="20" />
            </button>
          </div>
        </label>
        <div class="live2d-live-actions">
          <button
            class="live2d-action-btn live2d-run-btn"
            type="button"
            :disabled="!live2d.ready.value || (!liveDirector.running && llmState.loading)"
            @click="liveDirector.running ? stopLiveDirector() : startLiveDirector()"
          >
            <TsIcon :name="liveDirector.running ? 'pause' : 'play'" :size="18" />
            <span>{{ liveDirector.running ? '停止直播' : '开始直播' }}</span>
          </button>
          <label class="live2d-switch">
            <input v-model="liveDirector.autoVoice" type="checkbox">
            <span>语音</span>
          </label>
        </div>
        <p v-if="liveDirector.error || speechState.error || asrState.error" class="live2d-inline-error">
          {{ liveDirector.error || speechState.error || asrState.error }}
        </p>
        <p v-else-if="asrState.status === 'listening' || asrState.status === 'transcribing'" class="live2d-inline-status">
          {{ asrState.status === 'listening' ? '正在聆听...' : '正在识别...' }}
        </p>
      </section>

      <section class="live2d-motion-panel" aria-label="Motion controls">
        <div class="live2d-tabbar" role="tablist" aria-label="Motion control mode">
          <button :class="{ active: activeMotionTab === 'expression' }" type="button" @click="activeMotionTab = 'expression'">表情</button>
          <button :class="{ active: activeMotionTab === 'action' }" type="button" @click="activeMotionTab = 'action'">动作</button>
          <button :class="{ active: activeMotionTab === 'parameter' }" type="button" @click="activeMotionTab = 'parameter'">参数</button>
        </div>
        <div v-if="activeMotionTab === 'expression'" class="live2d-control-grid">
          <button
            v-for="action in testActions"
            :key="action.expression"
            class="live2d-action-btn live2d-tile-btn"
            type="button"
            :disabled="!live2d.ready.value"
            @click="runExpression(action.expression)"
          >
            <TsIcon :name="action.icon" :size="28" />
            <span>{{ action.label }}</span>
          </button>
        </div>
        <div v-else-if="activeMotionTab === 'action'" class="live2d-control-grid action-grid">
          <button
            v-for="action in bodyActions"
            :key="action.bodyPose"
            class="live2d-action-btn live2d-tile-btn"
            type="button"
            :disabled="!live2d.ready.value"
            @click="runBodyPose(action.bodyPose)"
          >
            <TsIcon :name="actionIcon(action)" :size="27" />
            <span>{{ actionLabel(action) }}</span>
          </button>
        </div>
        <div v-else class="live2d-control-grid">
          <button
            v-for="action in parameterActions"
            :key="action.label"
            class="live2d-action-btn live2d-tile-btn"
            type="button"
            :disabled="!live2d.ready.value"
            @click="runParameterTargets(action.parameters)"
          >
            <TsIcon :name="action.icon" :size="27" />
            <span>{{ action.label }}</span>
          </button>
        </div>
      </section>

      <section class="live2d-quick-actions" aria-label="Quick actions">
        <h2>快捷操作</h2>
        <div>
          <button class="live2d-quick-btn" :class="{ active: muted }" type="button" title="静音" aria-label="静音" @click="muted = !muted">
            <TsIcon :name="muted ? 'micOff' : 'mic'" :size="24" />
            <span>静音</span>
          </button>
          <button class="live2d-quick-btn" :class="{ active: modelHidden }" type="button" title="隐藏模型" aria-label="隐藏模型" @click="modelHidden = !modelHidden">
            <TsIcon name="eyeOff" :size="24" />
            <span>隐藏</span>
          </button>
          <button class="live2d-quick-btn" :class="{ active: modelLocked }" type="button" title="锁定模型" aria-label="锁定模型" @click="modelLocked = !modelLocked">
            <TsIcon name="lock" :size="24" />
            <span>锁定</span>
          </button>
          <button class="live2d-quick-btn" type="button" title="全屏" aria-label="全屏" @click="toggleFullscreen">
            <TsIcon name="maximize" :size="24" />
            <span>全屏</span>
          </button>
        </div>
      </section>

      <section class="live2d-volume-panel" aria-label="Audio monitor">
        <div>
          <span>麦克风音量</span>
          <strong>{{ micGain }}%</strong>
        </div>
        <input v-model.number="micGain" type="range" min="0" max="100" aria-label="麦克风音量">
        <div class="live2d-mic-meter" aria-hidden="true">
          <TsIcon name="mic" :size="18" />
          <span v-for="(active, index) in micBars" :key="index" :class="{ active }"></span>
        </div>
      </section>

      <details class="live2d-director-command">
        <summary>导演指令</summary>
        <form class="live2d-llm-form" @submit.prevent="runLLMControl">
          <textarea v-model="prompt" rows="3" spellcheck="false" placeholder="Ask LLM to control Live2D"></textarea>
          <div class="live2d-llm-actions">
            <button class="live2d-action-btn live2d-run-btn" type="submit" :disabled="!live2d.ready.value || llmState.loading">
              {{ llmState.loading ? 'Thinking' : 'LLM Act' }}
            </button>
            <button class="live2d-icon-btn" type="button" title="清空历史" aria-label="清空历史" @click="resetLLMHistory">
              <TsIcon name="trash" :size="18" />
            </button>
          </div>
        </form>
      </details>
    </aside>

    <aside v-if="debugPanelOpen" class="live2d-debug-panel" aria-label="Live2D motion inspector">
      <header class="live2d-debug-header">
        <div>
          <span>Motion Inspector</span>
          <strong>{{ debugEmotion }}</strong>
        </div>
        <div class="live2d-debug-header-actions">
          <small>{{ debugUpdatedLabel }}</small>
          <button class="live2d-icon-btn" type="button" title="Close inspector" aria-label="Close inspector" @click="toggleLive2DDebugPanel">
            <TsIcon name="x" :size="17" />
          </button>
        </div>
      </header>

      <div class="live2d-debug-metrics">
        <div>
          <span>Emotion</span>
          <strong>{{ debugEmotion }}</strong>
        </div>
        <div>
          <span>Mouth</span>
          <strong>{{ debugMouthEnergy }}</strong>
        </div>
        <div>
          <span>VTS</span>
          <strong>{{ live2dDebug.vtsStatus?.status || 'idle' }}</strong>
        </div>
        <div>
          <span>Queue</span>
          <strong>{{ debugActionQueue.length }}</strong>
        </div>
      </div>

      <section class="live2d-debug-section">
        <h2>Action Queue</h2>
        <div v-if="debugActionQueue.length" class="live2d-debug-list">
          <article v-for="(action, index) in debugActionQueue" :key="`${debugActionLabel(action)}-${index}`">
            <strong>{{ debugActionLabel(action) }}</strong>
            <span>{{ debugActionMeta(action) }}</span>
          </article>
        </div>
        <p v-else>idle</p>
      </section>

      <section class="live2d-debug-section">
        <h2>BehaviorPlan</h2>
        <pre>{{ debugBehaviorPlanText }}</pre>
      </section>

      <section class="live2d-debug-section">
        <h2>VTS Parameters</h2>
        <div v-if="debugVTSParameters.length" class="live2d-debug-param-list">
          <span v-for="param in debugVTSParameters" :key="param.id">
            <code>{{ param.id }}</code>
            <em>{{ formatDebugNumber(param.value) }}</em>
          </span>
        </div>
        <p v-else>no VTS output yet</p>
      </section>

      <section v-if="debugCubismParameters.length" class="live2d-debug-section">
        <h2>Cubism Parameters</h2>
        <div class="live2d-debug-param-list">
          <span v-for="param in debugCubismParameters" :key="param.id">
            <code>{{ param.id }}</code>
            <em>{{ formatDebugNumber(param.value) }}</em>
          </span>
        </div>
      </section>

      <section class="live2d-debug-section">
        <h2>Expression Files</h2>
        <div class="live2d-debug-expression-state">
          <span>active {{ debugExpressionFiles.active?.length || 0 }}</span>
          <span>available {{ debugExpressionFiles.availableCount || 0 }}</span>
          <span>eye {{ debugExpressionFiles.ownsEyeOpen ? 'owned' : 'free' }}</span>
        </div>
        <div v-if="debugExpressionFiles.active?.length" class="live2d-debug-chip-row">
          <span v-for="file in debugExpressionFiles.active" :key="file">{{ file }}</span>
        </div>
      </section>

      <section class="live2d-debug-section">
        <h2>Interrupt Policy</h2>
        <pre>{{ debugInterruptPolicyText }}</pre>
      </section>

      <section class="live2d-debug-section">
        <h2>Recent Events</h2>
        <div v-if="debugEvents.length" class="live2d-debug-events">
          <article v-for="event in debugEvents" :key="event.id">
            <time>{{ formatDebugTime(event.createdAt) }}</time>
            <span>{{ debugEventLabel(event) }}</span>
          </article>
        </div>
        <p v-else>no events</p>
      </section>
    </aside>

    <div v-if="live2d.loading.value" class="live2d-loading" role="status">
      <TsIcon name="loader" :size="28" />
      <span>Loading Live2D</span>
    </div>
  </main>
</template>
