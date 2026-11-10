import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const client = require('./lib/client.js');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const state = {
  behavior: 'success',
  requests: [],
  origin: '',
};

function sendJson(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function startFakeServer() {
  const server = createServer((request, response) => {
    request.on('error', () => {});
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      state.requests.push({ method: request.method, url: request.url, headers: request.headers, body });

      // 模拟 desktop/server.mjs 的安全校验：Host / Origin / Authorization。
      const expectedHost = state.origin.replace('http://', '');
      if (request.headers.host !== expectedHost) {
        sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: '不允许的本机请求地址。' } });
        return;
      }
      if (request.url.startsWith('/api/')) {
        if (request.headers.origin !== state.origin) {
          sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: '不允许的请求来源。' } });
          return;
        }
        if (request.headers.authorization !== 'Bearer test-token') {
          sendJson(response, 401, { ok: false, error: { code: 'unauthorized', message: '本机会话凭据无效，请重新打开助手。' } });
          return;
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: '本机操作只接受 POST。' } });
          return;
        }
      }

      if (request.url === '/api/health') {
        sendJson(response, 200, { ok: true, value: { ready: true, version: '1.5.0' } });
        return;
      }
      if (request.url === '/api/enhance') {
        if (state.behavior === 'unauthorized') {
          sendJson(response, 401, { ok: false, error: { code: 'unauthorized', message: '本机会话凭据无效，请重新打开助手。' } });
          return;
        }
        if (state.behavior === 'invalid-json') {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('not-json');
          return;
        }
        if (state.behavior === 'server-error') {
          sendJson(response, 500, { ok: false, error: { code: 'provider-failed', message: '模型调用失败。' } });
          return;
        }
        if (state.behavior === 'slow') {
          const timer = setTimeout(() => {
            sendJson(response, 200, { ok: true, value: { enhanced: '太慢了', mode: 'general', level: 'standard', format: 'plain', model: 'fake', usage: null, elapsedMs: 1 } });
          }, 800);
          timer.unref();
          return;
        }
        sendJson(response, 200, {
          ok: true,
          value: {
            enhanced: `[${body.level || 'standard'}/${body.mode || 'general'}] ${body.text}`,
            mode: body.mode || 'general',
            level: body.level || 'standard',
            format: body.format || 'plain',
            model: 'fake-model',
            usage: null,
            elapsedMs: 7,
          },
        });
        return;
      }
      sendJson(response, 404, { ok: false, error: { code: 'not-found', message: '没有这个本机操作。' } });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address();
  state.origin = `http://127.0.0.1:${port}`;
  return { server, origin: state.origin };
}

