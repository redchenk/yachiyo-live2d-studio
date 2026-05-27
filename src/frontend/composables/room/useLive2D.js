import { onBeforeUnmount, ref } from 'vue';
import {
  consumePendingRoomLive2DIntent,
  ROOM_LIVE2D_PENDING_INTENT_KEY
} from '../../services/room/live2dControl';
import { mountVTubeStudioBridge } from '../../services/room/live2dVTubeStudioBridge';

export function useLive2D() {
  const loading = ref(false);
  const ready = ref(false);
  const error = ref('');
  let destroyVTubeStudio = null;

  function consumePendingSoon() {
    window.setTimeout(() => consumePendingRoomLive2DIntent(), 250);
  }

  function onStorage(event) {
    if (event.key === ROOM_LIVE2D_PENDING_INTENT_KEY && ready.value) consumePendingSoon();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }

  async function init() {
    loading.value = true;
    error.value = '';
    try {
      destroyVTubeStudio?.();
      destroyVTubeStudio = mountVTubeStudioBridge();
      ready.value = true;
      loading.value = false;
      consumePendingSoon();
      return true;
    } catch (err) {
      error.value = err?.message || 'Live2D init failed';
      ready.value = false;
      loading.value = false;
      return false;
    }
  }

  function speak() {
    // Speech is handled by createLive2DSpeechPlayer and VTube Studio mouth injection.
  }

  function destroy() {
    ready.value = false;
    loading.value = false;
    destroyVTubeStudio?.();
    destroyVTubeStudio = null;
  }

  onBeforeUnmount(destroy);
  onBeforeUnmount(() => {
    window.removeEventListener('storage', onStorage);
  });

  return { loading, ready, error, init, destroy, speak };
}
