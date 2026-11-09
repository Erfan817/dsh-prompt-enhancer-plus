const api = window.promptEnhancer;
const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id, element]));
let settings;
let runtime = 'electron';
let serviceStopped = false;
let busy = false;
let requestId = 0;
let pinned = false;
let resizeFrame;

function setStatus(message = '', failed = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('error', failed);
}

function autosize(element) {
  if (!element.offsetParent) return;
  const scrollPosition = elements.workspace.scrollTop;
  element.style.height = '0px';
  element.style.height = `${element.scrollHeight + 2}px`;
  elements.workspace.scrollTop = scrollPosition;
}

function updateActions() {
  elements.generate.disabled = serviceStopped || busy || !settings || !elements.draft.value.trim();
  elements.generate.textContent = busy ? '正在强化…' : elements.resultSection.hidden ? '强化提示词' : '重新强化';
  elements.copy.disabled = !elements.result.value.trim();
  elements.result.readOnly = busy;
  elements.cancel.hidden = !busy;
  for (const control of [elements.mode, elements.persona, elements.format, elements.direction, elements.settings]) control.disabled = serviceStopped || busy;
}

function updateDirection() {
  elements.customDirection.hidden = elements.persona.value !== 'custom';
  autosize(elements.direction);
}

function populateSettings() {
  elements.provider.value = settings.provider;
  elements.baseUrl.value = settings.baseUrl;
  elements.model.value = settings.model;
  elements.apiKey.value = '';
  elements.forgetKey.checked = false;
  elements.rememberKey.checked = settings.rememberKey && settings.canRememberKey;
  elements.rememberKey.disabled = !settings.canRememberKey;
  elements.savedDirection.value = elements.direction.value;
  elements.keyHint.textContent = settings.keyWarning || (settings.keyPresent ? '已配置 Key；不会把已保存的 Key 返回到此输入框。' : '尚未配置 Key。远程 API 通常需要 Key，本地模型可留空。');
  if (!settings.canRememberKey) elements.keyHint.textContent += ' 系统安全存储不可用，Key 只在本次运行内存中保留。';
  elements.settingsStatus.textContent = '';
}

function updateConnectionHint() {
  const hostname = new URL(settings.baseUrl).host;
  elements.connectionHint.textContent = `${settings.model} · ${hostname} · 仅点击生成时发送内容`;
}

async function cancelGeneration() {
  requestId += 1;
  try { await api.cancel(); setStatus('已取消，原文与已有结果均保留。'); }
  catch (error) { setStatus(error.message, true); }
  finally { busy = false; updateActions(); }
}

async function generate() {
  if (serviceStopped || busy || !settings || !elements.draft.value.trim()) return;
  const original = elements.draft.value;
  const generation = ++requestId;
  busy = true;
  setStatus('正在整理表达，不会发送到任何聊天窗口…');
  updateActions();
  try {
    const result = await api.generate({
      text: original, mode: elements.mode.value, format: elements.format.value,
      personaId: elements.persona.value, direction: elements.direction.value,
    });
    if (generation !== requestId) return;
    elements.result.value = result.enhanced;
    elements.resultSection.hidden = false;
    elements.emptyState.hidden = true;
    elements.draftPanel.open = false;
    const usage = result.usage?.totalTokens ?? ((result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0));
    elements.metadata.textContent = `${result.model} · ${result.format === 'markdown' ? 'Markdown' : '自然纯文本'} · ${(result.elapsedMs / 1000).toFixed(1)} 秒${usage ? ` · ${usage} tokens` : ' · 用量未提供'}。切换方式或格式后，重新强化会再次调用模型。`;
    autosize(elements.result);
    elements.workspace.scrollTop = 0;
    setStatus(elements.draft.value === original ? '已强化。可以直接编辑，再复制到你要用的 Agent。' : '已生成点击时原文的结果；你后来修改的原文没有被覆盖。');
  } catch (error) {
    if (generation === requestId) setStatus(error.message, error.code !== 'aborted');
  } finally {
    if (generation === requestId) { busy = false; updateActions(); }
  }
}

