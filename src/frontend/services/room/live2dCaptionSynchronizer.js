function asCaption(value) {
  return String(value || '').replace(/[ \t]{2,}/g, ' ').trim();
}

export function createLive2DPreparedCaption(resolved, options = {}) {
  const fallback = asCaption(options.fallback);
  let caption = fallback;
  const ready = Promise.resolve(resolved)
    .then((value) => {
      caption = asCaption(value) || fallback;
      return caption;
    })
    .catch(() => {
      caption = fallback;
      return caption;
    });

  return {
    ready,
    read: () => caption
  };
}

export function resolveFirstLive2DChineseCaption(candidates = [], options = {}) {
  const sources = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 6000));
  if (!sources.length) return Promise.resolve('');

  return new Promise((resolve) => {
    let settled = false;
    let pending = sources.length;
    let timer = null;
    const finish = (value = '') => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(asCaption(value));
    };
    const miss = () => {
      pending -= 1;
      if (pending < 1) finish('');
    };

    sources.forEach((source) => {
      Promise.resolve(source).then((value) => {
        const caption = asCaption(value);
        if (caption) finish(caption);
        else miss();
      }, miss);
    });
    if (timeoutMs > 0) timer = setTimeout(() => finish(''), timeoutMs);
  });
}

export function resolveLive2DChineseCaptionWithFallback(primary, fallbackFactory, options = {}) {
  const fallbackDelayMs = Math.max(0, Number(options.fallbackDelayMs ?? 800));
  const timeoutMs = Math.max(fallbackDelayMs + 1, Number(options.timeoutMs ?? 5000));
  const setTimer = options.setTimeoutImpl || globalThis.setTimeout;
  const clearTimer = options.clearTimeoutImpl || globalThis.clearTimeout;

  return new Promise((resolve) => {
    let settled = false;
    let primaryDone = false;
    let fallbackDone = typeof fallbackFactory !== 'function';
    let fallbackStarted = false;
    let fallbackTimer = null;
    let timeoutTimer = null;

    const cleanup = () => {
      if (fallbackTimer !== null) clearTimer(fallbackTimer);
      if (timeoutTimer !== null) clearTimer(timeoutTimer);
      fallbackTimer = null;
      timeoutTimer = null;
    };
    const finish = (value = '', allowEmpty = false) => {
      if (settled) return false;
      const caption = asCaption(value);
      if (!caption && !allowEmpty) return false;
      settled = true;
      cleanup();
      resolve(caption);
      return true;
    };
    const finishIfExhausted = () => {
      if (primaryDone && fallbackDone) finish('', true);
    };
    const startFallback = () => {
      if (settled || fallbackStarted || typeof fallbackFactory !== 'function') {
        finishIfExhausted();
        return;
      }
      fallbackStarted = true;
      Promise.resolve()
        .then(() => fallbackFactory())
        .then((value) => {
          fallbackDone = true;
          if (!finish(value)) finishIfExhausted();
        })
        .catch(() => {
          fallbackDone = true;
          finishIfExhausted();
        });
    };

    Promise.resolve(primary)
      .then((value) => {
        primaryDone = true;
        if (!finish(value)) {
          startFallback();
          finishIfExhausted();
        }
      })
      .catch(() => {
        primaryDone = true;
        startFallback();
        finishIfExhausted();
      });

    fallbackTimer = setTimer(startFallback, fallbackDelayMs);
    timeoutTimer = setTimer(() => finish('', true), timeoutMs);
  });
}

export function createLive2DCaptionPlaybackGate(preparedCaption) {
  const ready = preparedCaption?.ready ?? preparedCaption;
  return Promise.resolve(ready).then((value) => {
    const caption = asCaption(value);
    if (caption) return caption;
    const error = new Error('Chinese caption unavailable');
    error.name = 'AbortError';
    throw error;
  });
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
