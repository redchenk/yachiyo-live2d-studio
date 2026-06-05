<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import TsIcon from '@frontend/components/TsIcon.vue';
import {
  normalizeRoomBilibiliDanmakuSettings,
  readRoomBilibiliDanmakuSettings,
  writeRoomBilibiliDanmakuSettings
} from '@frontend/services/room/roomSettings';
import {
  BILIBILI_DANMAKU_EVENT,
  BILIBILI_DANMAKU_STATE_EVENT,
  clearBilibiliDanmakuMessages,
  readBilibiliDanmakuSnapshot,
  startBilibiliDanmakuListener,
  stopBilibiliDanmakuListener,
  syncBilibiliDanmakuListener
} from '@frontend/services/room/live2dBilibiliDanmaku';

const settings = reactive(normalizeRoomBilibiliDanmakuSettings(readRoomBilibiliDanmakuSettings()));
const snapshot = readBilibiliDanmakuSnapshot();
const state = ref(snapshot.state);
const messages = ref(snapshot.messages);
const busy = ref('');
const localError = ref('');

const connected = computed(() => state.value.connected || state.value.listening);
const statusTone = computed(() => {
  if (state.value.status === 'error') return 'error';
  if (state.value.listening) return 'ok';
  if (state.value.status === 'connecting' || state.value.status === 'connected') return 'warn';
  return 'idle';
});
const statusLabel = computed(() => {
  if (state.value.status === 'error') return 'Error';
  if (state.value.listening) return 'Listening';
  if (state.value.status === 'connecting') return 'Connecting';
  if (state.value.status === 'connected') return 'Connected';
  if (state.value.status === 'closed') return 'Closed';
  return 'Idle';
});
const connectionRoom = computed(() => state.value.actualRoomId || state.value.roomId || settings.roomId || 'Unset');
const latestMessage = computed(() => messages.value[0] || null);

function formatTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '--:--:--';
  return new Date(numeric).toLocaleTimeString();
}

function messageTypeLabel(type) {
  const labels = {
    danmu: 'Danmu',
    superchat: 'Super Chat',
    gift: 'Gift',
    guard: 'Guard',
    'live-start': 'Live',
    'live-end': 'Live'
  };
  return labels[type] || String(type || 'Message');
}

function applySnapshot(nextSnapshot = readBilibiliDanmakuSnapshot()) {
  state.value = nextSnapshot.state;
  messages.value = nextSnapshot.messages;
}

function dispatchSettingsSaved(saved) {
  window.dispatchEvent(new CustomEvent('tsukuyomi:studio-settings-saved', {
    detail: { bilibiliDanmaku: saved }
  }));
}

function saveSettings() {
  const saved = writeRoomBilibiliDanmakuSettings(settings);
  Object.assign(settings, saved);
  dispatchSettingsSaved(saved);
  return saved;
}

function runTask(name, action) {
  if (busy.value) return;
  busy.value = name;
  localError.value = '';
  try {
    const nextSnapshot = action();
    if (nextSnapshot) applySnapshot(nextSnapshot);
  } catch (error) {
    localError.value = error?.message || `${name} failed`;
    applySnapshot();
  } finally {
    busy.value = '';
  }
}

function saveAndSync() {
  runTask('save', () => syncBilibiliDanmakuListener(saveSettings()));
}

function connectNow() {
  runTask('connect', () => {
    const saved = writeRoomBilibiliDanmakuSettings({
      ...settings,
      enabled: true
    });
    Object.assign(settings, saved);
    dispatchSettingsSaved(saved);
    return startBilibiliDanmakuListener(saved);
  });
}

function disconnectNow() {
  runTask('disconnect', () => stopBilibiliDanmakuListener());
}

function clearMessages() {
  runTask('clear', () => clearBilibiliDanmakuMessages());
}

function onStateChanged(event) {
  state.value = event.detail || readBilibiliDanmakuSnapshot().state;
  messages.value = readBilibiliDanmakuSnapshot().messages;
}

function onMessage(event) {
  const message = event.detail;
  if (!message?.id) {
    applySnapshot();
    return;
  }
  messages.value = [
    message,
    ...messages.value.filter((item) => item.id !== message.id)
  ].slice(0, 100);
}

onMounted(() => {
  window.addEventListener(BILIBILI_DANMAKU_STATE_EVENT, onStateChanged);
  window.addEventListener(BILIBILI_DANMAKU_EVENT, onMessage);
  applySnapshot();
  if (settings.enabled && settings.autoConnect) {
    runTask('connect', () => syncBilibiliDanmakuListener(settings));
  }
});

onUnmounted(() => {
  window.removeEventListener(BILIBILI_DANMAKU_STATE_EVENT, onStateChanged);
  window.removeEventListener(BILIBILI_DANMAKU_EVENT, onMessage);
});
</script>

