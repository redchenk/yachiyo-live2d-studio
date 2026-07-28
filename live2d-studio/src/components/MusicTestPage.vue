<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import TsIcon from '@frontend/components/TsIcon.vue';
import {
  normalizeRoomMusicSettings,
  readRoomMusicSettings,
  writeRoomMusicSettings
} from '@frontend/services/room/roomSettings';
import { executeLive2DMusicCommand } from '@frontend/services/room/live2dMusic';
import {
  LIVE2D_MUSIC_QUEUE_EVENT,
  readLive2DMusicQueueState
} from '@frontend/services/room/live2dMusicQueue';
import {
  checkNeteaseMusicQrLogin,
  clearLegacyNeteaseMusicCredentials,
  createNeteaseMusicQrLogin,
  logoutNeteaseMusicAccount,
  readNeteaseMusicAccount
} from '@frontend/services/room/live2dNeteaseAccount';

const music = reactive(normalizeRoomMusicSettings({
  ...readRoomMusicSettings(),
  enabled: true,
  provider: 'netease-cloud'
}));
const query = ref('周杰伦 晴天');
const busy = ref('');
const serviceStatus = ref(null);
const candidates = ref([]);
const selectedSongId = ref('');
const resolved = ref(null);
const logs = ref([]);
const queueState = ref(readLive2DMusicQueueState());
const account = ref({ loggedIn: false, displayName: '', avatarUrl: '', source: '' });
const loginBusy = ref(false);
const qrLogin = ref(null);
let qrPollTimer = 0;
let qrPollGeneration = 0;

const selectedSong = computed(() => candidates.value.find((song) => song.songId === selectedSongId.value) || null);
const currentMusic = computed(() => queueState.value.current || null);
const selectedTitle = computed(() => musicSongTitle(selectedSong.value));
const accountStatusLabel = computed(() => account.value.loggedIn ? (account.value.displayName || 'Logged in') : 'Logged out');
const serviceReadyLabel = computed(() => {
  if (!serviceStatus.value) return 'Unknown';
  return serviceStatus.value.ready ? 'Ready' : 'Offline';
});

function musicSongTitle(song = null) {
  return [song?.title, song?.artist].map((item) => String(item || '').trim()).filter(Boolean).join(' - ') ||
    String(song?.songId || song?.url || '').trim();
}

function log(type, message, detail = null) {
  logs.value = [{
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    message,
    detail,
    createdAt: new Date().toLocaleTimeString()
  }, ...logs.value].slice(0, 80);
}

function saveMusicSettings() {
  const saved = writeRoomMusicSettings({
    ...music,
    enabled: true,
    provider: 'netease-cloud'
  });
  Object.assign(music, saved);
  window.dispatchEvent(new CustomEvent('tsukuyomi:studio-settings-saved', {
    detail: { music: saved }
  }));
  return saved;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || `${url} failed (${response.status})`);
  }
  return data;
}

async function runTask(name, action) {
  if (busy.value) return null;
  busy.value = name;
  try {
    return await action();
  } catch (error) {
    log('error', error?.message || `${name} failed`);
    return null;
  } finally {
    busy.value = '';
  }
}

async function probeService() {
  return runTask('probe', async () => {
    const settings = saveMusicSettings();
    const result = await postJson('/api/music/netease/managed/status', settings);
    serviceStatus.value = result;
    log(
      result.ready ? 'ok' : 'warn',
      result.ready ? 'Managed api-enhanced is ready' : 'Managed api-enhanced is not ready',
      result
    );
    return result;
  });
}

async function searchSongs() {
  return runTask('search', async () => {
    const settings = saveMusicSettings();
    const result = await postJson('/api/music/netease/search', {
      ...settings,
      query: query.value,
      limit: settings.searchLimit || 25
    });
    candidates.value = Array.isArray(result.candidates) ? result.candidates : [];
    selectedSongId.value = candidates.value[0]?.songId || '';
    resolved.value = null;
    log(candidates.value.length ? 'ok' : 'warn', `Search returned ${candidates.value.length} songs`, result);
    return result;
  });
}

