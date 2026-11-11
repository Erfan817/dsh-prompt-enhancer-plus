import { open, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { endpointFor, providerError } from './provider.mjs';

export const SCHEMA_VERSION = 2;
const MAX_SETTINGS_BYTES = 65536;

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', rememberKey: false,
  personaId: 'builtin:balanced', direction: '',
});

// Minimal, injectable filesystem seam. Production uses node:fs/promises; tests
// override individual operations to exercise write/rename failures deterministically.
const defaultIo = Object.freeze({ open, mkdir, rename, stat, unlink, writeFile });

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

// Classify a saved settings document already read into memory.
// `status` is one of: unused | legacy | current | future | corrupt | invalid | too-large.
function interpretSettings(raw, byteSize) {
  if (byteSize > MAX_SETTINGS_BYTES) return { status: 'too-large' };
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { status: 'corrupt' }; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'corrupt' };
  const version = parsed.schemaVersion;
  if (version !== undefined) {
    if (!Number.isInteger(version) || version < 1) return { status: 'invalid', reason: 'schemaVersion' };
    if (version > SCHEMA_VERSION) return { status: 'future', version, saved: parsed };
    if (version !== SCHEMA_VERSION) return { status: 'legacy', saved: parsed, fromVersion: version };
  } else {
    return { status: 'legacy', saved: parsed };
  }
  return { status: 'current', version, saved: parsed };
}

