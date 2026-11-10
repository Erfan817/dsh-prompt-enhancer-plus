#!/usr/bin/env node
/**
 * Prompt Spark 通用 CLI（Node ESM，零第三方依赖）。
 *
 * 用法：
 *   node cli/enhance.mjs --text "原始草稿" --level detailed
 *   echo "原始草稿" | node cli/enhance.mjs --copy
 *
 * 说明：CLI 只与本机 desktop 服务（127.0.0.1）通信，读取其发现文件
 * session.json 中的 { origin, token }；默认路径按平台自动定位。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  ClientError,
  FORMATS,
  LEVELS,
  MODES,
  copyToClipboard,
  readSession,
  requestEnhance,
  resolveSessionPath,
} from './client.mjs';

const HELP_TEXT = `提示词强化 CLI（Prompt Spark）

用法：
  node cli/enhance.mjs [选项]
  echo "原始草稿" | node cli/enhance.mjs [选项]

输入：
  --text <string>         直接传入要强化的文本；省略则从 stdin 读取
  --context-file <path>   读取项目上下文文件（UTF-8），随请求发送（≤8000 字符）
  --session <path>        指定本地服务发现文件 session.json

请求选项：
  --level <value>         concise | standard | detailed（默认 standard）
  --mode <value>          general | system | task | concise（默认 general）
  --format <value>        plain | markdown（默认 plain）
  --timeout <ms>          请求超时毫秒数（默认 90000）

输出：
  --json                  输出完整结果 JSON（enhanced/mode/level/format/model/usage/elapsedMs）
  --copy                  将强化结果复制到系统剪贴板
  -h, --help              显示本帮助

发现文件默认位置：
  Windows   %APPDATA%\\prompt-enhancer-plus-local\\session.json
  macOS     ~/Library/Application Support/prompt-enhancer-plus-local/session.json
  Linux     \${XDG_CONFIG_HOME:-~/.config}/prompt-enhancer-plus-local/session.json

示例：
  node cli/enhance.mjs --text "帮我写个周报" --level detailed
  Get-Clipboard | node cli/enhance.mjs --copy
  node cli/enhance.mjs --text "..." --context-file AGENTS.md --json

退出码：
  0 成功；1 请求/服务错误；2 参数、会话文件或输入错误。

提示：使用前请先运行 npm run desktop，并保持其窗口开启。
`;

const VALUE_OPTIONS = new Map([
  ['--text', 'text'],
  ['--level', 'level'],
  ['--mode', 'mode'],
  ['--format', 'format'],
  ['--context-file', 'contextFile'],
  ['--session', 'session'],
  ['--timeout', 'timeoutMs'],
]);

const FLAG_OPTIONS = new Map([
  ['--copy', 'copy'],
  ['--json', 'json'],
  ['--help', 'help'],
  ['-h', 'help'],
]);

export function parseArgs(argv = []) {
  const options = {
    text: undefined,
    level: 'standard',
    mode: 'general',
    format: 'plain',
    contextFile: undefined,
    session: undefined,
    timeoutMs: 90_000,
    copy: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (typeof raw !== 'string' || !raw) throw new ClientError('存在空的命令行参数。', { code: 'usage', exitCode: 2 });
    let name = raw;
    let inlineValue;
    if (raw.startsWith('--') && raw.includes('=')) {
      const separator = raw.indexOf('=');
      name = raw.slice(0, separator);
      inlineValue = raw.slice(separator + 1);
    }

    if (FLAG_OPTIONS.has(name)) {
      if (inlineValue !== undefined) throw new ClientError(`参数 ${name} 不接受值。`, { code: 'usage', exitCode: 2 });
      options[FLAG_OPTIONS.get(name)] = true;
      continue;
    }
    if (VALUE_OPTIONS.has(name)) {
      let value = inlineValue;
      if (value === undefined) {
        index += 1;
        if (index >= argv.length) throw new ClientError(`参数 ${name} 需要一个值。`, { code: 'usage', exitCode: 2 });
        value = argv[index];
      }
      const key = VALUE_OPTIONS.get(name);
      if (key === 'timeoutMs') {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) throw new ClientError('--timeout 必须是大于 0 的毫秒数。', { code: 'usage', exitCode: 2 });
        options.timeoutMs = Math.trunc(number);
      } else {
        options[key] = value;
      }
      continue;
    }
    throw new ClientError(`未知参数：${raw}`, { code: 'usage', exitCode: 2 });
  }

  if (!LEVELS.includes(options.level)) throw new ClientError(`--level 必须是 ${LEVELS.join('、')} 之一。`, { code: 'usage', exitCode: 2 });
  if (!MODES.includes(options.mode)) throw new ClientError(`--mode 必须是 ${MODES.join('、')} 之一。`, { code: 'usage', exitCode: 2 });
  if (!FORMATS.includes(options.format)) throw new ClientError(`--format 必须是 ${FORMATS.join('、')} 之一。`, { code: 'usage', exitCode: 2 });
  return options;
}

async function readStdin(stream = process.stdin) {
  if (stream?.isTTY) return '';
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function write(stream, text) {
  if (stream && typeof stream.write === 'function') stream.write(text);
}

/**
 * CLI 主流程；返回退出码而不是直接 process.exit，便于测试注入 io。
 * @param {string[]} argv
 * @param {{ stdout?: any, stderr?: any, stdin?: any, stdinText?: string, env?: Record<string,string|undefined>, cwd?: string, platform?: NodeJS.Platform, copyToClipboard?: Function }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const platform = io.platform ?? process.platform;

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    write(stderr, `参数错误：${error?.message ?? error}\n\n运行 node cli/enhance.mjs --help 查看用法。\n`);
    return 2;
  }
  if (options.help) {
    write(stdout, HELP_TEXT);
    return 0;
  }

  try {
    let text;
    if (options.text !== undefined) text = options.text;
    else if (io.stdinText !== undefined) text = io.stdinText;
    else text = await readStdin(io.stdin ?? process.stdin);
    if (typeof text !== 'string' || !text.trim()) {
      write(stderr, '错误：没有输入文本。请使用 --text 或通过 stdin 管道传入内容。\n');
      return 2;
    }

    let context;
    if (options.contextFile !== undefined) {
      const contextPath = path.resolve(cwd, options.contextFile);
      try {
        context = (await readFile(contextPath, 'utf8')).replace(/^\uFEFF/u, '').trim();
      } catch (error) {
        const reason = error?.code === 'ENOENT' ? '文件不存在' : (error?.message ?? error);
        throw new ClientError(`无法读取上下文文件：${contextPath}（${reason}）`, { code: 'context-file-unreadable', exitCode: 2, cause: error });
      }
    }

    const sessionPath = options.session !== undefined ? path.resolve(cwd, options.session) : resolveSessionPath({ platform, env });
    const session = await readSession(sessionPath);
    const result = await requestEnhance(session, {
      text,
      level: options.level,
      mode: options.mode,
      format: options.format,
      context,
    }, { timeoutMs: options.timeoutMs });

    if (options.copy) {
      const copy = io.copyToClipboard ?? copyToClipboard;
      await copy(result.enhanced);
    }

    if (options.json) write(stdout, `${JSON.stringify(result, null, 2)}\n`);
    else write(stdout, result.enhanced.endsWith('\n') ? result.enhanced : `${result.enhanced}\n`);
    return 0;
  } catch (error) {
    write(stderr, `强化失败：${error?.message ?? error}\n`);
    return error?.exitCode === 2 ? 2 : 1;
  }
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    const executed = path.resolve(process.argv[1]);
    const modulePath = fileURLToPath(import.meta.url);
    return process.platform === 'win32' ? executed.toLowerCase() === modulePath.toLowerCase() : executed === modulePath;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  process.exitCode = await main();
}
