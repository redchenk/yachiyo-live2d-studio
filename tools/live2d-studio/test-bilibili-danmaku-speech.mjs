import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    formatBilibiliAudienceMessage,
    formatBilibiliDanmakuSpeech
  } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dBilibiliDanmaku.js'
  );
  const { normalizeRoomBilibiliDanmakuSettings } = await server.ssrLoadModule(
    '/src/frontend/services/room/roomSettings.js'
  );

  const defaults = normalizeRoomBilibiliDanmakuSettings({});
  assert.equal(defaults.autoForward, true);
  assert.equal(defaults.autoStartDirector, true);
  assert.equal(defaults.readAloud, true);
  assert.equal(defaults.readUserName, true);
  assert.equal(defaults.safetyFilterEnabled, true);
  assert.equal(defaults.safetyLevel, 'balanced');
  assert.equal(defaults.sensitiveWords, '');
  assert.equal(defaults.maskMildLanguage, true);

  const normalizedSafety = normalizeRoomBilibiliDanmakuSettings({
    safetyLevel: 'STRICT',
    sensitiveWords: '词条一\n词条二',
    maskMildLanguage: false
  });
  assert.equal(normalizedSafety.safetyLevel, 'strict');
  assert.equal(normalizedSafety.sensitiveWords, '词条一\n词条二');
  assert.equal(normalizedSafety.maskMildLanguage, false);
  assert.equal(
    normalizeRoomBilibiliDanmakuSettings({ safetyLevel: 'unknown' }).safetyLevel,
    'balanced'
  );

  assert.equal(
    formatBilibiliDanmakuSpeech(
      { type: 'danmu', userName: '月兔', text: '晚上好！' },
      { readUserName: true }
    ),
    '月兔说：晚上好！'
  );
  assert.equal(
    formatBilibiliDanmakuSpeech(
      { type: 'superchat', userName: '辉夜', text: '唱一首歌吧' },
      { readUserName: true }
    ),
    '辉夜发来醒目留言：唱一首歌吧'
  );
  assert.equal(
    formatBilibiliDanmakuSpeech(
      { type: 'danmu', userName: '月兔', text: '只念内容' },
      { readUserName: false }
    ),
    '只念内容'
  );
  assert.equal(
    formatBilibiliDanmakuSpeech(
      { type: 'gift', userName: '星野', giftName: '辣条', amount: 3 },
      { readUserName: true }
    ),
    '星野送出了辣条，共3个，谢谢支持！'
  );
  assert.equal(
    formatBilibiliDanmakuSpeech(
      { type: 'guard', userName: '船长', giftName: '舰长' },
      { readUserName: true }
    ),
    '船长开通了舰长，谢谢支持！'
  );
  assert.equal(
    formatBilibiliAudienceMessage({
      type: 'superchat',
      userName: '辉夜',
      text: '晚上好',
      price: 30
    }),
    '[SC ¥30] 辉夜: 晚上好'
  );
  assert.equal(
    formatBilibiliAudienceMessage({
      type: 'gift',
      userName: '星野',
      giftName: '辣条',
      text: '辣条',
      amount: 3,
      price: 0.3
    }),
    '[礼物 ¥0.3] 星野 送出 辣条 ×3'
  );

  console.log('Bilibili danmaku speech checks passed');
} finally {
  await server.close();
}
