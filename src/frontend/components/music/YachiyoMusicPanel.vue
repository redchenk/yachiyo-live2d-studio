<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import TsIcon from '../TsIcon.vue';
import {
  executeLive2DMusicCommand,
  searchLive2DMusic,
  warmupLive2DMusicPlayback
} from '../../services/room/live2dMusic';
import {
  LIVE2D_MUSIC_QUEUE_EVENT,
  readLive2DMusicQueueState
} from '../../services/room/live2dMusicQueue';
import {
  yachiyoMusicAdapter,
  yachiyoSourceToLive2DProvider
} from '../../services/room/yachiyoMusicAdapter';
import { readRoomMusicSettings } from '../../services/room/roomSettings';
import {
  checkNeteaseMusicQrLogin,
  clearLegacyNeteaseMusicCredentials,
  createNeteaseMusicQrLogin,
  logoutNeteaseMusicAccount,
  readNeteaseMusicAccount
} from '../../services/room/live2dNeteaseAccount';

const emit = defineEmits(['result', 'error']);

const providerOptions = Object.freeze([
  { value: 'netease-cloud', label: '网易云' },
  { value: 'local-library', label: '本地曲库' },
  { value: 'apple-music', label: 'Apple Music' }
]);

const settings = readRoomMusicSettings();
const provider = ref(settings.provider || 'netease-cloud');
const query = ref('');
const searchResults = ref([]);
const queueState = ref(readLive2DMusicQueueState());
const busy = ref('');
const message = ref('');
const errorMessage = ref('');
const accountBusy = ref('');
const neteaseAccount = ref({
  loggedIn: false,
  displayName: '',
  avatarUrl: ''
});
const qrLogin = ref({
  visible: false,
  key: '',
  qrImage: '',
  qrUrl: '',
  status: 0,
  message: ''
});
let qrPollTimer = 0;
let qrPollGeneration = 0;

const currentTrack = computed(() => queueState.value.current || null);
const queuedTracks = computed(() => (queueState.value.queue || []).slice(0, 8));
const isNeteaseProvider = computed(() => provider.value === 'netease-cloud');
const providerLabel = computed(() => (
  providerOptions.find((option) => option.value === provider.value)?.label || provider.value
));
const playbackStatus = computed(() => {
  if (currentTrack.value?.status === 'playing') return '播放中';
  if (currentTrack.value?.status === 'paused') return '已暂停';
  return queuedTracks.value.length ? `排队 ${queuedTracks.value.length} 首` : '待机';
});

