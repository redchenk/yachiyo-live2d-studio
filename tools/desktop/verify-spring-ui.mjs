import { app, BrowserWindow, utilityProcess } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServiceManager } from './services.mjs';
import { startDesktopServer } from './server.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, 'output/spring-studio');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-spring-ui-'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(temp, 'profile'));
app.whenReady().then(async () => {
const services = createServiceManager({ moduleRoot: root, resourceRoot: root, dataDir: temp, fork: (...args) => utilityProcess.fork(...args) });
const runtime = await startDesktopServer({ resourceRoot: root, dataDir: temp, services, port: 0 });
const win = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { preload: path.join(root, 'tools/desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
const errors = [];
win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
const js = code => win.webContents.executeJavaScript(code);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function shot(name) { await delay(250); const bitmap = await win.webContents.capturePage(); fs.writeFileSync(path.join(output, name + '.png'), bitmap.toPNG()); }
async function click(selector, text) {
  const result = await js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
  assert.equal(result, true, `missing ${text}`); await delay(150);
}
try {
  await win.loadURL(`${runtime.origin}/live2d-studio/`);
  await delay(400);
  if (!await js(`Boolean(document.querySelector('.studio-settings-panel'))`)) await click('.studio-rail-settings', '设置');
  await shot('settings-llm');
  await click('.studio-settings-tabs button', '语音合成'); await shot('settings-tts');
  const tts = await js(`JSON.parse(localStorage.getItem('roomTTSSettings'))`);
  assert.equal(tts.refAudioPath, 'E:\\visualstudio\\cankao.wav');
  await js(`document.querySelector('.studio-settings-header button').click()`);
  for (let i = 0; i < 100; i++) {
    if (await js(`Boolean(document.querySelector('#live2d-container canvas')) && !document.querySelector('.live2d-loading')`)) break;
    await delay(200);
  }
  assert.equal(await js(`Boolean(document.querySelector('#live2d-container canvas'))`), true, 'real Cubism model loads');
  await delay(1000); await shot('live-desktop');
  const motion = await js(`new Promise(resolve => {
    const times = [], costs = [], restore = [];
    let frameTimestamp = -1, lastDrawFrame = -2;
    const oldRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = cb => oldRaf.call(window, timestamp => { frameTimestamp = timestamp; cb(timestamp); });
    restore.push(() => { window.requestAnimationFrame = oldRaf; });
    for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!C) continue;
      const old = C.prototype.clear;
      C.prototype.clear = function(mask) {
        if (this.canvas.closest('#live2d-container')) {
          const now = performance.now();
          if (lastDrawFrame !== frameTimestamp) { times.push(now); lastDrawFrame = frameTimestamp; }
        }
        return old.call(this, mask);
      };
      restore.push(() => { C.prototype.clear = old; });
    }
    let index = 0;
    const timer = setInterval(() => {
      const start = performance.now();
      window.dispatchEvent(new CustomEvent('tsukuyomi:room-act', { detail: { emotion: ['happy','curious','neutral'][index % 3], expression: ['smile','surprised','neutral'][index % 3], behaviorActions: [{ type: ['wave','nod','sway'][index % 3], intensity: .72, durationMs: 900 }] } }));
      costs.push(performance.now() - start);
      if (++index >= 18) clearInterval(timer);
    }, 400);
    setTimeout(() => {
      clearInterval(timer); restore.forEach(fn => fn());
      const gaps = times.slice(1).map((t,i) => t - times[i]).sort((a,b) => a-b);
      const percentile = p => gaps[Math.floor((gaps.length - 1) * p)] || 0;
      resolve({ switches:index, renders:times.length, fps:times.length * 1000 / (times.at(-1) - times[0]), p50Ms:percentile(.5), p95Ms:percentile(.95), maxMs:gaps.at(-1), maxEventCostMs:Math.max(...costs), devicePixelRatio, renderer:'WebGL clear on actual Cubism canvas', providerCalls:false });
    }, 8000);
  })`);
  assert.equal(motion.switches, 18); assert.ok(motion.renders > 100, 'actual Cubism draws during expression and action changes');
  fs.writeFileSync(path.join(output, 'cubism-motion.json'), JSON.stringify(motion, null, 2));
  const geometry = await js(`(() => { const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; }; return {stage:rect('.live2d-stage'),panel:rect('.live2d-control-panel'),nav:rect('.studio-left-rail'),header:rect('.studio-masthead'),canvas:rect('#live2d-container canvas'),background:getComputedStyle(document.querySelector('.live2d-stage')).backgroundImage}; })()`);
  assert.ok(geometry.stage.right < geometry.panel.x, 'stage and controls do not overlap');
  assert.ok(geometry.stage.y > geometry.header.bottom, 'stage clears the masthead');
  assert.ok(geometry.stage.x > geometry.nav.right, 'stage clears navigation');
  await click('.live2d-workspace-tabs button', '角色'); await shot('character-controls');
  await click('.studio-rail-item', '模型与道具'); await shot('items');
  await click('.studio-rail-item', '弹幕互动'); await shot('danmaku');
  await click('.studio-rail-item', '音乐与点歌'); await shot('music');
  await click('.studio-rail-item', 'Minecraft'); await shot('minecraft');
  await click('.studio-rail-item', '直播舞台');
  await click('.studio-memory-shortcut', '长记忆'); await shot('memory');
  await js(`document.querySelector('.studio-settings-header button').click()`);
  win.setContentSize(960, 720); await delay(800); await shot('live-compact');
  const compact = await js(`(() => { const a=document.querySelector('.live2d-stage').getBoundingClientRect(),b=document.querySelector('.live2d-control-panel').getBoundingClientRect();return { stageRight:a.right,panelLeft:b.left,panelRight:b.right,panelBottom:b.bottom,panelHeight:b.height,width:innerWidth,height:innerHeight }; })()`);
  assert.ok(compact.stageRight < compact.panelLeft && compact.panelRight <= compact.width && compact.panelHeight > 500 && compact.panelBottom <= compact.height);
  const report = { passed: true, geometry, compact, motion, consoleErrors: errors, evidence: 'Real bundled Cubism rendered through Electron; provider and audio tests use protocol fixtures separately.' };
  fs.writeFileSync(path.join(output, 'ui-verification.json'), JSON.stringify(report, null, 2));
  fs.rmSync(path.join(output, 'ui-error.json'), { force: true });
  console.log(JSON.stringify(report));
} catch (error) { console.error(error); fs.writeFileSync(path.join(output, 'ui-error.json'), JSON.stringify({ message: error.stack, errors }, null, 2)); process.exitCode = 1; }
finally { win.destroy(); await runtime.close(); await services.close(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error); app.exit(1); });
