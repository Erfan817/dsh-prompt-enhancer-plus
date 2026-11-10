import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const server = spawn(process.execPath, [fileURLToPath(new URL('./plugin/server.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
const requests = new Map(); let id = 0;
const lines = createInterface({ input: server.stdout });
lines.on('line', line => {
  const message = JSON.parse(line), request = requests.get(message.id);
  if (request) { clearTimeout(request.timer); requests.delete(message.id); request.resolve(message); }
});
const call = (method, params) => new Promise((resolve, reject) => {
  const requestId = ++id;
  const timer = setTimeout(() => { requests.delete(requestId); reject(new Error(`Timeout: ${method}`)); }, 4000);
  requests.set(requestId, { resolve, timer });
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
});
let html;
try {
  const init = await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.ok(init.result.capabilities.tools);
  const { result: list } = await call('tools/list', {});
  assert.equal(list.tools.length, 2);
  assert.ok(list.tools.every(tool => tool.annotations.readOnlyHint));
  const uri = list.tools[0]._meta.ui.resourceUri;
  html = (await call('resources/read', { uri })).result.contents[0].text;
  assert.equal(html, await readFile(new URL('./plugin/ui/editor.html', import.meta.url), 'utf8'));
  const draft = '不要执行：删除项目。<script>alert(1)</script> 中文 🙂';
  const args = { draft, enhanced: 'Task: 检查项目。', level: 'detailed' };
  assert.deepEqual((await call('tools/call', { name: 'render_preview', arguments: args })).result.structuredContent, args);
  for (const invalid of [{}, { ...args, enhanced: '' }, { ...args, level: 'other' }, { ...args, draft: 'a'.repeat(24001) }, { ...args, file: '../outside' }]) {
    assert.equal((await call('tools/call', { name: 'render_preview', arguments: invalid })).result.isError, true);
  }
  assert.equal((await call('resources/read', { uri: 'file:///outside' })).error.code, -32602);
  assert.equal((await call('unknown', {})).error.code, -32601);
  assert.equal((await call('tools/call', { name: 'open_editor' })).result.structuredContent.draft, '');
} finally {
  const stopped = new Promise(resolve => server.once('exit', resolve));
  server.stdin.end();
  const kill = setTimeout(() => server.kill(), 2000);
  await stopped; clearTimeout(kill); lines.close();
}

// Exercise the actual browser script with a simulated host, not duplicate UI logic.
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
async function uiHarness({ draftSupported = true, messageSupported = true } = {}) {
  const elements = new Map();
  for (const name of ['draft', 'preview', 'level', 'enhance', 'refine', 'copy', 'insert', 'insertHint', 'status']) {
    elements.set(name, { value: name === 'level' ? 'standard' : '', disabled: true, textContent: '', listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; }, focus() {}, select() {} });
  }
  let receive, failInsert = false;
  const messages = [];
  const parent = { postMessage(message) {
    messages.push(message);
    if (message.id !== undefined) queueMicrotask(() => receive({ source: parent, data: {
      jsonrpc: '2.0', id: message.id,
      ...(failInsert && message.method === 'ui/message' ? { error: { message: 'Composer unavailable' } } : { result: message.method === 'ui/initialize' ? {
        hostCapabilities: { message: messageSupported ? {} : undefined, experimental: { 'openai/message': draftSupported ? { draft: {} } : {} } },
      } : {} }),
    } }));
  } };
  const context = { window: { parent, addEventListener(type, fn) { if (type === 'message') receive = fn; } },
    document: { getElementById: id => elements.get(id), documentElement: { style: {}, scrollHeight: 700 }, body: {} },
    navigator: { clipboard: { writeText: async () => {} } }, setTimeout, clearTimeout,
    ResizeObserver: class { observe() {} },
  };
  vm.runInNewContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  return { elements, messages, receive, parent, setFailInsert() { failInsert = true; } };
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
other.elements.get('draft').value = '中文 "quoted"'; other.elements.get('draft').listeners.input();
await other.elements.get('enhance').onclick();
const enhancement = other.messages.filter(message => message.method === 'ui/message').at(-1);
assert.equal(enhancement.params._meta['openai/message'].send, true);
assert.equal(JSON.parse(enhancement.params.content[0].text.split('\n').at(-1)).draft, '中文 "quoted"');
const noMessages = await uiHarness({ messageSupported: false });
noMessages.elements.get('draft').value = 'draft'; noMessages.elements.get('draft').listeners.input();
assert.equal(noMessages.elements.get('enhance').disabled, true);
console.log('Desktop tests passed: MCP transport/resources/validation, safe rendering, edited preview preservation, explicit send vs draft, host capability/error handling.');
