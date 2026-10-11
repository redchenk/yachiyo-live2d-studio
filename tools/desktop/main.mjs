import { app, BrowserWindow, dialog, utilityProcess, shell, screen, systemPreferences } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { studioDataDirectory } from '../runtime/paths.mjs';
import { createServiceManager } from './services.mjs';
import { startDesktopServer } from './server.mjs';

const smoke = process.argv.includes('--smoke-test');
const dataDir = studioDataDirectory();
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', path.join(dataDir, 'DesktopProfile'));
let window;
let runtime;
let services;
let quitting = false;
const logFile = path.join(dataDir, 'desktop.log');
if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.previous`);
function log(message) { fs.appendFileSync(logFile, `${new Date().toISOString()} ${String(message).slice(0, 4000)}\n`); }

async function vision(input) {
  if (!input.enabled) return { success: true, enabled: false };
  const cursor = screen.getCursorScreenPoint();
  const result = { success: true, enabled: true, capturedAt: new Date().toISOString(), cursor, foregroundWindow: { available: false }, pointerWindow: { available: false } };
  // Electron exposes screens, but not portable foreground-window metadata. Do not
  // invent it or bypass the existing sensitive-window protection without it.
  result.redacted = true;
  result.redactionReason = process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted'
    ? 'Screen recording permission is not granted.'
    : 'Automatic desktop screenshots require a foreground-window privacy adapter on this platform.';
  return result;
}

function openWindow() {
  window = new BrowserWindow({ width: 1320, height: 840, minWidth: 900, minHeight: 620, show: !smoke, backgroundColor: '#f7f9fc', title: 'Yachiyo Live2D Studio', webPreferences: { preload: path.join(app.getAppPath(), 'tools/desktop/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== runtime.origin) event.preventDefault(); });
  window.webContents.on('console-message', event => { if (event.level === 'error') log(`Renderer: ${event.message}`); });
  window.webContents.on('render-process-gone', (_event, details) => log(`Renderer exited: ${details.reason}`));
  window.on('closed', () => { window = null; });
  window.loadURL(`${runtime.origin}/live2d-studio/`);
  return window;
}

async function smokeTest(win) {
  const deadline = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 45_000);
  try {
    await new Promise((resolve, reject) => {
      win.webContents.once('did-finish-load', resolve);
      win.webContents.once('did-fail-load', (_e, code, message) => reject(new Error(`${code}: ${message}`)));
    });
    const state = await win.webContents.executeJavaScript(`({ title: document.title, mounted: Boolean(document.querySelector('#app')?.children.length), nodeExposed: typeof window.require !== 'undefined', embeddedMemory: window.yachiyoDesktop?.embeddedMemory })`);
    if (!state.mounted || state.nodeExposed || !state.embeddedMemory) throw new Error(`Renderer smoke failed: ${JSON.stringify(state)}`);
    const base = await services.ensure('memory');
    const health = await (await fetch(`${base}/healthz`)).json();
    if (!health.sqliteReady) throw new Error(health.sqliteError || 'Embedded SQLite unavailable');
    const memoryResponse = await fetch(`${runtime.origin}/api/memory/init`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'sqlite', personaCorpusPath: '', milvusEnabled: false }) });
    const memory = await memoryResponse.json();
    if (!memory.success || memory.milvus?.enabled || !memory.indexed) throw new Error(`Memory smoke failed: ${JSON.stringify(memory)}`);
    const minecraft = await fetch(`${runtime.origin}/api/minecraft/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!minecraft.ok) throw new Error(`Minecraft runtime failed: ${await minecraft.text()}`);
    console.log(JSON.stringify({ smoke: 'passed', packaged: app.isPackaged, ...state, sqliteReady: health.sqliteReady, minecraftReady: minecraft.ok, indexed: memory.indexed, databasePath: memory.databasePath }));
    app.quit();
  } catch (error) { log(error.stack); console.error(error); process.exitCode = 1; app.quit(); }
  finally { clearTimeout(deadline); }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const moduleRoot = app.getAppPath();
    const resourceRoot = app.isPackaged ? path.join(process.resourcesPath, 'studio') : moduleRoot;
    services = createServiceManager({ moduleRoot, resourceRoot, dataDir, fork: (...args) => utilityProcess.fork(...args), log });
    runtime = await startDesktopServer({ resourceRoot, dataDir, services, vision, port: Number(process.env.YACHIYO_DESKTOP_PORT || 3289) });
    const win = openWindow();
    if (smoke) await smokeTest(win);
    else services.ensure('memory').catch(error => log(`Memory startup: ${error.message}`));
    app.on('activate', () => { if (!window && !quitting) openWindow(); });
  }).catch(error => {
    log(error.stack);
    if (!smoke) dialog.showErrorBox('Yachiyo 启动失败', `${error.message}\n\n日志：${logFile}`);
    else console.error(error);
    process.exitCode = 1; app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    const timer = setTimeout(() => app.exit(process.exitCode || 0), 6000);
    Promise.allSettled([runtime?.close(), services?.close()]).finally(() => { clearTimeout(timer); app.exit(process.exitCode || 0); });
  });
}
