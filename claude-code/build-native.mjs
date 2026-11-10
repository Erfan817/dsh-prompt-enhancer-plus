#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(directory, 'native-plugin');
const root = path.dirname(directory);

// The editable source lives in native-plugin; shared rules and the brand SVG module are generated.
// --import-dev copies this session's mod into the repository without engine caches.
if (process.argv.includes('--import-dev')) {
  const source = process.argv[process.argv.indexOf('--import-dev') + 1];
  if (!source) throw new Error('Provide the development mod folder after --import-dev.');
  const files = ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'types/index.d.ts', 'README.md', 'native.test.ts', 'layout.test.ts', 'skills.test.ts', 'reference-limits.test.ts', 'hooks/skills.ts'];
  for (const file of files) {
    const destination = path.join(target, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(source, file), destination);
  }
}
await mkdir(path.join(target, 'hooks'), { recursive: true });
const generated = path.join(target, 'hooks/prompt-core.js');
const brandPath = path.join(target, 'hooks/brand.js');
const normalizeLines = text => text.replace(/\r\n/g, '\n');
const brand = '// Generated from the repository icon.svg.\nexport const BRAND_ICON = ' + JSON.stringify(normalizeLines(await readFile(path.join(root, 'icon.svg'), 'utf8'))) + ';\n';
if (process.argv.includes('--check')) {
  if (normalizeLines(await readFile(brandPath, 'utf8')) !== brand) throw new Error('Native plugin icon is stale. Run npm run claude:build.');
  if (normalizeLines(await readFile(generated, 'utf8')) !== normalizeLines(await readFile(path.join(root, 'prompt-core.js'), 'utf8'))) {
    throw new Error('Native plugin rules are stale. Run npm run claude:build.');
  }
} else {
  await copyFile(path.join(root, 'prompt-core.js'), generated);
  await writeFile(brandPath, brand);
}
const forbidden = ['node_modules', 'bin'];
for (const entry of await readdir(target)) {
  if (forbidden.includes(entry)) throw new Error(`Unexpected runtime dependency directory: ${entry}`);
}
console.log('Prompt Spark native plugin: shared rules synchronized; no desktop service required.');
