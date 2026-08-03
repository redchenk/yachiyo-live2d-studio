import assert from 'node:assert/strict';
import {
  enqueueLive2DAudienceEntry,
  ensureLive2DAudienceNamesInSpeech,
  formatLive2DAudiencePromptEntry,
  requeueLive2DAudienceTurn,
  resolveLive2DAudienceAcknowledgements,
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
  { source: 'bilibili', bilibili: { userId: '2', userName: 'B' } },
  { now }
);
assert.equal(duplicate.accepted, false);
assert.equal(duplicate.reason, 'duplicate');

const commonGreetingFromAnotherViewer = enqueueLive2DAudienceEntry(
  [enqueueLive2DAudienceEntry([], '晚上好', {
    source: 'bilibili',
    bilibili: { id: 'greeting-a', userId: 'greeting-viewer-a', userName: 'A' }
  }, { now }).entry],
  '晚上好',
  {
    source: 'bilibili',
    bilibili: { id: 'greeting-b', userId: 'greeting-viewer-b', userName: 'B' }
  },
  { now }
);
assert.equal(
  commonGreetingFromAnotherViewer.accepted,
  true,
  'common messages from different viewers must not be collapsed by global text deduplication'
);

const spam = enqueueLive2DAudienceEntry(queue, '啊啊啊啊啊啊啊啊啊啊啊啊', {}, { now });
assert.equal(spam.accepted, false);
assert.equal(spam.reason, 'empty-or-spam');

const turn = selectLive2DAudienceTurn(queue, {
  limit: 3,
  replyCount: 2,
  rng: () => 0.4,
  now
});
assert.deepEqual(turn.selected.map((entry) => entry.id), ['sc', 'mention']);
assert.deepEqual(turn.remaining.map((entry) => entry.id), ['plain', 'question']);

