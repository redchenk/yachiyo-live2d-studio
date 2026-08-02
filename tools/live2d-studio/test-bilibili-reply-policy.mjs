import assert from 'node:assert/strict';
import { shouldReadBilibiliDanmakuAloud } from '../../src/frontend/services/room/live2dBilibiliReplyPolicy.js';

const ordinary = { type: 'danmu', text: 'viewer message' };
const gift = { type: 'gift', giftName: 'flower' };

assert.equal(
  shouldReadBilibiliDanmakuAloud(ordinary, { readAloud: false }, { autoReplyActive: false }),
  false
);
assert.equal(
  shouldReadBilibiliDanmakuAloud(ordinary, { readAloud: true }, { autoReplyActive: false }),
  true,
  'manual read-aloud mode must keep working when the AI director is not replying'
);
assert.equal(
  shouldReadBilibiliDanmakuAloud(ordinary, { readAloud: true }, { autoReplyActive: true }),
  false,
  'automatic AI replies must not also read the viewer text verbatim'
);
assert.equal(
  shouldReadBilibiliDanmakuAloud(gift, { readAloud: true }, { autoReplyActive: true }),
  false,
  'paid events must be thanked once by the AI reply path instead of being spoken twice'
);

console.log('Bilibili reply policy checks passed');
