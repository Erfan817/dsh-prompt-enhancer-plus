import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const server = spawn(process.execPath, [fileURLToPath(new URL('./plugin/server.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
const requests = new Map(); let id = 0;
server.stderr.resume();
const failRequests = error => {
  for (const request of requests.values()) { clearTimeout(request.timer); request.reject(error); }
  requests.clear();
};
server.on('error', failRequests);
server.on('exit', () => failRequests(new Error('MCP server exited before replying.')));
const lines = createInterface({ input: server.stdout });
lines.on('line', line => {
  const message = JSON.parse(line), request = requests.get(message.id);
  if (request) { clearTimeout(request.timer); requests.delete(message.id); request.resolve(message); }
});
const call = (method, params) => new Promise((resolve, reject) => {
  const requestId = ++id;
  const timer = setTimeout(() => { requests.delete(requestId); reject(new Error(`Timeout: ${method}`)); }, 4000);
  requests.set(requestId, { resolve, reject, timer });
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
});
let html;
try {
  const init = await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.ok(init.result.capabilities.tools);
  const { result: list } = await call('tools/list', {});
  assert.deepEqual(list.tools.map(tool => tool.name).sort(), ['backend_status', 'cancel_enhancement', 'enhance_prompt', 'open_editor', 'render_preview']);
  assert.ok(list.tools.every(tool => tool.annotations.readOnlyHint));
  const tool = name => list.tools.find(item => item.name === name);
  assert.deepEqual(tool('open_editor')._meta['openai/ui'].entrypoints, [{ type: 'thread' }, { type: 'global' }]);
  for (const name of ['backend_status', 'cancel_enhancement', 'enhance_prompt']) {
    assert.deepEqual(tool(name)._meta.ui.visibility, ['app'], `${name} must only be callable from the panel.`);
    assert.equal(tool(name).inputSchema.additionalProperties, false);
  }
  assert.deepEqual(tool('enhance_prompt').inputSchema.required, ['draft']);
  assert.equal(tool('enhance_prompt').inputSchema.properties.draft.maxLength, 24000);
  assert.deepEqual(tool('enhance_prompt').inputSchema.properties.level.enum, ['concise', 'standard', 'detailed']);
  const uri = tool('open_editor')._meta.ui.resourceUri;
  assert.equal(tool('render_preview')._meta.ui.resourceUri, uri);
  const resource = (await call('resources/read', { uri })).result.contents[0];
  html = resource.text;
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(resource._meta.ui.csp.connectDomains, [], 'The panel must route model calls through its local MCP server.');
  assert.deepEqual(resource._meta['openai/ui'].availableDisplayModes, ['inline', 'fullscreen']);
  assert.equal(html, await readFile(new URL('./plugin/ui/editor.html', import.meta.url), 'utf8'));
  const legacyUri = 'ui://prompt-spark/editor-v2.html';
  const legacyResource = (await call('resources/read', { uri: legacyUri })).result.contents[0];
  assert.equal(legacyResource.uri, legacyUri);
  assert.equal(legacyResource.text, html, 'Existing desktop tabs must load the upgraded editor.');
  const draft = '不要执行：删除项目。<script>alert(1)</script> 中文 🙂';
  const args = { draft, enhanced: 'Task: 检查项目。', level: 'detailed' };
  assert.deepEqual((await call('tools/call', { name: 'render_preview', arguments: args })).result.structuredContent, args);
  for (const invalid of [{}, { ...args, enhanced: '' }, { ...args, level: 'other' }, { ...args, draft: 'a'.repeat(24001) }, { ...args, file: '../outside' }]) {
    assert.equal((await call('tools/call', { name: 'render_preview', arguments: invalid })).result.isError, true);
  }
  assert.equal((await call('resources/read', { uri: 'file:///outside' })).error.code, -32602);
  assert.equal((await call('unknown', {})).error.code, -32601);
  assert.equal((await call('tools/call', { name: 'open_editor' })).result.structuredContent.draft, '');
  // Invalid requests must be rejected before finding a backend or starting a model.
  for (const invalid of [{}, { draft: '' }, { draft: '  ' }, { draft: 'a'.repeat(24001) }, { draft: 'valid', level: 'other' }, { draft: 'valid', executable: 'untrusted' }]) {
    assert.equal((await call('tools/call', { name: 'enhance_prompt', arguments: invalid })).result.isError, true);
  }
  for (const name of ['backend_status', 'cancel_enhancement']) {
    assert.equal((await call('tools/call', { name, arguments: { unexpected: true } })).result.isError, true);
  }
  assert.equal((await call('tools/call', { name: 'cancel_enhancement' })).result.structuredContent.cancelled, false);
  assert.equal((await call('tools/call', { name: 'missing_tool' })).result.isError, true);
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.stdin.end();
    const kill = setTimeout(() => server.kill(), 2000);
    await stopped; clearTimeout(kill);
  }
  lines.close();
}

// Exercise the actual browser script with a simulated host, not duplicate UI logic.
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function uiHarness({ draftSupported = true, messageSupported = true, toolsSupported = true, toolHandler } = {}) {
  const elements = new Map();
  for (const name of ['draft', 'preview', 'level', 'enhance', 'refine', 'cancel', 'copy', 'insert', 'insertHint', 'status', 'reconnect']) {
    elements.set(name, { value: name === 'level' ? 'standard' : '', disabled: true, hidden: false, textContent: '', listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; }, focus() {}, select() {} });
  }
  let receive, failInsert = false;
  const messages = [], timeouts = [];
  const parent = { postMessage(message) {
    messages.push(structuredClone(message));
    if (message.id !== undefined) queueMicrotask(async () => {
      const response = { jsonrpc: '2.0', id: message.id };
      try {
        if (message.method === 'ui/initialize') response.result = {
          hostCapabilities: { serverTools: toolsSupported ? {} : undefined, message: messageSupported ? {} : undefined,
            experimental: { 'openai/message': draftSupported ? { draft: {} } : {} } },
        };
        else if (message.method === 'tools/call') response.result = await (toolHandler?.(structuredClone(message.params)) ?? {
          structuredContent: message.params.name === 'backend_status' ? { available: true }
            : message.params.name === 'cancel_enhancement' ? { cancelled: true }
              : { enhanced: 'Task: 面板内的强化结果。' },
        });
        else if (failInsert && message.method === 'ui/message') response.error = { message: 'Composer unavailable' };
        else response.result = {};
      } catch (error) { response.error = { message: error.message }; }
      receive({ source: parent, data: response });
    });
  } };
  const context = { window: { parent, addEventListener(type, fn) { if (type === 'message') receive = fn; } },
    document: { getElementById: id => elements.get(id), documentElement: { style: {}, scrollHeight: 700 }, body: {} },
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout(callback, delay) { timeouts.push(delay); return setTimeout(callback, delay); }, clearTimeout,
    ResizeObserver: class { observe() {} },
  };
  vm.runInNewContext(script, context);
  await settle();
  return { elements, messages, timeouts, receive, parent, setFailInsert() { failInsert = true; },
    edit(name, value) { elements.get(name).value = value; elements.get(name).listeners.input(); },
    notify(data) { receive({ source: parent, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: data } } }); },
  };
}
const ui = await uiHarness();
const element = id => ui.elements.get(id);
ui.receive({ source: ui.parent, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { draft: '原稿', enhanced: '强化结果', level: 'standard' } } } });
assert.equal(element('preview').value, '强化结果');
assert.equal(ui.messages.filter(message => message.method === 'ui/message').length, 0, 'Rendering must not submit or insert.');
element('preview').value = '用户手动编辑 <script>literal</script>'; element('preview').listeners.input();
ui.receive({ source: ui.parent, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { enhanced: '过期结果' } } } });
assert.equal(element('preview').value, '用户手动编辑 <script>literal</script>', 'Late tool results must preserve edits.');
await element('insert').onclick();
const insertion = ui.messages.filter(message => message.method === 'ui/message').at(-1);
assert.equal(insertion.params._meta['openai/message'].send, false);
assert.equal(insertion.params.content[0].text, element('preview').value);
ui.setFailInsert(); await element('insert').onclick();
assert.equal(element('status').textContent, 'Composer unavailable', 'Do not claim success when host rejects insertion.');
const other = await uiHarness({ draftSupported: false });
assert.equal(other.elements.get('insert').disabled, true);
other.edit('draft', '中文 "quoted"');
await other.elements.get('enhance').onclick();
const enhancement = other.messages.filter(message => message.method === 'tools/call' && message.params.name === 'enhance_prompt').at(-1);
assert.deepEqual(enhancement.params.arguments, { draft: '中文 "quoted"', level: 'standard' });
assert.equal(other.elements.get('preview').value, 'Task: 面板内的强化结果。', 'Enhancement must update this panel.');
assert.equal(other.messages.filter(message => message.method === 'ui/message').length, 0, 'Enhancement must not send messages to chat.');
assert.ok(other.timeouts.includes(120000), 'Model requests need a longer timeout than bridge actions.');
other.edit('preview', '用户修改的当前预览');
other.edit('level', 'concise');
await other.elements.get('refine').onclick();
assert.deepEqual(other.messages.filter(message => message.method === 'tools/call' && message.params.name === 'enhance_prompt').at(-1).params.arguments,
  { draft: '用户修改的当前预览', level: 'concise' }, 'Refinement must use the latest editable preview and selected level.');

