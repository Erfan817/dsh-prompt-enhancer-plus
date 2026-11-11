const path = require('node:path');
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
// Resolve the installed binary without Electron's implicit downloader.
const electronDirectory = path.dirname(require.resolve('electron/package.json'));
const pathFile = path.join(electronDirectory, 'path.txt');
const executable = existsSync(pathFile) ? readFileSync(pathFile, 'utf8').trim() : process.platform === 'win32' ? 'electron.exe' : 'electron';
let electronPath;
try {
  electronPath = require('./launch-runtime.cjs').resolveRuntime(process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(electronDirectory, 'dist'), executable);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.resolve(__dirname), ...process.argv.slice(2)], { stdio: 'inherit', env: environment });
child.on('error', (error) => { console.error('Unable to launch desktop companion:', error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (code !== 0) console.error(`Desktop process exited with ${code ?? signal ?? 'unknown status'}.`);
  process.exitCode = code === 0 ? 0 : 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
