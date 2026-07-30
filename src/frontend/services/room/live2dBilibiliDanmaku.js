import { startListen } from 'blive-message-listener/browser';
import {
  normalizeRoomBilibiliDanmakuSettings,
  readRoomBilibiliDanmakuSettings
} from './roomSettings.js';
import { filterLive2DAudienceMessage } from './live2dAudienceSafetyFilter.js';

export const BILIBILI_DANMAKU_EVENT = 'tsukuyomi:bilibili-danmaku';
export const BILIBILI_DANMAKU_STATE_EVENT = 'tsukuyomi:bilibili-danmaku-state';

const MESSAGE_LIMIT = 100;
const MESSAGE_STATE_BATCH_MS = 40;

let listener = null;
let listenerRunId = 0;
let messageStateTimer = null;
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
  authMode: 'anonymous',
  userNamesComplete: false,
  authWarning: '',
  authFailureStage: '',
  authFailureCode: 0,
  filteredCount: 0,
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

function cancelScheduledMessageState() {
  if (messageStateTimer === null) return;
  clearTimeout(messageStateTimer);
  messageStateTimer = null;
}

function scheduleMessageState(patch = {}) {
  state = {
    ...state,
    ...patch
  };
  if (messageStateTimer !== null) return;
  messageStateTimer = setTimeout(() => {
    messageStateTimer = null;
    state = {
      ...state,
      updatedAt: Date.now()
    };
    dispatch(BILIBILI_DANMAKU_STATE_EVENT, state);
  }, MESSAGE_STATE_BATCH_MS);
}

function updateState(patch = {}) {
  cancelScheduledMessageState();
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
    settings.buvid || '',
    settings.cookie || ''
  ].join('|');
}

export function normalizeBilibiliDanmakuConnectionInfo(payload = {}, fallbackRoomId = 0) {
  const actualRoomId = Number(payload.actualRoomId || payload.roomId || fallbackRoomId);
  const port = Number(payload.port || 443);
  const host = String(payload.host || '').trim();
  const token = String(payload.token || '').trim();
  const buvid = String(payload.buvid || '').trim();
  if (!Number.isFinite(actualRoomId) || actualRoomId <= 0) {
    throw new Error('B站没有返回有效的直播间 ID');
  }
  if (!host || !token) {
    throw new Error('B站没有返回可用的弹幕服务器或连接令牌');
  }
  const authFailureStage = String(payload.authFailureStage || '').trim();
  const authFailureCode = Number(payload.authFailureCode || 0) || 0;
  return {
    roomId: Number(payload.roomId || fallbackRoomId) || actualRoomId,
    actualRoomId: Math.round(actualRoomId),
    liveStatus: Number(payload.liveStatus || 0) || 0,
    uid: Number(payload.uid || 0) || 0,
    host,
    port: Number.isFinite(port) && port > 0 ? Math.round(port) : 443,
    token,
    buvid,
    authMode: payload.authMode === 'authenticated' ? 'authenticated' : 'anonymous',
    userNamesComplete: payload.userNamesComplete === true,
    authWarning: formatBilibiliAuthWarning({
      stage: authFailureStage,
      code: authFailureCode,
      fallback: payload.authWarning
    }),
    authFailureStage,
    authFailureCode
  };
}

export function formatBilibiliAuthWarning({ stage = '', code = 0, fallback = '' } = {}) {
  const normalizedStage = String(stage || '').trim();
  const normalizedCode = Number(code || 0) || 0;
  if (normalizedStage === 'nav' && normalizedCode === -101) {
    return 'B站返回未登录（-101）：程序已经发送 Cookie，但 B站判定该会话未登录。这通常表示 SESSDATA 已过期、被截断或与其他字段不属于同一会话。请勿逐项复制；请从已登录请求的 Request Headers 复制完整 Cookie 请求头值（不含 Cookie: 前缀）并整段粘贴。';
  }
  if (normalizedStage === 'nav') {
    return `B站登录校验失败${normalizedCode ? `（${normalizedCode}）` : ''}，已自动使用匿名模式。`;
  }
  if (normalizedStage === 'danmaku-info' && normalizedCode === -352) {
    return 'B站认证弹幕接口触发风控（-352），已自动使用匿名模式；请稍后重试。';
  }
  if (normalizedStage === 'danmaku-info') {
    return `获取 B站认证弹幕令牌失败${normalizedCode ? `（${normalizedCode}）` : ''}，已自动使用匿名模式。`;
  }
  if (normalizedStage === 'wbi-sign') {
    return 'B站 WBI 签名密钥无效，已自动使用匿名模式。';
  }
  return String(fallback || '').trim();
}

