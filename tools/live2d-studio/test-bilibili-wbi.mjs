import assert from 'node:assert/strict';
import {
  extractBilibiliWbiKey,
  signBilibiliWbiParams
} from './bilibili-wbi.mjs';

assert.equal(
  extractBilibiliWbiKey('https://i0.hdslb.com/bfs/wbi/abc123.png'),
  'abc123'
);

const signed = signBilibiliWbiParams(
  { id: 25271643, type: 0 },
  {
    imgKey: '7cd084941338484aae1ad9425b84077c',
    subKey: '4932caff0ff746eab6f01bf08b70ac45',
    timestamp: 1_750_000_000
  }
);

assert.equal(
  signed,
  'id=25271643&type=0&wts=1750000000&w_rid=4ac39f957ebd36481722980b6037f345'
);

console.log('Bilibili WBI signing checks passed');
