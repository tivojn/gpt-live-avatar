'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('glaAppInfo', {
  get: () => ipcRenderer.invoke('gla:app-info:get'),
  check: () => ipcRenderer.invoke('gla:app-info:check'),
  open: kind => ipcRenderer.invoke('gla:app-info:open', kind),
  onChange: callback => { const handler = (_event, value) => callback(value); ipcRenderer.on('gla:app-info:changed', handler); return () => ipcRenderer.removeListener('gla:app-info:changed', handler); },
});
