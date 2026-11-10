import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCompanionServer } from './server.mjs';

const fixtures = [];
const modelSettings = { provider: 'openai', baseUrl: 'https://models.example.test/v1', model: 'test-model', rememberKey: false };
const completion = (text = '请清楚自然地说明目标，保留 C#、*.js 和 #release。', finish = 'stop') => ({ choices: [{ message: { content: text }, finish_reason: finish }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'prompt-enhancer-server-tests-'));
  const configPath = path.join(directory, 'settings.json');
  const { withSession = false, ...serverOptions } = options;
  const sessionPath = withSession ? path.join(directory, 'state', 'session.json') : undefined;
  const server = await createCompanionServer({
    configPath,
    ...(sessionPath === undefined ? {} : { sessionPath }),
    fetchImpl: async () => json(completion()),
    ...serverOptions,
  });
  const value = {
    ...server, directory, configPath, sessionPath,
    headers: () => ({ origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }),
    async api(action, body = {}, overrides = {}) {
      const response = await fetch(`${server.origin}/api/${action}`, {
        method: 'POST', headers: { ...value.headers(), ...overrides.headers }, body: overrides.rawBody ?? JSON.stringify(body), signal: overrides.signal,
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
  };
  fixtures.push(value);
  return value;
}

function rawRequest(server, { method = 'GET', target = '/', headers = {}, chunks = [] } = {}) {
  const address = new URL(server.origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: address.port, method, path: target, headers: { host: address.host, ...headers } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, headers: response.headers, text, body: response.headers['content-type']?.includes('application/json') ? JSON.parse(text) : undefined });
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

function assertSecurityHeaders(headers) {
  const header = (name) => headers instanceof Headers ? headers.get(name) : headers[name];
  assert.equal(header('access-control-allow-origin') ?? undefined, undefined);
  assert.equal(header('access-control-allow-credentials') ?? undefined, undefined);
  assert.equal(header('cache-control'), 'no-store');
  assert.equal(header('x-content-type-options'), 'nosniff');
  assert.equal(header('x-frame-options'), 'DENY');
  assert.equal(header('cross-origin-resource-policy'), 'same-origin');
  assert.match(header('content-security-policy'), /frame-ancestors 'none'/u);
  assert.match(header('content-security-policy'), /object-src 'none'; base-uri 'none'; form-action 'none'/u);
}

let passed = 0;
async function test(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`ok - ${name}`);
  } finally {
    for (const server of fixtures.splice(0).reverse()) {
      await server.close();
      assert.ok(path.basename(server.directory).startsWith('prompt-enhancer-server-tests-'));
      assert.equal(path.dirname(server.directory), path.resolve(tmpdir()));
      await rm(server.directory, { recursive: true, force: true });
    }
  }
}

await test('the server requires an explicit config path and exposes a random loopback origin and nonce', async () => {
  await assert.rejects(createCompanionServer(), /configPath/u);
  await assert.rejects(createCompanionServer({ configPath: '' }), /configPath/u);
  const first = await fixture();
  const second = await fixture();
  assert.match(first.origin, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/u);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.origin, second.origin);
  const initialized = await first.api('init');
  assert.equal(initialized.status, 200);
  assert.equal(initialized.body.ok, true);
  assert.equal(initialized.body.value.runtime, 'browser');
  assert.equal(initialized.body.value.shortcutAvailable, false);
  assert.equal(initialized.body.value.personas.length, 5);
  assert.deepEqual(Object.keys(initialized.body.value.personas[0]).sort(), ['id', 'name']);
  assert.equal(initialized.body.value.settings.canRememberKey, false);
  assert.equal(initialized.body.value.settings.keyPresent, false);
  assert.equal(initialized.body.value.settings.apiKey, undefined);
  assertSecurityHeaders(initialized.headers);
});

