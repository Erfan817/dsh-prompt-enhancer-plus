// Local Skills are reference data only. All filesystem access stays behind ctx.fs.
import path from 'node:path';
import { homedir } from 'node:os';

const PROVIDERS = [
  ['.claude', 'Claude'], ['.codex', 'Codex'], ['.agents', 'Agents'], ['.dsh', 'DSH'],
  ['.cursor', 'Cursor'], ['.codebuddy', 'CodeBuddy'], ['.workbuddy', 'WorkBuddy'],
  ['.qwen', 'Qwen'], ['.gemini', 'Gemini'], ['.cline', 'Cline'], ['.roo', 'Roo'], ['.windsurf', 'Windsurf'],
];
const SKIP = new Set(['.git', '.hg', '.svn', 'node_modules', '.tmp', 'tmp', 'temp', 'cache', '.cache', '__pycache__', 'dist', 'build', 'vendor', '.venv', 'venv', 'references', 'reference', 'scripts', 'assets']);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_BYTES = 256 * 1024;
const FIELDS = new Set(['name', 'description', 'disable-model-invocation', 'user-invocable']);
const cap = (value, fallback) => Number.isInteger(value) && value >= 0 ? Math.min(value, fallback) : fallback;
const bytes = value => Buffer.byteLength(value, 'utf8');

// Deliberately not a general YAML parser: only top-level scalar fields are consumed.
function scalar(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const quoted = /^"(?:[^"\\]|\\.)*"(?=\s*(?:#.*)?$)/u.exec(value);
    try { const parsed = JSON.parse(quoted?.[0] ?? value); return typeof parsed === 'string' ? parsed : undefined; } catch { return undefined; }
  }
  if (value.startsWith("'")) {
    const match = /^'((?:[^']|'')*)'\s*(?:#.*)?$/u.exec(value);
    return match ? match[1].replace(/''/gu, "'") : undefined;
  }
  if (/^[\[\]{},&*!]/u.test(value)) return undefined;
  return value.replace(/\s+#.*$/u, '').trim();
}
function parse(text, folder) {
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  const lines = normalized.split('\n');
  const fields = Object.create(null);
  let body = normalized;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
    if (end < 0) return undefined;
    body = lines.slice(end + 1).join('\n');
    for (let i = 1; i < end; i++) {
      const match = /^([a-z][a-z-]*):\s*(.*)$/u.exec(lines[i]);
      if (!match || !FIELDS.has(match[1])) continue;
      const [, key, raw] = match;
      if (Object.hasOwn(fields, key)) return undefined;
      if (/^[>|][+-]?(?:\s+#.*)?$/u.test(raw.trim())) {
        const block = [];
        while (i + 1 < end && (/^\s/u.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i]);
        const nonempty = block.filter(line => line.trim());
        const indent = nonempty.length ? Math.min(...nonempty.map(line => /^ */u.exec(line)[0].length)) : 0;
        const deindented = block.map(line => line.slice(indent));
        fields[key] = raw.trim().startsWith('>')
          ? deindented.join('\n').replace(/([^\n])\n(?=[^\n])/gu, '$1 ').trim()
          : deindented.join('\n').trim();
      } else {
        fields[key] = scalar(raw) ?? null;
      }
    }
  }
  const name = fields.name === undefined || fields.name === '' ? folder : fields.name;
  if (typeof name !== 'string' || !NAME.test(name)) return undefined;
  // Unknown/unsupported flag values fail closed for model invocation.
  const disabled = fields['disable-model-invocation'];
  const user = fields['user-invocable'];
  return {
    name, description: typeof fields.description === 'string' ? fields.description : '',
    invocation: { modelInvocable: disabled === undefined || disabled === 'false', userInvocable: user === undefined || user === 'true' },
    content: body.trim(),
  };
}

/** Discover bounded read-only local Skill metadata; get(name) loads the body on demand.
 * options.home/env override host defaults; maxDepth/maxDirectories/maxFiles may only lower limits.
 * Missing listDir intentionally yields an empty complete catalog for older filesystem adapters.
 */
