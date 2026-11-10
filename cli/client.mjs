/**
 * Prompt Spark CLI 可复用客户端逻辑（零第三方依赖）。
 *
 * 供 `cli/enhance.mjs` 与测试直接 import：
 *   - resolveSessionPath()  按平台定位本机服务发现文件 session.json
 *   - readSession()         读取并校验 { origin, token, ... }
 *   - requestEnhance()      POST ${origin}/api/enhance（Bearer token）
 *   - copyToClipboard()     写系统剪贴板（Windows clip.exe / macOS pbcopy / Linux xclip|wl-copy）
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { homedir } from 'node:os';
import path from 'node:path';

export const CONFIG_DIRECTORY = 'prompt-enhancer-plus-local';
export const DEFAULT_TIMEOUT_MS = 90_000;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const LEVELS = Object.freeze(['concise', 'standard', 'detailed']);
export const MODES = Object.freeze(['general', 'system', 'task', 'concise']);
export const FORMATS = Object.freeze(['plain', 'markdown']);

/** 带错误码的客户端错误：code 便于调用方判断，exitCode 供 CLI 使用。 */
export class ClientError extends Error {
  constructor(message, { code = 'client-error', status = undefined, exitCode = 1, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ClientError';
    this.code = code;
    this.status = status;
    this.exitCode = exitCode;
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname ?? '').replace(/^\[|\]$/gu, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(host);
}

function normalizeOrigin(rawOrigin) {
  const text = typeof rawOrigin === 'string' ? rawOrigin.trim() : '';
  if (!text) throw new ClientError('本地服务会话文件缺少 origin。请重新运行 npm run desktop。', { code: 'invalid-session', exitCode: 2 });
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new ClientError(`本地服务会话文件中的 origin 不是有效 URL：${text}`, { code: 'invalid-session', exitCode: 2 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ClientError(`本地服务只支持 http/https 地址（当前：${url.protocol}）。`, { code: 'invalid-session', exitCode: 2 });
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new ClientError(`本地服务地址必须是本机回环地址（当前：${url.hostname}），已拒绝发送 token。`, { code: 'unsafe-origin', exitCode: 2 });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ClientError('本地服务会话文件中的 origin 不能包含账号、密码、查询参数或片段。', { code: 'invalid-session', exitCode: 2 });
  }
  return url.origin;
}

/**
 * 定位本机服务发现文件。
 * @param {{ platform?: NodeJS.Platform, env?: Record<string, string|undefined>, homedir?: string }} [options]
 * @returns {string} session.json 的绝对路径
 */
export function resolveSessionPath({ platform = process.platform, env = process.env, homedir: home = homedir() } = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  let root;
  if (platform === 'win32') {
    const appData = typeof env.APPDATA === 'string' && env.APPDATA.trim() ? env.APPDATA.trim() : pathApi.join(home, 'AppData', 'Roaming');
    root = appData;
  } else if (platform === 'darwin') {
    root = pathApi.join(home, 'Library', 'Application Support');
  } else {
    const xdg = typeof env.XDG_CONFIG_HOME === 'string' ? env.XDG_CONFIG_HOME.trim() : '';
    root = xdg && pathApi.isAbsolute(xdg) ? xdg : pathApi.join(home, '.config');
  }
  return pathApi.join(root, CONFIG_DIRECTORY, 'session.json');
}

/**
 * 读取并校验发现文件。desktop 端写入格式：
 * { origin, token, pid, version, startedAt }
 */
export async function readSession(sessionPath) {
  const target = typeof sessionPath === 'string' && sessionPath.trim() ? sessionPath : resolveSessionPath();
  let source;
  try {
    source = await readFile(target, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ClientError(`未找到本地服务会话文件：${target}\n请先运行 npm run desktop 并保持窗口开启，再重试。`, { code: 'session-not-found', exitCode: 2, cause: error });
    }
    throw new ClientError(`无法读取本地服务会话文件：${target}（${error?.message ?? error}）`, { code: 'session-unreadable', exitCode: 2, cause: error });
  }
  let data;
  try {
    data = JSON.parse(source.replace(/^\uFEFF/u, ''));
  } catch {
    throw new ClientError(`本地服务会话文件不是有效 JSON：${target}`, { code: 'invalid-session', exitCode: 2 });
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ClientError(`本地服务会话文件内容无效：${target}`, { code: 'invalid-session', exitCode: 2 });
  }
  const token = typeof data.token === 'string' ? data.token.trim() : '';
  if (!token) throw new ClientError('本地服务会话文件缺少 token。请重新运行 npm run desktop。', { code: 'invalid-session', exitCode: 2 });
  return {
    origin: normalizeOrigin(data.origin),
    token,
    pid: data.pid,
    version: data.version,
    startedAt: data.startedAt,
    sessionPath: target,
  };
}

function normalizeTimeoutMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.trunc(number), 10 * 60 * 1000);
}

function mapRequestError(error, origin, timeoutMs) {
  if (error instanceof ClientError) return error;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new ClientError(`请求超时（${timeoutMs} ms）。本地服务可能仍在生成，请稍后重试或增大 --timeout。`, { code: 'timeout', cause: error });
  }
  if (error?.code === 'ECONNREFUSED') {
    return new ClientError(`无法连接本地服务：${origin}\n请先运行 npm run desktop 并保持窗口开启。`, { code: 'connection-refused', cause: error });
  }
  return new ClientError(`请求本地服务失败：${error?.message ?? error}`, { code: 'network-error', cause: error });
}

