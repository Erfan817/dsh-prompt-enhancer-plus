import assert from 'node:assert/strict';
import path from 'node:path';
import { discoverLocalSkills } from './local-skills.js';

// In-memory fixtures exercise the service boundary; no real host directories in unit tests.
function fixture() {
  const nodes = new Map();
  const reads = [];
  const listings = [];
  const resolvePath = value => path.resolve(value);
  const target = value => ({ targetKey: resolvePath(value), displayPath: resolvePath(value) });
  function dir(value) {
    const key = resolvePath(value);
    if (nodes.has(key)) return;
    nodes.set(key, { type: 'directory' });
    const parent = path.dirname(key);
    if (parent !== key) dir(parent);
  }
  function file(value, text, size) {
    dir(path.dirname(value));
    nodes.set(resolvePath(value), { type: 'file', text, size: size ?? Buffer.byteLength(text) });
  }
  function alias(value, destination) { dir(path.dirname(value)); nodes.set(resolvePath(value), { alias: resolvePath(destination) }); }
  function canonical(value) {
    let key = resolvePath(value);
    const visited = new Set();
    while (nodes.get(key)?.alias && !visited.has(key)) { visited.add(key); key = nodes.get(key).alias; }
    return key;
  }
  const fs = {
    async resolve(value, { signal } = {}) { signal?.throwIfAborted(); return target(canonical(value)); },
    async stat(value, signal) { signal?.throwIfAborted(); return nodes.get(value.targetKey); },
    async listDir(value, signal) {
      signal?.throwIfAborted(); listings.push(value.targetKey);
      return [...nodes].filter(([key]) => key !== value.targetKey && path.dirname(key) === value.targetKey).map(([key]) => {
        const resolved = canonical(key); const node = nodes.get(resolved);
        return { name: path.basename(key), type: node.type, size: node.size, target: target(resolved) };
      });
    },
    async readText(value, signal) { signal?.throwIfAborted(); reads.push(value.targetKey); return nodes.get(value.targetKey).text; },
    contains(parent, child) { const relative = path.relative(parent.targetKey, child.targetKey); return !relative.startsWith('..') && !path.isAbsolute(relative); },
  };
  return { fs, file, dir, alias, reads, listings };
}
const home = path.resolve('fixture-home');
const cwd = path.resolve('fixture-project', 'child');
const opts = { home, env: {} };
const skill = (name, description = 'Reference methods', fields = '') => `---\nname: ${name}\ndescription: ${description}\n${fields}---\nBody for ${name}.\n`;
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`ok ${passed} - ${name}`); }

