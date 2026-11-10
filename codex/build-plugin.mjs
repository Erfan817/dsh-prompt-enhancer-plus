#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { enhancementSystem } from '../prompt-core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const plugin = path.join(root, 'codex/plugin');
const check = process.argv.includes('--check');
const normalize = text => text.replace(/\r\n/g, '\n');
const manifest = JSON.parse(await readFile(path.join(plugin, 'plugin.json'), 'utf8'));
const { $schema, extensions, ...identity } = manifest;
const files = new Map([
  ['.codex-plugin/plugin.json', JSON.stringify({
    ...identity, skills: './skills/', mcpServers: './.mcp.json', ...extensions['com.openai'],
  }, null, 2) + '\n'],
  ['.mcp.json', JSON.stringify({ mcpServers: JSON.parse(await readFile(path.join(plugin, 'mcp.json'), 'utf8')).mcpServers }, null, 2) + '\n'],
  ['assets/icon.svg', await readFile(path.join(root, 'icon.svg'), 'utf8')],
  ['LICENSE', await readFile(path.join(root, 'LICENSE'), 'utf8')],
]);
for (const level of ['concise', 'standard', 'detailed']) {
  files.set(`skills/enhance/references/${level}.md`,
    '<!-- Generated from prompt-core.js by codex/build-plugin.mjs. Do not edit directly. -->\n\n'
    + enhancementSystem({ format: 'plain' }, 'general', undefined, level) + '\n');
}
for (const [relative, text] of files) {
  const destination = path.join(plugin, relative);
  if (check) {
    let current;
    try { current = await readFile(destination, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current === undefined || normalize(current) !== normalize(text)) {
      throw new Error(`Codex bundle is missing or stale: ${relative}. Run npm run codex:build.`);
    }
  } else {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, normalize(text));
  }
}
console.log(`Prompt Spark Codex bundle: ${files.size} generated files ${check ? 'verified' : 'updated'}.`);
