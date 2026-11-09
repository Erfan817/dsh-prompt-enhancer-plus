import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeTheme, safeStorage } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUILTIN_PERSONAS } from '../personas.js';
import { createSettingsStore } from './settings.mjs';
import { enhanceWithProvider } from './provider.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(directory, 'index.html');
const pageUrl = pathToFileURL(pagePath).href;
const shortcut = 'CommandOrControl+Shift+Space';
const smokeTest = process.argv.includes('--smoke-test');
let smokeDirectory = null;
if (smokeTest) {
  try {
    smokeDirectory = await mkdtemp(path.join(tmpdir(), 'prompt-enhancer-smoke-'));
    app.setPath('userData', smokeDirectory);
  } catch (error) {
    console.error('Desktop smoke test cannot create its isolated temporary configuration:', error.message);
    app.exit(1);
  }
}
app.setName('Prompt enhancer plus');

let window;
let settingsStore;
let activeRequest;
let shortcutAvailable = false;
let quitting = false;
let smokeTimer;
const ownsLock = app.requestSingleInstanceLock();

function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function cancelRequest() {
  activeRequest?.abort();
  activeRequest = undefined;
}

function hideWindow() {
  cancelRequest();
  if (!window || window.isDestroyed()) return;
  if (shortcutAvailable) window.hide();
  else window.minimize();
  window.webContents.send('enhancer:visibility', false);
}

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pageUrl) {
    throw new Error('不允许的桌面消息来源。');
  }
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, payload) => {
    trusted(event);
    try { return { ok: true, value: await callback(payload) }; }
    catch (error) {
      const aborted = error.name === 'AbortError';
      const timedOut = error.name === 'TimeoutError';
      return {
        ok: false,
        error: {
          code: aborted ? 'aborted' : timedOut ? 'timeout' : error.code ?? 'failed',
          message: aborted ? '已取消，本次结果不会覆盖现有内容。' : timedOut ? '请求超时，请稍后重试或缩短输入。' : error.message || '操作失败，请重试。',
        },
      };
    }
  });
}

async function completeSmoke(code) {
  clearTimeout(smokeTimer);
  cancelRequest();
  if (window && !window.isDestroyed()) window.destroy();
  if (smokeDirectory) await rm(smokeDirectory, { recursive: true, force: true }).catch(() => {});
  app.exit(code);
}

async function createWindow() {
  settingsStore = await createSettingsStore(path.join(app.getPath('userData'), 'settings.json'), safeStorage);
  window = new BrowserWindow({
    width: 1040, height: 820, minWidth: 540, minHeight: 500, show: false,
    title: '提示词强化 Plus', autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    webPreferences: {
      preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, address) => { if (address !== pageUrl) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('render-process-gone', () => { if (smokeTest) void completeSmoke(1); });
  window.on('close', (event) => {
    if (!quitting && !smokeTest) {
      event.preventDefault();
      hideWindow();
    }
  });
  handle('enhancer:init', () => ({
    runtime: 'electron', settings: settingsStore.view(), shortcut, shortcutAvailable,
    personas: BUILTIN_PERSONAS.map((persona) => ({ id: persona.id, name: persona.name.zh })),
  }));
  handle('enhancer:settings', (payload) => settingsStore.save(payload));
  handle('enhancer:generate', async (request) => {
    if (activeRequest) throw new Error('已有请求正在进行，请先取消。');
    const controller = new AbortController();
    activeRequest = controller;
    try {
      const { settings, apiKey } = settingsStore.current();
      const preset = BUILTIN_PERSONAS.find((persona) => persona.id === request.personaId);
      const persona = request.personaId === 'custom'
        ? { instructions: typeof request.direction === 'string' ? request.direction.slice(0, 4000) : '' }
        : preset;
      return await enhanceWithProvider(settings, { ...request, persona }, apiKey, { signal: controller.signal });
    } finally { if (activeRequest === controller) activeRequest = undefined; }
  });
  handle('enhancer:cancel', () => { cancelRequest(); return true; });
  handle('enhancer:copy', (text) => {
    if (typeof text !== 'string' || text.length > 200000) throw new Error('复制内容无效或过长。');
    clipboard.writeText(text);
    return true;
  });
  handle('enhancer:pin', (pinned) => { window.setAlwaysOnTop(pinned === true); return window.isAlwaysOnTop(); });
  handle('enhancer:fullscreen', () => { window.setFullScreen(!window.isFullScreen()); return window.isFullScreen(); });
  handle('enhancer:hide', () => { hideWindow(); return true; });
  handle('enhancer:quit', () => { quitting = true; app.quit(); return true; });
  handle('enhancer:ready', async () => {
    if (smokeTest) {
      console.log(JSON.stringify({ ok: true, pageLoaded: true, bridgeReady: true, builtInPersonas: BUILTIN_PERSONAS.length, noModelCall: true }));
      setImmediate(() => { void completeSmoke(0); });
    }
    return true;
  });
  try {
    shortcutAvailable = !smokeTest && globalShortcut.register(shortcut, () => { if (window.isVisible() && window.isFocused()) hideWindow(); else showWindow(); });
  } catch { shortcutAvailable = false; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '窗口', submenu: [
      { label: '显示提示词助手', click: showWindow },
      { label: '隐藏窗口', click: hideWindow },
      { type: 'separator' }, { label: '退出', accelerator: 'CommandOrControl+Q', click: () => { quitting = true; app.quit(); } },
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  if (smokeTest) smokeTimer = setTimeout(() => { console.error('Desktop startup timed out'); void completeSmoke(1); }, 15000);
  await window.loadFile(pagePath);
  if (!smokeTest) showWindow();
}

if (!ownsLock) {
  if (smokeDirectory) await rm(smokeDirectory, { recursive: true, force: true });
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => { quitting = true; cancelRequest(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
  await app.whenReady();
  try { await createWindow(); }
  catch (error) {
    console.error('提示词助手启动失败：', error.message);
    if (smokeTest) await completeSmoke(1);
    else app.quit();
  }
}