function formatDuration(durationMs = 0) {
  const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  if (!totalSeconds) return '--:--';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function trackTitle(track = null) {
  if (!track) return '未选择歌曲';
  return track.title || track.name || track.songId || track.id || '未知歌曲';
}

function trackArtist(track = null) {
  if (!track) return '';
  if (track.artist) return track.artist;
  if (Array.isArray(track.artists)) return track.artists.filter(Boolean).join(' / ');
  return '';
}

function trackSubtitle(track = null) {
  return [
    trackArtist(track),
    track?.album || track?.albumName,
    formatDuration(track?.durationMs ?? track?.duration),
    track?.requestedBy ? `点歌：${track.requestedBy}` : ''
  ].filter(Boolean).join(' · ');
}

function trackQueueSubtitle(track = null) {
  return [
    trackArtist(track),
    track?.requestedBy ? `点歌：${track.requestedBy}` : ''
  ].filter(Boolean).join(' · ') || '点歌';
}

function resultMessage(result = {}) {
  const title = result.title || trackTitle(result.current);
  if (result.status === 'playing') return `正在播放：${title}`;
  if (result.status === 'queued') return `已点歌：${title}${result.position ? `（队列第 ${result.position} 位）` : ''}`;
  if (result.status === 'duplicate') return `歌曲已在队列中：${title}`;
  if (result.status === 'queue-full') return '点歌队列已满';
  if (result.status === 'paused') return '音乐已暂停';
  if (result.status === 'resumed') return '继续播放';
  if (result.status === 'stopped') return '音乐已停止';
  if (result.status === 'ended') return '队列已播放完';
  if (result.status === 'cleared') return '点歌队列已清空';
  if (result.status === 'removed') return '已从队列移除';
  return `音乐状态：${result.status || '已更新'}`;
}

function syncQueue(event = null) {
  queueState.value = event?.detail || readLive2DMusicQueueState();
}

async function searchTracks() {
  const term = query.value.trim();
  if (!term || busy.value) return;
  busy.value = 'search';
  message.value = '';
  errorMessage.value = '';
  try {
    const result = provider.value === 'netease-cloud'
      ? await yachiyoMusicAdapter.search({
          query: term,
          source: 'netease',
          limit: 8
        })
      : await searchLive2DMusic(term, readRoomMusicSettings(), {
          provider: provider.value,
          limit: 8
        });
    searchResults.value = result.tracks || [];
    message.value = searchResults.value.length
      ? `找到 ${searchResults.value.length} 首，选择点歌方式`
      : '没有找到匹配歌曲';
  } catch (error) {
    errorMessage.value = error?.message || '音乐搜索失败';
    emit('error', errorMessage.value);
  } finally {
    busy.value = '';
  }
}

async function runCommand(action, payload = {}) {
  if (busy.value) return null;
  busy.value = action;
  message.value = '';
  errorMessage.value = '';
  warmupLive2DMusicPlayback().catch(() => {});
  try {
    const controlActions = new Set(['pause', 'resume', 'skip', 'stop']);
    const targetProvider = payload.provider ||
      (controlActions.has(action) ? currentTrack.value?.provider : '') ||
      provider.value;
    const requestedBy = payload.requestedBy || '主播控制台';
    const result = targetProvider === 'netease-cloud'
      ? await yachiyoMusicAdapter.execute({
          action,
          source: 'netease',
          query: payload.query,
          track: payload.track?.source === 'netease' ? payload.track : undefined,
          candidate: payload.track?.source === 'netease' ? undefined : payload.track,
          removeId: payload.removeId,
          requestedBy
        }, {
          requestedBy
        })
      : await executeLive2DMusicCommand({
          action,
          provider: targetProvider,
          query: payload.query,
          track: payload.track,
          removeId: payload.removeId,
          requestedBy
        });
    syncQueue();
    message.value = resultMessage(result || {});
    emit('result', result);
    return result;
  } catch (error) {
    errorMessage.value = error?.message || '音乐控制失败';
    emit('error', errorMessage.value);
    return null;
  } finally {
    busy.value = '';
  }
}

async function requestTrack(track, action = 'request') {
  const result = await runCommand(action, {
    provider: track.provider || yachiyoSourceToLive2DProvider(track.source, provider.value),
    query: [trackTitle(track), trackArtist(track)].filter(Boolean).join(' '),
    track
  });
  if (result && !['duplicate', 'queue-full', 'disabled'].includes(result.status)) {
    searchResults.value = [];
  }
}

function removeQueuedTrack(track) {
  const removeId = track?.uid || track?.key || track?.songId;
  if (removeId) runCommand('remove', { removeId });
}

function stopQrPolling() {
  qrPollGeneration += 1;
  if (qrPollTimer) {
    clearTimeout(qrPollTimer);
    qrPollTimer = 0;
  }
}

function closeQrLogin() {
  stopQrPolling();
  accountBusy.value = '';
  qrLogin.value = {
    visible: false,
    key: '',
    qrImage: '',
    qrUrl: '',
    status: 0,
    message: ''
  };
}

async function loadNeteaseAccount() {
  if (!isNeteaseProvider.value || accountBusy.value) return;
  accountBusy.value = 'account';
  try {
    neteaseAccount.value = await readNeteaseMusicAccount();
  } catch (error) {
    neteaseAccount.value = { loggedIn: false, displayName: '', avatarUrl: '' };
    errorMessage.value = error?.message || '读取网易云登录状态失败';
  } finally {
    if (accountBusy.value === 'account') accountBusy.value = '';
  }
}

function scheduleQrCheck(key, generation) {
  if (!key || generation !== qrPollGeneration || !qrLogin.value.visible) return;
  qrPollTimer = window.setTimeout(() => pollQrLogin(key, generation), 2200);
}

async function pollQrLogin(key, generation) {
  if (generation !== qrPollGeneration || !qrLogin.value.visible) return;
  try {
    const result = await checkNeteaseMusicQrLogin(key);
    if (generation !== qrPollGeneration) return;
    qrLogin.value = {
      ...qrLogin.value,
      status: result.status,
      message: result.message || qrLogin.value.message
    };
    if (result.status === 803 && result.loggedIn) {
      clearLegacyNeteaseMusicCredentials();
      neteaseAccount.value = result.account;
      message.value = `网易云已登录：${result.account.displayName || '网易云账号'}`;
      closeQrLogin();
      return;
    }
    if (result.status === 800) {
      accountBusy.value = '';
      return;
    }
    scheduleQrCheck(key, generation);
  } catch (error) {
    if (generation !== qrPollGeneration) return;
    accountBusy.value = '';
    qrLogin.value = {
      ...qrLogin.value,
      message: error?.message || '检查扫码状态失败'
    };
  }
}

async function startQrLogin() {
  if (accountBusy.value) return;
  stopQrPolling();
  accountBusy.value = 'qr';
  errorMessage.value = '';
  message.value = '';
  try {
    const result = await createNeteaseMusicQrLogin();
    qrLogin.value = {
      visible: true,
      key: result.key,
      qrImage: result.qrImage,
      qrUrl: result.qrUrl,
      status: result.status,
      message: result.message
    };
    const generation = qrPollGeneration;
    scheduleQrCheck(result.key, generation);
  } catch (error) {
    accountBusy.value = '';
    errorMessage.value = error?.message || '生成网易云登录二维码失败';
  }
}

async function logoutNetease() {
  if (accountBusy.value) return;
  stopQrPolling();
  accountBusy.value = 'logout';
  errorMessage.value = '';
  try {
    await logoutNeteaseMusicAccount();
    neteaseAccount.value = { loggedIn: false, displayName: '', avatarUrl: '' };
    message.value = '已退出网易云音乐';
  } catch (error) {
    errorMessage.value = error?.message || '退出网易云失败';
  } finally {
    accountBusy.value = '';
  }
}

watch(provider, (nextProvider) => {
  searchResults.value = [];
  message.value = '';
  errorMessage.value = '';
  if (nextProvider === 'netease-cloud') {
    loadNeteaseAccount();
  } else {
    closeQrLogin();
  }
});

onMounted(() => {
  window.addEventListener(LIVE2D_MUSIC_QUEUE_EVENT, syncQueue);
  syncQueue();
  loadNeteaseAccount();
});

onUnmounted(() => {
  stopQrPolling();
  window.removeEventListener(LIVE2D_MUSIC_QUEUE_EVENT, syncQueue);
});
</script>

<template>
  <section class="yachiyo-music-panel" aria-label="八千代音乐播放器">
    <header class="yachiyo-music-header">
      <div>
        <span>Yachiyo Music</span>
        <strong>{{ playbackStatus }}</strong>
      </div>
      <span class="yachiyo-music-tool-status" title="LLM 可通过 music_control 接口调用">
        <i aria-hidden="true"></i>
        LLM 已连接
      </span>
    </header>

    <section v-if="isNeteaseProvider" class="yachiyo-music-account" aria-label="网易云音乐账号">
      <div class="yachiyo-music-account-avatar" aria-hidden="true">
        <img v-if="neteaseAccount.avatarUrl" :src="neteaseAccount.avatarUrl" alt="">
        <TsIcon v-else name="user" :size="16" />
      </div>
      <div class="yachiyo-music-account-copy">
        <strong>{{ neteaseAccount.loggedIn ? (neteaseAccount.displayName || '网易云账号') : '网易云未登录' }}</strong>
        <small>{{ neteaseAccount.loggedIn ? '已启用账号版权与音质权限' : '扫码登录后可播放账号可用歌曲' }}</small>
      </div>
      <button
        v-if="neteaseAccount.loggedIn"
        class="live2d-mini-btn"
        type="button"
        :disabled="Boolean(accountBusy)"
        @click="logoutNetease"
      >
        {{ accountBusy === 'logout' ? '退出中' : '退出' }}
      </button>
      <button
        v-else
        class="live2d-mini-btn yachiyo-music-login-btn"
        type="button"
        :disabled="Boolean(accountBusy)"
        @click="startQrLogin"
      >
        {{ accountBusy ? '连接中' : '扫码登录' }}
      </button>
    </section>

    <section
      v-if="qrLogin.visible"
      class="yachiyo-music-qr"
      role="dialog"
      aria-modal="true"
      aria-label="网易云音乐扫码登录"
    >
      <button
        class="live2d-icon-btn yachiyo-music-qr-close"
        type="button"
        title="关闭扫码登录"
        aria-label="关闭扫码登录"
        @click="closeQrLogin"
      >
        <TsIcon name="x" :size="14" />
      </button>
      <div class="yachiyo-music-qr-image">
        <img v-if="qrLogin.qrImage" :src="qrLogin.qrImage" alt="网易云音乐登录二维码">
        <TsIcon v-else name="radio" :size="42" />
      </div>
      <div class="yachiyo-music-qr-copy">
        <strong>使用网易云音乐 App 扫码</strong>
        <small>{{ qrLogin.message || '扫码后请在手机上确认登录' }}</small>
        <button
          v-if="qrLogin.status === 800"
          class="live2d-mini-btn"
          type="button"
          :disabled="Boolean(accountBusy)"
          @click="startQrLogin"
        >
          重新生成
        </button>
      </div>
    </section>

    <form class="yachiyo-music-search" role="search" @submit.prevent="searchTracks">
      <select v-model="provider" aria-label="音乐来源">
        <option v-for="option in providerOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <label>
        <span class="sr-only">搜索歌曲或歌手</span>
        <input
          v-model="query"
          type="search"
          spellcheck="false"
          autocomplete="off"
          placeholder="搜索歌曲、歌手"
        >
      </label>
      <button
        class="live2d-icon-btn"
        type="submit"
        title="搜索歌曲"
        aria-label="搜索歌曲"
        :disabled="Boolean(busy) || !query.trim()"
      >
        <TsIcon name="search" :size="17" />
      </button>
    </form>

    <p v-if="message" class="yachiyo-music-message" role="status" aria-live="polite">{{ message }}</p>
    <p v-if="errorMessage" class="yachiyo-music-error" role="alert">{{ errorMessage }}</p>

    <div v-if="searchResults.length" class="yachiyo-music-results" aria-label="音乐搜索结果">
      <article
        v-for="track in searchResults"
        :key="`${track.provider || track.source}-${track.songId || track.id}`"
        class="yachiyo-music-result"
      >
        <div class="yachiyo-music-cover yachiyo-music-cover-small">
          <img v-if="track.artworkUrl || track.albumCoverUrl" :src="track.artworkUrl || track.albumCoverUrl" alt="" loading="lazy">
          <TsIcon v-else name="music" :size="17" />
        </div>
        <div class="yachiyo-music-track-copy">
          <strong>{{ trackTitle(track) }}</strong>
          <small>{{ trackSubtitle(track) || providerLabel }}</small>
        </div>
        <div class="yachiyo-music-result-actions">
          <button
            class="live2d-mini-btn"
            type="button"
            title="加入点歌队列"
            :aria-label="`点歌：${trackTitle(track)}`"
            :disabled="Boolean(busy)"
            @click="requestTrack(track, 'request')"
          >
            点歌
          </button>
          <button
            class="live2d-icon-btn"
            type="button"
            title="立即播放"
            :aria-label="`立即播放：${trackTitle(track)}`"
            :disabled="Boolean(busy)"
            @click="requestTrack(track, 'play_now')"
          >
            <TsIcon name="play" :size="15" />
          </button>
        </div>
      </article>
    </div>

    <article v-if="currentTrack" class="yachiyo-music-now">
      <div class="yachiyo-music-cover">
        <img v-if="currentTrack.artworkUrl" :src="currentTrack.artworkUrl" alt="">
        <TsIcon v-else name="music" :size="22" />
      </div>
      <div class="yachiyo-music-track-copy">
        <span>正在播放</span>
        <strong>{{ trackTitle(currentTrack) }}</strong>
        <small>{{ trackSubtitle(currentTrack) }}</small>
      </div>
      <div class="yachiyo-music-now-actions">
        <button
          class="live2d-icon-btn"
          type="button"
          :title="currentTrack.status === 'paused' ? '继续播放' : '暂停'"
          :aria-label="currentTrack.status === 'paused' ? '继续播放' : '暂停'"
          :disabled="Boolean(busy)"
          @click="runCommand(currentTrack.status === 'paused' ? 'resume' : 'pause')"
        >
          <TsIcon :name="currentTrack.status === 'paused' ? 'play' : 'pause'" :size="16" />
        </button>
        <button
          class="live2d-icon-btn"
          type="button"
          title="下一首"
          aria-label="下一首"
          :disabled="Boolean(busy)"
          @click="runCommand('skip')"
        >
          <TsIcon name="skipForward" :size="16" />
        </button>
      </div>
    </article>

    <article v-else class="yachiyo-music-empty">
      <TsIcon name="music" :size="18" />
      <div>
        <strong>还没有播放歌曲</strong>
        <small>搜索后点歌，或直接让 LLM 说“播放歌曲名”。</small>
      </div>
    </article>

    <section class="yachiyo-music-queue" aria-label="点歌队列">
      <header>
        <span>接下来</span>
        <button
          class="live2d-mini-btn"
          type="button"
          :disabled="Boolean(busy) || !queuedTracks.length"
          @click="runCommand('clear')"
        >
          清空
        </button>
      </header>
      <div v-if="queuedTracks.length" class="yachiyo-music-queue-list">
        <article v-for="(track, index) in queuedTracks" :key="track.uid || track.key">
          <span>{{ index + 1 }}</span>
          <div class="yachiyo-music-track-copy">
            <strong>{{ trackTitle(track) }}</strong>
            <small>{{ trackQueueSubtitle(track) }}</small>
          </div>
          <button
            class="live2d-icon-btn"
            type="button"
            title="从队列移除"
            :aria-label="`移除：${trackTitle(track)}`"
            :disabled="Boolean(busy)"
            @click="removeQueuedTrack(track)"
          >
            <TsIcon name="x" :size="14" />
          </button>
        </article>
      </div>
      <p v-else>队列为空，普通点歌会按先来后到播放。</p>
    </section>
  </section>
</template>
