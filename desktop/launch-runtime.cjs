const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');

const isAscii = (value) => /^[\x20-\x7e]+$/.test(value);

// Chromium's Windows bootstrap can fail before JS loads when the executable is
// under a non-ASCII path. Cache only the installed runtime, not app/user data.
function resolveRuntime(sourceDirectory, executable, { platform = process.platform, cacheRoot } = {}) {
  const original = path.join(sourceDirectory, executable);
  if (!fs.existsSync(original)) throw new Error('Electron 运行文件缺失。请先完成桌面依赖安装；启动器不会自动下载。');
  if (platform !== 'win32' || isAscii(original)) return original;
  const root = cacheRoot || [os.tmpdir(), process.env.LOCALAPPDATA]
    .filter(Boolean).map((directory) => path.join(directory, 'prompt-spark', 'electron-runtime'))
    .find(isAscii);
  if (!root || !isAscii(root)) throw new Error('Electron 无法从当前中文路径启动，且没有可用的英文缓存路径。请将项目放到英文路径后重试。');

  function manifest(directory) {
    const files = [];
    function walk(current, prefix = '') {
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = path.join(prefix, entry.name);
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full, relative);
        else if (entry.isFile()) {
          const stat = fs.statSync(full);
          files.push([relative, stat.size, stat.mtimeMs]);
        } else throw new Error('Electron 运行目录包含不支持的链接或特殊文件。');
      }
    }
    walk(directory);
    return files;
  }
  const files = manifest(sourceDirectory);
  const identity = createHash('sha256').update(sourceDirectory).update(JSON.stringify(files)).digest('hex').slice(0, 24);
  const target = path.join(root, identity);
  const marker = path.join(target, '.prompt-spark-runtime.json');
  function usable() {
    try {
      if (fs.readFileSync(marker, 'utf8') !== JSON.stringify(files)) return false;
      return files.every(([name, size]) => fs.statSync(path.join(target, name)).size === size);
    } catch { return false; }
  }
  if (!usable()) {
    // Never overwrite an existing runtime, including one another process is using.
    if (fs.existsSync(target)) throw new Error('Electron 专用缓存不完整；请先关闭助手，再检查 prompt-spark/electron-runtime 缓存目录。');
    fs.mkdirSync(root, { recursive: true });
    const temporary = path.join(root, `.preparing-${randomUUID()}`);
    try {
      // Use the same explicit directory traversal as the manifest. Avoid the
      // native recursive cpSync path, which can terminate Windows Node 22
      // without a JavaScript error when copying this runtime tree.
      fs.mkdirSync(temporary);
      for (const [relative] of files) {
        const destination = path.join(temporary, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(sourceDirectory, relative), destination, fs.constants.COPYFILE_EXCL);
      }
      fs.writeFileSync(path.join(temporary, '.prompt-spark-runtime.json'), JSON.stringify(files), { flag: 'wx' });
      try { fs.renameSync(temporary, target); }
      catch (error) { if (!usable()) throw error; }
    } finally {
      // Only this invocation's unpublished staging directory is cleaned up.
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  return path.join(target, executable);
}
module.exports = { resolveRuntime };
