import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, screen, Tray } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUILTIN_PERSONAS } from '../personas.js';
import { createSettingsStore } from './settings.mjs';
import { enhanceWithProvider } from './provider.mjs';
import { createShellSettingsStore } from './shell-settings.mjs';
import { createWindowShell, visibleBounds } from './window-shell.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(directory, 'index.html');
const pageUrl = pathToFileURL(pagePath).href;
const smokeTest = process.argv.includes('--smoke-test');
let smokeDirectory = null;
if (smokeTest) {
  smokeDirectory = await mkdtemp(path.join(tmpdir(), 'prompt-enhancer-smoke-'));
  app.setPath('userData', smokeDirectory);
}
// Keep the existing application identity and userData location.
app.setName('Prompt enhancer plus');

let window;
let settingsStore;
let shellStore;
let shell;
let tray;
let activeRequest;
let quitting = false;
let exitReady = false;
let shutdown;
let smokeTimer;
let boundsTimer;
let closeNoticeShown = false;
let recoveryDialogOpen = false;
let loading;
let shellWarning = '';
const ownsLock = app.requestSingleInstanceLock();

function cancelRequest() {
  activeRequest?.abort();
  activeRequest = undefined;
}
function send(channel, value) {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed()) window.webContents.send(channel, value);
}
function desktopState() {
  return { ...shell.state(), warning: [shell.state().warning, shellWarning].filter(Boolean).join(' ') };
}
function showWindow() {
  if (!quitting) shell?.show();
}
function quit() { app.quit(); }
function relocateWindow() {
  if (!window || window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return;
  const bounds = visibleBounds(window.getBounds(), screen.getAllDisplays());
  window.setMinimumSize(Math.min(540, bounds.width), Math.min(500, bounds.height));
  window.setBounds(bounds);
}
function rememberBounds() {
  clearTimeout(boundsTimer);
  if (quitting || !window || window.isDestroyed() || window.isMinimized() || window.isMaximized() || window.isFullScreen()) return;
  const bounds = window.getBounds();
  boundsTimer = setTimeout(() => {
    void shellStore.saveBounds(bounds).catch(() => {
      shellWarning = '窗口位置未能保存，本次仍可继续使用。';
      send('enhancer:shell-state', desktopState());
    });
  }, 250);
}
async function loadPage() {
  if (loading || quitting || !window || window.isDestroyed()) return loading;
  loading = window.loadFile(pagePath);
  try { await loading; }
  finally { loading = undefined; }
}
async function recoverRenderer() {
  cancelRequest();
  if (smokeTest) { await completeSmoke(1); return; }
  if (quitting || recoveryDialogOpen) return;
  recoveryDialogOpen = true;
  try {
    showWindow();
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning', title: 'Prompt Spark 页面已停止',
      message: '编辑页面意外停止。未保存的草稿和结果可能已经丢失。',
      detail: '可重新打开编辑页面，或退出助手；不会自动重新发起模型请求。',
      buttons: ['重新打开', '退出助手'], defaultId: 0, cancelId: 1,
    });
    if (quitting) return;
    if (response === 0) {
      try { await loadPage(); showWindow(); }
      catch { quit(); }
    } else quit();
  } finally { recoveryDialogOpen = false; }
}
function createTray() {
  if (smokeTest) return;
  try {
    // Small BGRA spark in the repository's brand colors; no SVG codec dependency.
    const size = 32;
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const star = Math.abs(x - 15) / 3 + Math.abs(y - 13) / 8 <= 1 || Math.abs(x - 15) / 8 + Math.abs(y - 13) / 3 <= 1;
      pixels.set(star ? [255, 255, 255, 255] : [254, 107, 77, 255], offset);
    }
    const image = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 1 });
    tray = new Tray(image);
    tray.setToolTip('Prompt Spark · 提示词助手');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 Prompt Spark', click: showWindow },
      { type: 'separator' },
      { label: '退出助手', click: quit },
    ]));
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
  } catch {
    tray?.destroy();
    tray = undefined;
    shellWarning = '托盘不可用；可用快捷键或任务栏唤回窗口。';
  }
}
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pageUrl) throw new Error('不允许的桌面消息来源。');
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, payload) => {
    trusted(event);
    try {
      if (quitting) throw new Error('桌面助手正在退出。');
      return { ok: true, value: await callback(payload) };
    } catch (error) {
      return { ok: false, error: {
        code: error.name === 'AbortError' ? 'aborted' : error.name === 'TimeoutError' ? 'timeout' : error.code ?? 'failed',
        message: error.name === 'AbortError' ? '已取消，本次结果不会覆盖现有内容。' : error.name === 'TimeoutError' ? '请求超时，请稍后重试或缩短输入。' : error.message || '操作失败，请重试。',
      } };
    }
  });
}
async function completeSmoke(code) {
  clearTimeout(smokeTimer);
  cancelRequest();
  shell?.dispose();
  if (window && !window.isDestroyed()) window.destroy();
  if (smokeDirectory) await rm(smokeDirectory, { recursive: true, force: true }).catch(() => {});
  app.exit(code);
}
async function start() {
  settingsStore = await createSettingsStore(path.join(app.getPath('userData'), 'settings.json'), safeStorage);
  shellStore = await createShellSettingsStore(path.join(app.getPath('userData'), 'shell-settings.json'));
  const bounds = visibleBounds(shellStore.view().windowBounds, screen.getAllDisplays());
  window = new BrowserWindow({
    ...bounds, minWidth: Math.min(540, bounds.width), minHeight: Math.min(500, bounds.height), show: false,
    title: 'Prompt Spark · 提示词助手', autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  shell = createWindowShell({
    getWindow: () => window, getDisplays: () => screen.getAllDisplays(),
    shortcuts: smokeTest ? { register: () => false, unregister: () => {} } : globalShortcut,
    store: shellStore, cancel: cancelRequest, trayAvailable: () => Boolean(tray && !tray.isDestroyed()),
    notifyHidden: () => send('enhancer:visibility', false),
    notifyState: () => send('enhancer:shell-state', desktopState()),
  });
  createTray();
  shell.start();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, address) => { if (address !== pageUrl) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('render-process-gone', () => { void recoverRenderer().catch(quit); });
  window.on('move', rememberBounds);
  window.on('resize', rememberBounds);
  // Never intercept the subsequent close during Windows logoff/shutdown.
  window.on('query-session-end', () => { quitting = true; cancelRequest(); shell.dispose(); });
  window.on('session-end', () => { quitting = true; cancelRequest(); shell.dispose(); });
  window.on('close', (event) => {
    if (quitting || smokeTest) return;
    event.preventDefault();
    if (recoveryDialogOpen) return;
    if (!closeNoticeShown) {
      closeNoticeShown = true;
      const available = desktopState();
      dialog.showMessageBoxSync(window, {
        type: 'info', title: 'Prompt Spark 仍在运行',
        message: available.trayAvailable ? '关闭窗口将收起到托盘，草稿保留在本次内存中。' : available.shortcutAvailable ? '关闭窗口将隐藏，可用快捷键重新打开。' : '托盘和快捷键不可用，窗口将最小化到任务栏。',
        detail: '真正退出请使用托盘菜单或窗口内的“退出”。退出后未保存的草稿会清除。', buttons: ['知道了'],
      });
    }
    shell.hide();
  });
  screen.on('display-removed', relocateWindow);
  screen.on('display-metrics-changed', relocateWindow);
  handle('enhancer:init', () => ({
    runtime: 'electron', settings: settingsStore.view(), ...desktopState(),
    personas: BUILTIN_PERSONAS.map((persona) => ({ id: persona.id, name: persona.name.zh })),
  }));
  handle('enhancer:settings', (payload) => settingsStore.save(payload));
  handle('enhancer:shortcut', async (value) => { await shell.changeShortcut(value); return desktopState(); });
  handle('enhancer:generate', async (request) => {
    if (activeRequest) throw new Error('已有请求正在进行，请先取消。');
    const controller = new AbortController();
    activeRequest = controller;
    try {
      const { settings, apiKey } = settingsStore.current();
      const preset = BUILTIN_PERSONAS.find((persona) => persona.id === request.personaId);
      const persona = request.personaId === 'custom' ? { instructions: typeof request.direction === 'string' ? request.direction.slice(0, 4000) : '' } : preset;
      return await enhanceWithProvider(settings, { ...request, persona }, apiKey, { signal: controller.signal });
    } finally { if (activeRequest === controller) activeRequest = undefined; }
  });
  handle('enhancer:cancel', () => { cancelRequest(); return true; });
  handle('enhancer:copy', (text) => {
    if (typeof text !== 'string' || text.length > 200000) throw new Error('复制内容无效或过长。');
    clipboard.writeText(text); return true;
  });
  handle('enhancer:pin', (pinned) => { window.setAlwaysOnTop(pinned === true); return window.isAlwaysOnTop(); });
  handle('enhancer:fullscreen', () => { window.setFullScreen(!window.isFullScreen()); return window.isFullScreen(); });
  handle('enhancer:hide', () => { shell.hide(); return true; });
  handle('enhancer:quit', () => { setImmediate(quit); return true; });
  handle('enhancer:ready', () => {
    if (smokeTest) {
      console.log(JSON.stringify({ ok: true, pageLoaded: true, bridgeReady: true, builtInPersonas: BUILTIN_PERSONAS.length, noModelCall: true }));
      setImmediate(() => { void completeSmoke(0); });
    }
    return true;
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '窗口', submenu: [{ label: '显示提示词助手', click: showWindow }, { label: '隐藏窗口', click: () => shell.hide() }, { type: 'separator' }, { label: '退出', accelerator: 'CommandOrControl+Q', click: quit }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  if (smokeTest) smokeTimer = setTimeout(() => { void completeSmoke(1); }, 15000);
  await loadPage();
  if (!smokeTest) showWindow();
}

if (!ownsLock) {
  if (smokeDirectory) await rm(smokeDirectory, { recursive: true, force: true });
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', (event) => {
    quitting = true;
    cancelRequest();
    clearTimeout(boundsTimer);
    shell?.dispose();
    if (exitReady) return;
    event.preventDefault();
    shutdown ??= (async () => {
      // A stalled filesystem must not leave an invisible process alive on exit.
      const deadline = setTimeout(() => { tray?.destroy(); app.exit(0); }, 2000);
      try {
        await shell?.flush();
        if (window && !window.isDestroyed()) await shellStore?.saveBounds(window.getNormalBounds()).catch(() => {});
        await shellStore?.flush();
      } finally {
        clearTimeout(deadline);
        tray?.destroy();
        exitReady = true;
        app.quit();
      }
    })();
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy(); });
  app.on('window-all-closed', quit);
  await app.whenReady();
  try { await start(); }
  catch {
    if (smokeTest) await completeSmoke(1);
    else { dialog.showErrorBox('Prompt Spark 启动失败', '桌面助手未能启动，请检查安装和配置文件权限。'); quit(); }
  }
}
