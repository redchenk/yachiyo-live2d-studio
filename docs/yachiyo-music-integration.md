# Yachiyo Music integration

The Live2D studio exposes one music runtime to the Vue panel, the live LLM,
and optional external automation. Its NetEase provider follows the account,
search, quality fallback, resolve, and playback flow used by
[`firefly20041001/Yachiyo`](https://github.com/firefly20041001/Yachiyo/tree/044ffb1cd4c499caedfe68499ce11e5c3e5e2ec6)
and adapts that flow to this project's WinForms + WebView2 desktop shell.

## NetEase account login

Open the live control page, choose **网易云**, then click **扫码登录**. Scan the
code with the NetEase Cloud Music mobile app and confirm on the phone. The
panel shows the avatar and nickname after status `803` is received.

The desktop API implements:

- `POST /api/music/netease/account`
- `POST /api/music/netease/login/qr/create`
- `POST /api/music/netease/login/qr/check`
- `POST /api/music/netease/logout`

The QR flow uses the API package's `/login/qr/key`, `/login/qr/create`, and
`/login/qr/check` routes. The returned `MUSIC_U` is encrypted with Windows
DPAPI for the current Windows user and stored under
`%LOCALAPPDATA%\YachiyoLive2DStudio\music\netease-account.dat`. It is never
returned to Vue, the LLM, or browser automation. Legacy Cookie text/file
settings remain readable for migration but QR login takes precedence.

## Search and playback

Search first calls the same NetEase PC cloud-search endpoint used by upstream
Yachiyo, then falls back to the locally managed
`@neteasecloudmusicapienhanced/api` service. Playback resolution uses the
upstream-style quality cascade, for example:

```text
exhigh -> higher -> standard -> legacy bitrate endpoint
lossless -> exhigh -> higher -> standard -> legacy bitrate endpoint
```

The EXE owns its API sidecar on a dynamically selected loopback port. The
configured `http://127.0.0.1:3302` is now only a logical managed-service
address; it is not reused when Docker, WSL, or another program occupies that
port. Search requests have bounded timeouts, so a stale service cannot hold a
point-song request for two minutes.

## Browser API

The studio installs a read-only API at `window.yachiyoMusic`:

```js
await window.yachiyoMusic.search({
  query: '海阔天空 Beyond',
  source: 'netease',
  limit: 8
});

await window.yachiyoMusic.request({
  query: '海阔天空 Beyond',
  source: 'netease',
  action: 'request'
}, {
  requestedBy: '观众昵称'
});

await window.yachiyoMusic.execute({
  action: 'play_now',
  query: '海阔天空 Beyond',
  source: 'netease'
});

await window.yachiyoMusic.control({ action: 'pause', source: 'netease' });
await window.yachiyoMusic.getState();
```

The same bridge accepts tool-style calls:

```js
await window.yachiyoMusic.callTool('music_search', {
  query: '海阔天空 Beyond',
  source: 'netease'
});

await window.yachiyoMusic.callTool('music_request', {
  query: '海阔天空 Beyond',
  source: 'netease',
  action: 'request'
});

await window.yachiyoMusic.callTool('music_control', {
  action: 'skip',
  source: 'netease'
});

await window.yachiyoMusic.callTool('music_state');
```

## Command semantics

- `request`: append to the FIFO request queue; it does not interrupt the
  current track.
- `play_next`: put the track at the front of the pending queue.
- `play_now`: explicitly interrupt and play immediately.
- `pause`, `resume`, `skip`, `stop`, `clear`, `remove`, `queue`: playback and
  queue controls.
- `requestedBy` comes from trusted audience context when the live LLM handles
  a Bilibili message. The live prompt may return a 1-based `requestIndex`, but
  the runtime maps that index back to the selected message and never trusts a
  model-supplied display name. For direct automation calls, pass the trusted
  name in the second context argument; context always overrides payload data.
- Live song queries are reconciled with the selected audience message and
  reject leaked director-prompt suffixes before search.
- Bilibili song requests are detected at the danmaku ingress and sent directly
  to `request`; they do not wait for the LLM or the ordinary reply rate gate.
  Phrases such as `我要听 ray`, `点歌晴天`, and `唱一首同桌的你` therefore enter
  the real FIFO queue even when the live director is busy. The audience entry
  is marked as handled so a later LLM reply cannot request the same song again.
- If a queued track cannot resolve or the browser audio element reports a
  media error, the runtime clears the failed current item and advances to the
  next queued song instead of leaving playback stuck.

All mutations are serialized by the adapter. The existing
`live2dMusicQueue.js` state remains the single source of truth, so the UI and
LLM cannot create separate queues.

## Safety boundary

The model-facing API accepts a query or stable track ID, never an arbitrary
playback URL. Search and playback results redact cookies, authorization data,
real stream URLs, temporary stream tokens, and sensitive backend exception
text before returning to the model.
Album artwork URLs may remain visible to the UI.

The current online source is NetEase (`netease`). The adapter
contains the source mapping needed for a future QQ Music provider, but reports
it as unavailable until a local search/resolve backend is implemented. The
existing studio panel can still use its local-library and Apple Music
providers through the native music engine.

## Upstream note

The provider behavior target is upstream commit
`044ffb1cd4c499caedfe68499ce11e5c3e5e2ec6`. Its root `LICENSE` is Apache-2.0,
while its `package.json` declares MIT. This project uses the same provider
strategy and API package but keeps its own WebView2 UI and encrypted Windows
credential store. Re-check the upstream license before importing additional
source files or assets.
