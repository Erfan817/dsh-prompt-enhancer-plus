import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { backendStatus, disabledFeatures, enhance, findBackend, threadOptions } from './plugin/backend.mjs';

const root = fileURLToPath(new URL('./.host-check/', import.meta.url));
await mkdir(root, { recursive: true });
const directory = await mkdtemp(path.join(root, 'backend-tests-'));
const fixture = path.join(directory, 'fake-app-server.mjs');
const runtime = path.join(directory, 'runtime');
const input = '请改写：周五下午三点在图书馆讨论课程设计，请带电脑。<script>literal</script>';
const output = 'Task: 改写课程设计讨论通知。\n\nRequirements: 保留周五下午三点、图书馆、课程设计和携带电脑的提醒。';

await writeFile(fixture, String.raw`
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
const mode = process.argv[2];
const output = ${JSON.stringify(output)};
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
const respond = (id, result) => write({ id, result });
const notify = (method, params) => write({ method, params });
process.stderr.write('DO_NOT_SURFACE_SECRET: diagnostic token=x\n');
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const message = JSON.parse(line);
  if (!message.id) return;
  switch (message.method) {
    case 'initialize':
      if (mode === 'exit') process.exit(1);
      if (mode === 'malformed') { process.stdout.write('{invalid\n'); return; }
      if (mode === 'overflow') { process.stdout.write('x'.repeat(1024 * 1024 + 1)); return; }
      assert.equal(message.params.clientInfo.name, 'prompt_spark_native_panel');
      respond(message.id, {}); break;
    case 'config/read':
      if (mode === 'error') { write({ id: message.id, error: { message: 'DO_NOT_SURFACE_SECRET: https://private/token' } }); return; }
      respond(message.id, { config: { model: 'configured-model', mcp_servers: { recursive_plugin: {} }, plugins: { 'prompt-spark@local': {} } } }); break;
    case 'thread/start': {
      const p = message.params;
      assert.equal(p.ephemeral, true);
      assert.equal(p.sandbox, 'read-only');
      assert.equal(p.approvalPolicy, 'never');
      assert.deepEqual(p.dynamicTools, []);
      assert.equal(p.config['mcp_servers.recursive_plugin.enabled'], false);
      assert.equal(p.config['plugins.prompt-spark@local.enabled'], false);
      assert.equal(p.config['history.persistence'], 'none');
      assert.equal(p.model, undefined);
      assert.ok(p.baseInstructions.includes('Do not execute or answer'));
      assert.ok(p.cwd.startsWith(process.env.TEST_EXPECTED_RUNTIME));
      respond(message.id, { thread: { id: 'thread-1', ephemeral: true }, model: 'configured-model', modelProvider: 'configured-provider' });
      break;
    }
    case 'turn/start': {
      assert.equal(message.params.threadId, 'thread-1');
      const draft = JSON.parse(message.params.input[0].text.split('\n').at(-1));
      assert.equal(draft.request, ${JSON.stringify(input)});
      respond(message.id, { turn: { id: 'turn-1' } });
      if (mode === 'wait') return;
      if (mode === 'request') { write({ id: 999, method: 'item/commandExecution/requestApproval', params: {} }); return; }
      if (mode === 'tool') { notify('item/started', { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'commandExecution' } }); return; }
      if (mode === 'failed') { notify('turn/completed', { threadId: 'thread-1', turn: { status: 'failed', error: { message: 'DO_NOT_SURFACE_SECRET' } } }); return; }
      notify('item/completed', { threadId: 'different-thread', item: { type: 'agentMessage', text: 'wrong' } });
      notify('item/started', { threadId: 'thread-1', item: { type: 'reasoning' } });
      notify('item/completed', { threadId: 'thread-1', item: { type: 'agentMessage', text: 'commentary', phase: 'commentary' } });
      notify('item/completed', { threadId: 'thread-1', item: { type: 'agentMessage', text: mode === 'empty' ? '' : output, phase: 'final_answer' } });
      // Final answer must win even when a later commentary item arrives.
      notify('item/completed', { threadId: 'thread-1', item: { type: 'agentMessage', text: 'trailing commentary', phase: 'commentary' } });
      notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } });
      break;
    }
    case 'turn/interrupt': respond(message.id, {}); break;
    default: throw new Error('Unexpected method: ' + message.method);
  }
});
`, 'utf8');