const noMessages = await uiHarness({ messageSupported: false });
noMessages.edit('draft', 'draft');
assert.equal(noMessages.elements.get('enhance').disabled, false, 'Independent enhancement must not require chat message capability.');
await noMessages.elements.get('enhance').onclick();
assert.equal(noMessages.elements.get('preview').value, 'Task: 面板内的强化结果。');
assert.equal(noMessages.elements.get('insert').disabled, true);

const noTools = await uiHarness({ toolsSupported: false });
noTools.edit('draft', 'draft');
assert.equal(noTools.elements.get('enhance').disabled, true);
assert.match(noTools.elements.get('status').textContent, /工具调用能力/);
assert.equal(noTools.messages.some(message => message.method === 'tools/call'), false);

const lateResult = deferred();
const edited = await uiHarness({ toolHandler: ({ name }) => name === 'enhance_prompt' ? lateResult.promise : undefined });
edited.edit('draft', '初始草稿');
const editingRequest = edited.elements.get('enhance').onclick();
await settle();
edited.edit('preview', '生成期间的用户编辑');
edited.notify({ enhanced: '过期工具事件' });
lateResult.resolve({ structuredContent: { enhanced: '过期生成结果' } });
await editingRequest;
assert.equal(edited.elements.get('preview').value, '生成期间的用户编辑');
assert.match(edited.elements.get('status').textContent, /保留你的编辑/);
assert.equal(edited.elements.get('enhance').disabled, false, 'The panel must remain usable after preserving an edit.');

