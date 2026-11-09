import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { endpointFor, providerError } from './provider.mjs';

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', rememberKey: false,
  personaId: 'builtin:balanced', direction: '',
});

export function normalizeSettings(value = {}) {
  const provider = value.provider === 'anthropic' ? 'anthropic' : 'openai';
  const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : DEFAULT_SETTINGS.baseUrl;
  endpointFor(provider, baseUrl);
  const model = typeof value.model === 'string' ? value.model.trim() : DEFAULT_SETTINGS.model;
  if (!model || model.length > 200) throw providerError('missing-model', '模型 ID 需要 1–200 个字符。');
  const direction = typeof value.direction === 'string' ? value.direction.trim() : '';
  if (direction.length > 4000) throw providerError('invalid-direction', '自定义强化方向最多 4000 个字符。');
  return {
    provider, baseUrl, model, rememberKey: value.rememberKey === true,
    personaId: typeof value.personaId === 'string' && value.personaId.length < 100 ? value.personaId : DEFAULT_SETTINGS.personaId,
    direction,
  };
}

export function secureStorageAvailable(cipher) {
  try {
    return cipher?.isEncryptionAvailable() === true && cipher.getSelectedStorageBackend?.() !== 'basic_text';
  } catch { return false; }
}

export async function createSettingsStore(filePath, cipher) {
  const resolvedPath = path.resolve(filePath);
  let settings = { ...DEFAULT_SETTINGS };
  let apiKey = '';
  let keyWarning = '';
  let queue = Promise.resolve();
  const canRememberKey = secureStorageAvailable(cipher);
  try {
    if ((await stat(resolvedPath)).size > 65536) throw new Error('settings-too-large');
    const saved = JSON.parse(await readFile(resolvedPath, 'utf8'));
    settings = normalizeSettings(saved);
    if (settings.rememberKey && saved.encryptedKey) {
      if (!canRememberKey) keyWarning = '系统安全存储不可用，请重新输入 API Key；不会明文保存。';
      else {
        try { apiKey = cipher.decryptString(Buffer.from(saved.encryptedKey, 'base64')); }
        catch { keyWarning = '之前保存的 API Key 无法解密，请重新输入。'; }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') keyWarning = '设置文件无法读取，已使用默认值；请检查设置并重新保存。';
  }
  const publicView = () => ({ ...settings, keyPresent: Boolean(apiKey), canRememberKey, keyWarning });
  return {
    view: publicView,
    current: () => ({ settings: { ...settings }, apiKey }),
    save(value) {
      const operation = queue.then(async () => {
        const next = normalizeSettings(value);
        if (next.rememberKey && !canRememberKey) throw providerError('secure-storage-unavailable', '系统安全存储不可用。取消“记住 Key”后可仅在本次运行中使用。');
        const keyInput = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
        if (keyInput.length > 8192 || /[\r\n]/u.test(keyInput)) throw providerError('invalid-key', 'API Key 格式不正确。');
        const endpointChanged = endpointFor(settings.provider, settings.baseUrl) !== endpointFor(next.provider, next.baseUrl);
        const nextKey = value.forgetKey === true ? '' : keyInput || (endpointChanged || next.provider !== settings.provider ? '' : apiKey);
        const stored = {
          ...next,
          ...(next.rememberKey && nextKey ? { encryptedKey: cipher.encryptString(nextKey).toString('base64') } : {}),
        };
        await mkdir(path.dirname(resolvedPath), { recursive: true });
        const temporaryPath = path.join(path.dirname(resolvedPath), `.prompt-enhancer-${randomUUID()}.tmp`);
        try {
          await writeFile(temporaryPath, JSON.stringify(stored, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          await rename(temporaryPath, resolvedPath);
        } finally { await unlink(temporaryPath).catch(() => {}); }
        settings = next;
        apiKey = nextKey;
        keyWarning = '';
        return publicView();
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
