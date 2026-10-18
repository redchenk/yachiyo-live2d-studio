<script setup>
import { ref } from 'vue';
import TsIcon from '../TsIcon.vue';
import { formatSongTime } from '../../services/room/rvcSongPlayer';
const props = defineProps({ songs: { type: Object, required: true }, concertEnabled: Boolean, concertState: { type: Object, default: () => ({}) } });
const emit = defineEmits(['concert-enabled', 'resume-concert']);
const fileInput = ref(null);
const vocalInput = ref(null);
let vocalTrack;
function chooseVocal(track) { vocalTrack = track; vocalInput.value.click(); }
async function importVocal(event) {
  const file = event.target.files[0], track = vocalTrack;
  event.target.value = '';
  if (file && track) await props.songs.associateVocal(track, file);
}
async function importSongs(event) {
  const files = [...event.target.files];
  event.target.value = '';
  await props.songs.importFiles(files);
}
</script>

<template>
  <section class="rvc-panel" aria-label="RVC 唱歌控制">
    <header class="live2d-section-heading">
      <div><strong>八千代的歌单</strong><span>播放已完成 RVC 推理的音频</span></div>
      <button type="button" class="live2d-mini-btn" :disabled="songs.importing.value" @click="fileInput.click()">
        <TsIcon name="upload" :size="16" />{{ songs.importing.value ? '导入中…' : '导入歌曲' }}
      </button>
      <input ref="fileInput" class="rvc-file-input" type="file" multiple accept=".wav,.mp3,.flac,.ogg,.m4a" aria-label="导入 RVC 歌曲" @change="importSongs">
    </header>
    <p class="rvc-hint">歌曲复制到本机歌曲库，重启后保留。支持 WAV / MP3 / FLAC / OGG / M4A，单首上限 512 MB。</p>
    <input ref="vocalInput" class="rvc-file-input" type="file" accept=".wav,.mp3,.flac,.ogg,.m4a" aria-label="关联纯人声轨" @change="importVocal">
    <div class="rvc-now-playing">
      <span>当前歌曲</span><strong>{{ songs.state.track?.name || '还没有选择歌曲' }}</strong>
      <input type="range" min="0" :max="songs.state.duration || 1" step="0.1" :value="songs.state.currentTime"
        :disabled="!songs.state.duration" aria-label="歌曲进度" @input="songs.seek($event.target.value)">
      <div class="rvc-times"><span>{{ formatSongTime(songs.state.currentTime) }}</span><span>{{ formatSongTime(songs.state.duration) }}</span></div>
      <div class="rvc-playback-actions">
        <button type="button" class="live2d-action-btn" :disabled="!songs.tracks.value.length" aria-label="播放或暂停歌曲" @click="songs.toggle">
          <TsIcon :name="songs.active.value ? 'pause' : 'play'" :size="18" />{{ songs.active.value ? '暂停' : '播放' }}
        </button>
        <button type="button" class="live2d-mini-btn" :disabled="!songs.state.track" @click="songs.stop">停止</button>
        <button type="button" class="live2d-mini-btn" :disabled="!songs.hasNext.value" @click="songs.next">下一首</button>
      </div>
      <label class="rvc-volume">音量 {{ Math.round(songs.state.volume * 100) }}%<input type="range" min="0" max="1" step="0.01" :value="songs.state.volume" aria-label="唱歌音量" @input="songs.setVolume($event.target.value)"></label>
      <label class="rvc-auto-next"><input :checked="concertEnabled" type="checkbox" aria-label="八千代自主接歌" @change="emit('concert-enabled', $event.target.checked)">八千代自主选曲与歌间互动</label>
      <button v-if="concertEnabled && concertState.phase === 'paused'" type="button" class="live2d-mini-btn" @click="emit('resume-concert')">恢复自主接歌</button>
    </div>
    <div v-if="songs.state.track" class="rvc-mouth-settings" :data-configured="!!songs.state.track.mouth">
      <div class="rvc-mouth-heading"><strong>人声口型</strong>
        <button type="button" class="live2d-mini-btn" :disabled="!!songs.mouthBusy.value" @click="chooseVocal(songs.state.track)">{{ songs.mouthBusy.value === songs.state.track.id ? '分析中…' : songs.state.track.mouth ? '更换人声轨' : '关联人声轨' }}</button>
      </div>
      <template v-if="songs.state.track.mouth">
        <p class="rvc-hint rvc-vocal-name">{{ songs.state.track.mouth.vocalName }}</p>
        <label class="rvc-mouth-offset">口型偏移（ms）<input type="number" min="-5000" max="5000" step="20" :value="songs.state.track.mouth.offsetMs" :disabled="!!songs.mouthBusy.value" aria-label="口型偏移（毫秒）" @change="songs.updateMouthSettings(songs.state.track, { offsetMs: Number($event.target.value) })"></label>
        <p class="rvc-hint">负值让口型提前，正值让口型延后。人声轨应保留与成品相同的开头空白。</p>
        <label class="rvc-mouth-gate">静音门限 {{ songs.state.track.mouth.gateDb }} dB<input type="range" min="-60" max="-20" step="1" :value="songs.state.track.mouth.gateDb" :disabled="!!songs.mouthBusy.value" aria-label="人声静音门限" @change="songs.updateMouthSettings(songs.state.track, { gateDb: Number($event.target.value) })"></label>
        <p class="rvc-hint">间奏有残音时向右调高；轻声漏字时向左调低。</p>
        <button type="button" class="live2d-mini-btn" :disabled="!!songs.mouthBusy.value" @click="songs.clearMouth(songs.state.track)">移除口型关联</button>
      </template>
      <p v-else class="rvc-hint">未关联纯人声，播放时保持闭嘴，避免伴奏误触发。</p>
      <p class="rvc-hint">请选择 RVC 混音前的纯人声（最大 256 MB、20 分钟）。仅在本机生成并保存口型数据，不会重复播放人声；请勿选择伴奏或混音成品。</p>
      <p v-if="songs.state.mouthError" class="live2d-inline-error" role="alert">{{ songs.state.mouthError }}</p>
    </div>
    <p class="rvc-hint">开始直播后，唱歌时暂存弹幕，歌间回应观众、介绍下一首并自动开唱。优先歌单内的点歌，避免连续重复；手动暂停或停止会暂停自主接歌。</p>
    <p v-if="songs.state.error || songs.libraryError.value" class="live2d-inline-error" role="alert">{{ songs.state.error || songs.libraryError.value }}</p>
    <ol class="rvc-track-list" aria-label="RVC 歌单">
      <li v-for="track in songs.tracks.value" :key="track.id" :class="{ active: songs.state.track?.id === track.id }">
        <button type="button" class="rvc-track-play" :aria-label="`播放 ${track.name}`" @click="songs.play(track)">
          <TsIcon name="music" :size="17" /><span>{{ track.name }}<small>{{ (track.size / 1024 / 1024).toFixed(1) }} MB · {{ track.mouth ? '人声口型已关联' : '未关联人声 · 保持闭嘴' }}</small></span>
        </button>
        <button type="button" class="live2d-mini-btn rvc-vocal-link" :disabled="!!songs.mouthBusy.value" :aria-label="`关联人声 ${track.name}`" @click="chooseVocal(track)">{{ songs.mouthBusy.value === track.id ? '分析中…' : '人声' }}</button>
        <button type="button" class="live2d-icon-btn" :disabled="!!songs.mouthBusy.value" :aria-label="`移出歌单 ${track.name}`" title="删除歌曲库副本，原文件不受影响" @click="songs.remove(track)"><TsIcon name="trash" :size="15" /></button>
      </li>
    </ol>
    <p v-if="!songs.tracks.value.length" class="rvc-empty">导入八千代演唱的第一首歌吧。</p>
  </section>
</template>
