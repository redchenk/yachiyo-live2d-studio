<script setup>
import { ref } from 'vue';
import { readLipsyncSettings, saveLipsyncSettings } from '../../services/room/lipsyncSettings';
import { createMfccExtractor, ANALYSIS_SIZE, VOWELS, validateVowelProfile } from '../../../shared/audio-lipsync.mjs';
import { DEFAULT_VOWEL_PROFILE } from '../../../shared/lipsync-profile.mjs';
const settings = ref(readLipsyncSettings()), busy = ref(false), message = ref(''), input = ref(null), selected = ref('A');
function save(patch) { settings.value = saveLipsyncSettings(patch); }
function choose(key) { selected.value = key; input.value.click(); }
async function calibrate(event) {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  if (file.size > 16 * 1024 * 1024) { message.value = '请选择 16 MB 以内的单个发音片段'; return; }
  busy.value = true; message.value = '';
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration < 0.15 || buffer.duration > 10) throw new Error('请选择 0.15–10 秒的单个发音片段');
    const extract = createMfccExtractor(), features = [];
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    let best = channels[0], energy = -1;
    for (const channel of channels) { const e = channel.reduce((n, v) => n + v * v, 0); if (e > energy) { energy = e; best = channel; } }
    for (let at = 0; at + ANALYSIS_SIZE <= best.length; at += 320) {
      const samples = best.subarray(at, at + ANALYSIS_SIZE);
      const rms = Math.sqrt(samples.reduce((n, v) => n + v * v, 0) / ANALYSIS_SIZE);
      if (rms > 0.003) features.push(extract(samples));
      if (at % 3200 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!features.length) throw new Error('片段太安静，没有找到可校准的声音');
    const average = Array.from({ length: 12 }, (_, i) => features.reduce((sum, row) => sum + row[i], 0) / features.length);
    const profile = validateVowelProfile({ ...settings.value.profile, [selected.value]: average });
    save({ profile, calibrated: [...new Set([...settings.value.calibrated, selected.value])] });
    message.value = `${selected.value === '-' ? '呼吸声' : selected.value} 已校准；讲话立即生效，歌曲需重新关联人声。`;
  } catch (error) { message.value = error.message || '校准失败，请使用 WAV / MP3 片段'; }
  finally { await context.close().catch(() => {}); busy.value = false; }
}
function reset() { save({ profile: DEFAULT_VOWEL_PROFILE, calibrated: [] }); message.value = '已恢复通用女声配置；歌曲需重新关联人声。'; }
</script>
<template>
  <details class="rvc-mouth-settings lipsync-calibration">
    <summary>讲话与唱歌口型校准</summary>
    <p class="rvc-hint">本地声音分析，不调用 LLM。通用女声配置已启用；八千代通过张口、下颌与圆唇参数表现元音，微笑仍由表情控制。</p>
    <label class="rvc-mouth-gate">讲话灵敏度 {{ settings.gain.toFixed(2) }}×<input aria-label="讲话口型灵敏度" type="range" min="0.25" max="4" step="0.05" :value="settings.gain" @input="save({ gain: Number($event.target.value) })"></label>
    <label class="rvc-mouth-gate">讲话静音门限 {{ settings.gateDb }} dB<input aria-label="讲话口型静音门限" type="range" min="-60" max="-20" step="1" :value="settings.gateDb" @input="save({ gateDb: Number($event.target.value) })"></label>
    <label class="rvc-mouth-gate">讲话口型延后 {{ settings.delayMs }} ms<input aria-label="讲话口型延后" type="range" min="0" max="250" step="10" :value="settings.delayMs" @input="save({ delayMs: Number($event.target.value) })"></label>
    <p class="rvc-hint">声音播放较晚时增加延后。歌曲在上方单独调整偏移与门限。</p>
    <p class="rvc-hint">用当前 TTS / RVC 音色的单个干净发音片段校准（0.15–10 秒，无伴奏）。A＝あ，I＝い，U＝う，E＝え，O＝お；呼吸声使用实际气声，不要用全静音。高音与说话音色差异较大时，优先选择常用音域。</p>
    <div class="rvc-playback-actions">
      <button v-for="key in [...VOWELS, '-']" :key="key" type="button" class="live2d-mini-btn" :disabled="busy" @click="choose(key)">{{ key === '-' ? '呼吸声' : key }}{{ settings.calibrated.includes(key) ? ' ✓' : '' }}</button>
      <button type="button" class="live2d-mini-btn" :disabled="busy" @click="reset">恢复通用女声</button>
    </div>
    <input ref="input" class="rvc-file-input" type="file" accept="audio/*" aria-label="口型元音校准音频" @change="calibrate">
    <p v-if="busy || message" class="rvc-hint" role="status">{{ busy ? '正在分析发音…' : message }}</p>
  </details>
</template>
