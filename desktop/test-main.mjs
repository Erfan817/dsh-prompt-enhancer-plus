import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Execute the real main module against a fake Electron host, never the user's
// running desktop, clipboard, global shortcuts, settings or model credentials.
const scenario = process.argv[2];
if (!scenario) {
  for (const name of ['tray', 'fallback', 'crash', 'second-instance', 'logoff']) {
    await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url), name], { timeout: 15000 });
    console.log(`ok - isolated Electron main: ${name}`);
  }
  console.log('Main lifecycle tests passed with a fake Electron host; no native desktop coverage claimed.');
} else {
  const directory = await mkdtemp(path.join(tmpdir(), 'prompt-spark-main-test-'));
  const handlers = new Map();
  const registered = new Map();
  const windows = [];
  const trays = [];
  const dialogs = [];
  let finished;
  const finishedPromise = new Promise((resolve) => { finished = resolve; });
  let trayDestroyed = false;
  let appQuitCount = 0;
  const app = new EventEmitter();
  app.setName = () => {};
  app.getPath = () => directory;
  app.requestSingleInstanceLock = () => scenario !== 'second-instance';
  app.whenReady = async () => {};
  app.exit = () => finished();
  app.quit = () => {
    appQuitCount += 1;
    let prevented = false;
    app.emit('before-quit', { preventDefault: () => { prevented = true; } });
    if (!prevented) { app.emit('will-quit'); finished(); }
  };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); windows.push(this); this.bounds = { ...options }; this.visible = false; this.minimized = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: { url: '' }, isDestroyed: () => false, isCrashed: () => false,
        setWindowOpenHandler: () => {}, send: (channel, value) => { this.lastMessage = { channel, value }; },
        session: { setPermissionRequestHandler: () => {} },
      });
    }
    async loadFile(file) { this.loads = (this.loads || 0) + 1; this.webContents.mainFrame.url = `file:///${file.replace(/\\/gu, '/')}`; }
    isDestroyed() { return false; }
    isMinimized() { return this.minimized; }
    isMaximized() { return false; }
    isFullScreen() { return false; }
    restore() { this.minimized = false; }
    setBounds(value) { this.bounds = value; }
    getBounds() { return { x: this.bounds.x, y: this.bounds.y, width: this.bounds.width, height: this.bounds.height }; }
    getNormalBounds() { return this.getBounds(); }
    setMinimumSize() {}
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() { this.focused = true; }
    minimize() { this.minimized = true; }
    setAlwaysOnTop() {}
    isAlwaysOnTop() { return false; }
    setFullScreen() {}
  }
  class FakeTray extends EventEmitter {
    constructor() { super(); if (scenario === 'fallback') throw new Error('no tray'); trays.push(this); }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    isDestroyed() { return trayDestroyed; }
    destroy() { trayDestroyed = true; }
  }
  const electron = {
    app, BrowserWindow: FakeWindow, Tray: FakeTray,
    clipboard: { writeText: () => { throw new Error('Clipboard should never be used by lifecycle tests'); } },
    dialog: { showMessageBoxSync: (_window, options) => dialogs.push(options), showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 0 }; }, showErrorBox: (...args) => { throw new Error(args.join(':')); } },
    globalShortcut: { register: (key, callback) => { if (scenario === 'fallback') return false; registered.set(key, callback); return true; }, unregister: (key) => registered.delete(key), unregisterAll: () => registered.clear() },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    Menu: { buildFromTemplate: (menu) => menu, setApplicationMenu: () => {} },
    nativeImage: { createFromBitmap: () => ({}) }, nativeTheme: { shouldUseDarkColors: false }, safeStorage: { isEncryptionAvailable: () => false },
    screen: Object.assign(new EventEmitter(), { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1200, height: 800 } }] }),
  };
  globalThis.__shellTestElectron = electron;
  const source = `const e=globalThis.__shellTestElectron; export const {${Object.keys(electron).join(',')}}=e;`;
  const hook = registerHooks({ resolve(specifier, context, next) { return specifier === 'electron' ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true } : next(specifier, context); } });
  try {
    await import('./main.mjs');
    if (scenario === 'second-instance') {
      assert.equal(windows.length, 0, 'second process never creates its own window');
      assert.equal(appQuitCount, 1);
    } else {
      const window = windows[0];
      assert.ok(window.visible);
      if (scenario === 'tray') {
        window.emit('close', { preventDefault() {} });
        assert.equal(window.visible, false);
        assert.equal(dialogs.length, 1, 'first close explains tray behavior');
        window.emit('close', { preventDefault() {} });
        assert.equal(dialogs.length, 1);
        trays[0].emit('click');
        assert.equal(window.visible, true);
        window.minimized = true;
        app.emit('second-instance');
        assert.equal(window.minimized, false);
        assert.equal(window.focused, true);
        app.quit();
        await finishedPromise;
        assert.equal(trayDestroyed, true);
        assert.equal(registered.size, 0);
      } else if (scenario === 'fallback') {
        window.emit('close', { preventDefault() {} });
        assert.equal(window.minimized, true, 'tray and shortcut failure falls back to taskbar');
        app.emit('second-instance');
        assert.equal(window.minimized, false);
        app.quit(); await finishedPromise;
      } else if (scenario === 'crash') {
        window.webContents.emit('render-process-gone');
        for (let i = 0; i < 5; i += 1) await new Promise(setImmediate);
        assert.equal(window.loads, 2);
        assert.ok(dialogs[0].message.includes('可能已经丢失'));
        assert.equal(window.visible, true);
        app.quit(); await finishedPromise;
      } else if (scenario === 'logoff') {
        window.emit('query-session-end');
        let prevented = false;
        window.emit('close', { preventDefault() { prevented = true; } });
        assert.equal(prevented, false, 'logoff close must not be intercepted');
        assert.equal(registered.size, 0);
      }
    }
  } finally { hook.deregister(); delete globalThis.__shellTestElectron; await rm(directory, { recursive: true, force: true }); }
}