// Bounded read that never loads more than MAX_SETTINGS_BYTES + 1 bytes, even if
// the file grows or is replaced between stat and read. Returns { raw, bytes, oversize }.
async function readBounded(io, resolvedPath) {
  const handle = await io.open(resolvedPath, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { notFile: true };
    const limit = MAX_SETTINGS_BYTES + 1;
    const buffer = Buffer.alloc(limit);
    let offset = 0;
    while (offset < limit) {
      const { bytesRead } = await handle.read(buffer, offset, limit - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    // Confirm size after the bounded read; a still-growing file must be treated as
    // too large rather than accepted from a stale stat.
    const after = await handle.stat();
    const oversize = offset > MAX_SETTINGS_BYTES || after.size > MAX_SETTINGS_BYTES;
    return { raw: buffer.subarray(0, Math.min(offset, MAX_SETTINGS_BYTES)).toString('utf8'), bytes: offset, oversize };
  } finally { await handle.close().catch(() => {}); }
}

export async function createSettingsStore(filePath, cipher, io = defaultIo) {
  const resolvedPath = path.resolve(filePath);
  let settings = { ...DEFAULT_SETTINGS };
  let apiKey = '';
  let keyWarning = '';
  let queue = Promise.resolve();
  const canRememberKey = secureStorageAvailable(cipher);

  // Reading never rewrites the file. `readState` records what happened so callers
  // can tell "not created yet" apart from "damaged and preserved".
  let readState = { status: 'unused' };
  // When the on-disk file could not be safely read/understood, a normal save must
  // not silently overwrite it. `protectedReason` records why; only an explicit,
  // user-confirmed `reset` (plus a successful backup) is allowed to replace it.
  let protectedReason = '';
  // The encrypted blob currently known to be on disk. Preserved across unrelated
  // saves even when we cannot decrypt it or secure storage is unavailable.
  let storedEncryptedKey = '';
  // True when the ciphertext is present but not currently usable (no decrypt or no
  // secure storage). Distinguishes "keep the blob" from "user forgot the key".
  let keyUnusable = false;

  try {
    const read = await readBounded(io, resolvedPath);
    if (read.notFile) {
      readState = { status: 'unreadable', reason: 'not-a-file' };
      protectedReason = '设置路径不是普通文件，已保留原状。';
      keyWarning = '设置文件无法读取，已使用默认值；原文件未被修改。';
    } else if (read.oversize) {
      readState = { status: 'too-large' };
      protectedReason = '设置文件过大，已保留原状。';
      keyWarning = '设置文件异常（过大），已使用默认值；原文件未被覆盖。';
    } else {
      const result = interpretSettings(read.raw, read.bytes);
      readState = result;
      if (result.status === 'corrupt') {
        protectedReason = '设置文件已损坏，已保留原状。';
        keyWarning = '设置文件已损坏，已使用默认值；原文件未被覆盖，可在设置中显式重建。';
      } else if (result.status === 'invalid') {
        protectedReason = '设置文件字段非法，已保留原状。';
        keyWarning = '设置文件字段异常，已使用默认值；原文件未被覆盖。';
      } else if (result.status === 'future') {
        protectedReason = '设置来自更新版本，已保留原状。';
        keyWarning = '设置由更新版本的 Prompt Spark 保存，为避免降级丢失数据，本次未覆盖；如需继续请显式重置（会先备份原文件）。';
      } else if (result.status === 'legacy' || result.status === 'current') {
        try {
          settings = normalizeSettings(result.saved);
          storedEncryptedKey = typeof result.saved.encryptedKey === 'string' ? result.saved.encryptedKey : '';
          if (settings.rememberKey && storedEncryptedKey && canRememberKey) {
            try { apiKey = cipher.decryptString(Buffer.from(storedEncryptedKey, 'base64')); }
            catch { /* Keep the encrypted copy and expose its unusable state below. */ }
          }
          keyUnusable = Boolean(storedEncryptedKey && !apiKey);
        } catch (error) {
          readState = { status: 'invalid', reason: error.code || 'normalize' };
          protectedReason = '设置文件字段非法，已保留原状。';
          keyWarning = '设置文件字段异常，已使用默认值；原文件未被覆盖。';
          storedEncryptedKey = '';
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      readState = { status: 'unreadable', reason: error.code || 'read-error' };
      protectedReason = '设置文件无法读取，已保留原状。';
      keyWarning = '设置文件无法读取，已使用默认值；原文件未被修改。';
    }
  }

  // A stored key exists but cannot be used right now (undecryptable or no secure
  // storage). Kept on disk and reused for unrelated saves; not returned to renderer.
  if (keyUnusable && !keyWarning) {
    keyWarning = readState.status === 'current' || readState.status === 'legacy'
      ? '已保存的 API Key 当前无法使用（安全存储不可用或无法解密）。原密文已保留；可重新输入 Key，或勾选清除。'
      : keyWarning;
  }
  const readStatus = () => ({
    status: readState.status,
    ...(readState.version !== undefined ? { version: readState.version } : {}),
    ...(readState.fromVersion !== undefined ? { fromVersion: readState.fromVersion } : {}),
    ...(readState.reason !== undefined ? { reason: readState.reason } : {}),
  });
  // Non-sensitive recovery signal. `recoverable` means a user-confirmed reset is
  // offered; `backupFirst` and `losesUnknownData` describe the reset's risk.
  // An oversized file cannot be backed up safely in-process, so it is NOT offered
  // for in-app recovery — the user must handle it outside the app.
  const recoveryInfo = () => {
    if (!protectedReason) return { recoverable: false };
    if (readState.status === 'too-large') {
      return { recoverable: false, reason: readState.status, manualOnly: true };
    }
    return {
      recoverable: true,
      backupFirst: true,
      losesUnknownData: readState.status === 'future',
      reason: readState.status,
    };
  };
  const publicView = () => ({
    ...settings,
    keyPresent: Boolean(apiKey),
    keyUnusable,
    canRememberKey,
    keyWarning,
    readStatus: readStatus(),
    recovery: recoveryInfo(),
  });

  return {
    view: publicView,
    current: () => ({ settings: { ...settings }, apiKey }),
    save(value) {
      const operation = queue.then(async () => {
        const next = normalizeSettings(value);
        const keyInput = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
        if (keyInput.length > 8192 || /[\r\n]/u.test(keyInput)) throw providerError('invalid-key', 'API Key 格式不正确。');
        const forget = value.forgetKey === true;
        const endpointChanged = endpointFor(settings.provider, settings.baseUrl) !== endpointFor(next.provider, next.baseUrl);
        const providerChanged = next.provider !== settings.provider;
        const preserveUnavailableKey = keyUnusable && storedEncryptedKey && !canRememberKey && next.rememberKey && !forget && !keyInput && !endpointChanged && !providerChanged;
        // Existing encrypted settings can be preserved without decrypting. Do not
        // permit creating/replacing remembered keys while secure storage is absent.
        if (next.rememberKey && !canRememberKey && !forget && !preserveUnavailableKey) throw providerError('secure-storage-unavailable', '系统安全存储不可用。取消“记住 Key”后可仅在本次运行中使用。');

        const replacing = value.reset === true;
        if (protectedReason && !replacing) {
          throw providerError('settings-protected', `${protectedReason}如确认要用当前内容替换，请先在设置中显式确认恢复。`);
        }

        // Decide the ciphertext to write:
        // - explicit forget  -> drop it
        // - new key input    -> encrypt fresh (only when remembering)
        // - endpoint/protocol change -> drop (existing safety rule)
        // - otherwise        -> preserve any existing on-disk blob verbatim
        let encryptedKey = '';
        let nextKey = apiKey;
        if (forget) {
          nextKey = '';
          encryptedKey = '';
        } else if (keyInput) {
          nextKey = keyInput;
          if (next.rememberKey) {
            if (!canRememberKey) throw providerError('secure-storage-unavailable', '系统安全存储不可用，无法保存新 Key。');
            encryptedKey = cipher.encryptString(keyInput).toString('base64');
          }
        } else if (endpointChanged || providerChanged) {
          nextKey = '';
          encryptedKey = '';
        } else if (preserveUnavailableKey) {
          // Browser mode cannot decrypt the blob, so preserve both it and its
          // rememberKey flag until the user explicitly forgets or changes endpoint.
          encryptedKey = storedEncryptedKey;
          nextKey = '';
        } else if (!next.rememberKey) {
          // Unchecking "remember key" removes the persisted copy. The current
          // process may continue using an already-decrypted key until it exits.
          nextKey = keyInput || apiKey;
          encryptedKey = '';
        } else {
          // Preserve an unavailable blob only while the user keeps rememberKey on.
          encryptedKey = keyUnusable ? storedEncryptedKey : '';
          if (!encryptedKey && nextKey && canRememberKey) {
            encryptedKey = cipher.encryptString(nextKey).toString('base64');
          }
        }

        // When resetting a protected file, back up the original before replacing it.
        let backupPath = '';
        if (replacing && protectedReason) {
          try { backupPath = await backupOriginal(); }
          catch (error) {
            throw providerError('recovery-backup-failed', '无法备份原设置文件，已阻止覆盖以免丢失唯一数据。请先手动备份或更新到兼容版本。');
          }
        }

        const stored = {
          schemaVersion: SCHEMA_VERSION,
          ...next,
          // Preserve an unavailable ciphertext only while its rememberKey setting is
          // retained; a normal uncheck explicitly removes the persisted copy.
          ...(encryptedKey ? { encryptedKey } : {}),
        };
        const directory = path.dirname(resolvedPath);
        await io.mkdir(directory, { recursive: true });
        const temporaryPath = path.join(directory, `.prompt-enhancer-${randomUUID()}.tmp`);
        try {
          await io.writeFile(temporaryPath, JSON.stringify(stored, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          await io.rename(temporaryPath, resolvedPath);
        } finally { await io.unlink(temporaryPath).catch(() => {}); }

        // Commit memory only after the write succeeded.
        settings = next;
        apiKey = nextKey;
        protectedReason = '';
        storedEncryptedKey = typeof stored.encryptedKey === 'string' ? stored.encryptedKey : '';
        keyUnusable = Boolean(storedEncryptedKey && !apiKey);
        keyWarning = keyUnusable
          ? '已保存的 API Key 当前无法使用（安全存储不可用或无法解密）。原密文已保留；可重新输入 Key，或勾选清除。'
          : '';
        readState = { status: 'current', version: SCHEMA_VERSION };
        const view = publicView();
        return backupPath ? { ...view, recovered: true } : view;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };

  // Copy the original file to a unique sibling backup using a temporary file and
  // atomic rename. The backup is byte-identical and never overwrites an existing file.
  async function backupOriginal() {
    const directory = path.dirname(resolvedPath);
    const baseName = path.basename(resolvedPath);
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const backupPath = path.join(directory, `${baseName}.backup-${stamp}-${randomUUID().slice(0, 8)}`);
    const temporaryPath = `${backupPath}.${randomUUID()}.tmp`;
    const source = await io.open(resolvedPath, 'r');
    try {
      const info = await source.stat();
      if (!info.isFile()) throw new Error('not-a-file');
      if (info.size > MAX_SETTINGS_BYTES) throw new Error('too-large-to-back-up');
      const buffer = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < info.size) {
        const { bytesRead } = await source.read(buffer, offset, info.size - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== info.size) throw new Error('source-changed-during-backup');
      await io.writeFile(temporaryPath, buffer, { mode: 0o600, flag: 'wx' });
      await io.rename(temporaryPath, backupPath);
      return backupPath;
    } finally {
      await source.close().catch(() => {});
      await io.unlink(temporaryPath).catch(() => {});
    }
  }
}
