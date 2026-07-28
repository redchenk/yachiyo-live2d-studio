<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import TsIcon from '@frontend/components/TsIcon.vue';
import {
  normalizeRoomBilibiliDanmakuSettings,
  readRoomBilibiliDanmakuSettings,
  writeRoomBilibiliDanmakuSettings
} from '@frontend/services/room/roomSettings';
import {
  BILIBILI_DANMAKU_STATE_EVENT,
  clearBilibiliDanmakuMessages,
  publishBilibiliDanmakuTestMessage,
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
  if (state.value.status === 'error') return '连接失败';
  if (state.value.listening) return '正在接收';
  if (state.value.status === 'connecting') return '正在获取连接信息';
  if (state.value.status === 'connected') return '正在认证';
  if (state.value.status === 'closed') return '连接已断开';
  return '未连接';
});
const authLabel = computed(() => {
  if (state.value.authMode === 'authenticated' && state.value.userNamesComplete) {
    return '登录模式 · 完整昵称';
  }
  if (connected.value) return '匿名模式 · 昵称可能隐藏';
  return '连接后检测';
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

async function runTask(name, action) {
  if (busy.value) return;
  busy.value = name;
  localError.value = '';
  try {
    const nextSnapshot = await action();
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

function sendTestMessage() {
  runTask('test', () => {
    const saved = writeRoomBilibiliDanmakuSettings({
      ...settings,
      enabled: true
    });
    Object.assign(settings, saved);
    dispatchSettingsSaved(saved);
    publishBilibiliDanmakuTestMessage();
    return readBilibiliDanmakuSnapshot();
  });
}

function onStateChanged(event) {
  state.value = event.detail || readBilibiliDanmakuSnapshot().state;
  messages.value = readBilibiliDanmakuSnapshot().messages;
}

onMounted(() => {
  window.addEventListener(BILIBILI_DANMAKU_STATE_EVENT, onStateChanged);
  applySnapshot();
  if (settings.enabled && settings.autoConnect) {
    runTask('connect', () => syncBilibiliDanmakuListener(settings));
  }
});

onUnmounted(() => {
  window.removeEventListener(BILIBILI_DANMAKU_STATE_EVENT, onStateChanged);
});
</script>

<template>
  <main class="studio-music-page studio-danmaku-page">
    <section class="studio-music-toolbar studio-danmaku-toolbar" aria-label="Bilibili danmaku runtime">
      <header>
        <span>Bilibili Live</span>
        <strong>B站弹幕</strong>
      </header>
      <div class="studio-danmaku-status" :class="statusTone">
        <span></span>
        <strong>{{ statusLabel }}</strong>
        <small>{{ connectionRoom }}</small>
      </div>
      <div class="studio-music-actions">
        <button class="studio-primary-btn" type="button" :disabled="Boolean(busy) || connected" @click="connectNow">
          <TsIcon name="radio" :size="16" />
          <span>{{ busy === 'connect' ? '连接中' : '连接直播间' }}</span>
        </button>
        <button class="studio-secondary-btn" type="button" :disabled="Boolean(busy) || !connected" @click="disconnectNow">
          <TsIcon name="pause" :size="16" />
          <span>断开</span>
        </button>
        <button class="studio-secondary-btn" type="button" :disabled="Boolean(busy)" @click="saveAndSync">
          <TsIcon name="save" :size="16" />
          <span>保存设置</span>
        </button>
        <button class="studio-secondary-btn" type="button" :disabled="Boolean(busy)" @click="sendTestMessage">
          <TsIcon name="message" :size="16" />
          <span>测试弹幕</span>
        </button>
      </div>
    </section>

    <section class="studio-music-grid studio-danmaku-grid">
      <article class="studio-music-card studio-danmaku-card studio-danmaku-settings">
        <header>
          <TsIcon name="settings2" :size="18" />
          <h2>直播间来源</h2>
        </header>
        <label>
          <span>B站直播间 ID</span>
          <input v-model="settings.roomId" type="text" inputmode="numeric" spellcheck="false" placeholder="例如 25271643">
        </label>
        <label>
          <span>B站完整 Cookie 请求头（用于完整昵称）</span>
          <input
            v-model="settings.cookie"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="粘贴完整 Cookie 请求头"
          >
        </label>
        <div class="studio-danmaku-switches">
          <label class="studio-check-row">
            <input v-model="settings.enabled" type="checkbox">
            <span>启用 B站弹幕</span>
          </label>
          <label class="studio-check-row">
            <input v-model="settings.autoConnect" type="checkbox">
            <span>启动时自动连接</span>
          </label>
          <label class="studio-check-row">
            <input v-model="settings.autoForward" type="checkbox">
            <span>交给 AI 回应</span>
          </label>
          <label class="studio-check-row">
            <input v-model="settings.autoStartDirector" type="checkbox">
            <span>首条弹幕自动开播</span>
          </label>
          <label class="studio-check-row">
            <input v-model="settings.readAloud" type="checkbox">
            <span>直接朗读弹幕</span>
          </label>
          <label class="studio-check-row">
            <input v-model="settings.readUserName" type="checkbox">
            <span>朗读观众昵称</span>
          </label>
        </div>
        <div class="studio-music-settings-row">
          <label>
            <span>每分钟处理上限</span>
            <input v-model.number="settings.maxForwardPerMinute" type="number" min="0" max="120" step="1">
          </label>
          <label>
            <span>连接平台</span>
            <input v-model="settings.platform" type="text" spellcheck="false">
          </label>
        </div>
        <p class="studio-danmaku-hint">
          请勿逐项拼接 Cookie。请在已登录的 B站页面打开开发者工具 → Network，刷新后选中 api.bilibili.com 请求，从 Request Headers 复制完整 Cookie 请求头值（不含 Cookie: 前缀）并整段粘贴。Cookie 只发送给本机代理；认证失败仍会匿名连接。
        </p>
      </article>

      <article class="studio-music-card studio-danmaku-card">
        <header>
          <TsIcon name="activity" :size="18" />
          <h2>连接状态</h2>
        </header>
        <div class="studio-music-status-grid studio-danmaku-metrics">
          <div>
            <span>状态</span>
            <strong>{{ statusLabel }}</strong>
          </div>
          <div>
            <span>房间</span>
            <strong>{{ connectionRoom }}</strong>
          </div>
          <div>
            <span>用户昵称</span>
            <strong>{{ authLabel }}</strong>
          </div>
          <div>
            <span>弹幕数</span>
            <strong>{{ state.messageCount }}</strong>
          </div>
          <div>
            <span>关注数</span>
            <strong>{{ state.attention || 0 }}</strong>
          </div>
          <div>
            <span>看过</span>
            <strong>{{ state.watched || 'Unknown' }}</strong>
          </div>
          <div>
            <span>更新时间</span>
            <strong>{{ formatTime(state.updatedAt) }}</strong>
          </div>
        </div>
        <p v-if="localError || state.error" class="studio-danmaku-error">
          {{ localError || state.error }}
        </p>
        <p v-if="state.authWarning" class="studio-danmaku-error">
          {{ state.authWarning }}
        </p>
        <div class="studio-music-now">
          <span>最新弹幕</span>
          <strong>{{ latestMessage ? `${latestMessage.userName}: ${latestMessage.text}` : '还没有收到弹幕' }}</strong>
          <small>{{ latestMessage ? messageTypeLabel(latestMessage.type) : '等待中' }}</small>
        </div>
      </article>

      <article class="studio-music-card studio-danmaku-card studio-danmaku-log-card">
        <header>
          <TsIcon name="message" :size="18" />
          <h2>最近弹幕</h2>
          <button class="studio-secondary-btn studio-danmaku-clear" type="button" :disabled="Boolean(busy) || !messages.length" @click="clearMessages">
            <TsIcon name="trash" :size="14" />
            <span>清空</span>
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
          <p v-if="!messages.length" class="studio-danmaku-empty">暂时没有弹幕</p>
        </div>
      </article>
    </section>
  </main>
</template>