elements.generate.addEventListener('click', generate);
elements.cancel.addEventListener('click', cancelGeneration);
elements.copy.addEventListener('click', async () => {
  try { await api.copy(elements.result.value); setStatus('已复制全文。切回 Claude、Codex 或其他软件后粘贴即可。'); }
  catch (error) { setStatus(error.message, true); }
});
elements.draft.addEventListener('input', () => {
  elements.draftSummary.textContent = elements.draft.value.trim().replace(/\s+/gu, ' ').slice(0, 90) || '不必写得很完整，保留你真正想做的事就好';
  autosize(elements.draft);
  updateActions();
});
elements.draftPanel.addEventListener('toggle', () => autosize(elements.draft));
elements.result.addEventListener('input', () => { autosize(elements.result); updateActions(); });
elements.persona.addEventListener('change', updateDirection);
elements.direction.addEventListener('input', () => autosize(elements.direction));
elements.settings.addEventListener('click', () => { populateSettings(); elements.settingsDialog.showModal(); });
elements.closeSettings.addEventListener('click', () => elements.settingsDialog.close());
elements.settingsDialog.addEventListener('close', () => { elements.apiKey.value = ''; });
elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.saveSettings.disabled = true;
  elements.settingsStatus.textContent = '正在保存…';
  try {
    settings = await api.saveSettings({
      provider: elements.provider.value, baseUrl: elements.baseUrl.value, model: elements.model.value,
      apiKey: elements.apiKey.value, rememberKey: elements.rememberKey.checked, forgetKey: elements.forgetKey.checked,
      personaId: elements.persona.value, direction: elements.savedDirection.value,
    });
    elements.direction.value = settings.direction;
    updateConnectionHint();
    elements.apiKey.value = '';
    elements.settingsDialog.close();
    setStatus('设置已保存。只有点击“强化提示词”才会调用模型。');
  } catch (error) { elements.settingsStatus.textContent = error.message; }
  finally { elements.saveSettings.disabled = false; }
});
elements.pin.addEventListener('click', async () => {
  try { pinned = await api.pin(!pinned); elements.pin.setAttribute('aria-pressed', String(pinned)); elements.pin.textContent = pinned ? '已置顶' : '置顶'; }
  catch (error) { setStatus(error.message, true); }
});
elements.fullscreen.addEventListener('click', async () => {
  try { await api.fullscreen(); }
  catch (error) { setStatus(error.message, true); }
});
elements.quit.addEventListener('click', async () => {
  try {
    await api.quit();
    serviceStopped = true;
    requestId += 1;
    busy = false;
    setStatus('本地助手服务已退出。可以关闭窗口，或先复制当前结果。');
    updateActions();
    elements.quit.disabled = true;
  } catch (error) { setStatus(error.message, true); }
});
document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Escape' && !elements.settingsDialog.open) {
    event.preventDefault();
    if (busy) void cancelGeneration();
    else if (runtime === 'browser') setStatus('本地窗口模式请通过任务栏最小化；点“退出”可结束服务。');
    else void api.hide();
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !elements.settingsDialog.open) {
    event.preventDefault();
    void generate();
  }
});
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { autosize(elements.draft); autosize(elements.result); autosize(elements.direction); });
});
const removeHiddenListener = api.onHidden(() => {
  requestId += 1;
  busy = false;
  updateActions();
  setStatus('窗口已隐藏，本次生成已取消；已有文字保留。');
});
window.addEventListener('beforeunload', () => { removeHiddenListener(); cancelAnimationFrame(resizeFrame); });

async function initialize() {
  try {
    const initial = await api.initialize();
    runtime = initial.runtime || 'electron';
    settings = initial.settings;
    elements.pin.hidden = runtime === 'browser';
    if (runtime === 'browser') elements.runtimeHint.textContent = '本地窗口使用你已有的浏览器，不依赖 Electron，不提供原生置顶或全局快捷键。可按 Ctrl / Cmd + Enter 强化，点“退出”结束本地服务。Key 仅保留在本次进程内存，不保存任务历史。';
    for (const persona of [...initial.personas, { id: 'custom', name: '我的自定义方向' }]) {
      const option = document.createElement('option');
      option.value = persona.id;
      option.textContent = persona.name;
      elements.persona.append(option);
    }
    elements.persona.value = settings.personaId;
    if (!elements.persona.value) elements.persona.value = 'builtin:balanced';
    elements.direction.value = settings.direction;
    elements.shortcutHint.textContent = runtime === 'browser' ? '本机窗口 · Ctrl / Cmd + Enter 强化 · 复制到任意 Agent 使用'
      : initial.shortcutAvailable ? 'Ctrl / Cmd + Shift + Space 唤出 · Ctrl / Cmd + Enter 强化' : '快捷键被占用；关闭会最小化，可从任务栏重新打开。';
    updateDirection();
    updateConnectionHint();
    updateActions();
    if (!settings.keyPresent) setStatus('首次使用请打开设置，填写你的模型 API；本地无鉴权模型可不填 Key。');
    if (settings.keyWarning) setStatus(settings.keyWarning, true);
    await api.ready();
  } catch (error) { setStatus(`初始化失败：${error.message}`, true); }
}

void initialize();
