(() => {
  const token = __BRIDGE_TOKEN__;
  async function call(action, payload = {}) {
    let response;
    try {
      response = await fetch(`/api/${action}`, {
        method: 'POST', cache: 'no-store',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error('本地助手服务未连接。请重新运行“启动通用窗口.cmd”，再打开它显示的地址。');
    }
    const result = await response.json();
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.error?.message || '本地操作失败。'), { code: result.error?.code });
    return result.value;
  }
  window.promptEnhancer = Object.freeze({
    initialize: () => call('init'),
    saveSettings: (settings) => call('settings', settings),
    generate: (request) => call('generate', request),
    cancel: () => call('cancel'),
    copy: async (text) => {
      if (!navigator.clipboard?.writeText) throw new Error('浏览器未提供剪贴板权限。请选中正文后按 Ctrl / Cmd + C。');
      await navigator.clipboard.writeText(text);
      return true;
    },
    pin: async () => false,
    fullscreen: async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      return Boolean(document.fullscreenElement);
    },
    hide: async () => false,
    quit: () => call('quit'),
    ready: async () => true,
    onHidden: () => () => {},
  });
})();
