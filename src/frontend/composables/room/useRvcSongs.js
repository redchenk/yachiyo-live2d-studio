import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { createRvcSongPlayer } from '../../services/room/rvcSongPlayer';
import { analyseVocalFile } from '../../services/room/rvcVocalTimeline';

export function useRvcSongs({ canPlay, onPlaybackChange = () => {} }) {
  const tracks = ref([]), importing = ref(false), libraryError = ref('');
  const autoNext = ref(false);
  const mouthBusy = ref('');
  const state = reactive({ status: 'idle', track: null, duration: 0, currentTime: 0, volume: 0.8, error: '' });
  const player = createRvcSongPlayer({
    onState(patch) {
      const changed = state.status !== patch.status;
      Object.assign(state, patch);
      if (changed) onPlaybackChange(patch.status);
    },
    onMouth: value => window.dispatchEvent(new CustomEvent('tsukuyomi:live2d-mouth', { detail: { value } })),
    onEnded: () => { if (autoNext.value && canPlay()) next(); }
  });
  const active = computed(() => ['playing', 'loading'].includes(state.status));
  async function request(url, options) {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.message || '歌曲库请求失败');
    return body;
  }
  async function refresh() {
    try { tracks.value = (await request('/api/rvc/tracks')).tracks; libraryError.value = ''; }
    catch (error) { libraryError.value = error.message; }
  }
  async function importFiles(files) {
    if (importing.value) return;
    importing.value = true; libraryError.value = '';
    const errors = [];
    for (const file of files) {
      try {
        if (file.size > 512 * 1024 * 1024) throw new Error('超过 512 MB');
        await request(`/api/rvc/tracks?name=${encodeURIComponent(file.name)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file
        });
      } catch (error) { errors.push(`${file.name}：${error.message}`); }
    }
    await refresh(); libraryError.value = errors.join('；'); importing.value = false;
  }
  async function remove(track) {
    if (mouthBusy.value) return;
    try {
      if (state.track?.id === track.id) player.clear();
      await request(`/api/rvc/tracks/${encodeURIComponent(track.id)}`, { method: 'DELETE' });
      await refresh();
    } catch (error) { libraryError.value = error.message; }
  }
  async function changeMouth(track, method, input) {
    const body = await request(`/api/rvc/tracks/${encodeURIComponent(track.id)}/mouth`, {
      method, ...(input ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {})
    });
    tracks.value = tracks.value.map(item => item.id === track.id ? body.track : item);
    player.updateMouth(body.track, body.mouth);
  }
  async function withMouthUpdate(track, action) {
    if (mouthBusy.value) return;
    mouthBusy.value = track.id; libraryError.value = '';
    try { await action(); } catch (error) { libraryError.value = error.message; }
    finally { mouthBusy.value = ''; }
  }
  function associateVocal(track, file) {
    return withMouthUpdate(track, async () => changeMouth(track, 'PUT', await analyseVocalFile(file)));
  }
  function updateMouthSettings(track, settings) {
    return withMouthUpdate(track, () => changeMouth(track, 'PATCH', { ...track.mouth, ...settings }));
  }
  function clearMouth(track) { return withMouthUpdate(track, () => changeMouth(track, 'DELETE')); }
  function play(track = state.track || tracks.value[0]) { if (canPlay()) return player.play(track); }
  function toggle() { if (active.value) player.pause(); else play(); }
  function next() {
    const index = tracks.value.findIndex(track => track.id === state.track?.id);
    if (index + 1 < tracks.value.length) play(tracks.value[index + 1]);
  }
  const hasNext = computed(() => tracks.value.findIndex(track => track.id === state.track?.id) + 1 < tracks.value.length);
  onMounted(refresh);
  onUnmounted(() => player.dispose());
  return { tracks, state, active, importing, libraryError, autoNext, hasNext, importFiles, remove, refresh, play, toggle, next,
    mouthBusy, associateVocal, updateMouthSettings, clearMouth,
    pause: player.pause, stop: player.stop, seek: player.seek, setVolume: player.setVolume };
}