await test('missing listDir supports older fakes', async () => {
  const result = await discoverLocalSkills({ fs: {} }, cwd, undefined, opts);
  assert.deepEqual(result.skills, []); assert.equal(result.complete, true); assert.equal(await result.get('unknown'), undefined);
});
await test('nearest projects win over parent and user; body loads on demand', async () => {
  const f = fixture();
  f.file(path.join(cwd, '.claude/skills/shared/SKILL.md'), skill('shared', 'Nearest'));
  f.file(path.join(path.dirname(cwd), '.codex/skills/shared/SKILL.md'), skill('shared', 'Parent'));
  f.file(path.join(home, '.claude/skills/shared/SKILL.md'), skill('shared', 'User'));
  f.file(path.join(home, '.claude/skills/humanizer-zh/SKILL.md'), skill('humanizer', '改善中文表达与行文习惯'));
  const result = await discoverLocalSkills(f, cwd, undefined, opts);
  assert.equal(result.complete, true);
  assert.equal(result.skills.length, 2);
  assert.equal(result.skills[0].description, 'Nearest');
  assert.equal(result.skills[0].source, 'Claude 项目');
  assert.equal(result.skills.find(s => s.name === 'humanizer').source, 'Claude 用户');
  assert.ok(result.skills.every(s => !('content' in s) && path.isAbsolute(s.path)));
  const before = f.reads.length;
  assert.equal((await result.get('humanizer')).content, 'Body for humanizer.');
  assert.equal(f.reads.length, before + 1);
  assert.equal(await result.get('absent'), undefined);
  assert.ok(result.diagnostics.some(d => d.status === 'missing'));
});
await test('limited scalar frontmatter: folded/literal, quotes, flags and fallback', async () => {
  const f = fixture(); const root = path.join(home, '.codex/skills');
  f.file(path.join(root, 'folded/SKILL.md'), '---\nname: folded\ndescription: >-\n  First line\n  second line\nextra: ignored\ndisable-model-invocation: true\nuser-invocable: false\n---\nLiteral body');
  f.file(path.join(root, 'literal/SKILL.md'), '---\nname: literal\ndescription: |\n  First line\n  second line\n---\nBody');
  f.file(path.join(root, 'quoted/SKILL.md'), skill('quoted', '"Text: \\"quoted\\"" # comment'));
  f.file(path.join(root, 'malformed-name/SKILL.md'), skill('[unsupported]'));
  f.file(path.join(root, 'unsafe/SKILL.md'), skill('unsafe', 'Reference', 'disable-model-invocation: [false]\n'));
  f.file(path.join(root, 'fallback-name/SKILL.md'), "---\ndescription: 'It''s useful'\n---\nFallback");
  f.file(path.join(root, 'Invalid_Name/SKILL.md'), 'No metadata');
  f.file(path.join(root, 'invalid/SKILL.md'), skill('not_valid'));
  const result = await discoverLocalSkills(f, cwd, undefined, opts);
  assert.equal(result.skills.length, 5);
  assert.equal(result.skills.find(s => s.name === 'unsafe').invocation.modelInvocable, false);
  assert.equal(result.skills.find(s => s.name === 'folded').description, 'First line second line');
  assert.deepEqual(result.skills.find(s => s.name === 'folded').invocation, { modelInvocable: false, userInvocable: false });
  assert.equal(result.skills.find(s => s.name === 'literal').description, 'First line\nsecond line');
  assert.equal(result.skills.find(s => s.name === 'quoted').description, 'Text: "quoted"');
  assert.equal(result.skills.find(s => s.name === 'fallback-name').description, "It's useful");
});
await test('environment overrides and all provider roots', async () => {
  const f = fixture();
  const claude = path.join(home, 'custom-claude'); const codex = path.join(home, 'custom-codex');
  f.file(path.join(claude, 'skills/a/SKILL.md'), skill('a'));
  f.file(path.join(codex, 'skills/b/SKILL.md'), skill('b'));
  f.file(path.join(home, '.claude/skills/ignored/SKILL.md'), skill('ignored'));
  for (const provider of ['agents', 'dsh', 'cursor', 'codebuddy', 'workbuddy', 'qwen', 'gemini', 'cline', 'roo', 'windsurf']) f.file(path.join(home, `.${provider}/skills/${provider}/SKILL.md`), skill(provider));
  const result = await discoverLocalSkills(f, cwd, undefined, { home, env: { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex } });
  assert.equal(result.skills.length, 12); assert.equal(result.skills.some(s => s.name === 'ignored'), false);
});
await test('nested skills, ignored directories, symlink identity dedup and loops', async () => {
  const f = fixture(); const root = path.join(home, '.claude/skills');
  f.file(path.join(root, 'bundle/skills/nested/SKILL.md'), skill('nested'));
  f.file(path.join(root, 'node_modules/hidden/SKILL.md'), skill('hidden'));
  f.file(path.join(root, '.git/hidden/SKILL.md'), skill('hidden-git'));
  f.alias(path.join(root, 'bundle/loop'), root);
  f.alias(path.join(root, 'alias'), path.join(root, 'bundle'));
  const result = await discoverLocalSkills(f, cwd, undefined, opts);
  assert.deepEqual(result.skills.map(s => s.name), ['nested']);
  assert.equal(result.complete, true);
  assert.equal(new Set(f.listings).size, f.listings.length);
});
await test('size, depth, directory and file caps report partial catalogs', async () => {
  for (const limits of [{ maxDepth: 0 }, { maxDirectories: 1 }, { maxFiles: 0 }]) {
    const f = fixture(); f.file(path.join(home, '.claude/skills/a/SKILL.md'), skill('a'));
    const result = await discoverLocalSkills(f, cwd, undefined, { ...opts, ...limits });
    assert.equal(result.complete, false); assert.ok(result.diagnostics.some(d => d.status === 'limited'));
  }
  const f = fixture(); const huge = path.join(home, '.claude/skills/huge/SKILL.md');
  f.file(huge, skill('huge'), 256 * 1024 + 1);
  const result = await discoverLocalSkills(f, cwd, undefined, opts);
  assert.equal(result.complete, false); assert.equal(f.reads.length, 0);
});
await test('metadata first, resources do not consume file budgets, roots stay fair', async () => {
  const f = fixture(); const root = path.join(home, '.claude/skills');
  f.file(path.join(root, 'parent/SKILL.md'), skill('same', 'Parent'));
  f.file(path.join(root, 'parent/child/SKILL.md'), skill('same', 'Child'));
  for (let i = 0; i < 450; i++) f.file(path.join(root, `parent/resource-${i}.txt`), 'resource');
  f.file(path.join(root, 'parent/scripts/hidden/SKILL.md'), skill('hidden'));
  const result = await discoverLocalSkills(f, cwd, undefined, opts);
  assert.equal(result.complete, true);
  assert.equal(result.skills.find(s => s.name === 'same').description, 'Parent');
  assert.equal(result.skills.length, 1);
  const fair = fixture();
  for (let i = 0; i < 110; i++) fair.file(path.join(home, `.claude/skills/a-${i}/SKILL.md`), skill(`a-${i}`));
  fair.file(path.join(home, '.codex/skills/codex/SKILL.md'), skill('codex'));
  const limited = await discoverLocalSkills(fair, cwd, undefined, opts);
  assert.equal(limited.complete, false);
  assert.ok(limited.skills.some(s => s.name === 'codex'));
  assert.equal(limited.skills.filter(s => s.source === 'Claude 用户').length, 100);
});
await test('read errors report error and abort propagates', async () => {
  const f = fixture(); f.file(path.join(home, '.claude/skills/a/SKILL.md'), skill('a'));
  f.fs.readText = async () => { throw new Error('denied'); };
  const result = await discoverLocalSkills(f, cwd, undefined, opts);
  assert.equal(result.complete, false); assert.ok(result.diagnostics.some(d => d.status === 'error'));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(discoverLocalSkills(f, cwd, abort.signal, opts), { name: 'AbortError' });
});
await test('get rechecks invocation and metadata after discovery', async () => {
  const f = fixture(); const location = path.join(home, '.claude/skills/a/SKILL.md');
  f.file(location, skill('a'));
  const result = await discoverLocalSkills(f, cwd, undefined, opts);
  f.file(location, skill('a', 'Updated', 'disable-model-invocation: true\n'));
  assert.equal((await result.get('a')).invocation.modelInvocable, false);
  f.file(location, skill('changed'));
  assert.equal(await result.get('a'), undefined);
});