/**
 * 调用 POST ${origin}/api/enhance。
 *
 * 注意：desktop 服务强制校验唯一 Origin 头（必须等于 session.origin）与
 * Bearer token，因此这里使用 node:http(s) 直接控制请求头。
 *
 * @param {{ origin: string, token: string }} session
 * @param {{ text: string, level?: string, mode?: string, format?: string, context?: string }} request
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ enhanced: string, mode: string, level: string, format: string, model?: string, usage?: object|null, elapsedMs?: number }>}
 */
export function requestEnhance(session, request = {}, options = {}) {
  const origin = typeof session?.origin === 'string' ? session.origin.trim().replace(/\/+$/u, '') : '';
  const token = typeof session?.token === 'string' ? session.token.trim() : '';
  if (!origin || !token) {
    return Promise.reject(new ClientError('本地服务会话信息不完整（缺少 origin 或 token）。', { code: 'invalid-session', exitCode: 2 }));
  }
  const text = typeof request.text === 'string' ? request.text : '';
  if (!text.trim()) return Promise.reject(new ClientError('要强化的文本不能为空。', { code: 'empty-input', exitCode: 2 }));

  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const payload = {
    text,
    level: request.level ?? 'standard',
    mode: request.mode ?? 'general',
    format: request.format ?? 'plain',
  };
  if (typeof request.context === 'string' && request.context.trim()) payload.context = request.context;
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    let target;
    try {
      target = new URL('/api/enhance', origin);
    } catch (error) {
      settle(reject, new ClientError(`本地服务地址无效：${origin}`, { code: 'invalid-session', exitCode: 2, cause: error }));
      return;
    }
    const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const signal = AbortSignal.timeout(timeoutMs);
    let req;
    try {
      req = transport(target, {
        method: 'POST',
        signal,
        headers: {
          // desktop/server.mjs 要求恰好一个 Origin，且值等于 session.origin。
          origin,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'content-length': Buffer.byteLength(body),
          connection: 'close',
        },
      }, (response) => {
        const chunks = [];
        let received = 0;
        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            response.destroy(new ClientError('本地服务返回内容过大，已停止读取。', { code: 'response-too-large' }));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', (error) => settle(reject, mapRequestError(error, origin, timeoutMs)));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let envelope;
          try {
            envelope = raw ? JSON.parse(raw) : null;
          } catch {
            settle(reject, new ClientError(`本地服务返回的不是有效 JSON（HTTP ${response.statusCode}）。`, { code: 'invalid-response', status: response.statusCode }));
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300 || envelope?.ok !== true) {
            const details = envelope && typeof envelope === 'object' ? envelope.error : undefined;
            const message = details && typeof details.message === 'string' ? details.message : `本地服务返回 HTTP ${response.statusCode}。`;
            const code = details && typeof details.code === 'string' ? details.code : `http-${response.statusCode}`;
            settle(reject, new ClientError(message, { code, status: response.statusCode }));
            return;
          }
          const value = envelope.value;
          if (value === null || typeof value !== 'object' || typeof value.enhanced !== 'string' || !value.enhanced) {
            settle(reject, new ClientError('本地服务返回的结果格式无效（缺少 enhanced）。', { code: 'invalid-response', status: response.statusCode }));
            return;
          }
          settle(resolve, value);
        });
      });
    } catch (error) {
      settle(reject, mapRequestError(error, origin, timeoutMs));
      return;
    }
    req.on('error', (error) => settle(reject, mapRequestError(error, origin, timeoutMs)));
    req.end(body);
  });
}

function runClipboardCommand(command, args, input, spawnImpl) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    let stderr = '';
    child.once('error', (error) => reject(error));
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new ClientError(`${command} 退出码 ${code}${stderr.trim() ? `：${stderr.trim()}` : ''}`, { code: 'clipboard-failed' }));
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input, 'utf8');
  });
}

/**
 * 将文本写入系统剪贴板。
 * Windows: clip.exe；macOS: pbcopy；Linux: wl-copy（Wayland 优先）或 xclip。
 *
 * @param {string} text
 * @param {{ platform?: NodeJS.Platform, env?: Record<string, string|undefined>, spawnImpl?: Function }} [options]
 */
export async function copyToClipboard(text, { platform = process.platform, env = process.env, spawnImpl = spawn } = {}) {
  if (typeof text !== 'string') throw new ClientError('写入剪贴板的内容必须是字符串。', { code: 'clipboard-invalid' });
  const candidates = [];
  if (platform === 'win32') {
    candidates.push({ command: 'clip.exe', args: [] });
  } else if (platform === 'darwin') {
    candidates.push({ command: 'pbcopy', args: [] });
  } else {
    if (env.WAYLAND_DISPLAY) candidates.push({ command: 'wl-copy', args: [] });
    candidates.push({ command: 'xclip', args: ['-selection', 'clipboard'] });
    if (!env.WAYLAND_DISPLAY) candidates.push({ command: 'wl-copy', args: [] });
  }

  const missing = [];
  for (const candidate of candidates) {
    try {
      await runClipboardCommand(candidate.command, candidate.args, text, spawnImpl);
      return;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        missing.push(candidate.command);
        continue;
      }
      throw error;
    }
  }
  throw new ClientError(`未找到可用的剪贴板命令（已尝试：${missing.join('、') || candidates.map((item) => item.command).join('、')}）。请先安装 xclip 或 wl-copy。`, { code: 'clipboard-unavailable' });
}
