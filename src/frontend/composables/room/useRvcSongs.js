import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { createRvcSongPlayer } from '../../services/room/rvcSongPlayer';

export function useRvcSongs({ canPlay, onPlaybackChange = () => {} }) {
  const tracks = ref([]), importing = ref(false), libraryError = ref('');
  const autoNext = ref(false);
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
    try {
      if (state.track?.id === track.id) player.clear();
      await request(`/api/rvc/tracks/${encodeURIComponent(track.id)}`, { method: 'DELETE' });
      await refresh();
    } catch (error) { libraryError.value = error.message; }
  }
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
    pause: player.pause, stop: player.stop, seek: player.seek, setVolume: player.setVolume };
}