await test('static assets use an exact whitelist, secure headers and fixed bridge injection', async () => {
  const server = await fixture();
  const page = await rawRequest(server);
  assert.equal(page.status, 200);
  assertSecurityHeaders(page.headers);
  assert.match(page.text, /connect-src 'self'/u);
  assert.doesNotMatch(page.text, /connect-src 'none'/u);
  assert.match(page.text, /<script src="\/bridge\.js"><\/script>\s*<script[^>]*src="renderer\.js"/u);
  assert.ok(page.text.indexOf('/bridge.js') < page.text.indexOf('src="renderer.js"'));
  const bridge = await rawRequest(server, { target: '/bridge.js' });
  assert.equal(bridge.status, 200);
  assert.match(bridge.headers['content-type'], /^text\/javascript/u);
  assert.ok(bridge.text.includes(JSON.stringify(server.token)));
  assert.ok(!bridge.text.includes('__BRIDGE_TOKEN__'));
  assertSecurityHeaders(bridge.headers);
  for (const target of ['/renderer.js', '/styles.css']) {
    const response = await rawRequest(server, { target });
    assert.equal(response.status, 200);
    assertSecurityHeaders(response.headers);
    assert.ok(response.text.length > 100);
  }
  const head = await rawRequest(server, { method: 'HEAD', target: '/bridge.js' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  for (const target of ['/settings.mjs', '/server.mjs', '/provider.mjs', '/settings.json', '/index.html', '/../personas.js', '/%2e%2e/settings.json', '/..%2fsettings.mjs', '/bridge.js?key=anything']) {
    const response = await rawRequest(server, { target });
    assert.equal(response.status, 404, target);
    assert.equal(response.body.ok, false);
    assert.ok(!response.text.includes(server.token));
    assertSecurityHeaders(response.headers);
  }
});

await test('Host, Origin and random Bearer credentials all reject rebinding and cross-site requests without CORS', async () => {
  const server = await fixture();
  const host = new URL(server.origin).host;
  const attacks = [
    { host: `localhost:${new URL(server.origin).port}`, origin: server.origin, authorization: `Bearer ${server.token}` },
    { host: 'attacker.example', origin: server.origin, authorization: `Bearer ${server.token}` },
    { host: '127.0.0.1', origin: server.origin, authorization: `Bearer ${server.token}` },
    { host, authorization: `Bearer ${server.token}` },
    { host, origin: 'null', authorization: `Bearer ${server.token}` },
    { host, origin: 'https://attacker.example', authorization: `Bearer ${server.token}` },
    { host, origin: server.origin },
    { host, origin: server.origin, authorization: 'Bearer not-the-token' },
  ];
  for (const headers of attacks) {
    const response = await rawRequest(server, { method: 'POST', target: '/api/init', headers, chunks: ['{}'] });
    assert.ok(response.status === 401 || response.status === 403);
    assert.equal(response.body.ok, false);
    assertSecurityHeaders(response.headers);
    assert.ok(!response.text.includes(server.token));
  }
  for (const site of ['cross-site', 'same-site']) {
    const blocked = await rawRequest(server, { target: '/bridge.js', headers: { 'sec-fetch-site': site, 'sec-fetch-dest': 'script' } });
    assert.equal(blocked.status, 403);
    assert.ok(!blocked.text.includes(server.token));
    assertSecurityHeaders(blocked.headers);
  }
  const foreignStatic = await rawRequest(server, { target: '/bridge.js', headers: { origin: 'https://attacker.example' } });
  assert.equal(foreignStatic.status, 403);
  const options = await rawRequest(server, { method: 'OPTIONS', target: '/api/init', headers: server.headers() });
  assert.equal(options.status, 405);
  assertSecurityHeaders(options.headers);
  assert.equal((await rawRequest(server, { target: '/api/init' })).status, 405);
  for (const action of ['copy', 'hide', 'pin', 'fullscreen', 'ready', 'not-an-action']) assert.equal((await server.api(action)).status, 404);
});

await test('JSON shape, malformed bodies, unsupported encodings and both declared and streamed size limits are controlled', async () => {
  const server = await fixture();
  for (const rawBody of ['{', 'null', '[]', '123', '"text"']) {
    const response = await server.api('settings', {}, { rawBody });
    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
  }
  const media = await server.api('init', {}, { headers: { 'content-type': 'text/plain' } });
  assert.equal(media.status, 415);
  const encoding = await server.api('init', {}, { headers: { 'content-encoding': 'gzip' } });
  assert.equal(encoding.status, 415);
  const declared = await server.api('settings', { direction: 'x'.repeat(96 * 1024) });
  assert.equal(declared.status, 413);
  assert.equal(declared.body.error.code, 'body-too-large');
  const streamed = await rawRequest(server, { method: 'POST', target: '/api/settings', headers: server.headers(), chunks: ['{"direction":"', 'x'.repeat(96 * 1024), '"}'] });
  assert.equal(streamed.status, 413);
  assert.equal(streamed.body.error.code, 'body-too-large');
  const empty = await rawRequest(server, { method: 'POST', target: '/api/init', headers: server.headers() });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.ok, true);
});

await test('settings expose only key presence and never persist an API key in browser mode', async () => {
  const secret = 'SESSION_ONLY_SECRET_DO_NOT_RETURN';
  let captured;
  const server = await fixture({ fetchImpl: async (_address, options) => { captured = options; return json(completion()); } });
  const saved = await server.api('settings', { ...modelSettings, apiKey: secret, direction: 'REUSABLE_DIRECTION' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.value.keyPresent, true);
  assert.equal(saved.body.value.canRememberKey, false);
  assert.ok(!JSON.stringify(saved.body).includes(secret));
  const stored = await readFile(server.configPath, 'utf8');
  assert.ok(!stored.includes(secret));
  assert.equal(JSON.parse(stored).encryptedKey, undefined);
  assert.equal(JSON.parse(stored).apiKey, undefined);
  assert.equal(JSON.parse(stored).direction, 'REUSABLE_DIRECTION');
  assert.ok(!JSON.stringify((await server.api('init')).body).includes(secret));
  const generated = await server.api('generate', { text: 'PRIVATE_TASK', personaId: 'builtin:balanced' });
  assert.equal(generated.body.ok, true);
  assert.equal(captured.headers.authorization, `Bearer ${secret}`);
  assert.ok(!JSON.stringify(generated.body).includes(secret));
  assert.ok(!(await readFile(server.configPath, 'utf8')).includes('PRIVATE_TASK'));
  const remember = await server.api('settings', { ...modelSettings, rememberKey: true, apiKey: secret });
  assert.equal(remember.body.ok, false);
  assert.equal(remember.body.error.code, 'secure-storage-unavailable');
  const reopened = await createCompanionServer({ configPath: server.configPath, fetchImpl: async () => json(completion()) });
  try {
    const response = await fetch(`${reopened.origin}/api/init`, { method: 'POST', headers: { origin: reopened.origin, authorization: `Bearer ${reopened.token}`, 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await response.json()).value.settings.keyPresent, false);
  } finally { await reopened.close(); }
  const changed = await server.api('settings', { ...modelSettings, baseUrl: 'https://different.example.test/v1' });
  assert.equal(changed.body.value.keyPresent, false);
});

await test('generation shares format rules and only accepts builtin or bounded custom persona directions', async () => {
  const calls = [];
  const output = '## Goal\n\n**Direction**\n\n保留 C#、*.js 和 #release。';
  const server = await fixture({ fetchImpl: async (address, options) => { calls.push({ address, options, payload: JSON.parse(options.body) }); return json(completion(output)); } });
  await server.api('settings', modelSettings);
  const plain = await server.api('generate', { text: '说明需求。', personaId: 'builtin:writing', persona: { instructions: 'ARBITRARY_PERSONA_INJECTION' } });
  assert.equal(plain.body.ok, true);
  assert.equal(plain.body.value.format, 'plain');
  assert.equal(plain.body.value.enhanced, 'Goal\n\nDirection\n\n保留 C#、*.js 和 #release。');
  assert.equal(plain.body.value.usage.totalTokens, 50);
  assert.match(calls[0].payload.messages[0].content, /writing coach/u);
  assert.doesNotMatch(calls[0].payload.messages[0].content, /ARBITRARY_PERSONA_INJECTION/u);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].address, 'https://models.example.test/v1/chat/completions');
  const markdown = await server.api('generate', { text: '说明需求。', format: 'markdown', mode: 'task', personaId: 'custom', direction: 'D'.repeat(4000) + 'MUST_NOT_APPEAR' });
  assert.equal(markdown.body.ok, true);
  assert.equal(markdown.body.value.format, 'markdown');
  assert.equal(markdown.body.value.mode, 'task');
  assert.equal(markdown.body.value.enhanced, output);
  assert.ok(calls[1].payload.messages[0].content.includes('instructions: ' + 'D'.repeat(4000)));
  assert.doesNotMatch(calls[1].payload.messages[0].content, /MUST_NOT_APPEAR/u);
  assert.equal((await server.api('generate', { text: ' ' })).body.error.code, 'empty-input');
  assert.equal((await server.api('generate', { text: 'x'.repeat(12001) })).body.error.code, 'too-long');
});

await test('non-text, tool calls, incomplete, truncated and malformed model results never return success', async () => {
  let scenario = 'length';
  const server = await fixture({ fetchImpl: async () => {
    if (scenario === 'length') return json(completion('PARTIAL_RESULT', 'length'));
    if (scenario === 'non-text') return json(completion([{ type: 'image', data: 'not-a-prompt' }]));
    if (scenario === 'tool') return json({ choices: [{ finish_reason: 'stop', message: { content: 'PARTIAL_RESULT', tool_calls: [{}] } }] });
    if (scenario === 'incomplete') return json(completion('PARTIAL_RESULT', null));
    if (scenario === 'malformed') return new Response('not JSON');
    if (scenario === 'secret-error') throw new Error('SECRET_FROM_TRANSPORT');
    return json({ stop_reason: 'end_turn', content: [{ type: 'text', text: { secret: 'NOT_TEXT' } }] });
  } });
  await server.api('settings', modelSettings);
  for (const [name, code] of [['length', 'output-truncated'], ['non-text', 'empty-output'], ['tool', 'incomplete-output'], ['incomplete', 'incomplete-output'], ['malformed', 'invalid-response'], ['secret-error', 'failed']]) {
    scenario = name;
    const response = await server.api('generate', { text: 'Clarify the request.' });
    assert.equal(response.body.ok, false, name);
    assert.equal(response.body.error.code, code, name);
    assert.equal(response.body.value, undefined);
    assert.ok(!JSON.stringify(response.body).includes('PARTIAL_RESULT'));
    assert.ok(!JSON.stringify(response.body).includes('SECRET_FROM_TRANSPORT'));
  }
  scenario = 'anthropic';
  await server.api('settings', { ...modelSettings, provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'TEST_KEY' });
  const malformed = await server.api('generate', { text: 'Clarify the request.' });
  assert.equal(malformed.body.error.code, 'invalid-response');
});

await test('concurrent requests reject, cancel aborts promptly and late results cannot be published', async () => {
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  let signal;
  const server = await fixture({ fetchImpl: async (_address, options) => {
    calls += 1;
    if (calls === 1) {
      signal = options.signal;
      entered.resolve();
      await release.promise;
      return json(completion('LATE_CANCELLED_RESULT'));
    }
    return json(completion('FRESH_RESULT'));
  } });
  try {
    const pending = server.api('generate', { text: 'First request' });
    await entered.promise;
    assert.equal(signal.aborted, false);
    const busy = await server.api('generate', { text: 'Concurrent request' });
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error.code, 'busy');
    const cancelled = await server.api('cancel');
    assert.equal(cancelled.body.value, true);
    assert.equal(signal.aborted, true);
    const result = await pending;
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error.code, 'aborted');
    assert.equal(result.body.value, undefined);
    const fresh = await server.api('generate', { text: 'New request' });
    assert.equal(fresh.body.value.enhanced, 'FRESH_RESULT');
    release.resolve();
    await server.close();
  } finally { release.resolve(); }
});

