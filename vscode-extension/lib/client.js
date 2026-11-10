'use strict';

/**
 * Prompt Spark VS Code/Cursor 扩展的本地服务客户端。
 *
 * 纯 Node 实现：不依赖 `vscode` 模块，可被 Node 直接单元测试。
 * 与 desktop/server.mjs 的契约：
 *   POST /api/enhance  { text, mode?, level?, format?, personaId?, direction?, context? }
 *   POST /api/health   {}
 *   响应统一为 { ok: true, value: {...} } 或 { ok: false, error: { code, message } }
 *
 * 安全说明：本地服务只监听 127.0.0.1，且校验 Host/Origin/Authorization。
 * 因此这里显式发送 `Origin: <origin>`，并且只允许回环地址作为目标，避免把 token 发到远端。
 */

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const APP_DIR_NAME = 'prompt-enhancer-plus-local';
const SESSION_FILE_NAME = 'session.json';
const DEFAULT_TIMEOUT_MS = 90 * 1000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

class LocalServiceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'LocalServiceError';
    if (options.code !== undefined) this.code = options.code;
    if (options.status !== undefined) this.status = options.status;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * 本地服务发现文件路径：
 * - Windows: %APPDATA%/prompt-enhancer-plus-local/session.json
 * - macOS:   ~/Library/Application Support/prompt-enhancer-plus-local/session.json
 * - Linux:   ${XDG_CONFIG_HOME:-~/.config}/prompt-enhancer-plus-local/session.json
 */
function sessionPath() {
  let base;
  if (process.platform === 'win32') {
    base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  }
  return path.join(base, APP_DIR_NAME, SESSION_FILE_NAME);
}

function assertLoopbackOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new LocalServiceError(`本地服务地址无效：${String(origin)}`, { code: 'session-invalid' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LocalServiceError(`本地服务地址必须使用 http/https：${origin}`, { code: 'session-invalid' });
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new LocalServiceError(`本地服务地址必须是回环地址（127.0.0.1/localhost）：${origin}`, { code: 'session-invalid' });
  }
  return url;
}

/**
 * 读取发现文件，返回至少包含 { origin, token } 的对象。
 * @param {string} [sessionFile] 可选覆盖路径（便于测试/多实例）。
 */
function readSession(sessionFile = sessionPath()) {
  let raw;
  try {
    raw = fs.readFileSync(sessionFile, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new LocalServiceError(
        `未找到本地服务会话文件：${sessionFile}。请先运行 npm run desktop 启动本地服务。`,
        { code: 'session-not-found', cause: error },
      );
    }
    throw new LocalServiceError(`读取本地服务会话文件失败：${error.message}`, { code: 'session-invalid', cause: error });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new LocalServiceError(`本地服务会话文件不是合法 JSON：${sessionFile}`, { code: 'session-invalid', cause: error });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LocalServiceError('本地服务会话文件内容必须是 JSON 对象。', { code: 'session-invalid' });
  }
  if (typeof parsed.origin !== 'string' || !parsed.origin.trim()) {
    throw new LocalServiceError('本地服务会话文件缺少 origin。', { code: 'session-invalid' });
  }
  if (typeof parsed.token !== 'string' || !parsed.token.trim()) {
    throw new LocalServiceError('本地服务会话文件缺少 token。', { code: 'session-invalid' });
  }
  const url = assertLoopbackOrigin(parsed.origin.trim());
  return { ...parsed, origin: url.origin, token: parsed.token };
}

function normalizeTimeout(timeoutMs) {
  if (timeoutMs === undefined || timeoutMs === null) return DEFAULT_TIMEOUT_MS;
  const value = Number(timeoutMs);
  if (!Number.isFinite(value) || value <= 0) {
    throw new LocalServiceError(`超时时间无效：${String(timeoutMs)}`, { code: 'invalid-argument' });
  }
  return Math.min(Math.floor(value), 10 * 60 * 1000);
}

