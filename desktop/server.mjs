import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BUILTIN_PERSONAS } from '../personas.js';
import { createSettingsStore } from './settings.mjs';
import { enhanceWithProvider } from './provider.mjs';

const MAX_JSON_BYTES = 96 * 1024;
const CLEANUP_TIMEOUT_MS = 1000;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; worker-src 'none'";
const SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': CSP,
  'referrer-policy': 'no-referrer',
});
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/renderer.js', ['renderer.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/bridge.js', ['browser-bridge.js', 'text/javascript; charset=utf-8']],
]);
const PUBLIC_CODES = new Set([
  'invalid-endpoint', 'missing-model', 'invalid-key', 'empty-input', 'too-long', 'missing-key',
  'invalid-response', 'response-too-large', 'provider-failed', 'output-truncated', 'incomplete-output',
  'empty-output', 'secure-storage-unavailable', 'invalid-direction', 'unauthorized', 'forbidden',
  'not-found', 'method-not-allowed', 'invalid-json', 'invalid-request', 'body-too-large',
  'unsupported-media-type', 'busy', 'server-closed', 'request-aborted',
]);

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function publicError(error) {
  if (error?.name === 'AbortError') return { code: 'aborted', message: '已取消，本次结果不会覆盖现有内容。' };
  if (error?.name === 'TimeoutError') return { code: 'timeout', message: '请求超时，请稍后重试或缩短输入。' };
  if (PUBLIC_CODES.has(error?.code)) return { code: error.code, message: error.message };
  return { code: 'failed', message: '操作失败，请检查配置后重试。' };
}

function sendJson(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function headerCount(request, name) {
  return request.rawHeaders.reduce((count, value, position) => position % 2 === 0 && value.toLowerCase() === name ? count + 1 : count, 0);
}

function readJson(request) {
  const contentType = request.headers['content-type'];
  if (contentType !== undefined && !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    throw httpError(415, 'unsupported-media-type', '请求必须使用 JSON。');
  }
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw httpError(415, 'unsupported-media-type', '不支持压缩请求。');
  }
  if (Number(request.headers['content-length']) > MAX_JSON_BYTES) throw httpError(413, 'body-too-large', '请求内容过大。');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    const cleanup = () => {
      request.off('data', receive);
      request.off('end', finish);
      request.off('error', fail);
      request.off('aborted', aborted);
    };
    const fail = () => { cleanup(); reject(httpError(400, 'request-aborted', '请求读取失败。')); };
    const aborted = () => { cleanup(); reject(httpError(400, 'request-aborted', '请求已中断。')); };
    const receive = (chunk) => {
      received += chunk.length;
      if (received > MAX_JSON_BYTES) {
        cleanup();
        request.resume();
        reject(httpError(413, 'body-too-large', '请求内容过大。'));
      } else chunks.push(chunk);
    };
    const finish = () => {
      cleanup();
      try {
        const body = received ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'invalid-request', '请求内容必须是 JSON 对象。');
        resolve(body);
      } catch (error) {
        reject(error.code ? error : httpError(400, 'invalid-json', '请求不是有效的 JSON。'));
      }
    };
    request.on('data', receive);
    request.once('end', finish);
    request.once('error', fail);
    request.once('aborted', aborted);
  });
}