await test('response disconnection aborts generation, while completion of the request body does not', async () => {
  const entered = deferred();
  const aborted = deferred();
  let signal;
  const server = await fixture({ fetchImpl: async (_address, options) => {
    signal = options.signal;
    entered.resolve();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted.resolve(); reject(signal.reason); }, { once: true }));
  } });
  const address = new URL(server.origin);
  const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path: '/api/generate', method: 'POST', headers: server.headers() });
  request.on('error', () => {});
  request.end(JSON.stringify({ text: 'Disconnect this response.' }));
  await entered.promise;
  assert.equal(signal.aborted, false);
  assert.equal((await server.api('init')).body.ok, true);
  request.destroy();
  await aborted.promise;
  assert.equal(signal.aborted, true);
  assert.equal((await server.api('init')).body.ok, true);
});

await test('aborted request streams are controlled and leave the service usable', async () => {
  const server = await fixture();
  const address = new URL(server.origin);
  await new Promise((resolve) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path: '/api/settings', method: 'POST', headers: { ...server.headers(), 'content-length': '1000' } });
    request.on('error', resolve);
    request.once('socket', (socket) => socket.once('connect', () => { request.write('{"direction":'); setImmediate(() => request.destroy()); }));
  });
  assert.equal((await server.api('init')).body.ok, true);
});

