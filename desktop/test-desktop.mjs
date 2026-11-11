import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, rm, writeFile, readdir, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildProviderCall, endpointFor, enhanceWithProvider } from './provider.mjs';
import { createSettingsStore, normalizeSettings, secureStorageAvailable, SCHEMA_VERSION } from './settings.mjs';
import { createShellSettingsStore, normalizeBounds, normalizeShortcut } from './shell-settings.mjs';
import { createWindowShell, visibleBounds } from './window-shell.mjs';

const settings = { provider: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' };
const request = { text: '帮我完善写作需求，保留 C#、*.ts 与 #release。', mode: 'general', format: 'plain' };
assert.equal(endpointFor('openai', 'https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions');
assert.equal(endpointFor('openai', 'http://localhost:1234/v1'), 'http://localhost:1234/v1/chat/completions');
assert.equal(endpointFor('openai', 'http://[::1]:11434/v1'), 'http://[::1]:11434/v1/chat/completions');
assert.equal(endpointFor('anthropic', 'https://api.anthropic.com/v1/messages'), 'https://api.anthropic.com/v1/messages');
for (const address of ['http://example.com/v1', 'file:///tmp/key', 'https://user:password@example.com', 'https://example.com?key=secret', 'https://example.com#secret']) {
  assert.throws(() => endpointFor('openai', address), { code: 'invalid-endpoint' });
}
const call = buildProviderCall(settings, request, 'TEST_KEY');
assert.equal(call.headers.authorization, 'Bearer TEST_KEY');
assert.equal(call.body.messages[1].role, 'user');
assert.ok(call.body.messages[1].content.includes('*.ts'));
assert.ok(call.body.messages[0].content.includes('plain'));
assert.equal(call.level, 'standard');
const detailedCall = buildProviderCall(settings, { ...request, level: 'detailed', context: 'PROJECT_CONTEXT_XYZ' }, 'TEST_KEY');
assert.equal(detailedCall.level, 'detailed');
assert.ok(detailedCall.body.messages[0].content.includes('Length/expansion level: detailed'));
assert.ok(detailedCall.body.messages[0].content.includes('PROJECT_CONTEXT_XYZ'));
assert.ok(detailedCall.body.messages[0].content.includes('Project context'));
assert.equal(buildProviderCall(settings, { ...request, level: 'unknown' }, '').level, 'standard');
assert.throws(() => buildProviderCall(settings, { ...request, context: 'x'.repeat(8001) }, ''), { code: 'invalid-request' });
assert.throws(() => buildProviderCall(settings, { text: ' ' }, ''), { code: 'empty-input' });
assert.throws(() => buildProviderCall(settings, { text: '长'.repeat(12001) }, ''), { code: 'too-long' });
assert.throws(() => buildProviderCall(settings, request, 'bad\nkey'), { code: 'invalid-key' });
assert.throws(() => buildProviderCall({ ...settings, provider: 'anthropic' }, request, ''), { code: 'missing-key' });
assert.equal(buildProviderCall(settings, request, '').headers.authorization, undefined);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const completion = (content = '清楚地说明写作要求，保留 C#、*.ts 与 #release。', finish = 'stop') => ({ choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 30, completion_tokens: 50, total_tokens: 80 } });
let captured;
const result = await enhanceWithProvider(settings, request, 'TEST_KEY', {
  fetchImpl: async (address, options) => { captured = { address, options }; return json(completion()); },
});
assert.equal(result.format, 'plain');
assert.equal(result.level, 'standard');
assert.equal(result.usage.totalTokens, 80);
assert.ok(result.enhanced.includes('C#'));
assert.ok(result.enhanced.includes('*.ts'));
assert.ok(result.enhanced.includes('#release'));
assert.equal(captured.options.redirect, 'error');
assert.equal(JSON.parse(captured.options.body).stream, false);
const leveled = await enhanceWithProvider(settings, { ...request, level: 'concise', context: 'CTX_FOR_CALL' }, '', { fetchImpl: async (_address, options) => {
  const system = JSON.parse(options.body).messages[0].content;
  assert.ok(system.includes('Length/expansion level: concise'));
  assert.ok(system.includes('CTX_FOR_CALL'));
  return json(completion());
} });
assert.equal(leveled.level, 'concise');
const markdown = await enhanceWithProvider(settings, { ...request, format: 'markdown' }, '', { fetchImpl: async () => json(completion('## Goal\n\n**Preserve** facts.')) });
assert.equal(markdown.format, 'markdown');
assert.ok(markdown.enhanced.includes('## Goal'));
const anthropic = await enhanceWithProvider({ ...settings, provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-model' }, request, 'ANTHROPIC_KEY', {
  fetchImpl: async (_address, options) => {
    assert.equal(options.headers['x-api-key'], 'ANTHROPIC_KEY');
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    assert.ok(JSON.parse(options.body).system);
    return json({ content: [{ type: 'text', text: '写清楚要做什么。' }], stop_reason: 'end_turn', usage: { input_tokens: 15, output_tokens: 20 } });
  },
});
assert.equal(anthropic.enhanced, '写清楚要做什么。');
assert.equal(anthropic.usage.outputTokens, 20);
for (const content of [[{ type: 'text', text: { unexpected: true } }], [{ type: 'text', text: 123 }], [{ type: 'text', text: 'Text' }, { type: 'tool_use', name: 'unexpected' }], null]) {
  await assert.rejects(enhanceWithProvider({ ...settings, provider: 'anthropic' }, request, 'KEY', {
    fetchImpl: async () => json({ content, stop_reason: 'end_turn' }),
  }), { code: 'invalid-response' });
}
await assert.rejects(enhanceWithProvider(settings, request, '', { fetchImpl: async () => json(null) }), { code: 'invalid-response' });
await assert.rejects(enhanceWithProvider(settings, request, '', { fetchImpl: async () => json(completion('Partial', 'length')) }), { code: 'output-truncated' });
await assert.rejects(enhanceWithProvider(settings, request, '', { fetchImpl: async () => json(completion('Unsafe', 'tool_calls')) }), { code: 'incomplete-output' });
await assert.rejects(enhanceWithProvider(settings, request, '', { fetchImpl: async () => json(completion('')) }), { code: 'empty-output' });
await assert.rejects(enhanceWithProvider(settings, request, '', { fetchImpl: async () => json({ secret: 'do-not-display' }, 401) }), (error) => error.code === 'provider-failed' && !error.message.includes('do-not-display'));
await assert.rejects(enhanceWithProvider(settings, request, '', { fetchImpl: async () => new Response('not JSON') }), { code: 'invalid-response' });
await assert.rejects(enhanceWithProvider(settings, request, '', { fetchImpl: async () => new Response('x'.repeat(1_048_577)) }), { code: 'response-too-large' });
const cancelled = new AbortController();
cancelled.abort();
let invoked = false;
await assert.rejects(enhanceWithProvider(settings, request, '', { signal: cancelled.signal, fetchImpl: async () => { invoked = true; return json(completion()); } }), { name: 'AbortError' });
assert.equal(invoked, false);
const late = new AbortController();
await assert.rejects(enhanceWithProvider(settings, request, '', { signal: late.signal, fetchImpl: async () => { late.abort(); return json(completion()); } }), { name: 'AbortError' });
assert.equal(normalizeSettings().rememberKey, false);
assert.equal(secureStorageAvailable({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }), false);
assert.equal(secureStorageAvailable({ isEncryptionAvailable: () => false }), false);
const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`encrypted:${text}`),
  decryptString: (bytes) => bytes.toString().replace(/^encrypted:/u, ''),
};
assert.equal(normalizeShortcut('Control+Shift+Space'), 'Control+Shift+Space');
assert.equal(normalizeShortcut(''), '');
for (const shortcut of ['Space', 'Control+', 'Control+Control+A', 'Ctrl+Bogus']) assert.throws(() => normalizeShortcut(shortcut), { code: 'invalid-shortcut' });
assert.deepEqual(normalizeBounds({ x: -1920, y: 0, width: 1040, height: 820 }), { x: -1920, y: 0, width: 1040, height: 820 });
assert.equal(normalizeBounds({ x: 0, y: 0, width: 0, height: 500 }), null);
const displays = [{ workArea: { x: 0, y: 0, width: 1200, height: 800 } }, { workArea: { x: 1200, y: 0, width: 1200, height: 800 } }];
assert.deepEqual(visibleBounds({ x: 5000, y: 5000, width: 1040, height: 820 }, displays), { x: 1360, y: 0, width: 1040, height: 800 });
let fakeBounds = { x: 0, y: 0, width: 1040, height: 820 };
let fakeMinimized = false;
let fakeVisible = false;
let fakeFocused = false;
let fakeCanceled = 0;
let shortcutCallback;
let shortcutRegistrationFails = false;
let savedShortcut = 'Control+Shift+Space';
const fakeWindow = {
  isDestroyed: () => false, isMinimized: () => fakeMinimized, isMaximized: () => false, isFullScreen: () => false,
  getBounds: () => fakeBounds, setBounds: (value) => { fakeBounds = value; }, restore: () => { fakeMinimized = false; },
  show: () => { fakeVisible = true; }, focus: () => { fakeFocused = true; }, hide: () => { fakeVisible = false; }, minimize: () => { fakeMinimized = true; },
};
const fakeShell = createWindowShell({
  getWindow: () => fakeWindow, getDisplays: () => displays,
  shortcuts: { register: (_accelerator, callback) => { if (shortcutRegistrationFails) return false; shortcutCallback = callback; return true; }, unregister: () => {} },
  store: { view: () => ({ shortcut: savedShortcut }), saveShortcut: async (value) => { savedShortcut = value; } },
  cancel: () => { fakeCanceled += 1; }, notifyHidden: () => {}, notifyState: () => {}, trayAvailable: () => false,
});
fakeShell.start();
assert.equal(fakeShell.state().shortcutAvailable, true);
shortcutCallback();
assert.equal(fakeVisible, true, 'shortcut shows and focuses the window');
assert.equal(fakeFocused, true);
fakeShell.hide();
assert.equal(fakeMinimized, false, 'a working shortcut remains a wake path, so hide is safe');
assert.equal(fakeVisible, false, 'window hides while shortcut is registered');
assert.equal(fakeCanceled, 1);
shortcutRegistrationFails = true;
await assert.rejects(fakeShell.changeShortcut('Alt+F8'), { code: 'shortcut-unavailable' });
assert.equal(fakeShell.state().shortcut, 'Control+Shift+Space', 'failed registration keeps old preference');
shortcutRegistrationFails = false;
await fakeShell.changeShortcut('');
assert.equal(fakeShell.state().shortcutAvailable, false);
assert.equal(fakeVisible, true, 'disabling last wake path shows the window');
fakeShell.hide();
assert.equal(fakeMinimized, true, 'no tray and no shortcut must minimize instead of hiding');
fakeShell.dispose();

