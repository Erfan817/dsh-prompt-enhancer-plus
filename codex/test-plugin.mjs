import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const plugin = path.join(root, 'codex/plugin');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
execFileSync(process.execPath, [path.join(root, 'codex/build-plugin.mjs'), '--check'], { stdio: 'inherit' });

// Every catalog/asset link must resolve inside its installed package, including symlinks.
async function contained(base, relative, directory = false) {
  assert.ok(relative.startsWith('./'), `Expected a package-relative path: ${relative}`);
  const resolved = await realpath(path.resolve(base, relative));
  const suffix = path.relative(await realpath(base), resolved);
  assert.ok(suffix && suffix !== '..' && !suffix.startsWith(`..${path.sep}`) && !path.isAbsolute(suffix),
    `Path escapes package: ${relative}`);
  const info = await stat(resolved);
  assert.ok(directory ? info.isDirectory() : info.isFile(), `Missing package resource: ${relative}`);
  return resolved;
}
const catalog = await json(path.join(root, '.agents/plugins/marketplace.json'));
const entry = catalog.plugins.find(item => item.name === 'prompt-spark');
assert.ok(entry, 'Marketplace must expose Prompt Spark.');
assert.equal(await contained(root, entry.source.path, true), await realpath(plugin));
assert.equal(entry.policy.installation, 'AVAILABLE');
const manifest = await json(path.join(plugin, 'plugin.json'));
const legacy = await json(path.join(plugin, '.codex-plugin/plugin.json'));
assert.equal(manifest.name, entry.name);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(legacy.name, manifest.name);
assert.deepEqual(legacy.interface, manifest.extensions['com.openai'].interface);
await contained(plugin, legacy.skills, true);
await contained(plugin, legacy.mcpServers);
const mcp = await json(path.join(plugin, 'mcp.json'));
const legacyMcp = await json(path.join(plugin, '.mcp.json'));
assert.deepEqual(legacyMcp.mcpServers, mcp.mcpServers);
assert.equal(mcp.mcpServers.prompt_spark.type, 'stdio');
assert.equal(mcp.mcpServers.prompt_spark.args[0], '${PLUGIN_ROOT}/server.mjs');
await contained(plugin, './server.mjs');
await contained(plugin, './backend.mjs');
await contained(plugin, './prompt-core.js');
await contained(plugin, './ui/editor.html');
for (const key of ['composerIcon', 'logo']) await contained(plugin, legacy.interface[key]);

// Verify that installing only the plugin directory leaves no dangling Skill references.
const skillDir = path.join(plugin, 'skills/enhance');
const skill = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
assert.match(skill, /^---\r?\nname: enhance\r?\ndescription: .+\r?\n---/);
const references = [...skill.matchAll(/\]\((references\/[^)]+)\)/g)];
assert.equal(references.length, 3);
for (const [, relative] of references) await contained(skillDir, `./${relative}`);
assert.ok((await readFile(path.join(plugin, 'LICENSE'), 'utf8')).includes('MIT'));

async function inspect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!item.isSymbolicLink(), `Plugin must be portable without symlinks: ${item.name}`);
    assert.ok(!/^(node_modules|\.git|\.env(?:\..*)?|session\.json|auth\.json|config\.toml)$/i.test(item.name),
      `Local state in plugin: ${item.name}`);
    if (item.isDirectory()) await inspect(path.join(directory, item.name));
  }
}
await inspect(plugin);
console.log('Codex plugin packaging verified: catalog, manifests, assets, Skill references, and generated rules.');
