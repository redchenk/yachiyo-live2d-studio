import { app, BrowserWindow, utilityProcess } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServiceManager } from './services.mjs';
import { startDesktopServer } from './server.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, 'output/live-session');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-live-session-'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(temp, 'profile'));
const wav = Buffer.alloc(44 + 16000 * 2 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);

app.whenReady().then(async () => {
  const services = createServiceManager({ moduleRoot: root, resourceRoot: root, dataDir: temp, fork: (...args) => utilityProcess.fork(...args) });
  const runtime = await startDesktopServer({ resourceRoot: root, dataDir: temp, services, port: 0 });
  const win = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { preload: path.join(root, 'tools/desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  // No real Bilibili, LLM, music or TTS account is contacted by this fixture.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:/.test(details.url) && new URL(details.url).origin !== runtime.origin });
  });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const js = code => win.webContents.executeJavaScript(code);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(code, message, timeout = 10_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await js(code)) return; await delay(100); }
    throw new Error(message);
  }
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const emit = (text, type = 'danmu') => js(`window.dispatchEvent(new CustomEvent('tsukuyomi:bilibili-danmaku', { detail: { id: 'fixture-' + Math.random(), type: ${JSON.stringify(type)}, userId: 123, userName: '小樱', text: ${JSON.stringify(text)}, giftName: ${JSON.stringify(type === 'gift' ? '鲜花' : '')}, timestamp: Date.now() } }))`);
  const shot = async name => fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const counts = () => js(`({ chat: __fixture.calls.filter(x => x.path.startsWith('/api/chat')).length, tts: __fixture.calls.filter(x => x.path === '/api/tts').length, music: __fixture.calls.filter(x => /music|netease/.test(x.path)).length, acts: __fixture.acts })`);
  const off = () => waitFor(`document.querySelector('.live2d-page').dataset.liveState === 'off'`, 'director did not stop');
  try {
    await win.loadURL(`${runtime.origin}/live2d-studio/`);
    await js(`localStorage.setItem('roomLLMSettings', JSON.stringify({ provider: 'deepseek', apiKey: 'fixture-only', apiUrl: 'http://127.0.0.1:1/v1/chat/completions', model: 'deepseek-flash', useProxy: true }));
      localStorage.setItem('roomTTSSettings', JSON.stringify({ enabled: true, provider: 'openai', apiUrl: 'http://127.0.0.1:1/audio/speech', apiKey: 'fixture-only', useProxy: true }));
      localStorage.setItem('roomMemorySettings', JSON.stringify({ enabled: false }));
      localStorage.setItem('roomVisionSettings', JSON.stringify({ enabled: false }));
      localStorage.setItem('roomBilibiliDanmakuSettings', JSON.stringify({ enabled: true, roomId: '123', autoConnect: false, autoForward: true, autoStartDirector: true, readAloud: true }));`);
    await win.loadURL(`${runtime.origin}/live2d-studio/`);
    await waitFor(`Boolean(document.querySelector('#live2d-container canvas')) && !document.querySelector('.live2d-loading')`, 'real Cubism did not load', 25_000);
    await js(`window.__fixture = { calls: [], acts: 0, offset: 0, stall: false, fastEndingTimeout: false, audioEvents: [], blobEvents: [] };
      const nativeObjectUrl = URL.createObjectURL.bind(URL);
      const nativeRevoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = nativeObjectUrl(blob); __fixture.blobEvents.push({ event: 'created', url, type: blob.type, size: blob.size, at: performance.now() }); return url; };
      URL.revokeObjectURL = url => { __fixture.blobEvents.push({ event: 'revoked', url, at: performance.now(), stack: new Error().stack }); return nativeRevoke(url); };
      const realNow = Date.now.bind(Date); Date.now = () => realNow() + __fixture.offset;
      const realTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, ms, ...args) => realTimeout(callback, ms === 90_000 && __fixture.fastEndingTimeout ? 500 : ms, ...args);
      const NativeAudio = window.Audio;
      window.Audio = function(...args) {
        const audio = new NativeAudio(...args);
        for (const event of ['playing', 'ended', 'error']) audio.addEventListener(event, () => __fixture.audioEvents.push({ event, at: performance.now(), duration: audio.duration, text: audio.dataset.speechText || '', error: audio.error?.message, source: audio.src, liveState: document.querySelector('.live2d-page')?.dataset.liveState }));
        return audio;
      };
      window.Audio.prototype = NativeAudio.prototype;
      const originalFetch = window.fetch.bind(window);
      window.addEventListener('tsukuyomi:room-act', () => __fixture.acts++);
      window.fetch = async (input, options = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        const body = options.body ? JSON.parse(options.body) : {};
        if (url.pathname.startsWith('/api/')) __fixture.calls.push({ path: url.pathname, message: body.message || '', at: performance.now() });
        if (url.pathname.startsWith('/api/chat')) {
          if (__fixture.stall) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }));
          const phase = body.message?.includes('final thank-you and goodbye') ? 'farewell' : (body.message?.includes('Begin that transition now') ? 'closing' : 'normal');
          const voice = phase === 'farewell' ? '皆さん、ありがとう、また会いましょう。' : (phase === 'closing' ? 'そろそろ今日のお話をまとめましょう。' : 'こんにちは、今日も楽しみましょう。');
          const control = { reply: voice, caption: phase === 'farewell' ? '谢谢大家，我们下次见。' : (phase === 'closing' ? '今天的时间快到啦，我们来回顾一下吧。' : '大家好，今天也一起开心聊聊吧。'), emotion: 'happy', actions: [{ type: 'nod', intensity: 0.4 }], acknowledgedIndexes: body.message?.includes('小樱') ? [1] : [], music: null, minecraft: null };
          if (url.pathname === '/api/chat/stream') return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'VOICE: ' + voice + ${JSON.stringify('\nCAPTION: ')} + control.caption + ${JSON.stringify('\nCONTROL: ')} + JSON.stringify(control) } }] }) + ${JSON.stringify('\n\ndata: [DONE]\n\n')}, { headers: { 'Content-Type': 'text/event-stream' } });
          if (!body.message?.startsWith('LIVE_DIRECTOR_TICK')) return Response.json({ success: true, data: { reply: control.caption } });
          return Response.json({ success: true, data: { reply: JSON.stringify(control) } });
        }
        if (url.pathname === '/api/tts') return new Response(Uint8Array.from(atob(${JSON.stringify(wav.toString('base64'))}), x => x.charCodeAt(0)), { headers: { 'Content-Type': 'audio/wav' } });
        if (/music|netease/.test(url.pathname)) return Response.json({ success: true, data: {} });
        return originalFetch(input, options);
      }; true;`);
    if (await js(`Boolean(document.querySelector('.studio-settings-panel'))`)) await click('.studio-settings-header button');
    await delay(300);
    const geometry = () => js(`(() => { const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; }; return { stage:rect('.live2d-stage'), nav:rect('.studio-left-rail'), panel:rect('.live2d-control-panel') }; })()`);
    const collapsed = await geometry();
    assert.equal(collapsed.nav.width, 64);
    assert.ok(collapsed.stage.x > collapsed.nav.right && collapsed.stage.right < collapsed.panel.x);
    await shot('workspace-collapsed');
    await click('.studio-workspace-toggle'); await delay(100);
    const expanded = await geometry();
    assert.ok(expanded.nav.width > collapsed.nav.width);
    assert.ok(collapsed.stage.width > expanded.stage.width);
    await shot('workspace-expanded');
    await click('.studio-workspace-toggle');
    assert.equal(await js(`localStorage.getItem('yachiyo:studio:workspaceCollapsed')`), 'true');

    await js(`document.querySelector('.live2d-switch input').checked = false; document.querySelector('.live2d-switch input').dispatchEvent(new Event('change', { bubbles: true }));`);
    const idleBefore = await counts();
    await emit('待机消息：请点歌夜に駆ける'); await emit('待机礼物谢谢', 'gift');
    await delay(400);
    assert.deepEqual(await counts(), idleBefore, 'idle danmaku cannot call LLM/TTS/music or dispatch an act');
    assert.equal(await js(`document.querySelector('.live2d-page').dataset.liveState`), 'off');
    await click('.live2d-run-btn');
    await waitFor(`__fixture.calls.some(x => x.path === '/api/chat')`, 'explicit start did not generate the opening');
    await delay(250);
    assert.equal(await js(`__fixture.calls.some(x => x.message.includes('待机消息'))`), false, 'idle backlog entered the show');
    await emit('开播之后的弹幕');
    await waitFor(`__fixture.calls.some(x => x.message.includes('开播之后的弹幕'))`, 'active chat was not answered');
    await emit('停止前待处理的弹幕'); await click('.live2d-run-btn'); await off();
    const stoppedBefore = await counts();
    await emit('停止后不要开播'); await delay(400);
    assert.deepEqual(await counts(), stoppedBefore, 'stopped director was reactivated');

    await js(`const s = JSON.parse(localStorage.getItem('roomBilibiliDanmakuSettings')); s.autoForward = false; s.readAloud = true; localStorage.setItem('roomBilibiliDanmakuSettings', JSON.stringify(s)); window.dispatchEvent(new Event('tsukuyomi:studio-settings-saved'));`);
    await delay(250);
    const readOnlyBefore = await counts();
    await emit('直接朗读也必须等待开播'); await emit('点歌 Lemon'); await delay(400);
    assert.deepEqual(await counts(), readOnlyBefore, 'read-aloud or music bypassed the inactive gate');

    await js(`const input = document.querySelector('[aria-label="直播时长（分钟）"]'); input.value = '1'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));`);
    await click('.live2d-run-btn'); await delay(300);
    assert.equal(await js(`document.querySelector('[aria-label="直播时长（分钟）"]').disabled`), true);
    await js(`__fixture.offset += 40_000`);
    await waitFor(`__fixture.calls.some(x => x.message.includes('Begin that transition now'))`, 'closing transition was not proactively generated');
    await shot('stream-closing');
    await js(`__fixture.offset += 20_000`); await off();
    assert.equal(await js(`__fixture.calls.filter(x => x.message.includes('Begin that transition now')).length`), 1);
    assert.equal(await js(`__fixture.calls.filter(x => x.message.includes('final thank-you and goodbye')).length`), 1);
    assert.match(await js(`document.querySelector('.live2d-stream-hint').textContent`), /本场已结束/);
    await shot('stream-ended');

    // Real HTMLAudio playback with a local silent WAV proves that farewell is not cut off.
    await js(`document.querySelector('.live2d-switch input').checked = true; document.querySelector('.live2d-switch input').dispatchEvent(new Event('change', { bubbles: true }));`);
    await click('.live2d-run-btn');
    await waitFor(`__fixture.calls.some(x => x.path === '/api/tts')`, 'streaming fixture never synthesized speech');
    await waitFor(`__fixture.audioEvents.some(x => x.event === 'playing' && x.duration >= 1)`, 'opening WAV never started playing');
    await js(`__fixture.offset += 60_000`);
    await waitFor(`document.querySelector('.live2d-stream-clock')?.dataset.phase === 'ending'`, 'farewell phase was not visible');
    await off();
    const audioEvents = await js(`__fixture.audioEvents.filter(x => x.duration >= 1)`);
    const audioEnds = audioEvents.filter(event => event.event === 'ended');
    assert.equal(audioEnds.length, 2, 'opening and farewell WAV must both finish naturally');
    assert.ok(audioEvents.every(event => event.event !== 'error' && event.liveState === 'on'), 'director stopped during playback');
    const farewellRequestAt = await js(`__fixture.calls.filter(x => x.message.includes('final thank-you and goodbye')).at(-1).at`);
    assert.ok(farewellRequestAt >= audioEnds[0].at, 'farewell generation started before the current audio finished');
    const afterFarewell = await counts();
    await emit('结束后送礼也不许重启', 'gift'); await delay(400);
    assert.deepEqual(await counts(), afterFarewell);

    // Cancellation of an in-flight request must not resurrect a stopped session.
    await js(`__fixture.stall = true; document.querySelector('.live2d-switch input').checked = false; document.querySelector('.live2d-switch input').dispatchEvent(new Event('change', { bubbles: true }));`);
    const stalledBefore = (await counts()).chat;
    await click('.live2d-run-btn');
    await waitFor(`__fixture.calls.filter(x => x.path.startsWith('/api/chat')).length > ${stalledBefore}`, 'stalled fixture did not start');
    await click('.live2d-run-btn'); await off(); await delay(200);
    await js(`__fixture.stall = false`);
    await click('.live2d-run-btn'); await delay(350);
    assert.equal(await js(`document.querySelector('.live2d-page').dataset.liveState`), 'on');
    await click('.live2d-run-btn'); await off();

    // Accelerate only the 90-second fail-safe, leaving the real audio test above intact.
    await js(`__fixture.stall = true; __fixture.fastEndingTimeout = true`);
    const timeoutBefore = (await counts()).chat;
    await click('.live2d-run-btn');
    await waitFor(`__fixture.calls.filter(x => x.path.startsWith('/api/chat')).length > ${timeoutBefore}`, 'fail-safe fixture did not start');
    await js(`__fixture.offset += 60_000`); await off();
    assert.match(await js(`document.querySelector('.live2d-stream-hint').textContent`), /本场已结束/);

    win.setContentSize(960, 720); await delay(300);
    const compact = await geometry();
    assert.ok(compact.stage.right < compact.panel.x && compact.panel.bottom <= 720);
    await shot('compact-collapsed');
    win.setContentSize(720, 900); await delay(250);
    const small = await geometry();
    assert.ok(small.stage.x > small.nav.right && small.stage.bottom <= small.panel.y);
    await shot('small-layout');
    const requests = await counts();
    await win.loadURL(`${runtime.origin}/live2d-studio/`);
    assert.equal(await js(`document.querySelector('.studio-app-shell').classList.contains('is-workspace-collapsed')`), true);
    assert.equal(await js(`document.querySelector('[aria-label="直播时长（分钟）"]').value`), '1');
    assert.equal(await js(`document.querySelector('.live2d-page').dataset.liveState`), 'off');
    const report = { passed: true, collapsed, expanded, compact, small, requests, audioEvents, consoleErrors: errors, realCubism: true, realAudioPlayback: true, remoteProviderCalls: false, checks: ['idle auto-forward/gift gate', 'read-aloud and song gate', 'explicit start', 'stop and batch cancellation', 'closing cue once', 'farewell waits for current audio then plays completely', 'late gift cannot restart', 'abort/restart', 'deadline fail-safe with unavailable LLM', 'collapsible workspace and compact layout', 'duration and collapse persist after reload'] };
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
    fs.rmSync(path.join(output, 'error.json'), { force: true });
    console.log(JSON.stringify(report));
  } catch (error) {
    await shot('failure').catch(() => {});
    fs.writeFileSync(path.join(output, 'error.json'), JSON.stringify({ message: error.stack, errors, counts: await counts().catch(() => null), fixture: await js(`({ audioEvents: __fixture.audioEvents, blobEvents: __fixture.blobEvents, calls: __fixture.calls.map(x => ({ ...x, message: x.message.slice(0, 180) })) })`).catch(() => null) }, null, 2));
    console.error(error); process.exitCode = 1;
  } finally {
    win.destroy(); await runtime.close(); await services.close();
    fs.rmSync(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0);
  }
}).catch(error => { console.error(error); app.exit(1); });
