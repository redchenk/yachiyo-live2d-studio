import assert from 'node:assert/strict';
import {
  enqueueLive2DAudienceEntry,
  formatLive2DAudiencePromptEntry,
  requeueLive2DAudienceTurn,
  selectLive2DBilibiliMessages,
  selectLive2DAudienceTurn
} from '../../src/frontend/services/room/live2dAudienceTurnSelector.js';

const now = 1_750_000_000_000;
let queue = [];

for (const [text, meta] of [
  ['路过打个招呼', { source: 'bilibili', bilibili: { id: 'plain', userId: '1', userName: 'A' } }],
  ['八千代，你今天为什么这么开心？', { source: 'bilibili', bilibili: { id: 'mention', userId: '2', userName: 'B' } }],
  ['今晚会唱歌吗？', { source: 'bilibili', bilibili: { id: 'question', userId: '3', userName: 'C' } }],
  ['[SC] D: 请讲讲月见', {
    source: 'bilibili',
    bilibili: { id: 'sc', type: 'superchat', userId: '4', userName: 'D', price: 30 }
  }]
]) {
  const result = enqueueLive2DAudienceEntry(queue, text, meta, { now });
  assert.equal(result.accepted, true);
  queue = result.queue;
}

const duplicate = enqueueLive2DAudienceEntry(
  queue,
  '八千代，你今天为什么这么开心？',
  { source: 'bilibili' },
  { now }
);
assert.equal(duplicate.accepted, false);
assert.equal(duplicate.reason, 'duplicate');

const spam = enqueueLive2DAudienceEntry(queue, '啊啊啊啊啊啊啊啊啊啊啊啊', {}, { now });
assert.equal(spam.accepted, false);
assert.equal(spam.reason, 'empty-or-spam');

const turn = selectLive2DAudienceTurn(queue, { limit: 3, now });
assert.deepEqual(turn.selected.map((entry) => entry.id), ['sc', 'mention', 'question']);
assert.deepEqual(turn.remaining.map((entry) => entry.id), ['plain']);

const musicRequest = enqueueLive2DAudienceEntry([], '我要听ray', {
  source: 'bilibili',
  bilibili: { id: 'music-request', userId: 'music-viewer', userName: '点歌观众' }
}, { now }).entry;
const ordinaryMessage = enqueueLive2DAudienceEntry([], '今天挺开心', {
  source: 'bilibili',
  bilibili: { id: 'ordinary-message', userId: 'ordinary-viewer', userName: '普通观众' }
}, { now }).entry;
assert.equal(
  selectLive2DAudienceTurn([ordinaryMessage, musicRequest], { limit: 1, now }).selected[0].id,
  'music-request'
);

let sameViewerQueue = [];
for (const [id, text, userId] of [
  ['a1', '八千代第一个问题？', 'viewer-a'],
  ['a2', '八千代第二个问题？', 'viewer-a'],
  ['b1', '普通观众也想问一个问题？', 'viewer-b']
]) {
  sameViewerQueue = enqueueLive2DAudienceEntry(
    sameViewerQueue,
    text,
    { source: 'bilibili', bilibili: { id, userId } },
    { now }
  ).queue;
}
const fairTurn = selectLive2DAudienceTurn(sameViewerQueue, { limit: 2, now });
assert.equal(new Set(fairTurn.selected.map((entry) => entry.userId)).size, 2);

const restored = requeueLive2DAudienceTurn(turn.remaining, turn.selected);
assert.deepEqual(restored.map((entry) => entry.id), ['sc', 'mention', 'question', 'plain']);

const promptLine = formatLive2DAudiencePromptEntry(turn.selected[0]);
assert.match(promptLine, /"type":"superchat"/);
assert.match(promptLine, /"viewer":"D"/);
assert.match(promptLine, /"paid":30/);

const staleQueue = [
  enqueueLive2DAudienceEntry([], 'old ordinary danmaku', {
    source: 'bilibili',
    bilibili: {
      id: 'stale-ordinary',
      type: 'danmu',
      userId: 'old-viewer',
      timestamp: now - 25_000
    }
  }, { now }).entry,
  enqueueLive2DAudienceEntry([], 'older but paid message', {
    source: 'bilibili',
    bilibili: {
      id: 'recent-enough-sc',
      type: 'superchat',
      userId: 'paid-viewer',
      price: 30,
      timestamp: now - 25_000
    }
  }, { now }).entry
];
const freshTurn = selectLive2DAudienceTurn(staleQueue, { limit: 3, now });
assert.deepEqual(freshTurn.selected.map((entry) => entry.id), ['recent-enough-sc']);
assert.deepEqual(freshTurn.remaining, []);
assert.deepEqual(freshTurn.discarded.map((entry) => entry.id), ['stale-ordinary']);

const burstSelection = selectLive2DBilibiliMessages([
  { id: 'ordinary', type: 'danmu', userId: '1', userName: 'A', text: '路过', timestamp: now },
  { id: 'question', type: 'danmu', userId: '2', userName: 'B', text: '今晚会唱歌吗？', timestamp: now },
  { id: 'mention', type: 'danmu', userId: '3', userName: 'C', text: '八千代看看这里', timestamp: now },
  { id: 'gift', type: 'gift', userId: '5', userName: 'E', text: '小花花', giftName: '小花花', amount: 5, price: 5, timestamp: now },
  { id: 'sc', type: 'superchat', userId: '4', userName: 'D', text: '醒目留言', price: 30, timestamp: now }
], { limit: 2, now });
assert.deepEqual(burstSelection.map((message) => message.id), ['sc', 'gift']);

const staleGift = enqueueLive2DAudienceEntry([], '[礼物] E 送出 小花花 ×5', {
  source: 'bilibili',
  bilibili: {
    id: 'recent-enough-gift',
    type: 'gift',
    userId: 'gift-viewer',
    userName: 'E',
    giftName: '小花花',
    amount: 5,
    price: 5,
    timestamp: now - 25_000
  }
}, { now }).entry;
const paidTurn = selectLive2DAudienceTurn([staleGift], { limit: 1, now });
assert.equal(paidTurn.selected[0].id, 'recent-enough-gift');
assert.match(formatLive2DAudiencePromptEntry(paidTurn.selected[0]), /"gift":"小花花"/);
assert.match(formatLive2DAudiencePromptEntry(paidTurn.selected[0]), /"amount":5/);

const expiredPaid = enqueueLive2DAudienceEntry([], '[SC] 太久以前的醒目留言', {
  source: 'bilibili',
  bilibili: {
    id: 'expired-paid',
    type: 'superchat',
    userId: 'expired-paid-viewer',
    price: 30,
    timestamp: now - 50_000
  }
}, { now }).entry;
const expiredPaidTurn = selectLive2DAudienceTurn([expiredPaid], { limit: 1, now });
assert.deepEqual(expiredPaidTurn.selected, []);
assert.deepEqual(expiredPaidTurn.discarded.map((entry) => entry.id), ['expired-paid']);

console.log('audience turn selector checks passed');
