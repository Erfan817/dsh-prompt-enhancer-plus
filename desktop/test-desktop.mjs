import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildProviderCall, endpointFor, enhanceWithProvider } from './provider.mjs';
import { createSettingsStore, normalizeSettings, secureStorageAvailable } from './settings.mjs';

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
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'prompt-enhancer-tests-'));
try {
  const configPath = path.join(temporaryDirectory, 'settings.json');
  const store = await createSettingsStore(configPath, cipher);
  assert.equal(store.view().keyPresent, false);
  await store.save({ ...settings, apiKey: 'SESSION_SECRET', rememberKey: false, direction: 'DIRECTION_ONLY' });
  assert.equal(store.view().keyPresent, true);
  assert.equal(store.view().apiKey, undefined);
  assert.ok(!(await readFile(configPath, 'utf8')).includes('SESSION_SECRET'));
  assert.equal((await createSettingsStore(configPath, cipher)).view().keyPresent, false);
  await store.save({ ...settings, apiKey: 'SAVED_SECRET', rememberKey: true });
  const storedText = await readFile(configPath, 'utf8');
  assert.ok(!storedText.includes('SAVED_SECRET'));
  assert.ok(JSON.parse(storedText).encryptedKey);
  const restored = await createSettingsStore(configPath, cipher);
  assert.equal(restored.current().apiKey, 'SAVED_SECRET');
  assert.equal(restored.view().keyPresent, true);
  const unavailable = await createSettingsStore(configPath, { isEncryptionAvailable: () => false });
  assert.equal(unavailable.view().keyPresent, false);
  assert.ok(unavailable.view().keyWarning);
  await assert.rejects(unavailable.save({ ...settings, rememberKey: true }), { code: 'secure-storage-unavailable' });
  await restored.save({ ...settings, baseUrl: 'https://different-provider.example/v1', rememberKey: true });
  assert.equal(restored.view().keyPresent, false);
  await restored.save({ ...settings, apiKey: 'FORGET_ME', rememberKey: true });
  await restored.save({ ...settings, forgetKey: true, rememberKey: false });
  assert.equal(restored.view().keyPresent, false);
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).encryptedKey, undefined);
  await Promise.all([
    restored.save({ ...settings, model: 'first-model' }),
    restored.save({ ...settings, model: 'second-model' }),
  ]);
  assert.equal(restored.view().model, 'second-model');
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).model, 'second-model');
  const directoryTarget = path.join(temporaryDirectory, 'not-a-file');
  await mkdir(directoryTarget);
  const failed = await createSettingsStore(directoryTarget, cipher);
  await assert.rejects(failed.save({ ...settings, model: 'not-saved', apiKey: 'NOT_COMMITTED' }));
  assert.notEqual(failed.view().model, 'not-saved');
  assert.equal(failed.view().keyPresent, false);
} finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
const htmlSource = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const rendererSource = await readFile(new URL('./renderer.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('./main.mjs', import.meta.url), 'utf8');
const elementIds = new Set([...htmlSource.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]));
for (const reference of rendererSource.matchAll(/elements\.([a-zA-Z][a-zA-Z0-9]*)/gu)) assert.ok(elementIds.has(reference[1]), `Missing control ${reference[1]}`);
assert.ok(rendererSource.includes('elements.result.readOnly = busy'));
assert.ok(mainSource.includes('else window.minimize()'));
assert.ok(mainSource.includes('contextIsolation: true, nodeIntegration: false, sandbox: true'));
assert.ok(!mainSource.includes('--no-sandbox'));
assert.ok(htmlSource.includes("connect-src 'none'"));
assert.ok(htmlSource.includes('id="level"'));
assert.ok(rendererSource.includes('level: elements.level.value'));
assert.ok(rendererSource.includes('result.level'));
assert.ok(!rendererSource.includes('innerHTML'));
console.log('Desktop tests passed: API adapters, completion guards, cancellation, HTTPS/redirect safety, isolated configuration, encrypted/ephemeral keys, write failures and source wiring. No visual rendering is claimed.');