export async function resolveBilibiliDanmakuConnection(settings = {}, dependencies = {}) {
  const roomId = normalizeRoomId(settings);
  if (!roomId) throw new Error('请填写有效的 B站直播间 ID');
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前运行环境无法请求 B站弹幕连接信息');
  }

  const response = await fetchImpl('/api/bilibili/connect-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomId,
      cookie: String(settings.cookie || '').trim()
    })
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    throw new Error('本地服务返回了无法识别的 B站连接信息');
  }
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `获取 B站弹幕连接信息失败（HTTP ${response.status || 0}）`);
  }
  return normalizeBilibiliDanmakuConnectionInfo(payload, roomId);
}

export function buildBilibiliDanmakuConnectionOptions(settings = {}, connectionInfo = {}) {
  const ws = {
    platform: settings.platform || 'web',
    uid: Number(connectionInfo.uid) || 0,
    ssl: true,
    host: connectionInfo.host,
    port: Number(connectionInfo.port) || 443,
    key: connectionInfo.token || settings.key,
    buvid: connectionInfo.buvid || settings.buvid
  };
  return { ws };
}

export function formatBilibiliDanmakuSpeech(message = {}, settings = {}) {
  const normalized = normalizeRoomBilibiliDanmakuSettings(settings);
  const type = String(message.type || 'danmu').trim().toLowerCase();
  const giftName = String(message.giftName || message.text || '礼物')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '礼物';
  const text = String(message.text || giftName)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  if (!text) return '';

  const userName = String(message.userName || '观众')
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .trim()
    .slice(0, 32) || '观众';
  const amount = Math.max(1, Math.round(Number(message.amount || 1)));
  if (type === 'gift') {
    const giftText = `送出了${giftName}${amount > 1 ? `，共${amount}个` : ''}，谢谢支持！`;
    return normalized.readUserName ? `${userName}${giftText}` : `收到${giftName}，谢谢支持！`;
  }
  if (type === 'guard') {
    const guardText = `开通了${giftName}，谢谢支持！`;
    return normalized.readUserName ? `${userName}${guardText}` : `收到${giftName}，谢谢支持！`;
  }
  if (!normalized.readUserName) return text;
  return type === 'superchat'
    ? `${userName}发来醒目留言：${text}`
    : `${userName}说：${text}`;
}

function formattedPrice(price) {
  const value = Math.max(0, Number(price) || 0);
  if (!value) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

export function formatBilibiliAudienceMessage(message = {}) {
  const type = String(message.type || 'danmu').trim().toLowerCase();
  const userName = String(message.userName || 'Bilibili').trim() || 'Bilibili';
  const text = String(message.text || '').trim();
  const giftName = String(message.giftName || text || '礼物').trim() || '礼物';
  const amount = Math.max(1, Math.round(Number(message.amount || 1)));
  const price = formattedPrice(message.price);
  const priceLabel = price ? ` ¥${price}` : '';
  if (type === 'superchat') return `[SC${priceLabel}] ${userName}: ${text}`;
  if (type === 'gift') return `[礼物${priceLabel}] ${userName} 送出 ${giftName}${amount > 1 ? ` ×${amount}` : ''}`;
  if (type === 'guard') return `[大航海${priceLabel}] ${userName} 开通 ${giftName}`;
  return `${userName}: ${text}`;
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
  const amount = Math.max(0, Number(body.amount || body.num || 0) || 0);
  const rawPrice = Math.max(0, Number(body.price || 0) || 0);
  const comboPrice = Math.max(0, Number(body.combo?.total_price || body.total_price || 0) || 0);
  const price = type === 'gift'
    ? (comboPrice || rawPrice * Math.max(1, amount)) / 1000
    : rawPrice;
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
    price,
    amount,
    giftName: String(body.gift_name || '').trim(),
    coinType: String(body.coin_type || '').trim(),
    timestamp
  };
}