function requestJson({ origin, token, requestPath, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    let timer;
    let targetUrl;
    let body;
    const effectiveTimeout = normalizeTimeout(timeoutMs);

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    try {
      const url = assertLoopbackOrigin(origin);
      targetUrl = url;
      if (typeof token !== 'string' || !token.trim()) {
        throw new LocalServiceError('本地服务会话缺少 token。请先运行 npm run desktop 启动本地服务。', { code: 'session-invalid' });
      }
      body = JSON.stringify(payload === undefined ? {} : payload);
      const transport = url.protocol === 'https:' ? https : http;
      request = transport.request({
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: requestPath,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=utf-8',
          accept: 'application/json',
          origin: url.origin,
          'content-length': Buffer.byteLength(body),
          'user-agent': 'prompt-spark-vscode/1.0.0',
        },
      }, (response) => {
        const chunks = [];
        let received = 0;
        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            request.destroy();
            finish(new LocalServiceError('本地服务响应过大。', { code: 'invalid-response' }));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', (error) => {
          finish(new LocalServiceError(`读取本地服务响应失败：${error.message}`, { code: 'network-error', cause: error }));
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch (error) {
            finish(new LocalServiceError(
              `本地服务返回了无法解析的响应（HTTP ${response.statusCode}）。`,
              { code: 'invalid-response', status: response.statusCode, cause: error },
            ));
            return;
          }
          const status = response.statusCode || 0;
          if (parsed && parsed.ok === false) {
            const detail = parsed.error && typeof parsed.error === 'object' ? parsed.error : {};
            const failure = new LocalServiceError(
              typeof detail.message === 'string' && detail.message ? detail.message : `本地服务请求失败（HTTP ${status}）。`,
              { code: typeof detail.code === 'string' ? detail.code : 'http-error', status },
            );
            finish(failure);
            return;
          }
          if (status < 200 || status >= 300) {
            finish(new LocalServiceError(`本地服务请求失败（HTTP ${status}）。`, { code: 'http-error', status }));
            return;
          }
          finish(undefined, parsed && parsed.ok === true && Object.prototype.hasOwnProperty.call(parsed, 'value') ? parsed.value : parsed);
        });
      });
    } catch (error) {
      finish(error instanceof LocalServiceError ? error : new LocalServiceError(String(error && error.message ? error.message : error), { code: 'network-error', cause: error }));
      return;
    }

    timer = setTimeout(() => {
      const error = new LocalServiceError(`本地服务请求超时（${effectiveTimeout}ms）。请确认 npm run desktop 仍在运行。`, { code: 'timeout' });
      if (request) request.destroy(error);
      finish(error);
    }, effectiveTimeout);
    if (typeof timer.unref === 'function') timer.unref();

    request.on('error', (error) => {
      if (settled) return;
      if (error instanceof LocalServiceError) {
        finish(error);
        return;
      }
      finish(new LocalServiceError(
        `无法连接本地服务（${targetUrl ? targetUrl.origin : String(origin)}）：${error && error.message ? error.message : error}。请先运行 npm run desktop 启动本地服务。`,
        { code: 'network-error', cause: error },
      ));
    });
    request.end(body);
  });
}

/**
 * 调用 POST /api/enhance。
 * @param {object} options { origin, token, text, level?, mode?, format?, context?, personaId?, direction?, timeoutMs? }
 * @returns {Promise<{enhanced:string, mode?:string, level?:string, format?:string, model?:string, usage?:object|null, elapsedMs?:number}>}
 */
async function enhance(options = {}) {
  const { origin, token, text, level, mode, format, context, personaId, direction, timeoutMs } = options;
  if (typeof text !== 'string' || !text.trim()) {
    throw new LocalServiceError('要强化的文本不能为空。', { code: 'empty-text' });
  }
  const payload = { text };
  if (level !== undefined) payload.level = level;
  if (mode !== undefined) payload.mode = mode;
  if (format !== undefined) payload.format = format;
  if (context !== undefined) payload.context = context;
  if (personaId !== undefined) payload.personaId = personaId;
  if (direction !== undefined) payload.direction = direction;

  const value = await requestJson({ origin, token, requestPath: '/api/enhance', payload, timeoutMs });
  if (value === null || typeof value !== 'object' || typeof value.enhanced !== 'string') {
    throw new LocalServiceError('本地服务返回的强化结果格式不正确。', { code: 'invalid-response' });
  }
  return value;
}

/**
 * 调用 POST /api/health 探测本地服务。
 * @param {object} options { origin, token, timeoutMs? }
 */
async function ping(options = {}) {
  const { origin, token, timeoutMs } = options;
  const value = await requestJson({ origin, token, requestPath: '/api/health', payload: {}, timeoutMs });
  if (value === null || typeof value !== 'object') {
    throw new LocalServiceError('本地服务健康检查返回格式不正确。', { code: 'invalid-response' });
  }
  return value;
}

module.exports = {
  APP_DIR_NAME,
  DEFAULT_TIMEOUT_MS,
  LocalServiceError,
  sessionPath,
  readSession,
  enhance,
  ping,
};