async function resolveSelected() {
  return runTask('resolve', async () => {
    const song = selectedSong.value;
    if (!song) throw new Error('Select a song first.');
    const settings = saveMusicSettings();
    const result = await postJson('/api/music/netease/resolve', {
      ...settings,
      candidate: song,
      songId: song.songId
    });
    resolved.value = result.candidate || null;
    log(resolved.value?.url ? 'ok' : 'warn', resolved.value?.url ? `Resolved ${musicSongTitle(song)}` : 'Resolve returned no stream URL', result);
    return result;
  });
}

async function playSelected() {
  return runTask('play', async () => {
    const song = selectedSong.value;
    if (!song) throw new Error('Select a song first.');
    saveMusicSettings();
    const result = await executeLive2DMusicCommand({
      action: 'play_now',
      songId: song.songId,
      query: musicSongTitle(song)
    });
    queueState.value = readLive2DMusicQueueState();
    log(result?.status === 'playing' ? 'ok' : 'warn', `Runtime play: ${result?.status || 'unknown'}`, result);
    return result;
  });
}

async function controlMusic(action) {
  return runTask(action, async () => {
    saveMusicSettings();
    const result = await executeLive2DMusicCommand({ action });
    queueState.value = readLive2DMusicQueueState();
    log('ok', `Runtime ${action}: ${result?.status || 'done'}`, result);
    return result;
  });
}

function selectSong(song) {
  selectedSongId.value = song?.songId || '';
  resolved.value = null;
}

function queueChanged(event) {
  queueState.value = event.detail || readLive2DMusicQueueState();
}

function stopQrPolling() {
  qrPollGeneration += 1;
  if (qrPollTimer) {
    clearTimeout(qrPollTimer);
    qrPollTimer = 0;
  }
}

async function refreshAccount() {
  try {
    account.value = await readNeteaseMusicAccount(music);
  } catch (error) {
    log('warn', error?.message || 'Unable to read NetEase account');
  }
}

function scheduleQrCheck(key, generation) {
  if (!key || generation !== qrPollGeneration || !qrLogin.value) return;
  qrPollTimer = window.setTimeout(async () => {
    try {
      const result = await checkNeteaseMusicQrLogin(key, music);
      if (generation !== qrPollGeneration) return;
      qrLogin.value = { ...qrLogin.value, status: result.status, message: result.message };
      if (result.status === 803 && result.loggedIn) {
        Object.assign(music, clearLegacyNeteaseMusicCredentials(music));
        account.value = result.account;
        loginBusy.value = false;
        qrLogin.value = null;
        log('ok', `Logged in as ${result.account.displayName || 'NetEase account'}`);
        return;
      }
      if (result.status === 800) {
        loginBusy.value = false;
        return;
      }
      scheduleQrCheck(key, generation);
    } catch (error) {
      loginBusy.value = false;
      log('error', error?.message || 'QR login check failed');
    }
  }, 2200);
}

async function startQrLogin() {
  if (loginBusy.value) return;
  stopQrPolling();
  loginBusy.value = true;
  try {
    const result = await createNeteaseMusicQrLogin(music);
    qrLogin.value = result;
    scheduleQrCheck(result.key, qrPollGeneration);
  } catch (error) {
    loginBusy.value = false;
    log('error', error?.message || 'QR login creation failed');
  }
}

async function logoutAccount() {
  if (loginBusy.value) return;
  stopQrPolling();
  loginBusy.value = true;
  try {
    await logoutNeteaseMusicAccount(music);
    Object.assign(music, readRoomMusicSettings());
    account.value = { loggedIn: false, displayName: '', avatarUrl: '', source: '' };
    qrLogin.value = null;
    log('ok', 'Logged out from NetEase Cloud Music');
  } catch (error) {
    log('error', error?.message || 'NetEase logout failed');
  } finally {
    loginBusy.value = false;
  }
}

