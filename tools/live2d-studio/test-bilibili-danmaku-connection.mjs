import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const bilibili = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dBilibiliDanmaku.js'
  );

  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({
      url,
      method: options?.method,
      body: JSON.parse(options?.body || '{}')
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        roomId: 25271643,
        actualRoomId: 25271643,
        liveStatus: 1,
        uid: 98765,
        token: 'fresh-danmu-token',
        buvid: 'fresh-buvid',
        host: 'broadcast.example.test',
        port: 443,
        authMode: 'authenticated',
        userNamesComplete: true,
        authWarning: ''
      })
    };
  };

  const info = await bilibili.resolveBilibiliDanmakuConnection(
    { roomId: '25271643', cookie: 'SESSDATA=test' },
    { fetchImpl }
  );
  assert.deepEqual(requests, [{
    url: '/api/bilibili/connect-info',
    method: 'POST',
    body: {
      roomId: 25271643,
      cookie: 'SESSDATA=test'
    }
  }]);
  assert.equal(info.actualRoomId, 25271643);
  assert.equal(info.uid, 98765);
  assert.equal(info.token, 'fresh-danmu-token');
  assert.equal(info.host, 'broadcast.example.test');
  assert.equal(info.port, 443);
  assert.equal(info.authMode, 'authenticated');
  assert.equal(info.userNamesComplete, true);

  const expiredInfo = bilibili.normalizeBilibiliDanmakuConnectionInfo({
    success: true,
    roomId: 25271643,
    actualRoomId: 25271643,
    uid: 0,
    token: 'anonymous-token',
    buvid: 'anonymous-buvid',
    host: 'broadcast.example.test',
    port: 443,
    authMode: 'anonymous',
    userNamesComplete: false,
    authWarning: 'generic fallback warning',
    authFailureStage: 'nav',
    authFailureCode: -101
  }, 25271643);
  assert.match(expiredInfo.authWarning, /SESSDATA/);
  assert.match(expiredInfo.authWarning, /-101/);
  assert.match(expiredInfo.authWarning, /已经发送 Cookie/);
  assert.match(expiredInfo.authWarning, /Request Headers/);
  assert.match(expiredInfo.authWarning, /完整 Cookie 请求头/);

  const started = [];
  const startListenImpl = (roomId, handler, options) => {
    const fake = {
      roomId,
      closed: false,
      close() {
        this.closed = true;
      }
    };
    started.push({ roomId, handler, options, fake });
    return fake;
  };

  const snapshot = await bilibili.startBilibiliDanmakuListener(
    {
      enabled: true,
      roomId: '25271643',
      platform: 'web',
      uid: 98765,
      key: 'stale-saved-token',
      buvid: 'stale-saved-buvid',
      cookie: 'SESSDATA=stale-saved-cookie'
    },
    { fetchImpl, startListenImpl }
  );

  assert.equal(started.length, 1);
  assert.equal(started[0].roomId, 25271643);
  assert.deepEqual(started[0].options, {
    ws: {
      platform: 'web',
      uid: 98765,
      ssl: true,
      host: 'broadcast.example.test',
      port: 443,
      key: 'fresh-danmu-token',
      buvid: 'fresh-buvid'
    }
  });
  assert.equal(snapshot.state.status, 'connecting');
  assert.equal(snapshot.state.actualRoomId, 25271643);
  assert.equal(snapshot.state.authMode, 'authenticated');
  assert.equal(snapshot.state.userNamesComplete, true);

  started[0].handler.onOpen();
  started[0].handler.onStartListen();
  assert.equal(bilibili.readBilibiliDanmakuState().listening, true);

  bilibili.stopBilibiliDanmakuListener();
  console.log('Bilibili danmaku connection checks passed');
} finally {
  await server.close();
}
