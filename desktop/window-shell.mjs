import { normalizeShortcut } from './shell-settings.mjs';

export function visibleBounds(saved, displays) {
  const areas = displays.map((display) => display.workArea);
  if (!areas.length) throw new Error('没有可用显示器。');
  const original = saved || { x: areas[0].x, y: areas[0].y, width: 1040, height: 820 };
  const center = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
  const distance = (area) => Math.max(area.x - center.x, 0, center.x - area.x - area.width) ** 2
    + Math.max(area.y - center.y, 0, center.y - area.y - area.height) ** 2;
  const area = areas.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best);
  const width = Math.min(Math.max(original.width, 540), area.width);
  const height = Math.min(Math.max(original.height, 500), area.height);
  return {
    x: Math.round(saved ? Math.max(area.x, Math.min(original.x, area.x + area.width - width)) : area.x + (area.width - width) / 2),
    y: Math.round(saved ? Math.max(area.y, Math.min(original.y, area.y + area.height - height)) : area.y + (area.height - height) / 2),
    width, height,
  };
}

// Lifecycle logic is injected so failure paths can be tested without an Electron desktop.
export function createWindowShell({ getWindow, getDisplays, shortcuts, store, cancel, notifyHidden, notifyState, trayAvailable }) {
  let shortcut = store.view().shortcut;
  let activeShortcut = '';
  let warning = '';
  let disposed = false;
  let changes = Promise.resolve();
  const state = () => ({ shortcut, shortcutAvailable: Boolean(activeShortcut), trayAvailable: trayAvailable(), warning: warning || store.view().warning });
  function show() {
    if (disposed) return;
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    if (!window.isMaximized() && !window.isFullScreen()) {
      const bounds = visibleBounds(window.getBounds(), getDisplays());
      window.setMinimumSize?.(Math.min(540, bounds.width), Math.min(500, bounds.height));
      window.setBounds(bounds);
    }
    window.show();
    window.focus();
  }
  function hide() {
    if (disposed) return;
    cancel();
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (trayAvailable() || activeShortcut) window.hide();
    else window.minimize();
    notifyHidden();
  }
  function register(value) {
    try { return shortcuts.register(value, show); } catch { return false; }
  }
  function start() {
    if (shortcut && register(shortcut)) activeShortcut = shortcut;
    else if (shortcut) warning = '快捷键不可用或已被占用；可从托盘/任务栏唤回，也可在设置中改键。';
  }
  function changeShortcut(value) {
    const operation = changes.then(async () => {
      if (disposed) throw new Error('桌面助手正在退出。');
      const next = normalizeShortcut(value);
      if (next === shortcut && (activeShortcut || !next)) return state();
      // Register the replacement before releasing the old working shortcut.
      if (next && !register(next)) throw Object.assign(new Error('快捷键不可用或已被占用，原快捷键保持不变。'), { code: 'shortcut-unavailable' });
      try {
        await store.saveShortcut(next);
      } catch (error) {
        if (next) shortcuts.unregister(next);
        throw error;
      }
      if (disposed) {
        if (next) shortcuts.unregister(next);
        throw new Error('桌面助手正在退出。');
      }
      if (activeShortcut && activeShortcut !== next) shortcuts.unregister(activeShortcut);
      shortcut = next;
      activeShortcut = next;
      warning = '';
      // Never leave a hidden window unreachable after disabling the last entry.
      if (!trayAvailable() && !activeShortcut) show();
      notifyState(state());
      return state();
    });
    changes = operation.catch(() => {});
    return operation;
  }
  function dispose() {
    disposed = true;
    if (activeShortcut) shortcuts.unregister(activeShortcut);
    activeShortcut = '';
    cancel();
  }
  return { state, start, show, hide, changeShortcut, dispose, flush: () => changes };
}
