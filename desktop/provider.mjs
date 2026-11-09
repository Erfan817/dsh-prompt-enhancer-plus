import { enhancementSystem, inputFor, normalizeEnhancedText, resolveFormat, resolveMode } from '../prompt-core.js';

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_INPUT_CHARS = 12000;
const MAX_KEY_CHARS = 8192;

export function providerError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function endpointFor(provider, baseUrl) {
  let address;
  try { address = new URL(baseUrl); }
  catch { throw providerError('invalid-endpoint', '请填写有效的模型 API 地址。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname);
  if (address.protocol !== 'https:' && !(address.protocol === 'http:' && loopback)) {
    throw providerError('invalid-endpoint', '远程 API 必须使用 HTTPS；本机模型可使用 localhost 的 HTTP 地址。');
  }
  if (address.username || address.password || address.search || address.hash) {
    throw providerError('invalid-endpoint', 'API 地址中不能包含账号、密码、查询参数或片段。');
  }
  const suffix = provider === 'anthropic' ? '/messages' : '/chat/completions';
  const pathname = address.pathname.replace(/\/+$/u, '');
  address.pathname = pathname.endsWith(suffix) ? pathname : pathname + suffix;
  return address.href;
}

export function buildProviderCall(settings, request, apiKey = '') {
  const provider = settings.provider === 'anthropic' ? 'anthropic' : 'openai';
  const endpoint = endpointFor(provider, settings.baseUrl);
  const model = typeof settings.model === 'string' ? settings.model.trim() : '';
  if (!model || model.length > 200) throw providerError('missing-model', '请先在设置里填写模型 ID。');
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key.length > MAX_KEY_CHARS || /[\r\n]/u.test(key)) throw providerError('invalid-key', 'API Key 格式不正确。');
  const text = typeof request.text === 'string' ? request.text.trim() : '';
  if (!text) throw providerError('empty-input', '先写下需要强化的内容。');
  if (text.length > MAX_INPUT_CHARS) throw providerError('too-long', '输入最多支持 12000 个字符。');
  const format = resolveFormat(request.format);
  const mode = resolveMode(request.mode);
  const system = enhancementSystem({ format }, mode, request.persona);
  const headers = { 'content-type': 'application/json' };
  let body;
  if (provider === 'anthropic') {
    if (!key) throw providerError('missing-key', 'Anthropic API 需要你自己的 API Key，不会读取 Claude 桌面版登录。');
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: 3000, system, messages: [{ role: 'user', content: inputFor(text) }] };
  } else {
    if (key) headers.authorization = `Bearer ${key}`;
    body = { model, max_tokens: 3000, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: inputFor(text) }] };
  }
  return { endpoint, headers, body, format, mode, original: text, provider };
}

async function readJsonBounded(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw providerError('invalid-response', 'API 没有返回可读取的内容。');
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > MAX_RESPONSE_BYTES) throw providerError('response-too-large', 'API 返回内容过大，已停止读取。');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof SyntaxError) throw providerError('invalid-response', 'API 返回的不是有效 JSON，请检查地址是否是模型 API。');
    throw error;
  } finally { reader.releaseLock(); }
}

export async function enhanceWithProvider(settings, request, apiKey, { signal, fetchImpl = fetch, timeoutMs = 90000 } = {}) {
  const call = buildProviderCall(settings, request, apiKey);
  const deadline = AbortSignal.timeout(timeoutMs);
  const callSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const startedAt = Date.now();
  callSignal.throwIfAborted();
  const response = await fetchImpl(call.endpoint, {
    method: 'POST', headers: call.headers, body: JSON.stringify(call.body), redirect: 'error', signal: callSignal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    const hint = response.status === 401 || response.status === 403 ? '请检查 API Key 和访问权限。'
      : response.status === 429 ? '调用额度不足或请求过于频繁，请稍后再试。'
        : '请检查 API 地址、模型 ID 和服务商的兼容性。';
    throw providerError('provider-failed', `模型 API 返回 HTTP ${response.status}。${hint}`);
  }
  const payload = await readJsonBounded(response, callSignal);
  callSignal.throwIfAborted();
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw providerError('invalid-response', 'API 返回的数据结构无效。');
  }
  let text;
  let usage;
  if (call.provider === 'anthropic') {
    if (payload.stop_reason === 'max_tokens') throw providerError('output-truncated', '结果达到输出上限，未把不完整内容当作成功。请缩短输入。');
    if (payload.stop_reason !== 'end_turn' && payload.stop_reason !== 'stop_sequence') {
      throw providerError('incomplete-output', '模型没有返回完整的纯文本结果。');
    }
    if (!Array.isArray(payload.content) || payload.content.some((block) => block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string')) {
      throw providerError('invalid-response', 'API 返回了非预期内容，强化结果必须是纯文本。');
    }
    text = payload.content.map((block) => block.text).join('\n');
    usage = payload.usage ? { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens } : null;
  } else {
    const choice = payload.choices?.[0];
    if (choice?.finish_reason === 'length') throw providerError('output-truncated', '结果达到输出上限，未把不完整内容当作成功。请缩短输入。');
    if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length) {
      throw providerError('incomplete-output', '模型没有返回完整的纯文本结果。');
    }
    text = typeof choice.message?.content === 'string' ? choice.message.content : '';
    usage = payload.usage ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens, totalTokens: payload.usage.total_tokens } : null;
  }
  const enhanced = normalizeEnhancedText(text, { format: call.format, original: call.original });
  if (!enhanced) throw providerError('empty-output', '模型没有返回提示词。');
  return { enhanced, mode: call.mode, format: call.format, model: settings.model, usage, elapsedMs: Date.now() - startedAt };
}