const musicRequest = enqueueLive2DAudienceEntry([], '我要听ray', {
  source: 'bilibili',
  bilibili: { id: 'music-request', userId: 'music-viewer', userName: '点歌观众' }
}, { now }).entry;
const ordinaryMessage = enqueueLive2DAudienceEntry([], '今天挺开心', {
  source: 'bilibili',
  bilibili: { id: 'ordinary-message', userId: 'ordinary-viewer', userName: '普通观众' }
}, { now }).entry;
assert.equal(
  selectLive2DAudienceTurn(
    [ordinaryMessage, musicRequest],
    { limit: 1, replyCount: 1, rng: () => 0.99, now }
  ).selected[0].id,
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
const fairTurn = selectLive2DAudienceTurn(sameViewerQueue, {
  limit: 2,
  replyCount: 2,
  rng: () => 0,
  now
});
assert.equal(new Set(fairTurn.selected.map((entry) => entry.userId)).size, 2);
assert.equal(fairTurn.remaining.length, 1);

const zeroIdViewerQueue = [
  enqueueLive2DAudienceEntry([], 'anonymous viewer one', {
    source: 'bilibili',
    bilibili: { id: 'zero-id-a', userId: '0', userName: 'Anonymous A' }
  }, { now }).entry,
  enqueueLive2DAudienceEntry([], 'anonymous viewer two', {
    source: 'bilibili',
    bilibili: { id: 'zero-id-b', userId: 0, userName: 'Anonymous B' }
  }, { now }).entry
];
const zeroIdViewerTurn = selectLive2DAudienceTurn(zeroIdViewerQueue, {
  limit: 2,
  replyCount: 2,
  rng: () => 0,
  now
});
assert.deepEqual(
  new Set(zeroIdViewerTurn.selected.map((entry) => entry.id)),
  new Set(['zero-id-a', 'zero-id-b'])
);

const restored = requeueLive2DAudienceTurn(turn.remaining, turn.selected);
assert.deepEqual(restored.map((entry) => entry.id), ['sc', 'mention', 'plain', 'question']);

const nearlyExpiredAttempt = enqueueLive2DAudienceEntry([], 'please retry this reply', {
  source: 'bilibili',
  bilibili: {
    id: 'retry-after-playback-failure',
    userId: 'retry-viewer',
    timestamp: now - 29_500
  }
}, { now }).entry;
const retryQueue = requeueLive2DAudienceTurn([
  enqueueLive2DAudienceEntry([], 'fresh reply candidate', {
    source: 'bilibili',
    bilibili: {
      id: 'fresh-reply-candidate',
      userId: 'fresh-reply-viewer',
      timestamp: now
    }
  }, { now }).entry
], [nearlyExpiredAttempt], { now });
const retriedTurn = selectLive2DAudienceTurn(retryQueue, {
  limit: 1,
  replyCount: 1,
  rng: () => 0.99,
  now: now + 1_000
});
assert.deepEqual(
  retriedTurn.selected.map((entry) => entry.id),
  ['retry-after-playback-failure'],
  'a selected reply that failed delivery must retain a fresh retry window instead of expiring immediately'
);
assert.equal(retriedTurn.discarded.length, 0);

let exhaustedRetryQueue = [enqueueLive2DAudienceEntry([], 'bounded failed reply', {
  source: 'bilibili',
  bilibili: {
    id: 'bounded-reply-failure',
    userId: 'bounded-retry-viewer',
    timestamp: now
  }
}, { now }).entry];
for (let retry = 0; retry < 3; retry += 1) {
  exhaustedRetryQueue = requeueLive2DAudienceTurn([], exhaustedRetryQueue, {
    now: now + retry * 1_000
  });
  assert.equal(exhaustedRetryQueue.length, 1);
}
exhaustedRetryQueue = requeueLive2DAudienceTurn([], exhaustedRetryQueue, {
  now: now + 3_000
});
assert.equal(
  exhaustedRetryQueue.length,
  0,
  'permanently failing ordinary replies must stop retrying before they can starve fresh viewers'
);

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
const freshTurn = selectLive2DAudienceTurn(staleQueue, { limit: 3, replyCount: 2, now });
assert.deepEqual(
  new Set(freshTurn.selected.map((entry) => entry.id)),
  new Set(['stale-ordinary', 'recent-enough-sc'])
);
assert.deepEqual(freshTurn.remaining, []);
assert.deepEqual(freshTurn.discarded, []);

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
assert.deepEqual(expiredPaidTurn.selected.map((entry) => entry.id), ['expired-paid']);
assert.deepEqual(expiredPaidTurn.discarded, []);

function sequenceRng(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

const randomCountQueue = [
  enqueueLive2DAudienceEntry([], 'random count a', {
    source: 'bilibili',
    bilibili: { id: 'random-a', userId: 'random-a' }
  }, { now }).entry,
  enqueueLive2DAudienceEntry([], 'random count b', {
    source: 'bilibili',
    bilibili: { id: 'random-b', userId: 'random-b' }
  }, { now }).entry,
  enqueueLive2DAudienceEntry([], 'random count c', {
    source: 'bilibili',
    bilibili: { id: 'random-c', userId: 'random-c' }
  }, { now }).entry
];
const singleViewerTurn = selectLive2DAudienceTurn(randomCountQueue, {
  limit: 9,
  rng: sequenceRng([0.2, 0.5]),
  now
});
assert.equal(singleViewerTurn.selected.length, 1);
assert.equal(singleViewerTurn.remaining.length, 2);

const twoViewerTurn = selectLive2DAudienceTurn(randomCountQueue, {
  limit: 9,
  rng: sequenceRng([0.55, 0.1, 0.9]),
  now
});
assert.equal(twoViewerTurn.selected.length, 2);
assert.equal(new Set(twoViewerTurn.selected.map((entry) => entry.userId)).size, 2);
assert.equal(twoViewerTurn.remaining.length, 1);

const firstMessageEntry = enqueueLive2DAudienceEntry([], 'same weight a', {
  source: 'bilibili',
  bilibili: { id: 'first-message', userId: 'first-viewer' }
}, { now }).entry;
const regularMessageEntry = enqueueLive2DAudienceEntry([], 'same weight b', {
  source: 'bilibili',
  bilibili: { id: 'regular-message', userId: 'regular-viewer' }
}, { now }).entry;
const firstMessageTurn = selectLive2DAudienceTurn(
  [firstMessageEntry, regularMessageEntry],
  {
    limit: 1,
    replyCount: 1,
    rng: () => 0.6,
    viewerState: new Map([
      ['first-viewer', { messageCount: 1 }],
      ['regular-viewer', { messageCount: 8 }]
    ]),
    now
  }
);
assert.equal(firstMessageTurn.selected[0].id, 'first-message');

const waitingEntry = enqueueLive2DAudienceEntry([], 'waiting one', {
  source: 'bilibili',
  bilibili: {
    id: 'waiting-message',
    userId: 'waiting-viewer',
    timestamp: now - 15_000
  }
}, { now }).entry;
const freshEntry = enqueueLive2DAudienceEntry([], 'waiting two', {
  source: 'bilibili',
  bilibili: {
    id: 'fresh-message',
    userId: 'fresh-viewer',
    timestamp: now
  }
}, { now }).entry;
const waitingTurn = selectLive2DAudienceTurn([waitingEntry, freshEntry], {
  limit: 1,
  replyCount: 1,
  rng: () => 0.55,
  now
});
assert.equal(waitingTurn.selected[0].id, 'waiting-message');

const coolingEntry = enqueueLive2DAudienceEntry([], 'cooling viewer', {
  source: 'bilibili',
  bilibili: { id: 'cooling-message', userId: 'cooling-viewer' }
}, { now }).entry;
const readyEntry = enqueueLive2DAudienceEntry([], 'ready viewer', {
  source: 'bilibili',
  bilibili: { id: 'ready-message', userId: 'ready-viewer' }
}, { now }).entry;
const cooldownTurn = selectLive2DAudienceTurn([coolingEntry, readyEntry], {
  limit: 2,
  replyCount: 2,
  rng: () => 0,
  viewerState: {
    'cooling-viewer': { lastRepliedAt: now - 1_000 },
    'ready-viewer': { lastRepliedAt: now - 120_000 }
  },
  now
});
assert.deepEqual(cooldownTurn.selected.map((entry) => entry.id), ['ready-message']);
assert.deepEqual(cooldownTurn.remaining.map((entry) => entry.id), ['cooling-message']);

const deterministicPaidTurn = selectLive2DAudienceTurn([
  enqueueLive2DAudienceEntry([], 'small gift', {
    source: 'bilibili',
    bilibili: {
      id: 'paid-gift',
      type: 'gift',
      userId: 'gift-user',
      price: 1
    }
  }, { now }).entry,
  enqueueLive2DAudienceEntry([], 'important superchat', {
    source: 'bilibili',
    bilibili: {
      id: 'paid-superchat',
      type: 'superchat',
      userId: 'sc-user',
      price: 30
    }
  }, { now }).entry,
  firstMessageEntry
], {
  limit: 9,
  rng: () => 0,
  now
});
assert.deepEqual(
  deterministicPaidTurn.selected.map((entry) => entry.id),
  ['paid-superchat', 'paid-gift']
);

const allBurstMessages = selectLive2DBilibiliMessages([
  { id: 'batch-a', type: 'danmu', userId: 'batch-a', text: 'batch a', timestamp: now },
  { id: 'batch-b', type: 'danmu', userId: 'batch-b', text: 'batch b', timestamp: now },
  { id: 'batch-c', type: 'danmu', userId: 'batch-c', text: 'batch c', timestamp: now }
], {
  limit: 3,
  rng: () => 0,
  now
});
assert.equal(allBurstMessages.length, 3);
assert.deepEqual(new Set(allBurstMessages.map((message) => message.id)), new Set([
  'batch-a',
  'batch-b',
  'batch-c'
]));

const sameViewerBurstMessages = selectLive2DBilibiliMessages([
  { id: 'same-batch-a', type: 'danmu', userId: 'same-batch-user', text: 'batch one', timestamp: now },
  { id: 'same-batch-b', type: 'danmu', userId: 'same-batch-user', text: 'batch two', timestamp: now }
], {
  limit: 2,
  rng: () => 0,
  now
});
assert.equal(sameViewerBurstMessages.length, 2);

const firstMessageOrderedBurst = selectLive2DBilibiliMessages([
  { id: 'batch-regular', type: 'danmu', userId: 'regular-user', text: 'regular', timestamp: now },
  {
    id: 'batch-first',
    type: 'danmu',
    userId: 'first-user',
    text: 'first',
    isFirstMessage: true,
    timestamp: now
  }
], {
  limit: 2,
  rng: () => 0.4,
  now
});
assert.equal(
  firstMessageOrderedBurst[0].id,
  'batch-first',
  'first-message weighting must apply before the global rate gate'
);

const acknowledgementAudience = [
  { id: 'ack-a', userName: 'A' },
  { id: 'ack-b', userName: 'B' }
];
const explicitAcknowledgements = resolveLive2DAudienceAcknowledgements(
  acknowledgementAudience,
  [2, 2, 99]
);
assert.deepEqual(explicitAcknowledgements.acknowledged.map((entry) => entry.id), ['ack-b']);
assert.deepEqual(explicitAcknowledgements.unacknowledged.map((entry) => entry.id), ['ack-a']);
assert.equal(explicitAcknowledgements.usedFallback, false);

const fallbackAcknowledgements = resolveLive2DAudienceAcknowledgements(
  acknowledgementAudience,
  []
);
assert.deepEqual(fallbackAcknowledgements.acknowledged.map((entry) => entry.id), ['ack-a']);
assert.deepEqual(fallbackAcknowledgements.unacknowledged.map((entry) => entry.id), ['ack-b']);
assert.equal(fallbackAcknowledgements.usedFallback, true);

assert.equal(
  ensureLive2DAudienceNamesInSpeech('今晚也要开心哦。', [
    { userName: '小明' },
    { userName: '阿雨' }
  ]),
  '小明、阿雨，今晚也要开心哦。'
);
assert.equal(
  ensureLive2DAudienceNamesInSpeech('小明，点歌已经排上啦。', [
    { userName: '小明' }
  ]),
  '小明，点歌已经排上啦。'
);

console.log('audience turn selector checks passed');