// Opt-in smoke only: node test-local-skills.mjs --smoke [home] [cwd].
// Direct Node filesystem access is confined to this test adapter, never the discovery module.
if (process.argv.includes('--smoke')) {
  const native = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const index = process.argv.indexOf('--smoke');
  const smokeHome = process.argv[index + 1] ?? homedir();
  const smokeCwd = process.argv[index + 2] ?? process.cwd();
  const fs = {
    async resolve(value, options = {}) {
      let absolute = path.resolve(options.cwd ?? process.cwd(), value);
      try { absolute = await native.realpath(absolute); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { targetKey: absolute, displayPath: absolute };
    },
    async stat(target) {
      try { const info = await native.stat(target.displayPath); return { type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', size: info.size }; }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    async listDir(target, signal) {
      signal?.throwIfAborted();
      const entries = await native.readdir(target.displayPath, { withFileTypes: true });
      return Promise.all(entries.map(async entry => {
        const child = await this.resolve(path.join(target.displayPath, entry.name));
        const info = await this.stat(child);
        return { name: entry.name, target: child, type: info?.type ?? 'other', size: info?.size };
      }));
    },
    async readText(target, signal) { return native.readFile(target.displayPath, { encoding: 'utf8', signal }); },
    contains(parent, child) { const relative = path.relative(parent.displayPath, child.displayPath); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); },
  };
  const result = await discoverLocalSkills({ fs }, smokeCwd, undefined, { home: smokeHome });
  console.log(JSON.stringify({ smoke: true, complete: result.complete, skills: result.skills.map(({ name, source, path }) => ({ name, source, path })), diagnostics: result.diagnostics.filter(d => d.status !== 'missing') }, null, 2));
  const humanizer = result.skills.find(item => item.name === 'humanizer-zh');
  if (humanizer) {
    const definition = await result.get(humanizer.name);
    assert.ok(definition.content.length > 0);
    console.log(JSON.stringify({ humanizer: humanizer.name, source: humanizer.source, path: humanizer.path, contentLength: definition.content.length }));
  }
  const { listSkillChoices, loadSkillContext } = await import('./skill-context.js');
  const choices = await listSkillChoices({ fs }, '去 AI 味', undefined, smokeCwd);
  const selected = await loadSkillContext({ fs }, '去 AI 味', undefined, smokeCwd, undefined, true, ['humanizer-zh']);
  assert.ok(choices.skills.some(item => item.name === 'humanizer-zh'));
  assert.ok(selected.metadata.skills.some(item => item.name === 'humanizer-zh'));
  assert.ok(selected.context.length > 0);
  console.log(JSON.stringify({ integration: true, status: choices.status, matchedNames: choices.matchedNames, humanizer: choices.skills.find(item => item.name === 'humanizer-zh'), selected: selected.metadata, contextLength: selected.context.length }, null, 2));
}
console.log(`${passed} local Skill tests passed`);
