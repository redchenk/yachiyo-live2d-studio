import { createHash } from 'node:crypto';

const MIXIN_KEY_PERMUTATION = Object.freeze([
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]);

export function extractBilibiliWbiKey(url) {
  const value = String(url || '');
  const fileName = value.slice(value.lastIndexOf('/') + 1);
  const extensionIndex = fileName.lastIndexOf('.');
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
}

export function createBilibiliMixinKey(imgKey, subKey) {
  const source = `${String(imgKey || '')}${String(subKey || '')}`;
  if (source.length < 64) throw new Error('B站没有返回有效的 WBI 签名密钥');
  return MIXIN_KEY_PERMUTATION
    .map((index) => source[index])
    .join('')
    .slice(0, 32);
}

export function signBilibiliWbiParams(params = {}, options = {}) {
  const timestamp = Math.floor(Number(options.timestamp) || Date.now() / 1000);
  const mixinKey = createBilibiliMixinKey(options.imgKey, options.subKey);
  const values = {
    ...params,
    wts: timestamp
  };
  const query = Object.keys(values)
    .sort()
    .map((key) => {
      const value = String(values[key] ?? '').replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const signature = createHash('md5').update(`${query}${mixinKey}`).digest('hex');
  return `${query}&w_rid=${signature}`;
}
