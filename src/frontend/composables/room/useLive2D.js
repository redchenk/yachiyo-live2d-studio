import { onBeforeUnmount, ref } from 'vue';
import {
  consumePendingRoomLive2DIntent,
  ROOM_LIVE2D_PENDING_INTENT_KEY
} from '../../services/room/live2dControl';
import { destroyLive2DRoom, initLive2DRoom } from '../../services/room/live2dBridge';
import { mountLive2DStageBodyActuator } from '../../services/room/live2dBodyActuator';
import { mountLocalCubismBridge } from '../../services/room/live2dLocalCubismBridge';
import { mountLocalVtsItemOverlay } from '../../services/room/live2dLocalVtsItemOverlay';
import { mountVTubeStudioBridge } from '../../services/room/live2dVTubeStudioBridge';

const INIT_STATE_KEY = '__TSUKUYOMI_LIVE2D_VUE_INIT_STATE__';

export function useLive2D() {
  const loading = ref(false);
  const ready = ref(false);
  const error = ref('');
  let destroyCubismBehavior = null;
  let destroyStageBody = null;
  let destroyLocalVtsItems = null;
  let destroyVTubeStudio = null;

  function consumePendingSoon() {
    window.setTimeout(() => consumePendingRoomLive2DIntent(), 250);
  }

  function setInitState(patch) {
    if (typeof window === 'undefined') return;
    window[INIT_STATE_KEY] = {
      ...(window[INIT_STATE_KEY] || {}),
      ...patch,
      updatedAt: Date.now()
    };
  }

  function ensureCubismBehaviorBridge(stage = 'unknown') {
    if (typeof window === 'undefined') return;
    if (window.TSUKUYOMI_CUBISM_BEHAVIOR_BRIDGE && destroyCubismBehavior) {
      setInitState({ cubismBehaviorMounted: true, cubismBehaviorStage: stage });
      return;
    }
    destroyCubismBehavior?.();
    destroyCubismBehavior = mountLocalCubismBridge();
    setInitState({ cubismBehaviorMounted: true, cubismBehaviorStage: stage });
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
    setInitState({ status: 'starting', error: '' });
    try {
      destroyCubismBehavior?.();
      destroyCubismBehavior = null;
      destroyStageBody?.();
      destroyStageBody = null;
      destroyLocalVtsItems?.();
      destroyLocalVtsItems = null;
      destroyVTubeStudio?.();
      destroyVTubeStudio = null;
      destroyLive2DRoom();
      ensureCubismBehaviorBridge('before-cubism-runtime');
      setInitState({ status: 'loading-runtime' });
      await initLive2DRoom();
      ensureCubismBehaviorBridge('after-cubism-runtime');
      destroyStageBody = mountLive2DStageBodyActuator();
      destroyLocalVtsItems = mountLocalVtsItemOverlay();
      destroyVTubeStudio = mountVTubeStudioBridge();
      ready.value = true;
      loading.value = false;
      setInitState({ status: 'ready', ready: true });
      consumePendingSoon();
      return true;
    } catch (err) {
      error.value = err?.message || 'Live2D init failed';
      ready.value = false;
      loading.value = false;
      setInitState({ status: 'error', ready: false, error: error.value });
      return false;
    }
  }

  function speak() {
    // Speech is handled by createLive2DSpeechPlayer and Live2D mouth events.
  }

  function destroy() {
    ready.value = false;
    loading.value = false;
    destroyCubismBehavior?.();
    destroyCubismBehavior = null;
    destroyStageBody?.();
    destroyStageBody = null;
    destroyLocalVtsItems?.();
    destroyLocalVtsItems = null;
    destroyVTubeStudio?.();
    destroyVTubeStudio = null;
    destroyLive2DRoom();
    setInitState({ status: 'destroyed', ready: false, cubismBehaviorMounted: false });
  }

  onBeforeUnmount(destroy);
  onBeforeUnmount(() => {
    window.removeEventListener('storage', onStorage);
  });

  return { loading, ready, error, init, destroy, speak };
}
