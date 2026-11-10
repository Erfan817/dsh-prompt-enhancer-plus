import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createCompanionServer } from './server.mjs';

const smokeTest = process.argv.includes('--smoke-test');
let temporaryDirectory;
let companion;
let stopping = false;

function openLocalWindow(address) {
  const command = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe')
    : process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open';
  const argumentsList = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', address] : [address];
  const opener = spawn(command, argumentsList, { stdio: 'ignore', detached: true });
  opener.on('error', () => console.log('浏览器未自动打开，请手动打开上面显示的本机地址。'));
  opener.unref();
}

async function stop() {
  if (stopping) return;
  stopping = true;
  await companion?.close();
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
}

try {
  if (smokeTest) temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'prompt-enhancer-local-smoke-'));
  const configurationRoot = temporaryDirectory || path.join(process.env.APPDATA || path.join(homedir(), '.config'), 'prompt-enhancer-plus-local');
  const sessionPath = path.join(configurationRoot, 'session.json');
  companion = await createCompanionServer({
    configPath: path.join(configurationRoot, 'settings.json'),
    sessionPath,
    ...(smokeTest ? { fetchImpl: async () => { throw new Error('A smoke test must not call a model'); } } : {}),
  });
  if (smokeTest) {
    const page = await fetch(companion.origin);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('/bridge.js'));
    assert.ok(html.includes('renderer.js'));
    const response = await fetch(`${companion.origin}/api/init`, {
      method: 'POST', headers: { origin: companion.origin, authorization: `Bearer ${companion.token}`, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 200);
    const initialized = await response.json();
    assert.equal(initialized.ok, true);
    assert.equal(initialized.value.runtime, 'browser');
    assert.equal(initialized.value.settings.canRememberKey, false);
    assert.equal(initialized.value.personas.length, 5);
    const sessionFile = JSON.parse(await readFile(sessionPath, 'utf8'));
    assert.deepEqual(Object.keys(sessionFile).sort(), ['origin', 'pid', 'startedAt', 'token', 'version']);
    assert.equal(sessionFile.origin, companion.origin);
    assert.equal(sessionFile.token, companion.token);
    assert.equal(sessionFile.pid, process.pid);
    assert.equal(sessionFile.version, '1.6.0');
    assert.ok(!Number.isNaN(Date.parse(sessionFile.startedAt)));
    await companion.close();
    await assert.rejects(readFile(sessionPath, 'utf8'), (error) => error.code === 'ENOENT');
    console.log(JSON.stringify({ ok: true, runtime: 'local-node', pageServed: true, authenticatedBridge: true, personas: 5, sessionFile: { written: true, removedOnClose: true }, noModelCall: true, noBrowserLaunched: true }));
    await stop();
  } else {
    console.log('提示词强化 Plus · 通用本地窗口');
    console.log(`打开地址：${companion.origin}`);
    console.log('仅监听本机，不需要 Electron，不读取其他客户端的登录或密钥。');
    console.log('保持这个终端运行；在界面点“退出”或在这里按 Ctrl+C 结束。');
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
    if (!process.argv.includes('--no-open')) openLocalWindow(companion.origin);
  }
} catch (error) {
  console.error('本地提示词窗口启动失败：', error.message);
  process.exitCode = 1;
  await stop();
}
