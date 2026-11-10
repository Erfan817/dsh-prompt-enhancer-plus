'use strict';

/**
 * Prompt Spark（提示词强化）VS Code / Cursor 扩展入口。
 *
 * 架构：
 *   - 命令/快捷键把当前文本交给扩展主进程；
 *   - WebviewView（底部面板）通过 postMessage 把内容交给扩展主进程；
 *   - 扩展主进程再调用本地 desktop 服务（/api/enhance），并把结果回传。
 *
 * 注意：webview 里绝不直接 fetch 本地服务——本地服务有同源（Origin）与 CSP 校验，
 * webview 的 Origin 与 127.0.0.1 服务不同源，会被拦截；必须由扩展主进程代理请求。
 */

const crypto = require('node:crypto');
const vscode = require('vscode');
const client = require('./lib/client');

const VIEW_ID = 'promptSpark.panel';
const STANDALONE_PANEL_TYPE = 'promptSpark.standalonePanel';
const DEFAULT_LEVEL = 'standard';
const DEFAULT_MODE = 'general';
const LEVELS = ['concise', 'standard', 'detailed'];
const MODES = ['general', 'system', 'task', 'concise'];

let standalonePanel;

function pick(value, allowed, fallback) {
  const text = typeof value === 'string' ? value : '';
  return allowed.includes(text) ? text : fallback;
}

function serviceErrorText(error) {
  const message = error && error.message ? error.message : String(error);
  if (message.includes('npm run desktop')) return message;
  return `${message}。请先运行 npm run desktop 启动本地服务。`;
}

function showServiceError(error) {
  void vscode.window.showErrorMessage(`提示词强化失败：${serviceErrorText(error)}`);
}

/** 每次调用都重新读取发现文件：本地服务重启后 token 会轮换。 */
async function callEnhance({ text, level, mode, format }) {
  const session = client.readSession();
  return client.enhance({
    origin: session.origin,
    token: session.token,
    text,
    level: pick(level, LEVELS, DEFAULT_LEVEL),
    mode: pick(mode, MODES, DEFAULT_MODE),
    ...(format === undefined ? {} : { format }),
  });
}

function withEnhanceProgress(task) {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Prompt Spark：正在强化提示词…' },
    task,
  );
}

async function insertTextAtCursor(text) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('没有活动的文本编辑器，无法插入结果。');
  const applied = await editor.edit((builder) => builder.insert(editor.selection.active, text));
  if (!applied) throw new Error('无法插入结果（文档可能已被修改）。');
}

async function enhanceSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showInformationMessage('请先打开一个文本编辑器，并选中要强化的文字。');
    return;
  }
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  if (selection.isEmpty || !selectedText.trim()) {
    await vscode.window.showInformationMessage('请先选中要强化的文字。');
    return;
  }
  try {
    const result = await withEnhanceProgress(() => callEnhance({ text: selectedText, level: DEFAULT_LEVEL, mode: DEFAULT_MODE }));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(editor.document.uri, selection, result.enhanced);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) throw new Error('无法替换选区（文档可能已被修改）。');
    vscode.window.setStatusBarMessage('$(check) 提示词已强化', 3000);
  } catch (error) {
    showServiceError(error);
  }
}

async function enhanceInput() {
  const draft = await vscode.window.showInputBox({
    title: 'Prompt Spark：强化提示词',
    prompt: '输入要强化的提示词草稿',
    placeHolder: '例如：帮我写一个登录接口，要安全一点',
    ignoreFocusOut: true,
    validateInput: (value) => (value && value.trim() ? undefined : '请输入要强化的内容'),
  });
  if (draft === undefined) return;
  try {
    const result = await withEnhanceProgress(() => callEnhance({ text: draft, level: DEFAULT_LEVEL, mode: DEFAULT_MODE }));
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await insertTextAtCursor(result.enhanced);
    } else {
      const document = await vscode.workspace.openTextDocument({ content: result.enhanced, language: 'markdown' });
      await vscode.window.showTextDocument(document, { preview: false });
    }
    vscode.window.setStatusBarMessage('$(check) 提示词已强化', 3000);
  } catch (error) {
    showServiceError(error);
  }
}

async function openPanel() {
  try {
    // VS Code 会为每个 webview view 自动生成 `<viewId>.focus` 命令，用于展开并聚焦底部面板。
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    return;
  } catch {
    // 个别环境/版本下 view 尚未注册时，退化为独立 WebviewPanel，保证命令永远可用。
  }
  showStandalonePanel();
}

function showStandalonePanel() {
  if (standalonePanel) {
    standalonePanel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  const mediaRoot = vscode.Uri.joinPath(vscode.Uri.file(__dirname), 'media');
  const panel = vscode.window.createWebviewPanel(
    STANDALONE_PANEL_TYPE,
    'Prompt Spark（提示词强化）',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot] },
  );
  standalonePanel = panel;
  panel.webview.html = getWebviewHtml(panel.webview);
  bindMessageHandler(panel.webview);
  panel.onDidDispose(() => { if (standalonePanel === panel) standalonePanel = undefined; });
}

function bindMessageHandler(webview) {
  webview.onDidReceiveMessage(async (message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'enhance') {
      try {
        const result = await callEnhance({
          text: typeof message.text === 'string' ? message.text : '',
          level: message.level,
          mode: message.mode,
        });
        await webview.postMessage({ type: 'result', result });
      } catch (error) {
        await webview.postMessage({ type: 'error', message: serviceErrorText(error) });
      }
      return;
    }
    if (message.type === 'copy') {
      try {
        await vscode.env.clipboard.writeText(typeof message.text === 'string' ? message.text : '');
        await webview.postMessage({ type: 'copied' });
      } catch (error) {
        await webview.postMessage({ type: 'error', message: `复制失败：${error.message}` });
      }
      return;
    }
    if (message.type === 'insert') {
      try {
        await insertTextAtCursor(typeof message.text === 'string' ? message.text : '');
        await webview.postMessage({ type: 'inserted' });
      } catch (error) {
        await webview.postMessage({ type: 'error', message: `插入失败：${error.message}` });
      }
    }
  });
}

