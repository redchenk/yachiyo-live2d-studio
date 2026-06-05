import { startListen } from 'blive-message-listener/browser';
import {
  normalizeRoomBilibiliDanmakuSettings,
  readRoomBilibiliDanmakuSettings
} from './roomSettings';

export const BILIBILI_DANMAKU_EVENT = 'tsukuyomi:bilibili-danmaku';
export const BILIBILI_DANMAKU_STATE_EVENT = 'tsukuyomi:bilibili-danmaku-state';

const MESSAGE_LIMIT = 100;

let listener = null;
let listenerRunId = 0;
let activeSettings = normalizeRoomBilibiliDanmakuSettings();
let activeConnectionKey = '';
let messages = [];
let state = {
  status: 'idle',
  roomId: '',
  actualRoomId: 0,
  connected: false,
  listening: false,
  messageCount: 0,
  attention: 0,
  watched: '',
  error: '',
  startedAt: 0,
  updatedAt: 0
};

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function dispatch(name, detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail: copy(detail) }));
}

function updateState(patch = {}) {
  state = {
    ...state,
    ...patch,
    updatedAt: Date.now()
  };
  dispatch(BILIBILI_DANMAKU_STATE_EVENT, state);
  return readBilibiliDanmakuState();
}

function normalizeRoomId(settings = {}) {
  const numeric = Number(settings.roomId);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric);
}

function connectionKey(settings = {}) {
  return [
    normalizeRoomId(settings),
    settings.platform || 'web',
    Number(settings.uid) || 0,
    settings.key || '',
    settings.buvid || ''
  ].join('|');
}

function connectionOptions(settings = {}) {
  const ws = {
    platform: settings.platform || 'web',
    uid: Number(settings.uid) || 0
  };
  if (settings.key) ws.key = settings.key;
  if (settings.buvid) ws.buvid = settings.buvid;
  return { ws };
}

function errorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return error.message || error.reason || String(error);
}

function timestampMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return Date.now();
  return numeric < 1000000000000 ? numeric * 1000 : numeric;
}

function normalizeUser(user = {}) {
  return {
    id: Number(user.uid || user.id || 0) || 0,
    name: String(user.uname || user.name || 'Bilibili').trim() || 'Bilibili',
    face: String(user.face || '').trim(),
    badge: user.badge || null
  };
}

function normalizeIncomingMessage(raw, type) {
  const body = raw?.body || {};
  const user = normalizeUser(body.user || body.sender || body.user_info || {});
  const content = String(body.content || body.message || body.gift_name || '').trim();
  const timestamp = timestampMs(raw?.timestamp || body.timestamp || body.ts || Date.now());
  return {
    id: String(raw?.id || body.id || `${type}-${timestamp}-${Math.random().toString(36).slice(2)}`),
    platform: 'bilibili',
    type,
    roomId: activeSettings.roomId || state.roomId,
    actualRoomId: Number(listener?.roomId || state.actualRoomId || 0) || 0,
    userId: user.id,
    userName: user.name,
    userFace: user.face,
    userBadge: user.badge,
    text: content,
    price: Number(body.price || 0) || 0,
    amount: Number(body.amount || body.num || 0) || 0,
    giftName: String(body.gift_name || '').trim(),
    timestamp,
    raw
  };
}

function pushIncomingMessage(message, { broadcast = true } = {}) {
  if (!message?.text && message?.type !== 'gift' && message?.type !== 'guard') return null;
  messages = [
    message,
    ...messages.filter((item) => item.id !== message.id)
  ].slice(0, MESSAGE_LIMIT);
  updateState({
    messageCount: state.messageCount + 1,
    actualRoomId: message.actualRoomId || state.actualRoomId
  });
  if (broadcast) dispatch(BILIBILI_DANMAKU_EVENT, message);
  return message;
}

function pushRuntimeLine(type, text, raw = null) {
  return pushIncomingMessage({
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    platform: 'bilibili',
    type,
    roomId: activeSettings.roomId || state.roomId,
    actualRoomId: Number(listener?.roomId || state.actualRoomId || 0) || 0,
    userId: 0,
    userName: 'Bilibili',
    userFace: '',
    userBadge: null,
    text: String(text || '').trim(),
    price: 0,
    amount: 0,
    giftName: '',
    timestamp: Date.now(),
    raw
  }, { broadcast: false });
}

