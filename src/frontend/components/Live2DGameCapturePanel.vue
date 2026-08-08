<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import TsIcon from './TsIcon.vue';
import { createLive2DGameCapture } from '../services/room/live2dGameCapture';

const GAME_CAPTURE_FIT_KEY = 'yachiyo:live2d:gameCaptureFit';
const videoRef = ref(null);
const captureState = ref({
  status: 'idle',
  sourceLabel: '',
  error: ''
});
const fit = ref(readFit());

const capture = createLive2DGameCapture({
  onState: (state) => {
    captureState.value = state;
  }
});

const isLive = computed(() => captureState.value.status === 'live');
const isSelecting = computed(() => captureState.value.status === 'selecting');
const statusLabel = computed(() => {
  if (isSelecting.value) return '正在等待窗口选择';
  if (isLive.value) return captureState.value.sourceLabel || '游戏画面已连接';
  if (captureState.value.status === 'ended') return '游戏窗口已关闭';
  return '尚未连接游戏画面';
});

function readFit() {
  try {
    return localStorage.getItem(GAME_CAPTURE_FIT_KEY) === 'cover' ? 'cover' : 'contain';
  } catch (_) {
    return 'contain';
  }
}

function toggleFit() {
  fit.value = fit.value === 'contain' ? 'cover' : 'contain';
  try {
    localStorage.setItem(GAME_CAPTURE_FIT_KEY, fit.value);
  } catch (_) {
    // The fit toggle still works when storage is unavailable.
  }
}

async function selectGameWindow() {
  try {
    await capture.start();
  } catch (_) {
    // Cancellation and capture failures are shown inside the panel.
  }
}

function stopCapture() {
  capture.stop();
}

onMounted(() => {
  capture.attach(videoRef.value);
});

onUnmounted(() => {
  capture.destroy();
});
</script>

<template>
  <section
    class="live2d-game-capture"
    :class="{ live: isLive }"
    aria-label="游戏画面"
  >
    <video
      ref="videoRef"
      class="live2d-game-capture-video"
      :class="`fit-${fit}`"
      autoplay
      muted
      playsinline
      aria-label="已选择的游戏窗口预览"
    ></video>

    <div v-if="!isLive" class="live2d-game-capture-empty">
      <span class="live2d-game-capture-icon" aria-hidden="true">
        <TsIcon name="gamepad" :size="30" />
      </span>
      <div>
        <strong>{{ statusLabel }}</strong>
        <p>选择正在运行的游戏窗口，画面会直接嵌入直播舞台。</p>
      </div>
      <button
        class="live2d-game-capture-primary"
        type="button"
        :disabled="isSelecting"
        @click="selectGameWindow"
      >
        <TsIcon :name="isSelecting ? 'loader' : 'gamepad'" :size="17" />
        <span>{{ isSelecting ? '等待选择' : '选择游戏画面' }}</span>
      </button>
      <small v-if="captureState.error">{{ captureState.error }}</small>
      <small v-else>仅预览画面，不回放采集音频，避免直播回声。</small>
    </div>

    <header v-else class="live2d-game-capture-toolbar">
      <div>
        <TsIcon name="radio" :size="16" />
        <span>
          <strong>GAME CAPTURE</strong>
          <small>{{ statusLabel }}</small>
        </span>
      </div>
      <nav aria-label="游戏画面控制">
        <button
          class="live2d-mini-btn"
          type="button"
          :title="fit === 'contain' ? '切换为铺满画面' : '切换为完整画面'"
          @click="toggleFit"
        >
          <TsIcon name="expand" :size="14" />
          <span>{{ fit === 'contain' ? '完整画面' : '铺满画面' }}</span>
        </button>
        <button class="live2d-mini-btn" type="button" @click="selectGameWindow">
          <TsIcon name="refresh" :size="14" />
          <span>更换窗口</span>
        </button>
        <button class="live2d-mini-btn danger" type="button" @click="stopCapture">
          <TsIcon name="x" :size="14" />
          <span>停止</span>
        </button>
      </nav>
    </header>
  </section>
</template>
