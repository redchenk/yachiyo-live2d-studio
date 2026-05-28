<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import TsIcon from '../components/TsIcon.vue';
import { useLive2D } from '../composables/room/useLive2D';
import {
  clearLive2DLLMHistory,
  requestLive2DControl,
  requestLive2DControlStream
} from '../services/room/live2dLlmControl';
import { dispatchRoomLive2D } from '../services/room/live2dControl';
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

let liveTimer = 0;
let liveTurnInFlight = false;
let speechPlayer = null;
const CHARACTER_STATE_EVENT = 'tsukuyomi:live2d-character-state';

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
  { label: 'Neutral', expression: 'neutral' },
  { label: 'Smile', expression: 'smile' },
  { label: 'Shy', expression: 'bsmile' },
  { label: 'Tears', expression: 'tears' }
];

const bodyActions = behaviorBodyActionButtons();

const parameterActions = [
  {
    label: 'Look L',
    parameters: [
      { id: 'ParamEyeBallX', value: -0.35, weight: 0.95, durationMs: 900 },
      { id: 'ParamAngleY', value: 5, weight: 0.45, durationMs: 900 }
    ]
  },
  {
    label: 'Look R',
    parameters: [
      { id: 'ParamEyeBallX', value: 0.35, weight: 0.95, durationMs: 900 },
      { id: 'ParamAngleY', value: -5, weight: 0.45, durationMs: 900 }
    ]
  },
  {
    label: 'Tilt',
    parameters: [
      { id: 'ParamAngleZ', value: 8, weight: 0.85, durationMs: 1100 }
    ]
  },
  {
    label: 'Focus',
    parameters: [
      { id: 'ParamAngleX', value: -6, weight: 0.65, durationMs: 1000 },
      { id: 'ParamBrowLY', value: 0.24, weight: 0.7, durationMs: 900 },
      { id: 'ParamBrowRY', value: 0.24, weight: 0.7, durationMs: 900 }
    ]
  },
  {
    label: 'Warm',
    parameters: [
      { id: 'ParamMouthForm', value: 0.42, weight: 0.9, durationMs: 1000 },
      { id: 'ParamCheek', value: 0.2, weight: 0.55, durationMs: 1100 }
    ]
  },
  {
    label: 'Breath',
    parameters: [
      { id: 'ParamBreath', value: 0.8, weight: 0.5, durationMs: 1800 }
    ]
  }
];

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

