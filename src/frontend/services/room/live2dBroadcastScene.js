export const LIVE2D_BROADCAST_SCENE_STORAGE_KEY = 'yachiyo:live2d:broadcastScene';
export const LIVE2D_BROADCAST_SCENE_EVENT = 'tsukuyomi:live2d-broadcast-scene';

const BROADCAST_SCENES = new Set(['chat', 'game']);

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}

export function normalizeLive2DBroadcastScene(value) {
  const scene = String(value || '').trim().toLowerCase();
  return BROADCAST_SCENES.has(scene) ? scene : 'chat';
}

export function readLive2DBroadcastScene(storage = browserStorage()) {
  try {
    return normalizeLive2DBroadcastScene(storage?.getItem?.(LIVE2D_BROADCAST_SCENE_STORAGE_KEY));
  } catch (_) {
    return 'chat';
  }
}

export function writeLive2DBroadcastScene(scene, options = {}) {
  const normalized = normalizeLive2DBroadcastScene(scene);
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const eventTarget = options.eventTarget === undefined ? globalThis.window : options.eventTarget;
  try {
    storage?.setItem?.(LIVE2D_BROADCAST_SCENE_STORAGE_KEY, normalized);
  } catch (_) {
    // Scene switching must remain available when storage is blocked.
  }
  if (eventTarget?.dispatchEvent && typeof globalThis.CustomEvent === 'function') {
    eventTarget.dispatchEvent(new globalThis.CustomEvent(LIVE2D_BROADCAST_SCENE_EVENT, {
      detail: { scene: normalized }
    }));
  }
  return normalized;
}