const cancelledResult = deferred();
let rewriteCount = 0;
const cancelled = await uiHarness({ toolHandler: ({ name }) => {
  if (name === 'enhance_prompt') return ++rewriteCount === 1 ? cancelledResult.promise : { structuredContent: { enhanced: '第二次强化结果' } };
} });
cancelled.edit('draft', '待取消草稿');
cancelled.edit('preview', '已有预览');
const cancelledRequest = cancelled.elements.get('enhance').onclick();
await settle();
assert.equal(cancelled.elements.get('cancel').hidden, false);
assert.equal(cancelled.elements.get('enhance').disabled, true);
await cancelled.elements.get('cancel').onclick();
assert.equal(cancelled.messages.filter(message => message.method === 'tools/call' && message.params.name === 'cancel_enhancement').length, 1);
assert.equal(cancelled.elements.get('cancel').hidden, true);
await cancelled.elements.get('enhance').onclick();
cancelledResult.resolve({ structuredContent: { enhanced: '取消后晚到的旧结果' } });
await cancelledRequest;
assert.equal(cancelled.elements.get('preview').value, '第二次强化结果', 'A cancelled request must not overwrite a later generation.');

let failures = 0;
const retry = await uiHarness({ toolHandler: ({ name }) => name === 'enhance_prompt'
  ? (++failures === 1 ? { isError: true, content: [{ type: 'text', text: '服务暂不可用，请重试。' }] } : { structuredContent: { enhanced: '重试成功' } })
  : undefined });
retry.edit('draft', '重试草稿');
retry.edit('preview', '失败前的预览');
await retry.elements.get('enhance').onclick();
assert.equal(retry.elements.get('preview').value, '失败前的预览');
assert.equal(retry.elements.get('status').textContent, '服务暂不可用，请重试。');
assert.equal(retry.elements.get('enhance').disabled, false);
await retry.elements.get('enhance').onclick();
assert.equal(retry.elements.get('preview').value, '重试成功');

let checks = 0;
const offline = await uiHarness({ toolHandler: ({ name }) => name === 'backend_status'
  ? { structuredContent: { available: ++checks > 1, message: '请启动本机 Codex。' } } : undefined });
offline.edit('draft', '服务恢复测试');
assert.equal(offline.elements.get('enhance').disabled, true);
assert.equal(offline.elements.get('reconnect').hidden, false);
assert.equal(offline.elements.get('status').textContent, '请启动本机 Codex。');
await offline.elements.get('reconnect').onclick();
assert.equal(offline.elements.get('enhance').disabled, false);
assert.equal(offline.elements.get('reconnect').hidden, true);

for (const harness of [ui, other, noMessages, noTools, edited, cancelled, retry, offline]) {
  assert.ok(harness.messages.filter(message => message.method === 'ui/message').every(message => message.params._meta['openai/message'].send === false),
    'No panel action may send a chat message.');
}
console.log('Desktop tests passed: MCP app-only tools and native entrypoints, transport/resources/input guards, same-panel enhancement/refinement, edit and cancellation protection, explicit draft insertion, capability fallbacks and retry.');