class PromptSparkViewProvider {
  constructor(context) {
    this.context = context;
  }

  resolveWebviewView(webviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    webviewView.webview.html = getWebviewHtml(webviewView.webview);
    bindMessageHandler(webviewView.webview);
  }
}

function getWebviewHtml(webview) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>提示词强化</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      padding: 10px 12px 12px;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-panel-background, var(--vscode-editor-background, transparent));
    }
    .page { display: flex; flex-direction: column; gap: 8px; max-width: 960px; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .row.between { justify-content: space-between; }
    .label { color: var(--vscode-descriptionForeground); }
    select {
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border, transparent);
      border-radius: 2px;
      padding: 3px 6px;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 92px;
      resize: vertical;
      padding: 8px 10px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.5;
    }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    button {
      border: none;
      border-radius: 2px;
      padding: 5px 14px;
      cursor: pointer;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.55; cursor: default; }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .status { min-height: 1.4em; color: var(--vscode-descriptionForeground); }
    .status.ok { color: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #388a34)); }
    .status.error { color: var(--vscode-errorForeground); }
    .hint { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
    #result { min-height: 120px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="row">
      <label class="label" for="level">详细度</label>
      <select id="level">
        <option value="concise">简洁</option>
        <option value="standard" selected>标准</option>
        <option value="detailed">详细</option>
      </select>
      <label class="label" for="mode">方式</label>
      <select id="mode">
        <option value="general" selected>通用</option>
        <option value="system">系统提示</option>
        <option value="task">任务</option>
        <option value="concise">精简</option>
      </select>
      <button id="enhance" class="primary">✨ 强化</button>
    </div>
    <textarea id="input" placeholder="粘贴或输入要强化的提示词草稿…" spellcheck="false"></textarea>
    <div class="row between">
      <span id="status" class="status"></span>
      <span class="hint">快捷键 Ctrl+Alt+E（macOS：Cmd+Alt+E）可强化编辑器中选中的文本</span>
    </div>
    <textarea id="result" readonly placeholder="强化结果会显示在这里…" spellcheck="false"></textarea>
    <div class="row">
      <button id="copy" class="secondary">复制</button>
      <button id="insert" class="secondary">插入编辑器</button>
    </div>
  </div>
  <script nonce="${nonce}">
    (function () {
      var vscode = acquireVsCodeApi();
      var input = document.getElementById('input');
      var result = document.getElementById('result');
      var status = document.getElementById('status');
      var enhanceButton = document.getElementById('enhance');
      var busy = false;

      function setStatus(text, kind) {
        status.textContent = text || '';
        status.className = 'status' + (kind ? ' ' + kind : '');
      }

      function setBusy(value) {
        busy = value;
        enhanceButton.disabled = value;
        enhanceButton.textContent = value ? '强化中…' : '✨ 强化';
      }

      enhanceButton.addEventListener('click', function () {
        if (busy) return;
        var text = input.value;
        if (!text || !text.trim()) {
          setStatus('请先输入要强化的提示词。', 'error');
          input.focus();
          return;
        }
        setBusy(true);
        setStatus('正在调用本地服务…');
        vscode.postMessage({
          type: 'enhance',
          text: text,
          level: document.getElementById('level').value,
          mode: document.getElementById('mode').value,
        });
      });

      document.getElementById('copy').addEventListener('click', function () {
        if (!result.value || !result.value.trim()) {
          setStatus('还没有可复制的结果。', 'error');
          return;
        }
        vscode.postMessage({ type: 'copy', text: result.value });
      });

      document.getElementById('insert').addEventListener('click', function () {
        if (!result.value || !result.value.trim()) {
          setStatus('还没有可插入的结果。', 'error');
          return;
        }
        vscode.postMessage({ type: 'insert', text: result.value });
      });

      window.addEventListener('message', function (event) {
        var message = event.data || {};
        if (message.type === 'result') {
          var value = message.result || {};
          result.value = typeof value.enhanced === 'string' ? value.enhanced : '';
          var meta = [];
          if (value.level) meta.push('详细度：' + value.level);
          if (typeof value.elapsedMs === 'number') meta.push((value.elapsedMs / 1000).toFixed(1) + 's');
          setStatus('强化完成' + (meta.length ? ' · ' + meta.join(' · ') : ''), 'ok');
          setBusy(false);
        } else if (message.type === 'error') {
          setStatus(message.message || '强化失败。', 'error');
          setBusy(false);
        } else if (message.type === 'copied') {
          setStatus('已复制到剪贴板。', 'ok');
        } else if (message.type === 'inserted') {
          setStatus('已插入到当前编辑器。', 'ok');
        }
      });
    })();
  </script>
</body>
</html>`;
}

function activate(context) {
  const provider = new PromptSparkViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('promptSpark.enhanceSelection', enhanceSelection),
    vscode.commands.registerCommand('promptSpark.enhanceInput', enhanceInput),
    vscode.commands.registerCommand('promptSpark.openPanel', openPanel),
  );
}

function deactivate() {
  if (standalonePanel) {
    standalonePanel.dispose();
    standalonePanel = undefined;
  }
}

module.exports = { activate, deactivate };
