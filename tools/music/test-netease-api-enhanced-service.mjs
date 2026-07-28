const baseUrl = String(process.argv[2] || 'http://127.0.0.1:3302').replace(/\/+$/g, '');
const result = {};

async function timed(name, url, timeoutMs = 12000) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await response.json();
  result[name] = {
    ms: Date.now() - startedAt,
    status: response.status,
    data
  };
  return data;
}

const health = await timed('health', `${baseUrl}/healthz`, 3000);
const keyResponse = await timed(
  'qrKey',
  `${baseUrl}/login/qr/key?timestamp=${Date.now()}&ua=pc`
);
const key = keyResponse?.data?.unikey;
const qrResponse = await timed(
  'qrCreate',
  `${baseUrl}/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true&platform=web&ua=pc&timestamp=${Date.now()}`
);
const searchResponse = await timed(
  'search',
  `${baseUrl}/cloudsearch?keywords=${encodeURIComponent('周杰伦')}&limit=3&type=1`,
  15000
);

console.log(JSON.stringify({
  health: {
    ok: health?.ok,
    instance: health?.instance,
    version: health?.version,
    port: health?.port,
    ms: result.health.ms
  },
  qrKeyMs: result.qrKey.ms,
  qrCreateMs: result.qrCreate.ms,
  qrReady: Boolean(qrResponse?.data?.qrimg),
  searchMs: result.search.ms,
  searchCode: searchResponse?.code,
  songCount: searchResponse?.result?.songs?.length || 0
}, null, 2));