export async function discoverLocalSkills(ctx, cwd, signal, options = {}) {
  const fs = ctx?.fs;
  const skills = [];
  const diagnostics = [];
  const records = new Map();
  let complete = true;
  const empty = () => ({ skills, complete, diagnostics, get: async () => undefined });
  signal?.throwIfAborted();
  if (!fs || typeof fs.listDir !== 'function') return empty();
  if (['resolve', 'stat', 'readText'].some(method => typeof fs[method] !== 'function')) {
    diagnostics.push({ source: '本地', path: String(cwd ?? ''), status: 'error', count: 0 });
    complete = false;
    return empty();
  }
  const home = path.resolve(options.home ?? homedir());
  const env = options.env ?? process.env;
  const globalRoots = PROVIDERS.map(([dir, label]) => ({
    path: path.resolve(home, dir === '.claude' && env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : dir === '.codex' && env.CODEX_HOME ? env.CODEX_HOME : dir, 'skills'),
    source: `${label} 用户`,
  }));
  const globalPaths = new Set(globalRoots.map(root => root.path));
  const roots = [];
  let current = path.resolve(cwd ?? process.cwd());
  // cwd plus at most eight ancestors, nearest project wins.
  for (let level = 0; level <= 8; level++) {
    for (const [dir, label] of PROVIDERS) {
      const candidate = path.join(current, dir, 'skills');
      if (!globalPaths.has(candidate)) roots.push({ path: candidate, source: `${label} 项目` });
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  roots.push(...globalRoots);
  const seenDirectories = new Set();
  const seenFiles = new Set();
  let directories = 0;
  let files = 0;
  const maxDepth = cap(options.maxDepth, 6);
  const maxDirectories = cap(options.maxDirectories, 1000);
  const maxFiles = cap(options.maxFiles, 400);
  const check = () => signal?.throwIfAborted();
  const read = async target => {
    check();
    const info = await fs.stat(target, signal);
    if (!info || info.type !== 'file') return undefined;
    if (typeof info.size === 'number' && info.size > MAX_BYTES) throw Object.assign(new Error('Skill exceeds size limit'), { code: 'LOCAL_SKILL_LIMIT' });
    const text = await fs.readText(target, signal);
    check();
    if (typeof text !== 'string') throw new Error('Skill is not text');
    if (bytes(text) > MAX_BYTES) throw Object.assign(new Error('Skill exceeds size limit'), { code: 'LOCAL_SKILL_LIMIT' });
    return text;
  };
  for (const root of roots) {
    check();
    const diagnostic = { source: root.source, path: root.path, status: 'ok', count: 0 };
    diagnostics.push(diagnostic);
    let rootDirectories = 0;
    let rootFiles = 0;
    const limited = () => { diagnostic.status = 'limited'; complete = false; };
    const failed = error => {
      check();
      if (error?.code === 'LOCAL_SKILL_LIMIT') limited();
      else { if (diagnostic.status !== 'limited') diagnostic.status = 'error'; complete = false; }
    };
    try {
      const target = await fs.resolve(root.path, { cwd, signal });
      const info = await fs.stat(target, signal);
      if (!info) { diagnostic.status = 'missing'; continue; }
      if (info.type !== 'directory') { diagnostic.status = 'error'; complete = false; continue; }
      const walk = async (directory, directoryPath, depth) => {
        check();
        if (seenDirectories.has(directory.targetKey)) return;
        // Keep one very large tool installation from monopolizing the entire catalog.
        if (directories >= maxDirectories || rootDirectories >= 250) { limited(); return; }
        seenDirectories.add(directory.targetKey);
        directories++;
        rootDirectories++;
        const entries = await fs.listDir(directory, signal);
        for (const entry of [...entries].sort((a, b) => Number(b.name === 'SKILL.md') - Number(a.name === 'SKILL.md') || a.name.localeCompare(b.name))) {
          check();
          if (!entry.name || entry.name === '.' || entry.name === '..' || /[\\/]/u.test(entry.name)) continue;
          const entryPath = path.join(directoryPath, entry.name);
          try {
            const child = entry.target ?? await fs.resolve(entryPath, { cwd, signal });
            let type = entry.type;
            if (type === 'other' || type === 'symlink') type = (await fs.stat(child, signal))?.type;
            if (type === 'directory') {
              if (SKIP.has(entry.name.toLowerCase())) continue;
              if (seenDirectories.has(child.targetKey)) continue;
              if (depth >= maxDepth) { limited(); continue; }
              await walk(child, entryPath, depth + 1);
            } else if (type === 'file') {
              if (entry.name !== 'SKILL.md' || seenFiles.has(child.targetKey)) continue;
              if (files >= maxFiles || rootFiles >= 100) { limited(); return; }
              seenFiles.add(child.targetKey);
              files++;
              rootFiles++;
              const text = await read(child);
              if (text === undefined) continue;
              const definition = parse(text, path.basename(directoryPath));
              if (!definition || records.has(definition.name)) continue;
              const { content, ...metadata } = definition;
              const summary = { ...metadata, source: root.source, path: path.resolve(entryPath) };
              skills.push(summary);
              records.set(summary.name, { target: child, folder: path.basename(directoryPath), summary });
              diagnostic.count++;
            }
          } catch (error) { failed(error); }
        }
      };
      await walk(target, root.path, 0);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'FS_NOT_FOUND') diagnostic.status = 'missing';
      else failed(error);
    }
  }
  check();
  return {
    skills, complete, diagnostics,
    get: async name => {
      check();
      const record = records.get(name);
      if (!record) return undefined;
      const text = await read(record.target);
      if (text === undefined) return undefined;
      const definition = parse(text, record.folder);
      // Recheck flags/name instead of trusting stale discovery metadata.
      if (!definition || definition.name !== name) return undefined;
      return { ...definition, source: record.summary.source, path: record.summary.path };
    },
  };
}