onMounted(() => {
  window.addEventListener(LIVE2D_MUSIC_QUEUE_EVENT, queueChanged);
  refreshAccount();
});

onUnmounted(() => {
  stopQrPolling();
  window.removeEventListener(LIVE2D_MUSIC_QUEUE_EVENT, queueChanged);
});
</script>

<template>
  <main class="studio-music-page">
    <section class="studio-music-toolbar" aria-label="Music diagnostics">
      <header>
        <span>Music Lab</span>
        <strong>NetEase Cloud</strong>
      </header>
      <div class="studio-music-actions">
        <button class="studio-primary-btn" type="button" :disabled="Boolean(busy)" @click="probeService">
          <TsIcon name="radio" :size="16" />
          <span>{{ busy === 'probe' ? 'Probing' : 'Probe' }}</span>
        </button>
        <button class="studio-secondary-btn" type="button" :disabled="Boolean(busy)" @click="saveMusicSettings">
          <TsIcon name="save" :size="16" />
          <span>Save</span>
        </button>
      </div>
    </section>

    <section class="studio-music-grid">
      <article class="studio-music-card studio-music-settings">
        <header>
          <TsIcon name="settings2" :size="18" />
          <h2>Provider</h2>
        </header>
        <label>
          <span>Managed URL</span>
          <input v-model="music.neteaseApiUrl" type="text" spellcheck="false">
        </label>
        <section class="studio-music-account">
          <img v-if="account.avatarUrl" :src="account.avatarUrl" alt="">
          <TsIcon v-else name="user" :size="20" />
          <div>
            <strong>{{ accountStatusLabel }}</strong>
            <small>{{ account.loggedIn ? 'Secure desktop login' : 'Use the NetEase Music App to scan' }}</small>
          </div>
          <button
            v-if="account.loggedIn"
            class="studio-secondary-btn"
            type="button"
            :disabled="loginBusy"
            @click="logoutAccount"
          >
            Logout
          </button>
          <button
            v-else
            class="studio-primary-btn"
            type="button"
            :disabled="loginBusy"
            @click="startQrLogin"
          >
            QR Login
          </button>
        </section>
        <section v-if="qrLogin" class="studio-music-qr">
          <img v-if="qrLogin.qrImage" :src="qrLogin.qrImage" alt="NetEase Cloud Music login QR code">
          <div>
            <strong>Scan with NetEase Music</strong>
            <small>{{ qrLogin.message || 'Confirm login on your phone' }}</small>
            <button
              v-if="qrLogin.status === 800"
              class="studio-secondary-btn"
              type="button"
              :disabled="loginBusy"
              @click="startQrLogin"
            >
              Refresh QR
            </button>
          </div>
        </section>
        <div class="studio-music-settings-row">
          <label>
            <span>Quality</span>
            <select v-model="music.neteaseQualityLevel">
              <option value="standard">standard</option>
              <option value="higher">higher</option>
              <option value="exhigh">exhigh</option>
              <option value="lossless">lossless</option>
              <option value="hires">hires</option>
              <option value="jyeffect">jyeffect</option>
              <option value="sky">sky</option>
              <option value="jymaster">jymaster</option>
            </select>
          </label>
          <label>
            <span>Fallback BR</span>
            <input v-model.number="music.neteaseBitrate" type="number" min="96000" max="999000" step="1000">
          </label>
        </div>
        <label class="studio-check-row">
          <input v-model="music.neteaseUnblock" type="checkbox">
          <span>Request unblock source</span>
        </label>
        <label>
          <span>Unblock Source</span>
          <input v-model="music.neteaseUnblockSource" type="text" spellcheck="false" placeholder="Optional">
        </label>
      </article>

      <article class="studio-music-card studio-music-search">
        <header>
          <TsIcon name="search" :size="18" />
          <h2>Search</h2>
        </header>
        <form class="studio-music-search-form" @submit.prevent="searchSongs">
          <input v-model="query" type="search" spellcheck="false" placeholder="Song title artist">
          <button class="studio-primary-btn" type="submit" :disabled="Boolean(busy) || !query.trim()">
            <TsIcon name="search" :size="16" />
            <span>{{ busy === 'search' ? 'Searching' : 'Search' }}</span>
          </button>
        </form>
        <div class="studio-music-song-list">
          <button
            v-for="song in candidates"
            :key="song.songId"
            class="studio-music-song"
            :class="{ selected: selectedSongId === song.songId }"
            type="button"
            @click="selectSong(song)"
          >
            <span>{{ musicSongTitle(song) }}</span>
            <small>{{ song.album || song.songId }}</small>
          </button>
          <p v-if="!candidates.length">No search results yet</p>
        </div>
      </article>

      <article class="studio-music-card">
        <header>
          <TsIcon name="play" :size="18" />
          <h2>Playback</h2>
        </header>
        <div class="studio-music-now">
          <span>Selected</span>
          <strong>{{ selectedTitle || 'No song selected' }}</strong>
          <small v-if="resolved?.url">Resolved stream token ready</small>
          <small v-else>Resolve before checking API, Play uses runtime path</small>
        </div>
        <div class="studio-music-actions">
          <button class="studio-secondary-btn" type="button" :disabled="Boolean(busy) || !selectedSong" @click="resolveSelected">
            <TsIcon name="link" :size="16" />
            <span>Resolve</span>
          </button>
          <button class="studio-primary-btn" type="button" :disabled="Boolean(busy) || !selectedSong" @click="playSelected">
            <TsIcon name="play" :size="16" />
            <span>Play Now</span>
          </button>
          <button class="studio-secondary-btn" type="button" :disabled="Boolean(busy)" @click="controlMusic('pause')">
            <TsIcon name="pause" :size="16" />
            <span>Pause</span>
          </button>
          <button class="studio-secondary-btn" type="button" :disabled="Boolean(busy)" @click="controlMusic('resume')">
            <TsIcon name="play" :size="16" />
            <span>Resume</span>
          </button>
          <button class="studio-secondary-btn" type="button" :disabled="Boolean(busy)" @click="controlMusic('stop')">
            <TsIcon name="x" :size="16" />
            <span>Stop</span>
          </button>
        </div>
        <div class="studio-music-now">
          <span>Runtime Current</span>
          <strong>{{ currentMusic ? musicSongTitle(currentMusic) : 'Idle' }}</strong>
          <small>{{ currentMusic?.status || 'stopped' }}</small>
        </div>
      </article>

      <article class="studio-music-card">
        <header>
          <TsIcon name="activity" :size="18" />
          <h2>Status</h2>
        </header>
        <div class="studio-music-status-grid">
          <div>
            <span>API</span>
            <strong>{{ serviceReadyLabel }}</strong>
          </div>
          <div>
            <span>Managed</span>
            <strong>{{ serviceStatus?.managed ? 'Yes' : 'Unknown' }}</strong>
          </div>
          <div>
            <span>Account</span>
            <strong>{{ account.loggedIn ? 'Logged in' : 'Logged out' }}</strong>
          </div>
          <div>
            <span>Login Store</span>
            <strong>{{ account.source || 'None' }}</strong>
          </div>
        </div>
        <div class="studio-music-log">
          <article v-for="line in logs" :key="line.id" :class="line.type">
            <time>{{ line.createdAt }}</time>
            <span>{{ line.message }}</span>
            <pre v-if="line.detail">{{ JSON.stringify(line.detail, null, 2) }}</pre>
          </article>
          <p v-if="!logs.length">No diagnostics yet</p>
        </div>
      </article>
    </section>
  </main>
</template>
