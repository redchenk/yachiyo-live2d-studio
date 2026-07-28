import assert from 'node:assert/strict';
import {
  BILIBILI_GIFT_ACK_QUIET_WINDOW_MS,
  createLive2DBilibiliGiftAcknowledgementGate
} from '../../src/frontend/services/room/live2dBilibiliGiftAcknowledgementGate.js';

let now = 1_750_000_000_000;
const gate = createLive2DBilibiliGiftAcknowledgementGate({
  now: () => now
});
const popularityTicket = {
  type: 'gift',
  userId: 1001,
  userName: '连续投喂观众',
  giftName: '人气票',
  amount: 1
};

assert.equal(gate.allow(popularityTicket), true);

now += 1_000;
assert.equal(
  gate.allow({ ...popularityTicket, id: 'ticket-2' }),
  false,
  'the same viewer continuously sending the same gift should be thanked only once'
);

now += BILIBILI_GIFT_ACK_QUIET_WINDOW_MS - 1;
assert.equal(
  gate.allow({ ...popularityTicket, id: 'ticket-3' }),
  false,
  'each repeated gift should extend the quiet window'
);

assert.equal(gate.allow({
  ...popularityTicket,
  id: 'ticket-other-viewer',
  userId: 1002,
  userName: '另一位观众'
}), true);
assert.equal(gate.allow({
  ...popularityTicket,
  id: 'different-gift',
  giftName: '小花花'
}), true);
assert.equal(gate.allow({
  type: 'superchat',
  userId: 1001,
  text: '连续 SC 也必须逐条回应'
}), true);

now += BILIBILI_GIFT_ACK_QUIET_WINDOW_MS + 1;
assert.equal(
  gate.allow({ ...popularityTicket, id: 'ticket-after-pause' }),
  true,
  'a new gift session after a quiet pause should be acknowledged again'
);

gate.reset();
assert.equal(gate.allow(popularityTicket), true);

console.log('Bilibili gift acknowledgement gate checks passed');