await test('close is idempotent, aborts active work and releases the actual listening socket', async () => {
  const entered = deferred();
  const aborted = deferred();
  const server = await fixture({ fetchImpl: async (_address, options) => {
    entered.resolve();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted.resolve(); reject(options.signal.reason); }, { once: true }));
  } });
  const pending = server.api('generate', { text: 'Close while generating.' }).catch((error) => error);
  await entered.promise;
  await Promise.all([server.close(), server.close()]);
  await aborted.promise;
  await pending;
  await assert.rejects(fetch(server.origin));
});

await test('close has bounded cleanup even when an injected provider never settles or honors abort', async () => {
  const entered = deferred();
  let signal;
  const server = await fixture({ fetchImpl: async (_address, options) => {
    signal = options.signal;
    entered.resolve();
    return new Promise(() => {});
  } });
  const pending = server.api('generate', { text: 'Never settle this provider stub.' }).catch((error) => error);
  await entered.promise;
  const startedAt = Date.now();
  await server.close();
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - startedAt < 3000);
  await pending;
  await assert.rejects(fetch(server.origin));
});

await test('quit sends a complete success response before closing and invokes its callback once', async () => {
  const quit = deferred();
  let quitCalls = 0;
  const server = await fixture({ onQuit: () => { quitCalls += 1; quit.resolve(); } });
  const response = await server.api('quit');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, value: true });
  await quit.promise;
  await server.close();
  assert.equal(quitCalls, 1);
  await assert.rejects(fetch(server.origin));
});

