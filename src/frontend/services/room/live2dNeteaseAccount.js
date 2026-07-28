import {
  normalizeRoomMusicSettings,
  readRoomMusicSettings,
  writeRoomMusicSettings
} from './roomSettings';

const ACCOUNT_ENDPOINT = '/api/music/netease/account';
const QR_CREATE_ENDPOINT = '/api/music/netease/login/qr/create';
const QR_CHECK_ENDPOINT = '/api/music/netease/login/qr/check';
const LOGOUT_ENDPOINT = '/api/music/netease/logout';
const DEFAULT_TIMEOUT_MS = 12000;

function asText(value) {
  return String(value ?? '').trim();
}

function safeSettings(settings = readRoomMusicSettings()) {
  const normalized = normalizeRoomMusicSettings(settings);
  return {
    neteaseApiUrl: normalized.neteaseApiUrl,
    neteaseQualityLevel: normalized.neteaseQualityLevel
  };
}

async function postJson(endpoint, payload = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS))
    : 0;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload || {}),
      signal: controller?.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(asText(data?.message) || `网易云请求失败（${response.status}）`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('网易云服务响应超时，请重试');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function publicAccount(data = {}) {
  const account = data?.account && typeof data.account === 'object' ? data.account : null;
  return {
    provider: 'netease-cloud',
    loggedIn: Boolean(data?.loggedIn ?? account?.loggedIn),
    source: asText(data?.source),
    userId: asText(account?.userId),
    displayName: asText(account?.displayName),
    avatarUrl: asText(account?.avatarUrl),
    message: asText(data?.message)
  };
}

export async function readNeteaseMusicAccount(settings = readRoomMusicSettings()) {
  const data = await postJson(ACCOUNT_ENDPOINT, safeSettings(settings));
  return publicAccount(data);
}

export async function createNeteaseMusicQrLogin(settings = readRoomMusicSettings()) {
  const data = await postJson(QR_CREATE_ENDPOINT, safeSettings(settings));
  return {
    key: asText(data?.key),
    qrUrl: asText(data?.qrUrl),
    qrImage: asText(data?.qrImage),
    status: Number(data?.status) || 801,
    message: asText(data?.message) || '请使用网易云音乐 App 扫码登录'
  };
}

export async function checkNeteaseMusicQrLogin(key, settings = readRoomMusicSettings()) {
  const normalizedKey = asText(key);
  if (!normalizedKey) throw new Error('网易云二维码登录 Key 为空');
  const data = await postJson(QR_CHECK_ENDPOINT, {
    ...safeSettings(settings),
    key: normalizedKey
  });
  return {
    status: Number(data?.status) || 0,
    loggedIn: Boolean(data?.loggedIn),
    message: asText(data?.message),
    account: publicAccount(data)
  };
}

export async function logoutNeteaseMusicAccount(settings = readRoomMusicSettings()) {
  const data = await postJson(LOGOUT_ENDPOINT, {});
  const normalized = normalizeRoomMusicSettings(settings);
  writeRoomMusicSettings({
    ...normalized,
    neteaseCookie: '',
    neteaseCookiePath: ''
  });
  return publicAccount(data);
}

export function clearLegacyNeteaseMusicCredentials(settings = readRoomMusicSettings()) {
  const normalized = normalizeRoomMusicSettings(settings);
  if (!normalized.neteaseCookie && !normalized.neteaseCookiePath) return normalized;
  return writeRoomMusicSettings({
    ...normalized,
    neteaseCookie: '',
    neteaseCookiePath: ''
  });
}
