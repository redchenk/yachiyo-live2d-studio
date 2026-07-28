import assert from 'node:assert/strict';
import { createServer } from 'vite';

const events = [];
globalThis.CustomEvent = class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
};
globalThis.window = {
  dispatchEvent(event) {
    events.push(event);
    return true;
  }
};

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const bilibili = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dBilibiliDanmaku.js'
  );
  let handler = null;
  await bilibili.startBilibiliDanmakuListener(
    {
      enabled: true,
      roomId: '25271643',
      platform: 'web'
    },
    {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          success: true,
          roomId: 25271643,
          actualRoomId: 25271643,
          token: 'test-token',
          buvid: 'test-buvid',
          host: 'broadcast.example.test',
          port: 443
        })
      }),
      startListenImpl: (roomId, nextHandler) => {
        handler = nextHandler;
        return {
          roomId,
          closed: false,
          close() {
            this.closed = true;
          }
        };
      }
    }
  );

  handler.onIncomeSuperChat({
    id: 'sc-1',
    timestamp: 1_750_000_000,
    body: {
      user: { uid: 1, uname: '醒目观众' },
      content: '八千代晚上好',
      price: 30
    }
  });
  handler.onGift({
    id: 'gift-1',
    timestamp: 1_750_000_001,
    body: {
      user: { uid: 2, uname: '送礼观众' },
      gift_name: '辣条',
      price: 100,
      amount: 3,
      coin_type: 'gold'
    }
  });
  handler.onGuardBuy({
    id: 'guard-1',
    timestamp: 1_750_000_002,
    body: {
      user: { uid: 3, uname: '舰长观众' },
      gift_name: '舰长',
      price: 198
    }
  });

  const paidEvents = events
    .filter((event) => event.type === bilibili.BILIBILI_DANMAKU_EVENT)
    .map((event) => event.detail);
  assert.deepEqual(paidEvents.map((message) => message.type), [
    'superchat',
    'gift',
    'guard'
  ]);
  assert.equal(paidEvents[0].userName, '醒目观众');
  assert.equal(paidEvents[0].price, 30);
  assert.equal(paidEvents[1].userName, '送礼观众');
  assert.equal(paidEvents[1].giftName, '辣条');
  assert.equal(paidEvents[1].amount, 3);
  assert.equal(paidEvents[1].price, 0.3);
  assert.equal(paidEvents[1].coinType, 'gold');
  assert.equal(paidEvents[2].userName, '舰长观众');
  assert.equal(paidEvents[2].giftName, '舰长');
  assert.equal(paidEvents[2].price, 198);

  bilibili.stopBilibiliDanmakuListener();
  console.log('Bilibili paid event checks passed');
} finally {
  await server.close();
}