function createHandler(runId) {
  const isCurrent = () => runId === listenerRunId;
  return {
    onOpen: () => {
      if (!isCurrent()) return;
      updateState({
        status: 'connected',
        connected: true,
        error: '',
        actualRoomId: Number(listener?.roomId || state.actualRoomId || 0) || 0
      });
    },
    onStartListen: () => {
      if (!isCurrent()) return;
      updateState({
        status: 'listening',
        connected: true,
        listening: true,
        error: ''
      });
    },
    onClose: () => {
      if (!isCurrent()) return;
      updateState({
        status: 'closed',
        connected: false,
        listening: false
      });
    },
    onError: (error) => {
      if (!isCurrent()) return;
      updateState({
        status: 'error',
        connected: false,
        listening: false,
        error: errorText(error) || 'Bilibili connection error'
      });
    },
    onIncomeDanmu: (msg) => {
      if (!isCurrent()) return;
      pushIncomingMessage(normalizeIncomingMessage(msg, 'danmu'));
    },
    onIncomeSuperChat: (msg) => {
      if (!isCurrent()) return;
      pushIncomingMessage(normalizeIncomingMessage(msg, 'superchat'));
    },
    onGift: (msg) => {
      if (!isCurrent()) return;
      const message = normalizeIncomingMessage(msg, 'gift');
      message.text = message.giftName || message.text;
      pushIncomingMessage(message, { broadcast: false });
    },
    onGuardBuy: (msg) => {
      if (!isCurrent()) return;
      pushIncomingMessage(normalizeIncomingMessage(msg, 'guard'), { broadcast: false });
    },
    onLiveStart: (msg) => {
      if (!isCurrent()) return;
      pushRuntimeLine('live-start', 'Live started', msg);
    },
    onLiveEnd: (msg) => {
      if (!isCurrent()) return;
      pushRuntimeLine('live-end', 'Live ended', msg);
    },
    onAttentionChange: (msg) => {
      if (!isCurrent()) return;
      updateState({ attention: Number(msg?.body?.attention || 0) || 0 });
    },
    onWatchedChange: (msg) => {
      if (!isCurrent()) return;
      updateState({ watched: String(msg?.body?.text_small || msg?.body?.num || '').trim() });
    }
  };
}

export function readBilibiliDanmakuState() {
  return copy(state);
}

export function readBilibiliDanmakuMessages() {
  return copy(messages);
}

export function readBilibiliDanmakuSnapshot() {
  return {
    state: readBilibiliDanmakuState(),
    messages: readBilibiliDanmakuMessages(),
    settings: copy(activeSettings)
  };
}

export function clearBilibiliDanmakuMessages() {
  messages = [];
  updateState({ messageCount: 0 });
  return readBilibiliDanmakuSnapshot();
}

export function stopBilibiliDanmakuListener() {
  listenerRunId += 1;
  const current = listener;
  listener = null;
  activeConnectionKey = '';
  if (current) {
    try {
      current.close();
    } catch (_) {}
  }
  updateState({
    status: 'idle',
    connected: false,
    listening: false,
    error: ''
  });
  return readBilibiliDanmakuSnapshot();
}

export function startBilibiliDanmakuListener(settings = readRoomBilibiliDanmakuSettings()) {
  const normalized = normalizeRoomBilibiliDanmakuSettings(settings);
  const roomId = normalizeRoomId(normalized);
  if (!roomId) {
    updateState({
      status: 'error',
      roomId: normalized.roomId,
      connected: false,
      listening: false,
      error: 'Room ID is required'
    });
    throw new Error('Room ID is required');
  }

  const nextKey = connectionKey(normalized);
  activeSettings = normalized;
  if (listener && !listener.closed && activeConnectionKey === nextKey) {
    updateState({
      roomId: normalized.roomId,
      actualRoomId: Number(listener.roomId || state.actualRoomId || 0) || 0
    });
    return readBilibiliDanmakuSnapshot();
  }

  stopBilibiliDanmakuListener();
  const runId = listenerRunId + 1;
  listenerRunId = runId;
  activeConnectionKey = nextKey;
  updateState({
    status: 'connecting',
    roomId: normalized.roomId,
    actualRoomId: 0,
    connected: false,
    listening: false,
    error: '',
    startedAt: Date.now()
  });
  listener = startListen(roomId, createHandler(runId), connectionOptions(normalized));
  updateState({
    actualRoomId: Number(listener.roomId || 0) || 0
  });
  return readBilibiliDanmakuSnapshot();
}

export function syncBilibiliDanmakuListener(settings = readRoomBilibiliDanmakuSettings()) {
  const normalized = normalizeRoomBilibiliDanmakuSettings(settings);
  activeSettings = normalized;
  if (!normalized.enabled) return stopBilibiliDanmakuListener();
  if (normalized.autoConnect) return startBilibiliDanmakuListener(normalized);
  updateState({
    roomId: normalized.roomId || state.roomId
  });
  return readBilibiliDanmakuSnapshot();
}
