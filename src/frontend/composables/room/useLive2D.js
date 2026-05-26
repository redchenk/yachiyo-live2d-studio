import { onBeforeUnmount, ref } from 'vue';
import {
  consumePendingRoomLive2DIntent,
  ROOM_LIVE2D_PENDING_INTENT_KEY
} from '../../services/room/live2dControl';
import { mountLive2DStageBodyActuator } from '../../services/room/live2dBodyActuator';
import { mountLive2DFaceCaptureSimulator } from '../../services/room/live2dFaceCaptureSimulator';
import { destroyLive2DRoom, initLive2DRoom, preloadLive2DResources, speakLive2D } from '../../services/room/live2dBridge';

export function useLive2D() {
  const loading = ref(false);
  const ready = ref(false);
  const error = ref('');
  let destroyBodyActuator = null;
  let destroyFaceCapture = null;

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
    preloadLive2DResources();
    try {
      await initLive2DRoom();
      destroyBodyActuator?.();
      destroyFaceCapture?.();
      destroyBodyActuator = mountLive2DStageBodyActuator();
      destroyFaceCapture = mountLive2DFaceCaptureSimulator();
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
    speakLive2D();
  }

  function destroy() {
    ready.value = false;
    loading.value = false;
    destroyBodyActuator?.();
    destroyFaceCapture?.();
    destroyBodyActuator = null;
    destroyFaceCapture = null;
    destroyLive2DRoom();
  }

  onBeforeUnmount(destroy);
  onBeforeUnmount(() => {
    window.removeEventListener('storage', onStorage);
  });

  return { loading, ready, error, init, destroy, speak };
}