async function init() {
  if (booted.value) return;
  booted.value = true;
  window.TSUKUYOMI_LIVE2D_DISABLE_POINTER = true;
  speechPlayer = createLive2DSpeechPlayer({
    onState: (patch) => {
      speechState.value = { ...speechState.value, ...patch };
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

function behaviorActionEndMs(actions = []) {
  return Math.max(
    0,
    ...actions.map((action) => (Number(action.delayMs) || 0) + (Number(action.durationMs) || 0))
  );
}

function stretchBehaviorActions(actions = [], targetDurationMs = 0) {
  const currentEndMs = behaviorActionEndMs(actions);
  if (!Array.isArray(actions) || !actions.length || !currentEndMs || !targetDurationMs) return actions;
  const scale = Math.min(Math.max(targetDurationMs / currentEndMs, 1), 3.2);
  if (scale <= 1.08) return actions;
  return actions.map((action) => ({
    ...action,
    delayMs: Math.round((Number(action.delayMs) || 0) * scale),
    durationMs: Math.round(Math.min(Math.max((Number(action.durationMs) || 1000) * scale, 360), 6800))
  }));
}

function alignLive2DToSpeech(intent, speechDurationMs = 0) {
  if (!intent || typeof intent !== 'object') return intent;
  const currentEndMs = Math.max(
    Number(intent.durationMs) || 0,
    behaviorActionEndMs(intent.behaviorActions)
  );
  const targetDurationMs = Math.min(Math.max(Number(speechDurationMs) || 0, currentEndMs, 1400), 14000);
  const alignStep = (step) => {
    if (!step || typeof step !== 'object') return step;
    const behaviorActions = Array.isArray(step.behaviorActions)
      ? stretchBehaviorActions(step.behaviorActions, targetDurationMs)
      : step.behaviorActions;
    return {
      ...step,
      durationMs: Math.max(Number(step.durationMs) || 0, targetDurationMs),
      behaviorActions
    };
  };
  return {
    ...alignStep(intent),
    sequence: Array.isArray(intent.sequence) ? intent.sequence.map(alignStep) : intent.sequence
  };
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

  dispatchCharacterState('thinking', { holdMs: 2400, attention: 0.82, arousal: 0.5 });
  llmState.value = {
    ...llmState.value,
    loading: true,
    error: ''
  };

  try {
    finalResult = await requestLive2DControlStream(value, {
      onSentence: (sentence) => {
        const visibleSentence = visibleYachiyoText(sentence.text);
        if (!visibleSentence) return;
        streamedReply = joinSpeechText(streamedReply, visibleSentence);
        upsertLogLine(logId, 'yachiyo', streamedReply, {
          live2d: sentence.live2d,
          emotion: sentence.emotion,
          streaming: true
        });
        llmState.value = {
          loading: true,
          error: '',
          reply: streamedReply,
          raw: finalResult?.raw || null,
          live2d: sentence.live2d
        };
        liveDirector.status = 'speaking';
        playbackPromises.push(speechPlayer.enqueue(visibleSentence, {
          emotion: sentence.emotion,
          speechStyle: sentence.speechStyle,
          onStart: ({ durationMs }) => {
            if (sentence.live2d) dispatchRoomLive2D(alignLive2DToSpeech(sentence.live2d, durationMs));
            dispatchCharacterState('speaking', {
              holdMs: Math.max(durationMs || 0, 1200),
              emotion: sentence.emotion,
              emotionHoldMs: Math.max(durationMs || 0, 1800),
              attention: 0.88,
              arousal: sentence.emotion === 'sad' || sentence.emotion === 'crying' ? 0.5 : 0.72
            });
          }
        }).catch((error) => {
          if (error?.name === 'AbortError') return;
          speechState.value = { status: 'error', error: error.message || 'TTS failed' };
        }));
      }
    });

    const visibleReply = visibleYachiyoText(finalResult.reply) || streamedReply || 'OK.';
    if (!streamedReply && visibleReply) {
      upsertLogLine(logId, 'yachiyo', visibleReply, {
        live2d: finalResult.live2d,
        streaming: false
      });
      playbackPromises.push(speechPlayer.enqueue(visibleReply, {
        emotion: finalResult.live2d?.emotion || finalResult.live2d?.expression || 'neutral',
        speechStyle: finalResult.live2d?.speechStyle || null,
        onStart: ({ durationMs }) => {
          if (finalResult.live2d) dispatchRoomLive2D(alignLive2DToSpeech(finalResult.live2d, durationMs));
        }
      }).catch((error) => {
        if (error?.name === 'AbortError') return;
        speechState.value = { status: 'error', error: error.message || 'TTS failed' };
      }));
    } else {
      upsertLogLine(logId, 'yachiyo', visibleReply, {
        live2d: finalResult.live2d,
        streaming: true
      });
    }

    llmState.value = {
      loading: false,
      error: '',
      reply: visibleReply,
      raw: finalResult.raw,
      live2d: finalResult.live2d
    };
    liveDirector.turn += 1;
    await Promise.allSettled(playbackPromises);
    dispatchCharacterState('listening', { holdMs: 1000, attention: 0.62 });
    return { ...finalResult, reply: visibleReply };
  } catch (error) {
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
      ? 'Streaming mode: follow the system format exactly, with SAY lines first and CONTROL JSON last.'
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
  speechPlayer?.stop();
  dispatchCharacterState('idle', { holdMs: 1200, attention: 0.32, arousal: 0.28 });
  pushLog('system', 'Live director stopped.');
}

function sendAudienceLine() {
  const value = audienceInput.value.trim();
  if (!value) return;
  audienceInput.value = '';
  audienceQueue.value.push(value);
  pushLog('audience', value);
  dispatchCharacterState('listening', { holdMs: 1800, attention: 0.88, arousal: 0.48 });
  if (liveDirector.running && !liveTurnInFlight) scheduleLiveTurn(450);
}

onMounted(() => {
  init();
});

onUnmounted(() => {
  stopLiveDirector();
  speechPlayer?.destroy();
  speechPlayer = null;
  delete window.TSUKUYOMI_LIVE2D_DISABLE_POINTER;
});
</script>

<template>
  <main class="live2d-page" :data-live-state="liveDirector.running ? 'on' : 'off'" aria-label="Live2D preview">
    <div class="live2d-backdrop" aria-hidden="true"></div>
    <section class="live2d-stage" aria-label="Yachiyo Live2D stage">
      <div
        id="live2d-container"
        class="live2d-model"
        :data-speaking="speechState.status === 'playing' ? 'true' : undefined"
      ></div>
      <div v-if="live2d.error.value" class="live2d-error" role="alert">{{ live2d.error.value }}</div>
    </section>

    <section class="live2d-broadcast-hud" aria-label="Live broadcast state">
      <div class="live2d-on-air" :class="{ active: liveDirector.running }">
        <span></span>
        <strong>{{ liveStateLabel }}</strong>
        <small>#{{ liveDirector.turn }}</small>
      </div>
      <div v-if="latestCaption" class="live2d-caption">
        {{ latestCaption }}
      </div>
      <div v-if="showLog.length" class="live2d-feed" aria-live="polite">
        <article v-for="line in showLog" :key="line.id" class="live2d-feed-line" :class="line.role">
          <strong>{{ line.role === 'yachiyo' ? 'Yachiyo' : line.role === 'audience' ? 'Chat' : 'System' }}</strong>
          <span>{{ line.text }}</span>
        </article>
      </div>
    </section>

    <aside class="live2d-control-panel" aria-label="Live2D test controls">
      <div class="live2d-status-row">
        <span class="live2d-status-dot" :class="{ ready: live2d.ready.value, error: live2d.error.value }"></span>
        <strong>{{ statusLabel }}</strong>
      </div>

      <section class="live2d-live-director" aria-label="Live director">
        <input v-model="liveTopic" type="text" spellcheck="false" placeholder="Stream topic">
        <div class="live2d-live-actions">
          <button
            class="live2d-action-btn live2d-run-btn"
            type="button"
            :disabled="!live2d.ready.value || (!liveDirector.running && llmState.loading)"
            @click="liveDirector.running ? stopLiveDirector() : startLiveDirector()"
          >
            <TsIcon :name="liveDirector.running ? 'pause' : 'play'" :size="16" />
            <span>{{ liveDirector.running ? 'Stop' : 'Start' }}</span>
          </button>
          <label class="live2d-toggle">
            <input v-model="liveDirector.autoVoice" type="checkbox">
            <span>Voice</span>
          </label>
        </div>
        <div class="live2d-audience-row">
          <input v-model="audienceInput" type="text" spellcheck="false" placeholder="Audience line" @keydown.enter="sendAudienceLine">
          <button class="live2d-icon-btn" type="button" title="Send audience line" aria-label="Send audience line" @click="sendAudienceLine">
            <TsIcon name="send" :size="17" />
          </button>
        </div>
        <p v-if="liveDirector.error || speechState.error" class="live2d-inline-error">
          {{ liveDirector.error || speechState.error }}
        </p>
      </section>

      <div class="live2d-actions">
        <button
          v-for="action in testActions"
          :key="action.expression"
          class="live2d-action-btn"
          type="button"
          :disabled="!live2d.ready.value"
          @click="runExpression(action.expression)"
        >
          {{ action.label }}
        </button>
      </div>
      <div class="live2d-actions live2d-body-actions">
        <button
          v-for="action in bodyActions"
          :key="action.bodyPose"
          class="live2d-action-btn"
          type="button"
          :disabled="!live2d.ready.value"
          @click="runBodyPose(action.bodyPose)"
        >
          {{ action.label }}
        </button>
      </div>
      <div class="live2d-actions live2d-parameter-actions">
        <button
          v-for="action in parameterActions"
          :key="action.label"
          class="live2d-action-btn"
          type="button"
          :disabled="!live2d.ready.value"
          @click="runParameterTargets(action.parameters)"
        >
          {{ action.label }}
        </button>
      </div>
      <div class="live2d-icon-actions">
        <button class="live2d-icon-btn" type="button" :disabled="!live2d.ready.value" title="Greeting" aria-label="Greeting" @click="runGreeting">
          <TsIcon name="star" :size="20" />
        </button>
        <button class="live2d-icon-btn" type="button" :disabled="!live2d.ready.value" title="Speak caption" aria-label="Speak caption" @click="speak">
          <TsIcon name="audioLines" :size="20" />
        </button>
      </div>
      <form class="live2d-llm-form" @submit.prevent="runLLMControl">
        <textarea v-model="prompt" rows="3" spellcheck="false" placeholder="Ask LLM to control Live2D"></textarea>
        <div class="live2d-llm-actions">
          <button class="live2d-action-btn live2d-run-btn" type="submit" :disabled="!live2d.ready.value || llmState.loading">
            {{ llmState.loading ? 'Thinking' : 'LLM Act' }}
          </button>
          <button class="live2d-icon-btn" type="button" title="Clear history" aria-label="Clear history" @click="resetLLMHistory">
            <TsIcon name="trash" :size="18" />
          </button>
        </div>
      </form>
      <div v-if="llmState.error || llmState.live2d" class="live2d-llm-result" :class="{ error: llmState.error }">
        <strong>{{ llmState.error ? 'ERROR' : 'ACT' }}</strong>
        <p v-if="llmState.error">{{ llmState.error }}</p>
        <p v-else>Motion queued.</p>
      </div>
    </aside>

    <div v-if="live2d.loading.value" class="live2d-loading" role="status">
      <TsIcon name="loader" :size="28" />
      <span>Loading Live2D</span>
    </div>
  </main>
</template>
