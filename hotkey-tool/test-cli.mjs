#!/usr/bin/env node
/**
 * CLI 测试（不依赖 child_process 管道，直接 import 被测模块）。
 *
 * 覆盖：
 *   - 三平台发现文件路径解析
 *   - session.json 读取与校验
 *   - POST /api/enhance 请求头（Origin / Bearer / JSON）与请求体（level/context）
 *   - 服务端错误、超时、非法响应
 *   - CLI main() 的 stdout / 错误码 / --json / --copy
 *   - copyToClipboard 的命令选择（注入假 spawn，可跳过真实剪贴板）
 *
 * 运行：node hotkey-tool/test-cli.mjs
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  ClientError,
  copyToClipboard,
  readSession,
  requestEnhance,
  resolveSessionPath,
} from '../cli/client.mjs';
import { main, parseArgs } from '../cli/enhance.mjs';

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.error(`✗ ${name}`);
    console.error(`  ${String(error?.stack ?? error).split('\n').slice(0, 6).join('\n  ')}`);
  }
}

function createFakeServer() {
  const requests = [];
  let server;
  server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      const record = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(record);

      const origin = `http://127.0.0.1:${server.address().port}`;
      const send = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      };
      if (req.headers.origin !== origin) return send(403, { ok: false, error: { code: 'forbidden', message: '不允许的请求来源。' } });
      if (req.headers.host !== `127.0.0.1:${server.address().port}`) return send(403, { ok: false, error: { code: 'forbidden', message: '不允许的 Host。' } });
      if (req.headers.authorization !== 'Bearer test-token') return send(401, { ok: false, error: { code: 'unauthorized', message: '本机会话凭据无效，请重新打开助手。' } });
      if (req.method !== 'POST' || req.url !== '/api/enhance') return send(404, { ok: false, error: { code: 'not-found', message: '没有这个本机操作。' } });
      if (body?.text === 'trigger-error') return send(400, { ok: false, error: { code: 'empty-input', message: '先写下需要强化的内容。' } });
      if (body?.text === 'trigger-timeout') {
        setTimeout(() => send(200, { ok: true, value: { enhanced: '迟到的结果' } }), 300);
        return undefined;
      }
      return send(200, {
        ok: true,
        value: {
          enhanced: `【${body?.level ?? 'standard'}】${body?.text ?? ''}`,
          mode: body?.mode ?? 'general',
          level: body?.level ?? 'standard',
          format: body?.format ?? 'plain',
          model: 'fake-model',
          usage: null,
          elapsedMs: 1,
        },
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}`, requests }));
  });
}

function captureIo(overrides = {}) {
  const state = { out: '', err: '' };
  const io = {
    stdout: { write: (chunk) => { state.out += String(chunk); return true; } },
    stderr: { write: (chunk) => { state.err += String(chunk); return true; } },
    stdinText: '',
    env: process.env,
    cwd: process.cwd(),
    ...overrides,
  };
  return { state, io };
}

function fakeSpawnRecorder(record) {
  return (command, args) => {
    const child = new EventEmitter();
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    child.stdin = stdin;
    child.stderr = stderr;
    const chunks = [];
    stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stdin.on('end', () => {
      record.push({ command, args, text: Buffer.concat(chunks).toString('utf8') });
      setImmediate(() => child.emit('close', 0));
    });
    return child;
  };
}

function fakeSpawnMissing() {
  return (command) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => child.emit('error', Object.assign(new Error(`${command} 不存在`), { code: 'ENOENT' })));
    return child;
  };
}

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'prompt-spark-cli-test-'));
let fakeServer;

try {
  fakeServer = await createFakeServer();
  const sessionPath = path.join(temporaryDirectory, 'session.json');
  const session = { origin: fakeServer.origin, token: 'test-token', pid: 1234, version: '1.5.0', startedAt: new Date().toISOString() };
  await writeFile(sessionPath, JSON.stringify(session), 'utf8');

  await test('resolveSessionPath：Windows 使用 %APPDATA%', () => {
    const resolved = resolveSessionPath({ platform: 'win32', env: { APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' }, homedir: 'C:\\Users\\tester' });
    assert.equal(resolved, path.win32.join('C:\\Users\\tester\\AppData\\Roaming', 'prompt-enhancer-plus-local', 'session.json'));
  });

  await test('resolveSessionPath：macOS 使用 Application Support', () => {
    const resolved = resolveSessionPath({ platform: 'darwin', env: {}, homedir: '/Users/tester' });
    assert.equal(resolved, '/Users/tester/Library/Application Support/prompt-enhancer-plus-local/session.json');
  });

  await test('resolveSessionPath：Linux 使用 XDG_CONFIG_HOME 或 ~/.config', () => {
    assert.equal(
      resolveSessionPath({ platform: 'linux', env: { XDG_CONFIG_HOME: '/home/tester/.config-x' }, homedir: '/home/tester' }),
      '/home/tester/.config-x/prompt-enhancer-plus-local/session.json',
    );
    assert.equal(
      resolveSessionPath({ platform: 'linux', env: {}, homedir: '/home/tester' }),
      '/home/tester/.config/prompt-enhancer-plus-local/session.json',
    );
  });

  await test('readSession：读取发现文件 origin/token', async () => {
    const loaded = await readSession(sessionPath);
    assert.equal(loaded.origin, fakeServer.origin);
    assert.equal(loaded.token, 'test-token');
    assert.equal(loaded.pid, 1234);
  });

  await test('readSession：文件不存在时提示 npm run desktop', async () => {
    await assert.rejects(
      () => readSession(path.join(temporaryDirectory, 'missing-session.json')),
      (error) => error instanceof ClientError && error.code === 'session-not-found' && /npm run desktop/u.test(error.message),
    );
  });

  await test('readSession：拒绝非本机 origin（防止 token 外泄）', async () => {
    const unsafePath = path.join(temporaryDirectory, 'unsafe-session.json');
    await writeFile(unsafePath, JSON.stringify({ origin: 'https://example.com', token: 'secret' }), 'utf8');
    await assert.rejects(
      () => readSession(unsafePath),
      (error) => error instanceof ClientError && error.code === 'unsafe-origin',
    );
  });

  await test('parseArgs：解析全部选项与默认值', () => {
    const options = parseArgs(['--text', '你好', '--level', 'detailed', '--mode', 'task', '--format', 'markdown', '--copy', '--json', '--timeout', '1234']);
    assert.equal(options.text, '你好');
    assert.equal(options.level, 'detailed');
    assert.equal(options.mode, 'task');
    assert.equal(options.format, 'markdown');
    assert.equal(options.copy, true);
    assert.equal(options.json, true);
    assert.equal(options.timeoutMs, 1234);
  });

  await test('parseArgs：未知参数抛 usage 错误', () => {
    assert.throws(() => parseArgs(['--nope']), (error) => error instanceof ClientError && error.code === 'usage' && error.exitCode === 2);
  });

  await test('requestEnhance：发送 Origin/Bearer 与 level/context 请求体', async () => {
    const result = await requestEnhance({ origin: fakeServer.origin, token: 'test-token' }, {
      text: '原始文本', level: 'detailed', mode: 'task', format: 'markdown', context: '项目背景',
    }, { timeoutMs: 5000 });
    assert.equal(result.enhanced, '【detailed】原始文本');
    const request = fakeServer.requests.at(-1);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/enhance');
    assert.equal(request.headers.origin, fakeServer.origin);
    assert.equal(request.headers.authorization, 'Bearer test-token');
    assert.match(request.headers['content-type'], /^application\/json/u);
    assert.deepEqual(request.body, { text: '原始文本', level: 'detailed', mode: 'task', format: 'markdown', context: '项目背景' });
  });

  await test('requestEnhance：服务端错误转为 ClientError', async () => {
    await assert.rejects(
      () => requestEnhance({ origin: fakeServer.origin, token: 'test-token' }, { text: 'trigger-error' }, { timeoutMs: 5000 }),
      (error) => error instanceof ClientError && error.code === 'empty-input' && error.status === 400 && /先写下/u.test(error.message),
    );
  });

  await test('requestEnhance：错误 token 返回 unauthorized', async () => {
    await assert.rejects(
      () => requestEnhance({ origin: fakeServer.origin, token: 'wrong-token' }, { text: '任意内容' }, { timeoutMs: 5000 }),
      (error) => error instanceof ClientError && error.code === 'unauthorized' && error.status === 401,
    );
  });

  await test('requestEnhance：超时可控', async () => {
    await assert.rejects(
      () => requestEnhance({ origin: fakeServer.origin, token: 'test-token' }, { text: 'trigger-timeout' }, { timeoutMs: 50 }),
      (error) => error instanceof ClientError && error.code === 'timeout',
    );
  });

  await test('main：stdout 只输出 enhanced 文本', async () => {
    const { state, io } = captureIo();
    const code = await main(['--session', sessionPath, '--text', '来自 CLI', '--level', 'detailed'], io);
    assert.equal(code, 0);
    assert.equal(state.err, '');
    assert.equal(state.out, '【detailed】来自 CLI\n');
  });

  await test('main：未指定 --session 时按平台默认发现文件', async () => {
    const platform = process.platform;
    const env = platform === 'win32'
      ? { ...process.env, APPDATA: path.join(temporaryDirectory, 'AppData', 'Roaming') }
      : { ...process.env, XDG_CONFIG_HOME: path.join(temporaryDirectory, 'xdg-config') };
    const defaultSessionPath = resolveSessionPath({ platform, env, homedir: temporaryDirectory });
    await mkdir(path.dirname(defaultSessionPath), { recursive: true });
    await writeFile(defaultSessionPath, JSON.stringify(session), 'utf8');
    const { state, io } = captureIo({ env, platform });
    const code = await main(['--text', '默认发现文件'], io);
    assert.equal(code, 0);
    assert.equal(state.out, '【standard】默认发现文件\n');
  });

  await test('main：从 stdin 读取文本', async () => {
    const { state, io } = captureIo({ stdinText: '来自标准输入' });
    const code = await main(['--session', sessionPath], io);
    assert.equal(code, 0);
    assert.equal(state.out, '【standard】来自标准输入\n');
  });

  await test('main：--context-file 内容进入请求体，--json 输出完整结果', async () => {
    const contextPath = path.join(temporaryDirectory, 'context.txt');
    await writeFile(contextPath, '项目上下文 ABC\n', 'utf8');
    const { state, io } = captureIo();
    const code = await main(['--session', sessionPath, '--text', '带上下文', '--context-file', contextPath, '--json'], io);
    assert.equal(code, 0);
    const parsed = JSON.parse(state.out);
    assert.equal(parsed.enhanced, '【standard】带上下文');
    assert.equal(parsed.model, 'fake-model');
    assert.equal(fakeServer.requests.at(-1).body.context, '项目上下文 ABC');
  });

  await test('main：--copy 调用剪贴板并写入增强结果', async () => {
    const copied = [];
    const { state, io } = captureIo({ copyToClipboard: async (text) => { copied.push(text); } });
    const code = await main(['--session', sessionPath, '--text', '复制我', '--copy'], io);
    assert.equal(code, 0);
    assert.deepEqual(copied, ['【standard】复制我']);
    assert.equal(state.out, '【standard】复制我\n');
  });

  await test('main：服务端错误时 stderr + 非 0 退出码', async () => {
    const { state, io } = captureIo();
    const code = await main(['--session', sessionPath, '--text', 'trigger-error'], io);
    assert.equal(code, 1);
    assert.match(state.err, /强化失败：先写下需要强化的内容。/u);
    assert.equal(state.out, '');
  });

  await test('main：缺少输入文本时退出码 2', async () => {
    const { state, io } = captureIo();
    const code = await main([], io);
    assert.equal(code, 2);
    assert.match(state.err, /没有输入文本/u);
  });

  await test('main：--help 输出帮助且退出 0', async () => {
    const { state, io } = captureIo();
    const code = await main(['--help'], io);
    assert.equal(code, 0);
    assert.match(state.out, /--session/u);
    assert.match(state.out, /--copy/u);
  });

  await test('copyToClipboard：Windows 选择 clip.exe 并写入文本', async () => {
    const record = [];
    await copyToClipboard('剪贴板内容', { platform: 'win32', env: {}, spawnImpl: fakeSpawnRecorder(record) });
    assert.equal(record.length, 1);
    assert.equal(record[0].command, 'clip.exe');
    assert.equal(record[0].text, '剪贴板内容');
  });

  await test('copyToClipboard：Linux 无 xclip/wl-copy 时报错', async () => {
    await assert.rejects(
      () => copyToClipboard('文本', { platform: 'linux', env: {}, spawnImpl: fakeSpawnMissing() }),
      (error) => error instanceof ClientError && error.code === 'clipboard-unavailable' && /xclip|wl-copy/u.test(error.message),
    );
  });

  await test('copyToClipboard：macOS 选择 pbcopy', async () => {
    const record = [];
    await copyToClipboard('mac 文本', { platform: 'darwin', env: {}, spawnImpl: fakeSpawnRecorder(record) });
    assert.equal(record[0].command, 'pbcopy');
    assert.equal(record[0].text, 'mac 文本');
  });
} finally {
  await new Promise((resolve) => fakeServer?.server.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const failed = results.filter((item) => !item.ok);
console.log('');
console.log(`测试完成：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.error(`失败 ${failed.length} 项：${failed.map((item) => item.name).join('、')}`);
  process.exitCode = 1;
}