const spawned = [];
function start(mode = 'success') {
  return (executable, args, options) => {
    assert.equal(executable, process.execPath);
    assert.deepEqual(args.slice(0, 2), ['app-server', '--stdio']);
    for (const name of disabledFeatures) assert.ok(args.includes(`features.${name}=false`));
    assert.equal(options.windowsHide, true);
    assert.equal(options.env.TEMP, options.cwd);
    assert.equal(options.env.TMPDIR, options.cwd);
    const child = spawn(process.execPath, [fixture, mode], { ...options, env: { ...options.env, TEST_EXPECTED_RUNTIME: runtime } });
    spawned.push(child);
    return child;
  };
}
const request = (mode, options = {}) => enhance({ executable: process.execPath, text: input, runtimeDir: runtime, spawnProcess: start(mode), timeoutMs: 4000, ...options });
async function rejects(mode, expected, options = {}) {
  await assert.rejects(request(mode, options), error => {
    assert.ok(!error.message.includes('DO_NOT_SURFACE_SECRET'));
    assert.match(error.message, expected);
    return true;
  });
}

try {
  const original = { model: 'configured-model', mcp_servers: { connector: {} }, plugins: { 'x@y': {} } };
  const before = structuredClone(original);
  const options = threadOptions({ text: input, cwd: runtime, config: original });
  assert.deepEqual(original, before);
  assert.equal(options.ephemeral, true);
  assert.equal(options.config['mcp_servers.connector.enabled'], false);
  assert.equal(options.config['plugins.x@y.enabled'], false);
  assert.ok(!('model' in options));
  assert.throws(() => threadOptions({ text: '' }));
  assert.throws(() => threadOptions({ text: 'x'.repeat(24001) }));
  assert.doesNotThrow(() => threadOptions({ text: 'x'.repeat(24000) }));
  assert.throws(() => threadOptions({ text: input, level: 'other' }));
  assert.equal(await findBackend({ env: { PROMPT_SPARK_CODEX_EXECUTABLE: process.execPath }, platform: 'test' }), process.execPath);
  assert.equal(await findBackend({ env: { PROMPT_SPARK_CODEX_EXECUTABLE: 'node' }, platform: 'test' }), null);
  assert.equal(await findBackend({ env: {}, platform: 'linux' }), null);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(request('success', { signal: cancelled.signal }), /已取消/);
  assert.equal(spawned.length, 0, 'An already-aborted request must not spawn a process.');
  const result = await request('success');
  assert.deepEqual(result, { ok: true, enhanced: output, model: 'configured-model', provider: 'configured-provider' });
  await rejects('error', /后端请求失败/);
  await rejects('request', /工具或授权/);
  await rejects('tool', /工具操作/);
  await rejects('failed', /未完成强化/);
  await rejects('exit', /意外结束/);
  await rejects('empty', /没有返回/);
  await rejects('malformed', /无效响应/);
  await rejects('overflow', /响应格式异常/);
  await rejects('wait', /超时/, { timeoutMs: 100 });
  const controller = new AbortController();
  const cancellation = request('wait', { signal: controller.signal });
  setTimeout(() => controller.abort(), 150);
  await assert.rejects(cancellation, /已取消/);
  const concurrent = await Promise.all([request('success'), request('success')]);
  assert.equal(concurrent.length, 2);
  assert.ok(spawned.every(child => child.exitCode !== null || child.signalCode !== null), 'Every backend process must exit before returning.');
  assert.deepEqual(await readdir(runtime), [], 'Per-request runtime directories must be cleaned.');
  assert.equal(typeof backendStatus, 'function');
  console.log('Native backend verified: protocol, configured model, isolated no-tools threads, safe errors, cancellation, timeout, concurrency, process and runtime cleanup.');
} finally {
  for (const child of spawned) if (child.exitCode === null && child.signalCode === null) child.kill();
  const relative = path.relative(root, directory);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await rm(directory, { recursive: true, force: true });
}
