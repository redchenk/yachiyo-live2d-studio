function asCaption(value) {
  return String(value || '').replace(/[ \t]{2,}/g, ' ').trim();
}

export function createLive2DPreparedCaption(resolved, options = {}) {
  const unavailableText = asCaption(options.unavailableText) || '（中文字幕暂不可用）';
  let caption = '';
  const ready = Promise.resolve(resolved)
    .then((value) => {
      caption = asCaption(value) || unavailableText;
      return caption;
    })
    .catch(() => {
      caption = unavailableText;
      return caption;
    });

  return {
    ready,
    read: () => caption
  };
}

function joinCaptionText(left, right) {
  const previous = asCaption(left);
  const next = asCaption(right);
  if (!previous) return next;
  if (!next) return previous;
  const needsSpace = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(next);
  return `${previous}${needsSpace ? ' ' : ''}${next}`;
}

export function createLive2DCaptionSynchronizer(options = {}) {
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const setTimer = options.setTimeoutImpl || globalThis.setTimeout;
  const clearTimer = options.clearTimeoutImpl || globalThis.clearTimeout;
  const holdMs = Math.max(0, Number(options.holdMs ?? 220));
  let tokenSequence = 0;
  let activeToken = 0;
  let resolvedToken = 0;
  let clearTimerId = null;
  let caption = '';

  function cancelClear() {
    if (clearTimerId === null) return;
    clearTimer(clearTimerId);
    clearTimerId = null;
  }

  function publish(value) {
    const next = asCaption(value);
    if (caption === next) return caption;
    caption = next;
    onChange(caption);
    return caption;
  }

  function start({ fallback = '', resolved = null } = {}) {
    cancelClear();
    const token = tokenSequence += 1;
    activeToken = token;
    resolvedToken = token;
    publish(fallback);
    if (resolved && typeof resolved.then === 'function') {
      Promise.resolve(resolved)
        .then((value) => {
          if (activeToken !== token || resolvedToken !== token) return;
          const next = asCaption(value);
          if (next) publish(next);
        })
        .catch(() => {});
    }
    return token;
  }

  function finish(token) {
    if (!token || token !== activeToken) return false;
    resolvedToken = 0;
    cancelClear();
    const clearActive = () => {
      clearTimerId = null;
      if (activeToken !== token) return;
      activeToken = 0;
      publish('');
    };
    if (!holdMs) clearActive();
    else clearTimerId = setTimer(clearActive, holdMs);
    return true;
  }

  function clear() {
    cancelClear();
    activeToken = 0;
    resolvedToken = 0;
    tokenSequence += 1;
    publish('');
  }

  return {
    start,
    finish,
    clear,
    read: () => caption,
    activeToken: () => activeToken
  };
}

export function createLive2DOrderedCaptionTranscript(options = {}) {
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const sentences = [];
  let transcript = '';

  function rebuild() {
    let next = '';
    for (let index = 0; index < sentences.length; index += 1) {
      if (!Object.hasOwn(sentences, index)) break;
      next = joinCaptionText(next, sentences[index]);
    }
    if (transcript !== next) {
      transcript = next;
      onChange(transcript);
    }
    return transcript;
  }

  function resolve(index, text) {
    const normalizedIndex = Math.max(0, Math.round(Number(index) || 0));
    const value = asCaption(text);
    if (!value) return transcript;
    sentences[normalizedIndex] = value;
    return rebuild();
  }

  return {
    resolve,
    read: () => transcript,
    clear() {
      sentences.length = 0;
      transcript = '';
      onChange('');
    }
  };
}
