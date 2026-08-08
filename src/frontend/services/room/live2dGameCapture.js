function defaultMediaDevices() {
  try {
    return globalThis.navigator?.mediaDevices || null;
  } catch (_) {
    return null;
  }
}

function captureErrorMessage(error) {
  if (error?.name === 'NotAllowedError') return '未选择游戏窗口，画面保持未连接。';
  if (error?.name === 'NotFoundError') return '没有找到可捕获的游戏窗口或屏幕。';
  return error?.message || '游戏画面捕获失败，请重新选择窗口。';
}

export function createLive2DGameCapture(options = {}) {
  const mediaDevices = options.mediaDevices || defaultMediaDevices();
  const onState = typeof options.onState === 'function' ? options.onState : () => {};
  let stream = null;
  let videoElement = null;
  let state = {
    status: 'idle',
    sourceLabel: '',
    error: ''
  };

  function publish(patch = {}) {
    state = { ...state, ...patch };
    onState({ ...state });
    return { ...state };
  }

  function clearVideo() {
    if (videoElement?.srcObject) videoElement.srcObject = null;
  }

  function releaseStream(stopTracks) {
    const current = stream;
    stream = null;
    clearVideo();
    if (stopTracks) {
      for (const track of current?.getTracks?.() || []) track.stop?.();
    }
  }

  async function attachStream() {
    if (!videoElement || !stream) return;
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.srcObject = stream;
    await videoElement.play?.();
  }

  function attach(element) {
    videoElement = element || null;
    if (stream) attachStream().catch(() => {});
    return videoElement;
  }

  async function start() {
    if (!mediaDevices?.getDisplayMedia) {
      const error = new Error('当前环境不支持游戏窗口捕获。');
      publish({ status: 'error', sourceLabel: '', error: error.message });
      throw error;
    }
    if (stream) releaseStream(true);
    publish({ status: 'selecting', sourceLabel: '', error: '' });
    try {
      stream = await mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      const track = stream.getVideoTracks?.()[0] || null;
      const sourceLabel = String(track?.label || '').trim() || '已选择游戏画面';
      track?.addEventListener?.('ended', () => {
        releaseStream(false);
        publish({ status: 'ended', sourceLabel: '', error: '' });
      }, { once: true });
      await attachStream();
      return publish({ status: 'live', sourceLabel, error: '' });
    } catch (error) {
      releaseStream(true);
      publish({ status: 'idle', sourceLabel: '', error: captureErrorMessage(error) });
      throw error;
    }
  }

  function stop() {
    releaseStream(true);
    return publish({ status: 'idle', sourceLabel: '', error: '' });
  }

  function destroy() {
    stop();
    videoElement = null;
  }

  return {
    attach,
    start,
    stop,
    destroy,
    isActive: () => Boolean(stream),
    snapshot: () => ({ ...state })
  };
}
