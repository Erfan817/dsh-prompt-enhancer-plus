const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);
  if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
  return response.value;
}

contextBridge.exposeInMainWorld('promptEnhancer', {
  initialize: () => invoke('enhancer:init'),
  saveSettings: (settings) => invoke('enhancer:settings', settings),
  generate: (request) => invoke('enhancer:generate', request),
  cancel: () => invoke('enhancer:cancel'),
  copy: (text) => invoke('enhancer:copy', text),
  pin: (enabled) => invoke('enhancer:pin', enabled),
  fullscreen: () => invoke('enhancer:fullscreen'),
  hide: () => invoke('enhancer:hide'),
  quit: () => invoke('enhancer:quit'),
  ready: () => invoke('enhancer:ready'),
  onHidden: (callback) => {
    const listener = (_event, visible) => { if (!visible) callback(); };
    ipcRenderer.on('enhancer:visibility', listener);
    return () => ipcRenderer.removeListener('enhancer:visibility', listener);
  },
});