function filterIncomingMessage(message) {
  const filtered = filterLive2DAudienceMessage(message, activeSettings);
  if (filtered.dropped) {
    if (!['superchat', 'gift', 'guard'].includes(message?.type)) {
      return { message: null, filtered };
    }
    return {
      filtered,
      message: {
        ...message,
        userName: filtered.safeUserName,
        text: '[内容已过滤]',
        giftName: message?.type === 'superchat' ? '' : '[内容已过滤]',
        safetyFiltered: true,
        safetyReason: filtered.reason
      }
    };
  }
  return {
    filtered,
    message: {
      ...message,
      userName: filtered.safeUserName,
      text: filtered.safeText,
      giftName: ['gift', 'guard'].includes(message?.type)
        ? filtered.safeText
        : String(message?.giftName || '').trim(),
      safetyFiltered: filtered.masked,
      safetyReason: filtered.reason
    }
  };
}

function pushIncomingMessage(message, { broadcast = true, applySafetyFilter = true } = {}) {
  if (!message?.text && message?.type !== 'gift' && message?.type !== 'guard') return null;
  const safety = applySafetyFilter
    ? filterIncomingMessage(message)
    : { message, filtered: null };
  const safeMessage = safety.message;
  if (!safeMessage) {
    scheduleMessageState({
      messageCount: state.messageCount + 1,
      filteredCount: state.filteredCount + 1,
      actualRoomId: message.actualRoomId || state.actualRoomId
    });
    return null;
  }
  messages = [
    safeMessage,
    ...messages.filter((item) => item.id !== safeMessage.id)
  ].slice(0, MESSAGE_LIMIT);
  scheduleMessageState({
    messageCount: state.messageCount + 1,
    filteredCount: state.filteredCount + (
      safety.filtered?.masked || safety.filtered?.dropped ? 1 : 0
    ),
    actualRoomId: safeMessage.actualRoomId || state.actualRoomId
  });
  if (broadcast) dispatch(BILIBILI_DANMAKU_EVENT, safeMessage);
  return safeMessage;
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
    timestamp: Date.now()
  }, { broadcast: false, applySafetyFilter: false });
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
      pushIncomingMessage(message);
    },
    onGuardBuy: (msg) => {
      if (!isCurrent()) return;
      pushIncomingMessage(normalizeIncomingMessage(msg, 'guard'));
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
  updateState({ messageCount: 0, filteredCount: 0 });
  return readBilibiliDanmakuSnapshot();
}

export function publishBilibiliDanmakuTestMessage(text = '八千代，能听见这条测试弹幕吗？') {
  return pushIncomingMessage({
    id: `test-danmu-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    platform: 'bilibili',
    type: 'danmu',
    roomId: activeSettings.roomId || state.roomId,
    actualRoomId: Number(listener?.roomId || state.actualRoomId || 0) || 0,
    userId: 0,
    userName: '测试观众',
    userFace: '',
    userBadge: null,
    text: String(text || '').trim(),
    price: 0,
    amount: 0,
    giftName: '',
    timestamp: Date.now()
  });
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

export async function startBilibiliDanmakuListener(
  settings = readRoomBilibiliDanmakuSettings(),
  dependencies = {}
) {
  const normalized = normalizeRoomBilibiliDanmakuSettings(settings);
  const roomId = normalizeRoomId(normalized);
  if (!roomId) {
    updateState({
      status: 'error',
      roomId: normalized.roomId,
      connected: false,
      listening: false,
      error: '请填写有效的 B站直播间 ID'
    });
    throw new Error('请填写有效的 B站直播间 ID');
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
  try {
    const connectionInfo = await resolveBilibiliDanmakuConnection(normalized, dependencies);
    if (runId !== listenerRunId) return readBilibiliDanmakuSnapshot();
    const startListenImpl = dependencies.startListenImpl || startListen;
    listener = startListenImpl(
      connectionInfo.actualRoomId,
      createHandler(runId),
      buildBilibiliDanmakuConnectionOptions(normalized, connectionInfo)
    );
    updateState({
      actualRoomId: connectionInfo.actualRoomId,
      authMode: connectionInfo.authMode,
      userNamesComplete: connectionInfo.userNamesComplete,
      authWarning: connectionInfo.authWarning,
      authFailureStage: connectionInfo.authFailureStage,
      authFailureCode: connectionInfo.authFailureCode
    });
    return readBilibiliDanmakuSnapshot();
  } catch (error) {
    if (runId === listenerRunId) {
      activeConnectionKey = '';
      updateState({
        status: 'error',
        connected: false,
        listening: false,
        error: errorText(error) || '无法连接到 B站直播间'
      });
    }
    throw error;
  }
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
