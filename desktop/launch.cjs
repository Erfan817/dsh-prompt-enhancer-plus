const path = require('node:path');
const { spawn } = require('node:child_process');
const electronPath = require('electron');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.resolve(__dirname), ...process.argv.slice(2)], { stdio: 'inherit', env: environment });
child.on('error', (error) => { console.error('Unable to launch desktop companion:', error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (code !== 0) console.error(`Desktop process exited with ${code ?? signal ?? 'unknown status'}.`);
  process.exitCode = code === 0 ? 0 : 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
