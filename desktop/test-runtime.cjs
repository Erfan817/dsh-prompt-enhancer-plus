const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolveRuntime } = require('./launch-runtime.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-runtime-tests-'));
try {
  const source = path.join(root, '运行文件');
  const cache = path.join(root, 'cache');
  fs.mkdirSync(path.join(source, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(source, 'electron.exe'), 'fake-binary');
  fs.writeFileSync(path.join(source, 'resources', 'default_app.asar'), 'fake-resource');
  assert.equal(resolveRuntime(source, 'electron.exe', { platform: 'linux' }), path.join(source, 'electron.exe'));
  const executable = resolveRuntime(source, 'electron.exe', { platform: 'win32', cacheRoot: cache });
  assert.ok(/^[\x20-\x7e]+$/.test(executable));
  assert.equal(fs.readFileSync(executable, 'utf8'), 'fake-binary');
  assert.equal(fs.readFileSync(path.join(path.dirname(executable), 'resources', 'default_app.asar'), 'utf8'), 'fake-resource');
  assert.equal(resolveRuntime(source, 'electron.exe', { platform: 'win32', cacheRoot: cache }), executable, 'reuse existing complete runtime');
  fs.writeFileSync(path.join(source, 'electron.exe'), 'new-version-binary');
  const updated = resolveRuntime(source, 'electron.exe', { platform: 'win32', cacheRoot: cache });
  assert.notEqual(updated, executable, 'updated installed runtime gets a different cache');
  assert.equal(fs.readFileSync(executable, 'utf8'), 'fake-binary', 'never overwrite an in-use previous cache');
  fs.unlinkSync(updated);
  assert.throws(() => resolveRuntime(source, 'electron.exe', { platform: 'win32', cacheRoot: cache }), /缓存不完整/u);
  assert.throws(() => resolveRuntime(source, 'absent.exe', { platform: 'win32', cacheRoot: cache }), /运行文件缺失/u);
  assert.throws(() => resolveRuntime(source, 'electron.exe', { platform: 'win32', cacheRoot: path.join(root, '缓存') }), /英文缓存路径/u);
  assert.equal(fs.readdirSync(cache).some((name) => name.startsWith('.preparing-')), false);
  console.log('Runtime path tests passed: non-ASCII relocation, reuse, updates, missing files and staging cleanup. No runtime downloaded or executed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
