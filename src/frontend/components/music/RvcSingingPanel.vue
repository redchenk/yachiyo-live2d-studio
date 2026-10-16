<script setup>
import { ref } from 'vue';
import TsIcon from '../TsIcon.vue';
import { formatSongTime } from '../../services/room/rvcSongPlayer';
const props = defineProps({ songs: { type: Object, required: true } });
const fileInput = ref(null);
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
      <label class="rvc-auto-next"><input v-model="songs.autoNext.value" type="checkbox">顺序播放（播完歌单后停止）</label>
    </div>
    <p class="rvc-hint">唱歌模式暂停自动互动及语音。口型跟随音频音量；含伴奏的音频也会受伴奏影响。切回聊天或游戏即可恢复互动。</p>
    <p v-if="songs.state.error || songs.libraryError.value" class="live2d-inline-error" role="alert">{{ songs.state.error || songs.libraryError.value }}</p>
    <ol class="rvc-track-list" aria-label="RVC 歌单">
      <li v-for="track in songs.tracks.value" :key="track.id" :class="{ active: songs.state.track?.id === track.id }">
        <button type="button" class="rvc-track-play" :aria-label="`播放 ${track.name}`" @click="songs.play(track)">
          <TsIcon name="music" :size="17" /><span>{{ track.name }}<small>{{ (track.size / 1024 / 1024).toFixed(1) }} MB</small></span>
        </button>
        <button type="button" class="live2d-icon-btn" :aria-label="`移出歌单 ${track.name}`" title="删除歌曲库副本，原文件不受影响" @click="songs.remove(track)"><TsIcon name="trash" :size="15" /></button>
      </li>
    </ol>
    <p v-if="!songs.tracks.value.length" class="rvc-empty">导入八千代演唱的第一首歌吧。</p>
  </section>
</template>
