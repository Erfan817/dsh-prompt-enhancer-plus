import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// npm invokes scripts with these paths on Linux and Windows; no shell quoting.
assert.ok(process.env.npm_execpath, 'Run through npm run ci:package.');
const output = execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
});
const [archive] = JSON.parse(output);
assert.ok(archive?.files?.length, 'npm pack returned no files.');
const names = new Set(archive.files.map(file => file.path));
for (const required of [
  'index.js', 'client.js', 'prompt-core.js', 'skill-context.js',
  'claude-code/build-native.mjs',
  'claude-code/native-plugin/.claude-plugin/plugin.json',
  'claude-code/native-plugin/hooks/hooks.json',
  'claude-code/native-plugin/hooks/register.tsx',
  'claude-code/native-plugin/hooks/prompt-core.js',
  'claude-code/native-plugin/hooks/brand.js',
  'claude-code/native-plugin/hooks/skills.ts',
  'claude-code/native-plugin/types/index.d.ts',
]) assert.ok(names.has(required), `Package is missing ${required}`);
for (const name of names) {
  assert.ok(!/(^|\/)(node_modules|\.git|\.mcpb-cache)(\/|$)/.test(name), `Unexpected dependency/cache file: ${name}`);
  assert.ok(!/(^|\/)\.env(?:\.|$)|(^|\/)session\.json$|\.log$/i.test(name), `Unexpected local configuration/log: ${name}`);
}
console.log(`Package verified: ${names.size} files; ${archive.size} packed bytes.`);