function abortable(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    operation.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function createCompanionServer({ configPath, fetchImpl, onQuit } = {}) {
  if (typeof configPath !== 'string' || !configPath.trim()) throw new Error('createCompanionServer 需要提供 configPath。');
  const store = await createSettingsStore(configPath, undefined);
  const token = randomBytes(32).toString('base64url');
  const authorization = Buffer.from(`Bearer ${token}`);
  const tasks = new Set();
  const modelTasks = new Set();
  let origin;
  let expectedHost;
  let activeRequest;
  let closing = false;
  let closePromise;

  const cancel = () => { activeRequest?.abort(); activeRequest = undefined; };
  const track = (collection, operation) => {
    collection.add(operation);
    operation.then(() => collection.delete(operation), () => collection.delete(operation));
    return operation;
  };

  async function dispatch(action, body, response) {
    if (closing) throw httpError(503, 'server-closed', '本机服务正在退出。');
    if (action === 'init') return {
      runtime: 'browser', settings: store.view(), shortcutAvailable: false,
      personas: BUILTIN_PERSONAS.map((persona) => ({ id: persona.id, name: persona.name.zh })),
    };
    if (action === 'settings') return store.save(body);
    if (action === 'cancel') { cancel(); return true; }
    if (action === 'quit') {
      closing = true;
      cancel();
      let scheduled = false;
      const finishQuit = () => {
        if (scheduled) return;
        scheduled = true;
        setImmediate(() => {
          void (async () => {
            try { await onQuit?.(); }
            finally { await close(); }
          })().catch(() => {});
        });
      };
      response.once('finish', finishQuit);
      response.once('close', finishQuit);
      if (response.destroyed) finishQuit();
      return true;
    }
    if (action !== 'generate') throw httpError(404, 'not-found', '没有这个本机操作。');
    if (activeRequest) throw httpError(409, 'busy', '已有请求正在进行，请先取消。');
    const controller = new AbortController();
    activeRequest = controller;
    const disconnected = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close', disconnected);
    try {
      const { settings, apiKey } = store.current();
      const persona = body.personaId === 'custom'
        ? { instructions: typeof body.direction === 'string' ? body.direction.slice(0, 4000) : '' }
        : BUILTIN_PERSONAS.find((candidate) => candidate.id === body.personaId);
      const operation = track(modelTasks, enhanceWithProvider(settings, {
        text: body.text, mode: body.mode, format: body.format, persona,
      }, apiKey, { signal: controller.signal, ...(fetchImpl === undefined ? {} : { fetchImpl }) }));
      const result = await abortable(operation, controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally {
      response.off('close', disconnected);
      if (activeRequest === controller) activeRequest = undefined;
    }
  }

  async function handleRequest(request, response) {
    try {
      if (headerCount(request, 'host') !== 1 || request.headers.host !== expectedHost) throw httpError(403, 'forbidden', '不允许的本机请求地址。');
      const site = request.headers['sec-fetch-site'];
      if (site === 'cross-site' || site === 'same-site') throw httpError(403, 'forbidden', '不允许跨站访问本机助手。');
      if (request.headers.origin !== undefined && (headerCount(request, 'origin') !== 1 || request.headers.origin !== origin)) {
        throw httpError(403, 'forbidden', '不允许的请求来源。');
      }
      if (request.method === 'OPTIONS') throw httpError(405, 'method-not-allowed', '不支持这个请求方式。');
      const target = request.url;
      if (target?.startsWith('/api/')) {
        if (request.method !== 'POST') throw httpError(405, 'method-not-allowed', '本机操作只接受 POST。');
        if (headerCount(request, 'origin') !== 1 || request.headers.origin !== origin) throw httpError(403, 'forbidden', '本机操作需要同源请求。');
        const supplied = typeof request.headers.authorization === 'string' ? Buffer.from(request.headers.authorization) : Buffer.alloc(0);
        if (headerCount(request, 'authorization') !== 1 || supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization)) {
          throw httpError(401, 'unauthorized', '本机会话凭据无效，请重新打开助手。');
        }
        if (!['/api/init', '/api/settings', '/api/generate', '/api/cancel', '/api/quit'].includes(target)) throw httpError(404, 'not-found', '没有这个本机操作。');
        const body = await readJson(request);
        const value = await dispatch(target.slice('/api/'.length), body, response);
        sendJson(response, 200, { ok: true, value });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw httpError(405, 'method-not-allowed', '静态资源只接受 GET 或 HEAD。');
      const file = STATIC_FILES.get(target);
      if (!file) throw httpError(404, 'not-found', '没有这个本机资源。');
      let content = await readFile(new URL(file[0], import.meta.url), 'utf8');
      if (target === '/bridge.js') content = content.replace('__BRIDGE_TOKEN__', JSON.stringify(token));
      if (target === '/') {
        content = content.replace("connect-src 'none'", "connect-src 'self'")
          .replace(/(<script\b[^>]*\bsrc=["'](?:\.\/|\/)?renderer\.js["'][^>]*>)/u, '<script src="/bridge.js"></script>\n$1');
      }
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(200, { ...SECURITY_HEADERS, 'content-type': file[1], 'content-length': Buffer.byteLength(content) });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const failure = publicError(error);
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
        ? error.status : failure.code === 'aborted' ? 409 : failure.code === 'timeout' ? 504 : failure.code === 'failed' ? 500 : 502;
      if (!request.complete) {
        response.setHeader('connection', 'close');
        request.resume();
      }
      sendJson(response, status, { ok: false, error: failure });
    }
  }

  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    request.on('error', () => {});
    response.on('error', () => {});
    track(tasks, handleRequest(request, response).catch(() => { response.destroy(); }));
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 1000;
  server.on('clientError', (_error, socket) => {
    if (!socket.writable || socket.destroyed) return;
    const body = JSON.stringify({ ok: false, error: { code: 'invalid-request', message: 'HTTP 请求无效。' } });
    const headers = { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), connection: 'close' };
    socket.end(`HTTP/1.1 400 Bad Request\r\n${Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n${body}`);
  });

  function close() {
    if (closePromise !== undefined) return closePromise;
    closing = true;
    cancel();
    closePromise = (async () => {
      const stopped = new Promise((resolve) => { server.close(() => resolve()); });
      server.closeAllConnections();
      let cleanupTimer;
      try {
        await Promise.race([
          Promise.allSettled([...tasks, ...modelTasks]),
          new Promise((resolve) => { cleanupTimer = setTimeout(resolve, CLEANUP_TIMEOUT_MS); }),
        ]);
      } finally {
        clearTimeout(cleanupTimer);
        tasks.clear();
        modelTasks.clear();
      }
      await stopped;
    })();
    return closePromise;
  }

  await new Promise((resolve, reject) => {
    const failed = (error) => reject(error);
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => { server.off('error', failed); resolve(); });
  });
  server.on('error', () => { void close().catch(() => {}); });
  expectedHost = `127.0.0.1:${server.address().port}`;
  origin = `http://${expectedHost}`;
  return { origin, token, close };
}