const originalEnv = { APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
function setConfigRoot(root) {
  if (process.platform === 'win32') process.env.APPDATA = root;
  else if (process.platform === 'linux') process.env.XDG_CONFIG_HOME = root;
}
function restoreEnv() {
  for (const key of Object.keys(originalEnv)) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

let fake;
let tempRoot;
let sessionFile;
const TOKEN = 'test-token';

async function main() {
  fake = await startFakeServer();
  tempRoot = await mkdtemp(path.join(tmpdir(), 'prompt-spark-vscode-test-'));
  await mkdir(path.join(tempRoot, 'prompt-enhancer-plus-local'), { recursive: true });
  sessionFile = path.join(tempRoot, 'prompt-enhancer-plus-local', 'session.json');
  await writeFile(sessionFile, JSON.stringify({
    origin: fake.origin,
    token: TOKEN,
    pid: 1234,
    version: '1.5.0',
    startedAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  test('sessionPath() 返回平台约定的发现文件路径', () => {
    if (process.platform === 'win32') {
      setConfigRoot(tempRoot);
      assert.equal(client.sessionPath(), path.join(tempRoot, 'prompt-enhancer-plus-local', 'session.json'));
    } else if (process.platform === 'linux') {
      setConfigRoot(tempRoot);
      assert.equal(client.sessionPath(), path.join(tempRoot, 'prompt-enhancer-plus-local', 'session.json'));
    } else {
      assert.ok(client.sessionPath().endsWith(path.join('prompt-enhancer-plus-local', 'session.json')));
    }
  });

  test('readSession() 读取 origin/token 及附加字段', () => {
    const session = client.readSession(sessionFile);
    assert.equal(session.origin, fake.origin);
    assert.equal(session.token, TOKEN);
    assert.equal(session.pid, 1234);
    assert.equal(session.version, '1.5.0');
  });

  test('readSession() 通过默认发现路径读取会话文件', () => {
    if (process.platform === 'darwin') return; // macOS 的 ~/Library 不便在测试中重定向
    setConfigRoot(tempRoot);
    const session = client.readSession();
    assert.equal(session.origin, fake.origin);
    assert.equal(session.token, TOKEN);
  });

  test('readSession() 文件缺失时报 session-not-found', () => {
    assert.throws(() => client.readSession(path.join(tempRoot, 'does-not-exist', 'session.json')), (error) => {
      assert.equal(error.name, 'LocalServiceError');
      assert.equal(error.code, 'session-not-found');
      assert.match(error.message, /npm run desktop/);
      return true;
    });
  });

  test('readSession() 非法 JSON 报 session-invalid', async () => {
    const badFile = path.join(tempRoot, 'bad-session.json');
    await writeFile(badFile, '{ not json', 'utf8');
    assert.throws(() => client.readSession(badFile), (error) => {
      assert.equal(error.code, 'session-invalid');
      return true;
    });
  });

  test('readSession() 拒绝非回环 origin（避免 token 外泄）', async () => {
    const remoteFile = path.join(tempRoot, 'remote-session.json');
    await writeFile(remoteFile, JSON.stringify({ origin: 'http://example.com:8080', token: TOKEN }), 'utf8');
    assert.throws(() => client.readSession(remoteFile), (error) => {
      assert.equal(error.code, 'session-invalid');
      return true;
    });
  });

  test('enhance() 发送 Bearer/Origin/JSON，level/context 透传并解析结果', async () => {
    state.behavior = 'success';
    state.requests.length = 0;
    const result = await client.enhance({
      origin: fake.origin,
      token: TOKEN,
      text: '原始提示词',
      level: 'detailed',
      mode: 'task',
      format: 'markdown',
      context: '项目上下文',
    });
    assert.equal(result.enhanced, '[detailed/task] 原始提示词');
    assert.equal(result.level, 'detailed');
    assert.equal(result.mode, 'task');
    const request = state.requests.at(-1);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/enhance');
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    assert.match(request.headers['content-type'], /^application\/json/);
    assert.equal(request.headers.origin, fake.origin);
    assert.equal(request.headers.host, new URL(fake.origin).host);
    assert.deepEqual(request.body, {
      text: '原始提示词',
      level: 'detailed',
      mode: 'task',
      format: 'markdown',
      context: '项目上下文',
    });
  });

  test('enhance() 默认不发送未提供的可选字段', async () => {
    state.behavior = 'success';
    state.requests.length = 0;
    await client.enhance({ origin: fake.origin, token: TOKEN, text: '只给文本' });
    const request = state.requests.at(-1);
    assert.deepEqual(request.body, { text: '只给文本' });
  });

  test('enhance() 空文本直接拒绝，不发起请求', async () => {
    state.requests.length = 0;
    await assert.rejects(client.enhance({ origin: fake.origin, token: TOKEN, text: '   ' }), (error) => {
      assert.equal(error.code, 'empty-text');
      return true;
    });
    assert.equal(state.requests.length, 0);
  });

  test('ping() 调用 /api/health 并返回 ready/version', async () => {
    state.behavior = 'success';
    state.requests.length = 0;
    const health = await client.ping({ origin: fake.origin, token: TOKEN });
    assert.deepEqual(health, { ready: true, version: '1.5.0' });
    const request = state.requests.at(-1);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/health');
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
  });

  test('错误 token 时解析 401 错误码与消息', async () => {
    state.behavior = 'success';
    await assert.rejects(client.enhance({ origin: fake.origin, token: 'wrong-token', text: '你好' }), (error) => {
      assert.equal(error.code, 'unauthorized');
      assert.equal(error.status, 401);
      assert.match(error.message, /本机会话凭据无效/);
      return true;
    });
  });

  test('服务端 ok:false 错误被转换为 LocalServiceError', async () => {
    state.behavior = 'server-error';
    await assert.rejects(client.enhance({ origin: fake.origin, token: TOKEN, text: '你好' }), (error) => {
      assert.equal(error.code, 'provider-failed');
      assert.equal(error.status, 500);
      assert.match(error.message, /模型调用失败/);
      return true;
    });
  });

  test('非 JSON 响应报 invalid-response', async () => {
    state.behavior = 'invalid-json';
    await assert.rejects(client.enhance({ origin: fake.origin, token: TOKEN, text: '你好' }), (error) => {
      assert.equal(error.code, 'invalid-response');
      return true;
    });
  });

  test('超时（timeoutMs）报 timeout', async () => {
    state.behavior = 'slow';
    await assert.rejects(client.enhance({ origin: fake.origin, token: TOKEN, text: '你好', timeoutMs: 150 }), (error) => {
      assert.equal(error.code, 'timeout');
      assert.match(error.message, /npm run desktop/);
      return true;
    });
  });

  let passed = 0;
  const failures = [];
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`✔ ${item.name}`);
    } catch (error) {
      failures.push({ name: item.name, error });
      console.error(`✘ ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  console.log('');
  console.log(`test-client: ${passed}/${tests.length} passed`);
  if (failures.length > 0) {
    console.error(`失败 ${failures.length} 项：${failures.map((failure) => failure.name).join('、')}`);
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  restoreEnv();
  fake?.server.closeAllConnections?.();
  await new Promise((resolve) => {
    if (!fake) return resolve();
    fake.server.close(() => resolve());
  });
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}