await test('enhance accepts level and context, falls back invalid level to standard, and health reports readiness', async () => {
  const calls = [];
  const server = await fixture({ fetchImpl: async (address, options) => { calls.push({ address, options, payload: JSON.parse(options.body) }); return json(completion('清楚说明目标。')); } });
  await server.api('settings', modelSettings);
  const health = await server.api('health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { ok: true, value: { ready: true, version: '1.6.0' } });
  assertSecurityHeaders(health.headers);
  const unauthenticated = await rawRequest(server, { method: 'POST', target: '/api/health', headers: { origin: server.origin }, chunks: ['{}'] });
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.ok, false);
  const enhanced = await server.api('enhance', { text: '说明需求。', mode: 'task', level: 'detailed', format: 'plain', personaId: 'builtin:balanced', context: 'PROJECT_CONTEXT_XYZ' });
  assert.equal(enhanced.status, 200);
  assert.equal(enhanced.body.ok, true);
  const value = enhanced.body.value;
  assert.equal(value.enhanced, '清楚说明目标。');
  assert.equal(value.mode, 'task');
  assert.equal(value.level, 'detailed');
  assert.equal(value.format, 'plain');
  assert.equal(value.model, 'test-model');
  assert.equal(value.usage.totalTokens, 50);
  assert.equal(typeof value.elapsedMs, 'number');
  assert.ok(calls[0].payload.messages[0].content.includes('Length/expansion level: detailed'));
  assert.ok(calls[0].payload.messages[0].content.includes('PROJECT_CONTEXT_XYZ'));
  assert.ok(calls[0].payload.messages[0].content.includes('Project context'));
  assert.ok(calls[0].payload.messages[0].content.includes('task brief'));
  const fallback = await server.api('enhance', { text: '说明需求。', level: 'extreme' });
  assert.equal(fallback.body.ok, true);
  assert.equal(fallback.body.value.level, 'standard');
  assert.ok(calls[1].payload.messages[0].content.includes('Length/expansion level: standard'));
  const generated = await server.api('generate', { text: '说明需求。', level: 'concise', context: 'GENERATE_CONTEXT_XYZ' });
  assert.equal(generated.body.value.level, 'concise');
  assert.ok(calls[2].payload.messages[0].content.includes('Length/expansion level: concise'));
  assert.ok(calls[2].payload.messages[0].content.includes('GENERATE_CONTEXT_XYZ'));
  assert.equal(calls.length, 3);
  assert.equal((await server.api('enhance', { text: ' ' })).body.error.code, 'empty-input');
  assert.equal((await server.api('enhance', { text: 'x'.repeat(12001) })).body.error.code, 'too-long');
  const tooMuchContext = await server.api('enhance', { text: '说明需求。', context: 'x'.repeat(8001) });
  assert.equal(tooMuchContext.status, 400);
  assert.equal(tooMuchContext.body.error.code, 'invalid-request');
  const wrongContext = await server.api('enhance', { text: '说明需求。', context: 123 });
  assert.equal(wrongContext.status, 400);
  assert.equal(wrongContext.body.error.code, 'invalid-request');
  assert.equal((await server.api('not-an-action')).status, 404);
  assert.equal((await rawRequest(server, { target: '/api/enhance' })).status, 405);
  assert.equal((await rawRequest(server, { target: '/api/health' })).status, 405);
});

await test('session discovery file is written with the live origin and removed on close', async () => {
  await assert.rejects(createCompanionServer({ configPath: path.join(tmpdir(), 'prompt-enhancer-session-invalid', 'settings.json'), sessionPath: '' }), /sessionPath/u);
  const server = await fixture({ withSession: true });
  const session = JSON.parse(await readFile(server.sessionPath, 'utf8'));
  assert.deepEqual(Object.keys(session).sort(), ['origin', 'pid', 'startedAt', 'token', 'version']);
  assert.equal(session.origin, server.origin);
  assert.equal(session.token, server.token);
  assert.equal(session.pid, process.pid);
  assert.equal(session.version, '1.6.0');
  assert.ok(!Number.isNaN(Date.parse(session.startedAt)));
  assert.equal(path.dirname(server.sessionPath), path.join(server.directory, 'state'));
  assert.equal((await server.api('health')).body.value.ready, true);
  await server.close();
  await assert.rejects(readFile(server.sessionPath, 'utf8'), (error) => error.code === 'ENOENT');
});

console.log(`local server tests passed (${passed} cases)`);