<template>
  <main class="studio-music-page studio-danmaku-page">
    <section class="studio-music-toolbar studio-danmaku-toolbar" aria-label="Bilibili danmaku runtime">
      <header>
        <span>Bilibili Live</span>
        <strong>Danmaku</strong>
      </header>
      <div class="studio-danmaku-status" :class="statusTone">
        <span></span>
        <strong>{{ statusLabel }}</strong>
        <small>{{ connectionRoom }}</small>
      </div>
      <div class="studio-music-actions">
        <button class="studio-primary-btn" type="button" :disabled="Boolean(busy) || connected" @click="connectNow">
          <TsIcon name="radio" :size="16" />
          <span>{{ busy === 'connect' ? 'Connecting' : 'Connect' }}</span>
        </button>
        <button class="studio-secondary-btn" type="button" :disabled="Boolean(busy) || !connected" @click="disconnectNow">
          <TsIcon name="pause" :size="16" />
          <span>Disconnect</span>
        </button>
        <button class="studio-secondary-btn" type="button" :disabled="Boolean(busy)" @click="saveAndSync">
          <TsIcon name="save" :size="16" />
          <span>Save</span>
        </button>
      </div>
    </section>

    <section class="studio-music-grid studio-danmaku-grid">
      <article class="studio-music-card studio-danmaku-card studio-danmaku-settings">
        <header>
          <TsIcon name="settings2" :size="18" />
          <h2>Source</h2>
        </header>
        <label>
          <span>Room ID</span>
          <input v-model="settings.roomId" type="text" inputmode="numeric" spellcheck="false" placeholder="Long room ID">
        </label>
        <div class="studio-danmaku-switches">
          <label class="studio-check-row">
            <input v-model="settings.enabled" type="checkbox">
            <span>Enabled</span>
          </label>
          <label class="studio-check-row">
            <input v-model="settings.autoConnect" type="checkbox">
            <span>Auto Connect</span>
          </label>
          <label class="studio-check-row">
            <input v-model="settings.autoForward" type="checkbox">
            <span>Forward to Live2D</span>
          </label>
        </div>
        <div class="studio-music-settings-row">
          <label>
            <span>Forward Limit</span>
            <input v-model.number="settings.maxForwardPerMinute" type="number" min="0" max="120" step="1">
          </label>
          <label>
            <span>Platform</span>
            <input v-model="settings.platform" type="text" spellcheck="false">
          </label>
        </div>
        <div class="studio-music-settings-row">
          <label>
            <span>UID</span>
            <input v-model.number="settings.uid" type="number" min="0" step="1">
          </label>
          <label>
            <span>Buvid</span>
            <input v-model="settings.buvid" type="text" spellcheck="false">
          </label>
        </div>
        <label>
          <span>Login Key</span>
          <input v-model="settings.key" type="password" spellcheck="false" placeholder="Optional">
        </label>
        <label>
          <span>Cookie</span>
          <textarea v-model="settings.cookie" rows="4" spellcheck="false" placeholder="Stored for local proxy use"></textarea>
        </label>
      </article>

      <article class="studio-music-card studio-danmaku-card">
        <header>
          <TsIcon name="activity" :size="18" />
          <h2>Status</h2>
        </header>
        <div class="studio-music-status-grid studio-danmaku-metrics">
          <div>
            <span>Status</span>
            <strong>{{ statusLabel }}</strong>
          </div>
          <div>
            <span>Room</span>
            <strong>{{ connectionRoom }}</strong>
          </div>
          <div>
            <span>Messages</span>
            <strong>{{ state.messageCount }}</strong>
          </div>
          <div>
            <span>Attention</span>
            <strong>{{ state.attention || 0 }}</strong>
          </div>
          <div>
            <span>Watched</span>
            <strong>{{ state.watched || 'Unknown' }}</strong>
          </div>
          <div>
            <span>Updated</span>
            <strong>{{ formatTime(state.updatedAt) }}</strong>
          </div>
        </div>
        <p v-if="localError || state.error" class="studio-danmaku-error">
          {{ localError || state.error }}
        </p>
        <div class="studio-music-now">
          <span>Latest</span>
          <strong>{{ latestMessage ? `${latestMessage.userName}: ${latestMessage.text}` : 'No messages yet' }}</strong>
          <small>{{ latestMessage ? messageTypeLabel(latestMessage.type) : 'Idle' }}</small>
        </div>
      </article>

      <article class="studio-music-card studio-danmaku-card studio-danmaku-log-card">
        <header>
          <TsIcon name="message" :size="18" />
          <h2>Recent</h2>
          <button class="studio-secondary-btn studio-danmaku-clear" type="button" :disabled="Boolean(busy) || !messages.length" @click="clearMessages">
            <TsIcon name="trash" :size="14" />
            <span>Clear</span>
          </button>
        </header>
        <div class="studio-danmaku-log">
          <article v-for="line in messages" :key="line.id" class="studio-danmaku-message" :class="line.type">
            <header>
              <strong>{{ line.userName }}</strong>
              <span>{{ messageTypeLabel(line.type) }}</span>
              <time>{{ formatTime(line.timestamp) }}</time>
            </header>
            <p>{{ line.text }}</p>
            <small v-if="line.price">RMB {{ line.price }}</small>
          </article>
          <p v-if="!messages.length" class="studio-danmaku-empty">No messages yet</p>
        </div>
      </article>
    </section>
  </main>
</template>
