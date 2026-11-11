import { open, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+Space';
const MODIFIERS = new Set(['CommandOrControl', 'Control', 'Ctrl', 'Alt', 'Option', 'Shift', 'Super', 'Meta', 'Command', 'Cmd']);
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus|Equal|Comma|Period|Slash|Backslash)$/u;

export function normalizeShortcut(value) {
  const invalid = () => Object.assign(new Error('快捷键需包含修饰键和按键，例如 Control+Shift+Space；留空可停用。'), { code: 'invalid-shortcut' });
  if (typeof value !== 'string' || value.length > 100) throw invalid();
  if (!value.trim()) return '';
  const tokens = value.split('+').map((part) => part.trim());
  const modifiers = tokens.slice(0, -1);
  if (!modifiers.length || modifiers.some((part) => !MODIFIERS.has(part)) || new Set(modifiers).size !== modifiers.length || !KEY.test(tokens.at(-1))) throw invalid();
  return tokens.join('+');
}

export function normalizeBounds(value) {
  if (!value || !['x', 'y', 'width', 'height'].every((key) => Number.isSafeInteger(value[key]) && Math.abs(value[key]) <= 100000)) return null;
  if (value.width < 1 || value.height < 1) return null;
  return Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, value[key]]));
}

// Separate from model settings: shell changes must never modify credentials.
export async function createShellSettingsStore(filePath, io = { open, mkdir, rename, unlink, writeFile }) {
  let settings = { shortcut: DEFAULT_SHORTCUT, windowBounds: null };
  let warning = '';
  let queue = Promise.resolve();
  try {
    const handle = await io.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(8193);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > 8192) throw new Error('too-large');
      const saved = JSON.parse(buffer.subarray(0, length).toString('utf8'));
      if (!saved || saved.schemaVersion !== 1) throw new Error('unsupported-shell-settings');
      settings = { shortcut: normalizeShortcut(saved.shortcut), windowBounds: normalizeBounds(saved.windowBounds) };
    } finally { await handle.close(); }
  } catch (error) {
    if (error.code !== 'ENOENT') warning = '桌面设置无法读取，已使用默认值并保留原文件；本次不能保存桌面设置。';
  }
  function update(patch) {
    const operation = queue.then(async () => {
      if (warning) throw new Error(warning);
      const next = { ...settings, ...patch };
      const directory = path.dirname(filePath);
      const temporary = path.join(directory, `.prompt-spark-shell-${randomUUID()}.tmp`);
      await io.mkdir(directory, { recursive: true });
      try {
        await io.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, ...next }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await io.rename(temporary, filePath);
      } finally { await io.unlink(temporary).catch(() => {}); }
      settings = next;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    view: () => ({ ...settings, warning }),
    saveShortcut: (value) => update({ shortcut: normalizeShortcut(value) }),
    saveBounds: (value) => {
      const bounds = normalizeBounds(value);
      if (!bounds) return Promise.reject(new Error('窗口位置无效。'));
      return update({ windowBounds: bounds });
    },
    flush: () => queue,
  };
}