// Conflict-free registration followed by persistence failure rolls back only the new key.
const registered = new Set();
let failSave = true;
const rollbackShell = createWindowShell({
  getWindow: () => fakeWindow, getDisplays: () => displays,
  shortcuts: { register: (key) => { registered.add(key); return true; }, unregister: (key) => registered.delete(key) },
  store: { view: () => ({ shortcut: 'Control+F8' }), saveShortcut: async () => { if (failSave) throw new Error('disk-full'); } },
  cancel: () => {}, notifyHidden: () => {}, notifyState: () => {}, trayAvailable: () => true,
});
rollbackShell.start();
await assert.rejects(rollbackShell.changeShortcut('Control+F9'), /disk-full/u);
assert.deepEqual([...registered], ['Control+F8']);
assert.equal(rollbackShell.state().shortcut, 'Control+F8');
failSave = false;
await rollbackShell.changeShortcut('Control+F9');
assert.deepEqual([...registered], ['Control+F9']);
rollbackShell.dispose();
assert.equal(registered.size, 0, 'exit releases owned shortcut');

const DEFAULT_PROVIDER = 'openai';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'prompt-enhancer-tests-'));
const writeConfig = (name, text) => writeFile(path.join(temporaryDirectory, name), text, { encoding: 'utf8' });
const readConfig = (name) => readFile(path.join(temporaryDirectory, name), 'utf8');
const readConfigBytes = (name) => readFile(path.join(temporaryDirectory, name));
try {
  const configPath = path.join(temporaryDirectory, 'settings.json');
  const store = await createSettingsStore(configPath, cipher);
  assert.equal(store.view().keyPresent, false);
  assert.equal(store.view().readStatus.status, 'unused');
  assert.equal(store.view().recovery.recoverable, false);
  await store.save({ ...settings, apiKey: 'SESSION_SECRET', rememberKey: false, direction: 'DIRECTION_ONLY' });
  assert.equal(store.view().keyPresent, true);
  assert.equal(store.view().apiKey, undefined);
  assert.equal(JSON.parse(await readConfig('settings.json')).schemaVersion, SCHEMA_VERSION);
  assert.ok(!(await readConfig('settings.json')).includes('SESSION_SECRET'));
  assert.equal((await createSettingsStore(configPath, cipher)).view().keyPresent, false);
  await store.save({ ...settings, apiKey: 'SAVED_SECRET', rememberKey: true });
  const storedText = await readConfig('settings.json');
  assert.ok(!storedText.includes('SAVED_SECRET'));
  assert.ok(JSON.parse(storedText).encryptedKey);
  const restored = await createSettingsStore(configPath, cipher);
  assert.equal(restored.current().apiKey, 'SAVED_SECRET');
  assert.equal(restored.view().keyPresent, true);
  assert.equal(restored.view().readStatus.status, 'current');

  // Disabling persistence keeps a usable key only in this process, not on disk.
  const ephemeralPath = path.join(temporaryDirectory, 'disable-remember.json');
  const ephemeralStore = await createSettingsStore(ephemeralPath, cipher);
  await ephemeralStore.save({ ...settings, apiKey: 'EPHEMERAL_AFTER_UNCHECK', rememberKey: true });
  await ephemeralStore.save({ ...settings, rememberKey: false });
  assert.equal(JSON.parse(await readConfig('disable-remember.json')).encryptedKey, undefined);
  assert.equal(ephemeralStore.current().apiKey, 'EPHEMERAL_AFTER_UNCHECK');
  assert.equal((await createSettingsStore(ephemeralPath, cipher)).view().keyPresent, false);

  // ===== T1: versioned shell preferences and non-overlapping migration =====
{
  const shellPath = path.join(temporaryDirectory, 'shell-settings.json');
  const shellStore = await createShellSettingsStore(shellPath);
  assert.equal(shellStore.view().shortcut, 'CommandOrControl+Shift+Space');
  await shellStore.saveShortcut('Control+Alt+E');
  await shellStore.saveBounds({ x: -1200, y: 12, width: 1040, height: 820 });
  const savedShell = JSON.parse(await readConfig('shell-settings.json'));
  assert.equal(savedShell.schemaVersion, 1);
  assert.equal(savedShell.shortcut, 'Control+Alt+E');
  assert.equal(savedShell.windowBounds.x, -1200);
  const reloadedShell = await createShellSettingsStore(shellPath);
  assert.equal(reloadedShell.view().shortcut, 'Control+Alt+E');
  assert.equal(reloadedShell.view().windowBounds.x, -1200);
  await writeConfig('broken-shell.json', '{bad');
  const brokenShell = await createShellSettingsStore(path.join(temporaryDirectory, 'broken-shell.json'));
  assert.ok(brokenShell.view().warning);
  await assert.rejects(brokenShell.saveShortcut('Control+F8'));
  assert.equal(await readConfig('broken-shell.json'), '{bad');
  assert.equal(JSON.parse(await readConfig('settings.json')).model, 'deepseek-chat', 'shell changes must not overwrite model settings');
}

// ===== ITEM 1: undecryptable stored key must survive unrelated saves =====
  {
    const path1 = path.join(temporaryDirectory, 'undecryptable.json');
    const good = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(`encrypted:${t}`), decryptString: (b) => b.toString().replace(/^encrypted:/u, '') };
    const writer = await createSettingsStore(path1, good);
    await writer.save({ ...settings, apiKey: 'LOST_IF_OVERWRITTEN', rememberKey: true });
    const originalBlob = JSON.parse(await readConfig('undecryptable.json')).encryptedKey;
    assert.ok(originalBlob);
    // New store whose cipher cannot decrypt, but whose encrypt would produce a DIFFERENT blob.
    const badDecrypt = { isEncryptionAvailable: () => true, encryptString: () => Buffer.from('encrypted:BRAND_NEW'), decryptString: () => { throw new Error('nope'); } };
    const broken = await createSettingsStore(path1, badDecrypt);
    assert.equal(broken.view().keyPresent, false);
    assert.equal(broken.view().keyUnusable, true);
    assert.ok(broken.view().keyWarning.includes('无法使用') || broken.view().keyWarning.includes('无法解密'));
    // Saving an unrelated setting (no apiKey, no forget, same endpoint) must keep the original blob.
    await broken.save({ ...settings, model: 'changed-model', rememberKey: true });
    const after = JSON.parse(await readConfig('undecryptable.json'));
    assert.equal(after.encryptedKey, originalBlob, 'undecryptable ciphertext must be preserved on unrelated save');
    assert.equal(after.model, 'changed-model');
    assert.equal(after.schemaVersion, SCHEMA_VERSION);
    assert.equal(broken.view().keyUnusable, true);
    assert.ok(broken.view().keyWarning.includes('原密文已保留'));
    // Explicitly disabling persistence or forgetting removes the stored ciphertext.
    await broken.save({ ...settings, model: 'changed-model', rememberKey: false });
    let afterUncheck = JSON.parse(await readConfig('undecryptable.json'));
    assert.equal(afterUncheck.encryptedKey, undefined, 'unchecking rememberKey must remove ciphertext');
    assert.equal(afterUncheck.rememberKey, false);
    await broken.save({ ...settings, model: 'changed-model', apiKey: 'NEW_KEY', rememberKey: true });
    assert.ok(JSON.parse(await readConfig('undecryptable.json')).encryptedKey, 'new remembered key is stored');
    await broken.save({ ...settings, model: 'changed-model', forgetKey: true, rememberKey: false });
    assert.equal(JSON.parse(await readConfig('undecryptable.json')).encryptedKey, undefined, 'forgetKey must remove ciphertext');
    // Successful replacement with a new key overwrites with a fresh blob.
    await broken.save({ ...settings, model: 'changed-model', apiKey: 'NEW_KEY', rememberKey: true });
    const replaced = JSON.parse(await readConfig('undecryptable.json'));
    assert.equal(replaced.encryptedKey, Buffer.from('encrypted:BRAND_NEW').toString('base64'));
    // Endpoint/provider change drops the old ciphertext (existing safety rule).
    const path2 = path.join(temporaryDirectory, 'endpoint-change.json');
    const enc = await createSettingsStore(path2, good);
    await enc.save({ ...settings, apiKey: 'TO_BE_DROPPED', rememberKey: true });
    const dropped = await createSettingsStore(path2, badDecrypt);
    await dropped.save({ ...settings, baseUrl: 'https://other.example/v1', model: 'changed-model' });
    assert.equal(JSON.parse(await readConfig('endpoint-change.json')).encryptedKey, undefined, 'endpoint change must drop old ciphertext');
  }

  // ===== ITEM 2: secure storage unavailable must not delete existing ciphertext =====
  {
    const path2 = path.join(temporaryDirectory, 'storage-unavailable.json');
    const good = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(`encrypted:${t}`), decryptString: (b) => b.toString().replace(/^encrypted:/u, '') };
    const writer = await createSettingsStore(path2, good);
    await writer.save({ ...settings, apiKey: 'KEEP_ME', rememberKey: true });
    const blob = JSON.parse(await readConfig('storage-unavailable.json')).encryptedKey;
    assert.ok(blob);
    // Now secure storage is unavailable (like browser mode with cipher undefined).
    const unavailable = await createSettingsStore(path2, undefined);
    assert.equal(unavailable.view().keyPresent, false);
    assert.equal(unavailable.view().keyUnusable, true);
    assert.ok(unavailable.view().keyWarning);
    assert.equal(unavailable.view().apiKey, undefined, 'never expose plaintext key');
    // Save unrelated settings. The remembered state and ciphertext must survive,
    // and the unusable-key warning remains visible to the user.
    await unavailable.save({ ...settings, model: 'unrelated', rememberKey: true });
    let after = JSON.parse(await readConfig('storage-unavailable.json'));
    assert.equal(after.encryptedKey, blob, 'unavailable storage must keep the encrypted blob');
    assert.equal(after.rememberKey, true);
    assert.equal(after.model, 'unrelated');
    assert.equal(unavailable.view().keyUnusable, true);
    assert.ok(unavailable.view().keyWarning.includes('原密文已保留'));
    assert.ok(!(await readConfig('storage-unavailable.json')).includes('KEEP_ME'), 'no plaintext ever');
    assert.equal((await createSettingsStore(path2, good)).current().apiKey, 'KEEP_ME', 'restoring secure storage must restore the remembered key');
    // Explicitly unchecking rememberKey drops the persistent ciphertext.
    await unavailable.save({ ...settings, model: 'unrelated', rememberKey: false });
    after = JSON.parse(await readConfig('storage-unavailable.json'));
    assert.equal(after.encryptedKey, undefined);
    assert.equal(after.rememberKey, false);
  }

  // ===== ITEM 3/6: recovery is explicit, backs up first, future requires warning =====
  {
    // corrupt file -> recoverable, backup created, original preserved byte-for-byte in backup
    await writeConfig('corrupt.json', '{"provider": "openai", "model": ');
    const corruptBytes = await readConfigBytes('corrupt.json');
    const corruptStore = await createSettingsStore(path.join(temporaryDirectory, 'corrupt.json'), cipher);
    assert.equal(corruptStore.view().readStatus.status, 'corrupt');
    assert.equal(corruptStore.view().recovery.recoverable, true);
    assert.equal(corruptStore.view().recovery.losesUnknownData, false);
    // Normal save blocked, no backup yet, original untouched.
    await assert.rejects(corruptStore.save({ ...settings, model: 'should-not-write' }), { code: 'settings-protected' });
    assert.deepEqual(await readConfigBytes('corrupt.json'), corruptBytes);
    // Explicit reset succeeds and leaves a byte-identical backup.
    const rebuilt = await corruptStore.save({ ...settings, model: 'explicit-rebuild', reset: true });
    assert.equal(rebuilt.readStatus.status, 'current');
    assert.equal(rebuilt.recovered, true, 'reset must report successful recovery without returning a path');
    const backups = (await readdir(temporaryDirectory)).filter((name) => name.startsWith('corrupt.json.backup-'));
    assert.equal(backups.length, 1, 'exactly one backup expected');
    assert.deepEqual(await readFile(path.join(temporaryDirectory, backups[0])), corruptBytes, 'backup must equal original bytes');
    assert.equal(rebuilt.recovered, true);
    assert.equal(Object.hasOwn(rebuilt, 'recoveredFromBackup'), false, 'absolute backup path must not leave the settings store');
    assert.equal(JSON.parse(await readConfig('corrupt.json')).model, 'explicit-rebuild');

    // If backup cannot be created (source vanished between load and reset), reset must
    // be blocked so the only copy cannot be lost, and the target must stay untouched.
    await writeConfig('backupfail.json', '{bad json');
    const bfStore = await createSettingsStore(path.join(temporaryDirectory, 'backupfail.json'), cipher);
    assert.equal(bfStore.view().recovery.recoverable, true);
    await rm(path.join(temporaryDirectory, 'backupfail.json'), { force: true });
    await mkdir(path.join(temporaryDirectory, 'backupfail.json')); // make it un-openable as a file
    await assert.rejects(bfStore.save({ ...settings, model: 'never', reset: true }), { code: 'recovery-backup-failed' });
    assert.equal(bfStore.view().readStatus.status, 'corrupt', 'state unchanged when backup fails');

    // A normal save with no reset never writes to a protected file (reset is not implicit).
    await writeConfig('implicit.json', 'not json');
    const implicitBytes = await readConfigBytes('implicit.json');
    const implicitStore = await createSettingsStore(path.join(temporaryDirectory, 'implicit.json'), cipher);
    await assert.rejects(implicitStore.save({ ...settings, model: 'x' }), { code: 'settings-protected' });
    assert.deepEqual(await readConfigBytes('implicit.json'), implicitBytes, 'no implicit reset on normal save');
    assert.equal((await readdir(temporaryDirectory)).filter((n) => n.startsWith('implicit.json.backup-')).length, 0, 'no backup created for a blocked normal save');

    // future version: recoverable only with explicit confirmation, losesUnknownData flagged,
    // default read does not decrypt and normal save does not downgrade.
    await writeConfig('future.json', JSON.stringify({ schemaVersion: SCHEMA_VERSION + 5, provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'future-model', encryptedKey: 'FUTURE_BLOB', futureOnlyField: { keep: true } }));
    const futureBytes = await readConfigBytes('future.json');
    const futureStore = await createSettingsStore(path.join(temporaryDirectory, 'future.json'), cipher);
    assert.equal(futureStore.view().readStatus.status, 'future');
    assert.equal(futureStore.view().readStatus.version, SCHEMA_VERSION + 5);
    assert.equal(futureStore.view().recovery.recoverable, true);
    assert.equal(futureStore.view().recovery.losesUnknownData, true);
    assert.equal(futureStore.view().keyPresent, false, 'must not attempt to decrypt unknown structure');
    await assert.rejects(futureStore.save({ ...settings, model: 'downgrade' }), { code: 'settings-protected' });
    assert.deepEqual(await readConfigBytes('future.json'), futureBytes, 'future file must not be downgraded by a normal save');
    const futureRebuilt = await futureStore.save({ ...settings, model: 'explicit-future-rebuild', reset: true });
    assert.equal(futureRebuilt.recovered, true);
    const futureBackups = (await readdir(temporaryDirectory)).filter((name) => name.startsWith('future.json.backup-'));
    assert.equal(futureBackups.length, 1);
    assert.deepEqual(await readFile(path.join(temporaryDirectory, futureBackups[0])), futureBytes, 'future backup must equal original bytes incl. unknown fields');
    assert.equal(futureRebuilt.recovered, true);
    assert.equal(Object.hasOwn(futureRebuilt, 'recoveredFromBackup'), false, 'future backup path must not be returned');

    // A partial backup write fails without publishing a final backup or leaving a temp file.
    await writeConfig('partial-backup.json', '{bad json');
    const partialStore = await createSettingsStore(path.join(temporaryDirectory, 'partial-backup.json'), cipher, {
      open, mkdir, stat, unlink,
      writeFile: async (target, data, options) => {
        if (target.includes('.backup-') && target.endsWith('.tmp')) {
          await writeFile(target, data.subarray(0, Math.max(1, Math.floor(data.length / 2))), options);
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        }
        return writeFile(target, data, options);
      },
      rename,
    });
    await assert.rejects(partialStore.save({ ...settings, reset: true }), { code: 'recovery-backup-failed' });
    const partialNames = await readdir(temporaryDirectory);
    assert.equal(partialNames.some((name) => name.startsWith('partial-backup.json.backup-')), false, 'partial backup must not appear as final');
    assert.equal(partialNames.some((name) => name.startsWith('partial-backup.json.backup-') && name.endsWith('.tmp')), false, 'partial temp backup must be cleaned');
    assert.equal(await readConfig('partial-backup.json'), '{bad json', 'failed backup must preserve original');

    // Failed backup publication must not overwrite the source and can be retried.
    await writeConfig('rename-backup.json', '{bad json');
    let backupRenameFails = true;
    const backupRenameStore = await createSettingsStore(path.join(temporaryDirectory, 'rename-backup.json'), cipher, {
      open, mkdir, stat, unlink, writeFile,
      rename: async (from, to) => {
        if (backupRenameFails && to.includes('.backup-')) throw Object.assign(new Error('blocked'), { code: 'EPERM' });
        return rename(from, to);
      },
    });
    await assert.rejects(backupRenameStore.save({ ...settings, reset: true }), { code: 'recovery-backup-failed' });
    assert.equal(await readConfig('rename-backup.json'), '{bad json');
    assert.equal((await readdir(temporaryDirectory)).some((name) => name.startsWith('rename-backup.json.backup-')), false);
    backupRenameFails = false;
    const backupRetry = await backupRenameStore.save({ ...settings, reset: true });
    assert.equal(backupRetry.recovered, true);
    assert.ok(!JSON.stringify(backupRetry).includes(temporaryDirectory), 'public recovery result must not contain local paths');

    // Non-object / scalar JSON is corrupt.
    await writeConfig('scalar.json', '"just a string"');
    assert.equal((await createSettingsStore(path.join(temporaryDirectory, 'scalar.json'), cipher)).view().readStatus.status, 'corrupt');
  }

  // ===== ITEM 4: bounded read must not load beyond MAX even if file grows =====
  {
    // Oversized file is classified too-large and preserved.
    await writeConfig('huge.json', '{"padding":"' + 'x'.repeat(70000) + '"}');
    const hugeBefore = await readConfig('huge.json');
    const hugeStore = await createSettingsStore(path.join(temporaryDirectory, 'huge.json'), cipher);
    assert.equal(hugeStore.view().readStatus.status, 'too-large');
    // An oversized file cannot be backed up in-process, so no in-app recovery is offered.
    assert.equal(hugeStore.view().recovery.recoverable, false);
    assert.equal(hugeStore.view().recovery.manualOnly, true);
    await assert.rejects(hugeStore.save({ ...settings }), { code: 'settings-protected' });
    // Forcing a reset on an oversized file is blocked because it cannot be backed up.
    await assert.rejects(hugeStore.save({ ...settings, reset: true }), { code: 'recovery-backup-failed' });
    assert.equal(await readConfig('huge.json'), hugeBefore, 'oversized file must be preserved');

    // A file that GROWS during read (simulated via an IO seam) must still be bounded:
    // the store must never accept it as valid; read bytes are capped near the limit.
    let maxRead = 0;
    const growIo = {
      async open(p, flags) {
        const handle = await open(p, flags);
        return {
          async stat() { const s = await handle.stat(); return { ...s, isFile: () => true, size: 90000 }; },
          async read(buffer, offset, length, position) {
            const r = await handle.read(buffer, offset, length, position);
            maxRead = Math.max(maxRead, offset + r.bytesRead);
            return r;
          },
          close: () => handle.close(),
        };
      },
      mkdir, rename, stat, unlink, writeFile,
    };
    await writeConfig('growing.json', JSON.stringify({ schemaVersion: SCHEMA_VERSION, provider: 'openai', baseUrl: 'https://api.deepseek.com', model: 'grown' }));
    const growStore = await createSettingsStore(path.join(temporaryDirectory, 'growing.json'), cipher, growIo);
    assert.equal(growStore.view().readStatus.status, 'too-large', 'a file reporting oversize size must be treated as too-large');
    assert.ok(maxRead <= 65537, `bounded read must not exceed limit (read ${maxRead})`);
  }

  // ===== ITEM 5: write/rename failure keeps old file + memory; same store retries =====
  {
    const path5 = path.join(temporaryDirectory, 'io-fail.json');
    const store5 = await createSettingsStore(path5, cipher);
    await store5.save({ ...settings, model: 'committed-model', apiKey: 'COMMITTED_KEY', rememberKey: true });
    const goodBytes = await readConfigBytes('io-fail.json');
    const goodMemoryModel = store5.view().model;

    // (a) writeFile of the temp file fails.
    let writeFailIo = { open, mkdir, rename, stat, unlink, writeFile: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
    // Rebuild store over same path so it points at the same file but uses the failing IO.
    const store5b = await createSettingsStore(path5, cipher, writeFailIo);
    assert.equal(store5b.view().model, 'committed-model');
    await assert.rejects(store5b.save({ ...settings, model: 'not-committed', apiKey: 'NEWKEY', rememberKey: true }));
    assert.notEqual(store5b.view().model, 'not-committed', 'memory must not update on write failure');
    assert.equal(store5b.view().keyPresent, true, 'previously loaded key remains; failed new key must not commit');
    assert.deepEqual(await readConfigBytes('io-fail.json'), goodBytes, 'old file unchanged on write failure');
    // No temp files left behind.
    assert.equal((await readdir(temporaryDirectory)).filter((n) => n.includes('.prompt-enhancer-') && n.endsWith('.tmp')).length, 0, 'temp file must be cleaned up');

    // (b) rename fails after a successful temp write — same store, same instance retries.
    let renameFail = true;
    const renameIo = { open, mkdir, unlink, writeFile, stat, rename: async (from, to) => { if (renameFail) { const e = Object.assign(new Error('rename blocked'), { code: 'EPERM' }); throw e; } return rename(from, to); } };
    const store5c = await createSettingsStore(path5, cipher, renameIo);
    await assert.rejects(store5c.save({ ...settings, model: 'rename-fail-model' }));
    assert.notEqual(store5c.view().model, 'rename-fail-model', 'memory must not update on rename failure');
    assert.deepEqual(await readConfigBytes('io-fail.json'), goodBytes, 'old file unchanged on rename failure');
    assert.equal((await readdir(temporaryDirectory)).filter((n) => n.includes('.prompt-enhancer-') && n.endsWith('.tmp')).length, 0, 'temp file cleaned after rename failure');
    // Retry on the SAME store instance now that rename works.
    renameFail = false;
    await store5c.save({ ...settings, model: 'retry-succeeded' });
    assert.equal(store5c.view().model, 'retry-succeeded');
    assert.equal(JSON.parse(await readConfig('io-fail.json')).model, 'retry-succeeded', 'same store retry writes successfully');
  }

  // ===== preserved existing behaviors =====
  {
    // Migrations reentrant: re-reading current -> current.
    assert.equal((await createSettingsStore(configPath, cipher)).view().readStatus.status, 'current');
    // Invalid schemaVersion field.
    await writeConfig('badversion.json', JSON.stringify({ schemaVersion: 'two', model: 'x' }));
    assert.equal((await createSettingsStore(path.join(temporaryDirectory, 'badversion.json'), cipher)).view().readStatus.status, 'invalid');
    // Invalid fields with valid JSON envelope: invalid and preserved.
    await writeConfig('badfields.json', JSON.stringify({ schemaVersion: SCHEMA_VERSION, provider: 'openai', baseUrl: 'http://example.com/v1', model: 'ok' }));
    const badFieldsStore = await createSettingsStore(path.join(temporaryDirectory, 'badfields.json'), cipher);
    assert.equal(badFieldsStore.view().readStatus.status, 'invalid');
    assert.equal(badFieldsStore.view().baseUrl, DEFAULT_BASE_URL);
    // basic_text storage is treated as unavailable for remembering.
    assert.equal(secureStorageAvailable({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }), false);
    await assert.rejects((await createSettingsStore(path.join(temporaryDirectory, 'basictext.json'), { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text', encryptString: (t) => Buffer.from(t), decryptString: (b) => b.toString() })).save({ ...settings, apiKey: 'X', rememberKey: true }), { code: 'secure-storage-unavailable' });
  }

  // ===== ITEM 3: recovery signal surfaces through the same view used by init =====
  {
    await writeConfig('recoverable-init.json', 'not json at all');
    const initStore = await createSettingsStore(path.join(temporaryDirectory, 'recoverable-init.json'), cipher);
    const view = initStore.view();
    assert.equal(view.recovery.recoverable, true);
    assert.equal(view.recovery.backupFirst, true);
    // Recovery info must be non-sensitive (no ciphertext, no key).
    assert.ok(!JSON.stringify(view.recovery).includes('encryptedKey'));
    // A healthy store exposes no recovery.
    assert.equal((await createSettingsStore(configPath, cipher)).view().recovery.recoverable, false);
  }

  // No public view / error text / file leaks any plaintext key.
  for (const name of ['settings.json', 'corrupt.json', 'future.json', 'undecryptable.json', 'storage-unavailable.json', 'io-fail.json']) {
    const text = await readConfig(name);
    assert.ok(!/KEEP_ME|SAVED_SECRET|SESSION_SECRET|FORGET_ME|LOST_IF_OVERWRITTEN|COMMITTED_KEY|TO_BE_DROPPED|NEW_KEY/.test(text), `${name} must not contain plaintext keys`);
  }
} finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
const htmlSource = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const rendererSource = await readFile(new URL('./renderer.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('./main.mjs', import.meta.url), 'utf8');
const elementIds = new Set([...htmlSource.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]));
for (const reference of rendererSource.matchAll(/elements\.([a-zA-Z][a-zA-Z0-9]*)/gu)) assert.ok(elementIds.has(reference[1]), `Missing control ${reference[1]}`);
assert.ok(rendererSource.includes('elements.result.readOnly = busy'));
assert.ok(mainSource.includes('shell.hide()'));
assert.ok(mainSource.includes('trayAvailable: () => Boolean(tray && !tray.isDestroyed())'));
assert.ok(mainSource.includes('contextIsolation: true, nodeIntegration: false, sandbox: true'));
assert.ok(!mainSource.includes('--no-sandbox'));
assert.ok(htmlSource.includes("connect-src 'none'"));
assert.ok(htmlSource.includes('id="level"'));
assert.ok(rendererSource.includes('level: elements.level.value'));
assert.ok(rendererSource.includes('result.level'));
assert.ok(!rendererSource.includes('innerHTML'));
// Recovery UI wiring (item 3): elements exist and reset is only attached from the
// visible confirmation checkbox, never unconditionally.
for (const id of ['recovery', 'recoveryHint', 'confirmRecovery']) assert.ok(elementIds.has(id), `Missing recovery control ${id}`);
assert.ok(rendererSource.includes('elements.confirmRecovery.checked === true'), 'reset must be gated on the visible confirmation');
assert.ok(rendererSource.includes('...(reset ? { reset: true } : {})'), 'reset must be conditionally attached');
assert.ok(rendererSource.includes('settings.recovery'), 'renderer must read recovery state from init');
assert.ok(!rendererSource.includes('recoveredFromBackup'), 'renderer must not receive/display an absolute backup path');
assert.ok(rendererSource.includes('settings.recovered ?'), 'renderer should show only a generic backup confirmation');
console.log('Desktop tests passed: API adapters, completion guards, cancellation, HTTPS/redirect safety, isolated configuration, encrypted/ephemeral keys, ciphertext retention, explicit recovery with backup, bounded reads, injectable IO failure/retry and source wiring. No visual rendering is claimed.');
