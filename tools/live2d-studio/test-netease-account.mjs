import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

const store = new Map();
const calls = [];

globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  }
};
globalThis.window = { localStorage: globalThis.localStorage };

globalThis.fetch = async (url, options = {}) => {
  const body = JSON.parse(options.body || '{}');
  calls.push({ url, body });
  if (url.endsWith('/account')) {
    return Response.json({
      success: true,
      loggedIn: true,
      source: 'secure-storage',
      account: {
        loggedIn: true,
        userId: '10086',
        displayName: '八千代',
        avatarUrl: 'https://p.example/avatar.jpg'
      },
      cookie: 'MUSIC_U=must-not-leak'
    });
  }
  if (url.endsWith('/login/qr/create')) {
    return Response.json({
      success: true,
      key: 'qr-key',
      qrUrl: 'orpheus://login',
      qrImage: 'data:image/png;base64,abc',
      status: 801
    });
  }
  if (url.endsWith('/login/qr/check')) {
    return Response.json({
      success: true,
      status: 803,
      loggedIn: true,
      cookie: 'MUSIC_U=must-not-leak',
      account: {
        loggedIn: true,
        userId: '10086',
        displayName: '八千代',
        avatarUrl: ''
      }
    });
  }
  if (url.endsWith('/logout')) {
    return Response.json({ success: true, loggedIn: false });
  }
  return Response.json({ success: false, message: 'unexpected endpoint' }, { status: 404 });
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    checkNeteaseMusicQrLogin,
    createNeteaseMusicQrLogin,
    logoutNeteaseMusicAccount,
    readNeteaseMusicAccount
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dNeteaseAccount.js');
  const {
    DEFAULT_ROOM_MUSIC_SETTINGS,
    ROOM_MUSIC_SETTINGS_KEY,
    writeRoomMusicSettings
  } = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');

  writeRoomMusicSettings({
    ...DEFAULT_ROOM_MUSIC_SETTINGS,
    neteaseCookie: 'MUSIC_U=legacy',
    neteaseCookiePath: 'C:\\legacy-cookie.txt'
  });

  const account = await readNeteaseMusicAccount();
  assert.equal(account.loggedIn, true);
  assert.equal(account.displayName, '八千代');
  assert.ok(!JSON.stringify(account).includes('MUSIC_U'));
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['neteaseApiUrl', 'neteaseQualityLevel']);

  const qr = await createNeteaseMusicQrLogin();
  assert.equal(qr.key, 'qr-key');
  assert.ok(qr.qrImage.startsWith('data:image/png'));

  const checked = await checkNeteaseMusicQrLogin(qr.key);
  assert.equal(checked.status, 803);
  assert.equal(checked.account.displayName, '八千代');
  assert.ok(!JSON.stringify(checked).includes('MUSIC_U'));

  await logoutNeteaseMusicAccount();
  const saved = JSON.parse(store.get(ROOM_MUSIC_SETTINGS_KEY));
  assert.equal(saved.neteaseCookie, '');
  assert.equal(saved.neteaseCookiePath, '');

  const launcherSource = await fs.readFile(
    new URL('../live2d-launcher/Live2DStudioLauncher.cs', import.meta.url),
    'utf8'
  );
  assert.match(launcherSource, /ProtectedData\.Protect/);
  assert.match(launcherSource, /ReserveFreeLoopbackPort/);
  assert.match(launcherSource, /\/api\/music\/netease\/login\/qr\/create/);
  assert.doesNotMatch(launcherSource, /Arguments = .*NeteaseMusicApiLogicalPort/);
} finally {
  await server.close();
}

console.log('netease account and managed sidecar checks passed');
