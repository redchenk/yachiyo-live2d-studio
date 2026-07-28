import { inferLive2DMusicCommandFromText } from './live2dMusic';

const DEFAULT_HANDLED_ID_LIMIT = 500;

function asText(value) {
  return String(value ?? '').trim();
}

function trustedRequester(meta = {}) {
  const bilibili = meta?.bilibili || {};
  return asText(bilibili.userName) ||
    asText(meta.userName) ||
    asText(meta.requestedBy);
}

function trustedRequestId(meta = {}) {
  const bilibili = meta?.bilibili || {};
  return asText(bilibili.id) || asText(meta.id);
}

export function createLive2DAudienceMusicRequestRouter(options = {}) {
  const execute = typeof options.execute === 'function'
    ? options.execute
    : async () => null;
  const handledIdLimit = Math.max(
    20,
    Math.round(Number(options.handledIdLimit) || DEFAULT_HANDLED_ID_LIMIT)
  );
  const handledIds = new Set();
  const handledIdOrder = [];

  function rememberRequestId(requestId) {
    if (!requestId || handledIds.has(requestId)) return;
    handledIds.add(requestId);
    handledIdOrder.push(requestId);
    while (handledIdOrder.length > handledIdLimit) {
      handledIds.delete(handledIdOrder.shift());
    }
  }

  function detect(text) {
    return inferLive2DMusicCommandFromText(text);
  }

  function handle(text, meta = {}, audienceEntry = null) {
    const command = detect(text);
    if (!command) {
      return {
        handled: false,
        duplicate: false,
        command: null,
        requestedBy: '',
        requestId: '',
        promise: null
      };
    }

    if (audienceEntry && typeof audienceEntry === 'object') {
      audienceEntry.musicRequestHandled = true;
    }

    const requestId = trustedRequestId(meta);
    const requestedBy = trustedRequester(meta);
    if (requestId && handledIds.has(requestId)) {
      return {
        handled: true,
        duplicate: true,
        command,
        requestedBy,
        requestId,
        promise: Promise.resolve(null)
      };
    }
    rememberRequestId(requestId);

    const promise = Promise.resolve().then(() => execute(command, {
      requestedBy,
      requestId,
      text: asText(text)
    }));
    return {
      handled: true,
      duplicate: false,
      command,
      requestedBy,
      requestId,
      promise
    };
  }

  function reset() {
    handledIds.clear();
    handledIdOrder.splice(0, handledIdOrder.length);
  }

  return {
    detect,
    handle,
    reset
  };
}
