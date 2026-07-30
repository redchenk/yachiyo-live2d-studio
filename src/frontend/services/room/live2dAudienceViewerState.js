function asText(value) {
  return String(value ?? '').trim();
}

export function live2DAudienceViewerIdentity(entry = {}) {
  const userId = asText(entry.userId ?? entry.bilibili?.userId);
  if (userId && userId !== '0') return userId;
  const userName = asText(entry.userName ?? entry.bilibili?.userName).toLocaleLowerCase();
  if (userName) return userName;
  return asText(entry.id ?? entry.bilibili?.id);
}

export function createLive2DAudienceViewerState(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const states = new Map();

  function stateFor(entry = {}) {
    const identity = live2DAudienceViewerIdentity(entry);
    return identity ? states.get(identity) || null : null;
  }

  function recordArrival(entry = {}) {
    const identity = live2DAudienceViewerIdentity(entry);
    if (!identity) return null;
    const previous = states.get(identity) || {};
    const next = {
      ...previous,
      firstSeenAt: previous.firstSeenAt || Number(entry.receivedAt ?? entry.timestamp) || now(),
      messageCount: Math.max(0, Number(previous.messageCount) || 0) + 1,
      pendingReplyCount: Math.max(0, Number(previous.pendingReplyCount) || 0),
      recentlyReplied: Math.max(0, Number(previous.pendingReplyCount) || 0) > 0
    };
    states.set(identity, next);
    return next;
  }

  function isFirstUnansweredMessage(entry = {}) {
    const state = stateFor(entry);
    return Boolean(
      state &&
      Number(state.messageCount) === 1 &&
      !Number(state.lastRepliedAt)
    );
  }

  function markPending(entries = []) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      const identity = live2DAudienceViewerIdentity(entry);
      if (!identity) continue;
      const previous = states.get(identity) || {
        firstSeenAt: Number(entry.receivedAt) || now(),
        messageCount: 1
      };
      const pendingReplyCount = Math.max(0, Number(previous.pendingReplyCount) || 0) + 1;
      states.set(identity, {
        ...previous,
        pendingReplyCount,
        recentlyReplied: true
      });
    }
  }

  function settle(entries = [], { replied = false } = {}) {
    const settledAt = now();
    for (const entry of Array.isArray(entries) ? entries : []) {
      const identity = live2DAudienceViewerIdentity(entry);
      if (!identity) continue;
      const previous = states.get(identity);
      if (!previous) continue;
      const pendingReplyCount = Math.max(0, (Number(previous.pendingReplyCount) || 0) - 1);
      states.set(identity, {
        ...previous,
        pendingReplyCount,
        recentlyReplied: pendingReplyCount > 0,
        lastRepliedAt: replied ? settledAt : Number(previous.lastRepliedAt) || 0
      });
    }
  }

  function clearPending() {
    for (const [identity, state] of states) {
      states.set(identity, {
        ...state,
        pendingReplyCount: 0,
        recentlyReplied: false
      });
    }
  }

  return {
    stateFor,
    recordArrival,
    isFirstUnansweredMessage,
    markPending,
    settle,
    clearPending,
    clear: () => states.clear(),
    snapshot: () => new Map(states)
  };
}
